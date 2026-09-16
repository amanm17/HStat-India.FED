#!/usr/bin/env python3
"""
Turn a DGCIS Trade Intelligence & Analytics extract into tidy monthly HS-8 rows.

FLOW IS DECLARED, NOT ASSUMED

The extract has no flow column. Nothing in the CSV says whether these are
India's imports or India's exports - the portal knows, the file does not.
An earlier version of this script wrote `"flow": "imports"` as a literal and
every figure downstream inherited that word. The data was exports.

So --flow is required, there is no default, and flow_guard.py weighs the
declaration against Comtrade's India series before anything is written. A
declaration the evidence contradicts stops the run.

Value columns are named `value_*`, not `import_*`. A column called
`import_usd_million` carrying export figures is how the first mistake spread:
every reader downstream, human or code, took the column name at its word.

Run:
    python3 pipeline/dgcis/process_tia_hs8.py --flow exports
    python3 pipeline/dgcis/process_tia_hs8.py --flow imports --source path/to.csv
"""
from __future__ import annotations

from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import re
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

import flow_guard  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]

INCOMING = ROOT / "data" / "dgcis" / "incoming"
PROCESSED = ROOT / "data" / "dgcis" / "processed"
RAW = ROOT / "data" / "dgcis" / "raw"

FED = ROOT / "config" / "fed_sector_definition.csv"
HS6_UNIVERSE = ROOT / "config" / "hs6_universe.txt"

FLOWS = ("imports", "exports")

