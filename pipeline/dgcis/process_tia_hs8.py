from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]

SOURCE = ROOT / "data" / "dgcis" / "incoming" / "DGCIS_DATA.csv"
PROCESSED = ROOT / "data" / "dgcis" / "processed"
RAW = ROOT / "data" / "dgcis" / "raw"

OUT_LONG = PROCESSED / "india_hs8_monthly.csv"
OUT_SCOPE = PROCESSED / "hs8_scope.csv"
OUT_MANIFEST = PROCESSED / "manifest.json"

FED = ROOT / "config" / "fed_sector_definition.csv"
HS6_UNIVERSE = ROOT / "config" / "hs6_universe.txt"

PROCESSED.mkdir(parents=True, exist_ok=True)
RAW.mkdir(parents=True, exist_ok=True)


MONTHS = {
    "January": 1,
    "February": 2,
    "March": 3,
    "April": 4,
    "May": 5,
    "June": 6,
    "July": 7,
    "August": 8,
    "September": 9,
    "October": 10,
    "November": 11,
    "December": 12,
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def normalise_code(value, length=None):
    if pd.isna(value):
        return ""

    s = str(value).strip()

    # Deal with Excel-like 85171300.0
    if s.endswith(".0"):
        s = s[:-2]

    s = re.sub(r"\D", "", s)

    if length and s:
        s = s.zfill(length)

    return s


def load_hstat_scope():
    """
    Build the currently represented HStat HS2 / HS4 / HS6 universe.

    Prefer hs6_universe.txt because it is the generated universe actually
    shipped by HStat. Fall back to fed_sector_definition.csv only if needed.
    """
    hs6_codes = set()

    if HS6_UNIVERSE.exists():
        for line in HS6_UNIVERSE.read_text(encoding="utf-8").splitlines():
            code = normalise_code(line)
            if len(code) == 6:
                hs6_codes.add(code)

    if not hs6_codes:
        fed = pd.read_csv(FED, dtype=str).fillna("")

        candidates = [
            "hs_code",
            "hs6",
            "HS Code",
            "code",
            "hs",
        ]

        code_col = next((c for c in candidates if c in fed.columns), None)

        if not code_col:
            raise SystemExit(
                "Could not identify HS-code column in "
                f"{FED}. Columns: {list(fed.columns)}"
            )

        for raw in fed[code_col]:
            code = normalise_code(raw)
            if len(code) >= 6:
                hs6_codes.add(code[:6])

    hs4_codes = {x[:4] for x in hs6_codes}
    hs2_codes = {x[:2] for x in hs6_codes}

    return hs2_codes, hs4_codes, hs6_codes


def parse_value_column(name):
    """
    Example:
        April-2024_INR_Cr
        April-2024_USD_Mn

    Return:
        month, year, metric
    """
    m = re.fullmatch(
        r"(January|February|March|April|May|June|July|August|"
        r"September|October|November|December)-(\d{4})_(INR_Cr|USD_Mn)",
        name,
    )

    if not m:
        return None

    month_name, year, metric = m.groups()

    return {
        "month_name": month_name,
        "month": MONTHS[month_name],
        "year": int(year),
        "metric": metric,
    }


if not SOURCE.exists():
    raise SystemExit(f"Missing source file: {SOURCE}")


df = pd.read_csv(SOURCE, dtype=str).fillna("")

required = {
    "HS Code",
    "Country Name",
    "Principal Commodity",
    "Quick Estimate Commodity",
}

missing = required - set(df.columns)

if missing:
    raise SystemExit(f"Missing required columns: {sorted(missing)}")


# Drop the aggregate TOTAL row from the source extract.
# DGCIS stores it with a blank HS Code and Country Name == TOTAL.
# It is an aggregate footer, not an HS8 commodity observation.
df = df[df["Country Name"].str.strip().str.upper() != "TOTAL"].copy()

df["hs8"] = df["HS Code"].map(lambda x: normalise_code(x, 8))

bad_hs = df[~df["hs8"].str.fullmatch(r"\d{8}")]

if len(bad_hs):
    raise SystemExit(
        f"Found {len(bad_hs)} malformed HS8 codes. "
        "Stopping instead of silently dropping them."
    )


# ------------------------------------------------------------
# HStat scope
# ------------------------------------------------------------

hs2_scope, hs4_scope, hs6_scope = load_hstat_scope()


def match_scope(hs8):
    hs2 = hs8[:2]
    hs4 = hs8[:4]
    hs6 = hs8[:6]

    matches = []

    if hs6 in hs6_scope:
        matches.append("HS6")

    if hs4 in hs4_scope:
        matches.append("HS4")

    if hs2 in hs2_scope:
        matches.append("HS2")

    return ",".join(matches)


df["scope_match"] = df["hs8"].map(match_scope)

scoped = df[df["scope_match"] != ""].copy()

scoped["hs6"] = scoped["hs8"].str[:6]
scoped["hs4"] = scoped["hs8"].str[:4]
scoped["hs2"] = scoped["hs8"].str[:2]


# ------------------------------------------------------------
# HS8 scope reference
# ------------------------------------------------------------

scope_cols = [
    "hs8",
    "hs6",
    "hs4",
    "hs2",
    "scope_match",
    "Principal Commodity",
    "Quick Estimate Commodity",
]

scope_ref = (
    scoped[scope_cols]
    .drop_duplicates("hs8")
    .sort_values("hs8")
)

scope_ref.to_csv(OUT_SCOPE, index=False)


# ------------------------------------------------------------
# Wide -> long monthly data
# ------------------------------------------------------------

value_columns = {}

for col in df.columns:
    parsed = parse_value_column(col)

    if parsed:
        key = (parsed["year"], parsed["month"])
        value_columns.setdefault(key, {})[parsed["metric"]] = col


rows = []

for _, record in scoped.iterrows():
    for (year, month), cols in sorted(value_columns.items()):

        inr_col = cols.get("INR_Cr")
        usd_col = cols.get("USD_Mn")

        raw_inr = record.get(inr_col, "") if inr_col else ""
        raw_usd = record.get(usd_col, "") if usd_col else ""

        def numeric(x):
            if x in ("", None):
                return None
            try:
                return float(str(x).replace(",", ""))
            except ValueError:
                return None

        inr_cr = numeric(raw_inr)
        usd_mn = numeric(raw_usd)

        # Preserve true zero observations.
        # Skip only where BOTH measures are genuinely absent.
        if inr_cr is None and usd_mn is None:
            continue

        rows.append({
            "hs8": record["hs8"],
            "hs6": record["hs6"],
            "hs4": record["hs4"],
            "hs2": record["hs2"],
            "scope_match": record["scope_match"],
            "country": record["Country Name"],
            "principal_commodity": record["Principal Commodity"],
            "quick_estimate_commodity": record["Quick Estimate Commodity"],
            "year": year,
            "month": month,
            "period": f"{year}-{month:02d}",
            "import_inr_crore": inr_cr,
            "import_usd_million": usd_mn,

            # Convenience normalized values.
            # These are arithmetic unit conversions only.
            "import_inr": (
                inr_cr * 10_000_000
                if inr_cr is not None
                else None
            ),
            "import_usd": (
                usd_mn * 1_000_000
                if usd_mn is not None
                else None
            ),
        })


long_df = pd.DataFrame(rows)

if long_df.empty:
    raise SystemExit("No monthly HS8 observations were produced.")


# ------------------------------------------------------------
# QA
# ------------------------------------------------------------

duplicate_key = [
    "hs8",
    "country",
    "year",
    "month",
]

duplicates = long_df.duplicated(
    subset=duplicate_key,
    keep=False,
)

if duplicates.any():
    sample = long_df.loc[duplicates, duplicate_key].head(20)
    print(sample.to_string(index=False))

    raise SystemExit(
        f"Found {duplicates.sum()} duplicated HS8/month observations."
    )


long_df = long_df.sort_values(
    ["hs8", "year", "month"]
).reset_index(drop=True)

long_df.to_csv(OUT_LONG, index=False)


# ------------------------------------------------------------
# Archive exact source
# ------------------------------------------------------------

digest = sha256(SOURCE)

stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

archive = RAW / f"{stamp}_DGCIS_DATA.csv"

if not archive.exists():
    archive.write_bytes(SOURCE.read_bytes())


# ------------------------------------------------------------
# Manifest
# ------------------------------------------------------------

manifest = {
    "source": "DGCIS Trade Intelligence and Analytics Portal",
    "sourceFile": SOURCE.name,
    "sourceSha256": digest,
    "processedAt": datetime.now(timezone.utc).isoformat(),
    "flow": "imports",
    "country": sorted(scoped["Country Name"].unique().tolist()),
    "sourceRows": int(len(df)),
    "sourceHS8": int(df["hs8"].nunique()),
    "inScopeSourceRows": int(len(scoped)),
    "inScopeHS8": int(scoped["hs8"].nunique()),
    "processedMonthlyRows": int(len(long_df)),
    "firstPeriod": str(long_df["period"].min()),
    "lastPeriod": str(long_df["period"].max()),
    "hs2ScopeCount": len(hs2_scope),
    "hs4ScopeCount": len(hs4_scope),
    "hs6ScopeCount": len(hs6_scope),
    "matchingRule": (
        "HS8 retained when its first 6, 4, or 2 digits match "
        "a currently represented HStat HS6/HS4/HS2 code."
    ),
    "units": {
        "import_inr_crore": "INR crore exactly as supplied by DGCIS",
        "import_usd_million": "USD million exactly as supplied by DGCIS",
        "import_inr": "INR crore × 10,000,000",
        "import_usd": "USD million × 1,000,000",
    },
}

OUT_MANIFEST.write_text(
    json.dumps(manifest, indent=2),
    encoding="utf-8",
)


print("\nDGCIS HS8 processing complete")
print("--------------------------------")
print(f"Source rows            : {len(df):,}")
print(f"Source HS8             : {df['hs8'].nunique():,}")
print(f"In-scope HS8           : {scoped['hs8'].nunique():,}")
print(f"Processed monthly rows : {len(long_df):,}")
print(f"Period                 : {long_df['period'].min()} -> {long_df['period'].max()}")
print(f"Countries              : {', '.join(sorted(scoped['Country Name'].unique()))}")
print()
print(f"HS8 scope   : {OUT_SCOPE}")
print(f"Monthly data: {OUT_LONG}")
print(f"Manifest    : {OUT_MANIFEST}")
print(f"Raw archive : {archive}")