MONTHS = {
    "January": 1, "February": 2, "March": 3, "April": 4,
    "May": 5, "June": 6, "July": 7, "August": 8,
    "September": 9, "October": 10, "November": 11, "December": 12,
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

        candidates = ["hs_code", "hs6", "HS Code", "code", "hs"]
        code_col = next((c for c in candidates if c in fed.columns), None)

        if not code_col:
            raise SystemExit(
                f"Could not identify HS-code column in {FED}. "
                f"Columns: {list(fed.columns)}"
            )

        for raw in fed[code_col]:
            code = normalise_code(raw)
            if len(code) >= 6:
                hs6_codes.add(code[:6])

    return {x[:2] for x in hs6_codes}, {x[:4] for x in hs6_codes}, hs6_codes


def parse_value_column(name):
    """
    Example:
        April-2024_INR_Cr
        April-2024_USD_Mn
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


def resolve_source(flow: str, given: str | None) -> Path:
    """
    The file to read, preferring one whose name states its flow.

    A single DGCIS_DATA.csv is accepted because that is what the portal hands
    back, but it is called out: a file named for nothing is how a run ends up
    processing last month's imports as this month's exports. The guard below
    is what actually settles it.
    """
    if given:
        return Path(given)

    named = INCOMING / f"DGCIS_DATA_{flow}.csv"

    if named.exists():
        return named

    plain = INCOMING / "DGCIS_DATA.csv"

    if plain.exists():
        print(f"note: {plain.name} does not say which flow it holds; reading it "
              f"as --flow {flow}, which the flow guard will confirm or reject.")
        print(f"      rename it to {named.name} to remove the ambiguity.\n")
        return plain

    return named


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--flow", required=True, choices=FLOWS,
        help="which flow this extract holds. Required: the file does not say.",
    )
    parser.add_argument("--source", default=None)
    args = parser.parse_args()

    flow = args.flow

    PROCESSED.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)

    out_long = PROCESSED / f"india_hs8_monthly_{flow}.csv"
    out_scope = PROCESSED / f"hs8_scope_{flow}.csv"
    out_manifest = PROCESSED / f"manifest_{flow}.json"

    source = resolve_source(flow, args.source)

    if not source.exists():
        raise SystemExit(
            f"Missing source file: {source}\n"
            f"Put the portal download at {INCOMING / f'DGCIS_DATA_{flow}.csv'}"
        )

    df = pd.read_csv(source, dtype=str).fillna("")

    required = {
        "HS Code", "Country Name",
        "Principal Commodity", "Quick Estimate Commodity",
    }

    missing = required - set(df.columns)

    if missing:
        raise SystemExit(f"Missing required columns: {sorted(missing)}")

    # Drop the aggregate TOTAL row from the source extract.
    # DGCIS stores it with a blank HS Code and Country Name == TOTAL.
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
        matches = []

        if hs8[:6] in hs6_scope:
            matches.append("HS6")

        if hs8[:4] in hs4_scope:
            matches.append("HS4")

        if hs8[:2] in hs2_scope:
            matches.append("HS2")

        return ",".join(matches)

    df["scope_match"] = df["hs8"].map(match_scope)

    scoped = df[df["scope_match"] != ""].copy()

    scoped["hs6"] = scoped["hs8"].str[:6]
    scoped["hs4"] = scoped["hs8"].str[:4]
    scoped["hs2"] = scoped["hs8"].str[:2]

    scope_ref = (
        scoped[[
            "hs8", "hs6", "hs4", "hs2", "scope_match",
            "Principal Commodity", "Quick Estimate Commodity",
        ]]
        .drop_duplicates("hs8")
        .sort_values("hs8")
    )

    # ------------------------------------------------------------
    # Wide -> long monthly data
    # ------------------------------------------------------------

    value_columns = {}

    for col in df.columns:
        parsed = parse_value_column(col)

        if parsed:
            key = (parsed["year"], parsed["month"])
            value_columns.setdefault(key, {})[parsed["metric"]] = col

    if not value_columns:
        raise SystemExit(
            "No Month-Year_INR_Cr / _USD_Mn columns found. "
            "Is this a DGCIS Data Extraction download?"
        )

    def numeric(x):
        if x in ("", None):
            return None
        try:
            return float(str(x).replace(",", ""))
        except ValueError:
            return None

    rows = []

    for _, record in scoped.iterrows():
        for (year, month), cols in sorted(value_columns.items()):
            inr_col = cols.get("INR_Cr")
            usd_col = cols.get("USD_Mn")

            inr_cr = numeric(record.get(inr_col, "") if inr_col else "")
            usd_mn = numeric(record.get(usd_col, "") if usd_col else "")

            # Preserve true zero observations.
            # Skip only where BOTH measures are genuinely absent.
            if inr_cr is None and usd_mn is None:
                continue

            rows.append({
                "flow": flow,
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

                # Named for what they are - a value - not for a flow the file
                # never stated. The flow lives in its own column.
                "value_inr_crore": inr_cr,
                "value_usd_million": usd_mn,

                # Convenience normalized values. Arithmetic unit conversions
                # only; INR and USD are never derived from each other.
                "value_inr": None if inr_cr is None else inr_cr * 10_000_000,
                "value_usd": None if usd_mn is None else usd_mn * 1_000_000,
            })

    long_df = pd.DataFrame(rows)

    if long_df.empty:
        raise SystemExit("No monthly HS8 observations were produced.")

    # ------------------------------------------------------------
    # QA
    # ------------------------------------------------------------

    duplicate_key = ["hs8", "country", "year", "month"]
    duplicates = long_df.duplicated(subset=duplicate_key, keep=False)

    if duplicates.any():
        print(long_df.loc[duplicates, duplicate_key].head(20).to_string(index=False))

        raise SystemExit(
            f"Found {duplicates.sum()} duplicated HS8/month observations."
        )

    long_df = long_df.sort_values(["hs8", "year", "month"]).reset_index(drop=True)

    # ------------------------------------------------------------
    # Flow guard - before anything is written
    # ------------------------------------------------------------

    verdict = flow_guard.check(long_df.to_dict("records"), flow)

    print(flow_guard.report(verdict))
    print()

    if not verdict["ok"]:
        raise SystemExit(
            f"\nRefusing to write. This extract was declared --flow {flow}, and "
            f"Comtrade's India series for the same HS-6 codes says it is "
            f"{verdict['flow']}.\n"
            f"Nothing has been written. Re-run with --flow {verdict['flow']} if "
            f"the portal query was in fact {verdict['flow']}."
        )

    # ------------------------------------------------------------
    # Write
    # ------------------------------------------------------------

    scope_ref.to_csv(out_scope, index=False)
    long_df.to_csv(out_long, index=False)

    digest = sha256(source)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    archive = RAW / f"{stamp}_{flow}_DGCIS_DATA.csv"

    if not archive.exists():
        archive.write_bytes(source.read_bytes())

    manifest = {
        "source": "DGCIS Trade Intelligence and Analytics Portal",
        "sourceFile": source.name,
        "sourceSha256": digest,
        "processedAt": datetime.now(timezone.utc).isoformat(),
        "reporter": "India",
        "flow": flow,
        "flowDeclaredBy": "--flow argument",
        "flowVerifiedAgainst": (
            "Comtrade India imports/exports for the same HS-6 codes, "
            "via pipeline/dgcis/flow_guard.py"
        ),
        "flowVerdict": {
            "status": verdict["status"],
            "evidence": verdict["flow"],
            "pairs": verdict["pairs"],
            "wins": verdict["wins"],
            "medianRatio": verdict.get("medianRatio"),
        },
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
            "value_inr_crore": "INR crore exactly as supplied by DGCIS",
            "value_usd_million": "USD million exactly as supplied by DGCIS",
            "value_inr": "INR crore × 10,000,000",
            "value_usd": "USD million × 1,000,000",
        },
    }

    out_manifest.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"DGCIS HS8 processing complete  ({flow})")
    print("-" * 46)
    print(f"Source rows            : {len(df):,}")
    print(f"Source HS8             : {df['hs8'].nunique():,}")
    print(f"In-scope HS8           : {scoped['hs8'].nunique():,}")
    print(f"Processed monthly rows : {len(long_df):,}")
    print(f"Period                 : {long_df['period'].min()} -> {long_df['period'].max()}")
    print(f"Countries              : {', '.join(sorted(scoped['Country Name'].unique()))}")
    print()
    print(f"HS8 scope   : {out_scope}")
    print(f"Monthly data: {out_long}")
    print(f"Manifest    : {out_manifest}")
    print(f"Raw archive : {archive}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
