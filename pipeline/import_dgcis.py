"""
India ITC(HS)-8 tariff-line detail, from a static CSV.

HStat no longer scripts a pull against DGCIS. The canonical input is one
hand-maintained file:

    data/dgcis/india_hs8.csv

    hs8,description,fy,flow,value_inr,value_usd,months_covered
    84713010,Laptops including notebook and palmtop,2024-25,import,41200000000000,,12

  hs8            8-digit ITC(HS) code
  description    the tariff-line description
  fy             Indian financial year: 2024-25. See FINANCIAL YEARS below.
  flow           import | export   (m | x also accepted)
  value_inr      value in rupees, if that is what the source published
  value_usd      value in US dollars, if that is what the source published
  months_covered optional; 12 for a full year, fewer for a part year

At least one of value_inr / value_usd must be present. Whichever is given is
the native figure and is stored exactly as filed; the other is derived at
processing time using the financial-year rate in config/fx_inr_usd.csv, and is
labelled as derived wherever it appears. A value is never round-tripped, so the
number the source published is always the number shown.

FINANCIAL YEARS
    DGCIS publishes April-March. UN Comtrade publishes January-December. The
    two are different periods and this pipeline never adds them together or
    plots them on one axis.

    Because of that, a bare four-digit year is refused here rather than
    guessed at: "2024" in a DGCIS export might mean FY 2023-24 or FY 2024-25,
    and picking one silently would shift a whole year of trade by up to twelve
    months. Write 2024-25, or FY25, or FY 2024-25 - all normalise to 2024-25.

PART YEARS
    An export taken mid-year is legitimate and useful, but it must not be
    compared against a full year as though it were one. Set months_covered and
    the dashboard labels the period as incomplete and declines to make it the
    default view. Left blank, a financial year is treated as complete only once
    it has actually ended.

Run this script to validate the file. If loose exports are dropped into
`data/dgcis/incoming/` (CSV or XLSX, with "import" or "export" in the filename)
it will normalise them into the canonical CSV first, so an official download can
be folded in without hand-editing.

The pipeline treats missing tariff-line data as missing. It never substitutes
an estimate.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
import argparse
import csv
import re
import sys

ROOT = Path(__file__).resolve().parents[1]

if __package__ in (None, ""):
    sys.path.insert(0, str(ROOT))

from pipeline import fx  # noqa: E402

DGCIS = ROOT / "data" / "dgcis"

INCOMING = DGCIS / "incoming"

CANONICAL = DGCIS / "india_hs8.csv"

# The machine-read copy. CSV is the format a person edits and reviews in a
# diff; Parquet is the format the pipeline reads and the one that survives the
# file getting large. India has roughly 12,000 ITC(HS)-8 lines, so two flows
# across ten financial years is already a quarter of a million rows - well
# inside what Parquet shrugs at and past the point where a CSV is pleasant to
# open. Both are written; the CSV stays the source of truth for edits.
CANONICAL_PARQUET = DGCIS / "india_hs8.parquet"

COLUMNS = [
    "hs8",
    "description",
    "fy",
    "flow",
    "value_inr",
    "value_usd",
    "months_covered",
]

ALIASES = {
    "hs8": [
        "hs8", "hs code", "hscode", "itc hs code", "itc(hs) code",
        "commodity code", "itc hs", "tariff line", "itchs",
    ],
    "description": ["description", "commodity", "commodity description"],
    "value_usd": [
        "value_usd", "value", "trade value", "value in us$", "value in usd",
        "value in million us$", "value in million usd", "us$ million",
        "usd million", "value (us$ million)",
    ],
    "value_inr": [
        "value_inr", "value in rs", "value in inr", "value in rupees",
        "value in rs. lakh", "value in rs lakh", "value in rs. crore",
        "value in rs crore", "rs lakh", "rs crore", "inr crore", "inr lakh",
        "value (rs. crore)", "value (rs. lakh)", "₹ crore", "₹ lakh",
    ],
    "fy": ["fy", "financial year", "year", "period", "fin year", "fin. year"],
    "flow": ["flow", "trade flow", "direction"],
    "months_covered": ["months_covered", "months", "months covered"],
}

# Indian sources publish in lakh and crore far more often than in units.
INR_SCALES = (
    ("crore", 10_000_000),
    ("lakh", 100_000),
)

USD_SCALES = (
    ("billion", 1_000_000_000),
    ("million", 1_000_000),
)


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", str(text).strip().lower())


def pick(columns, names):
    lookup = {normalise(column): column for column in columns}

    for name in names:
        if normalise(name) in lookup:
            return lookup[normalise(name)]

    return None


def scale_for(header: str, scales) -> int:
    text = normalise(header)

    for token, factor in scales:
        if token in text:
            return factor

    return 1


def read_any(path: Path):
    if path.suffix.lower() in {".xlsx", ".xls"}:
        import pandas as pd

        return pd.read_excel(path).to_dict("records"), list(
            pd.read_excel(path, nrows=0).columns
        )

    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)

        rows = list(reader)

        return rows, list(reader.fieldnames or [])


def flow_from_name(name: str) -> str | None:
    lowered = name.lower()

    if "import" in lowered:
        return "import"

    if "export" in lowered:
        return "export"

    return None


def normalise_flow(value: str) -> str | None:
    text = normalise(value)

    if text.startswith("i") or text == "m":
        return "import"

    if text.startswith("e") or text == "x":
        return "export"

    return None


def parse_number(raw) -> float | None:
    text = str(raw or "").replace(",", "").strip()

    if not text:
        return None

    try:
        return float(text)
    except ValueError:
        return None


def fy_has_ended(fy: str, today: date | None = None) -> bool:
    """An Indian financial year 2024-25 ends on 31 March 2025."""
    today = today or date.today()

    return today >= date(fx.fy_end_year(fy), 4, 1)


def fy_is_complete(fy: str, months_covered: int | None) -> bool:
    if months_covered is not None:
        return months_covered >= 12

    return fy_has_ended(fy)


# ---------------------------------------------------------------------------
# Folding in an official download
# ---------------------------------------------------------------------------


def convert_incoming() -> int:
    files = sorted(
        path
        for path in INCOMING.glob("*")
        if path.suffix.lower() in {".csv", ".xlsx", ".xls"}
    )

    if not files:
        return 0

    output: list[dict] = []

    for path in files:
        rows, columns = read_any(path)

        if not rows:
            print(f"  {path.name}: empty, skipped")
            continue

        columns = columns or list(rows[0].keys())

        mapping = {
            field: pick(columns, names)
            for field, names in ALIASES.items()
        }

        if not mapping["hs8"]:
            raise SystemExit(
                f"{path.name}: cannot identify the HS code column. "
                f"Found: {columns}"
            )

        if not mapping["value_usd"] and not mapping["value_inr"]:
            raise SystemExit(
                f"{path.name}: cannot identify a value column. One of rupees "
                f"or dollars is required. Found: {columns}"
            )

        usd_scale = (
            scale_for(mapping["value_usd"], USD_SCALES)
            if mapping["value_usd"]
            else 1
        )

        inr_scale = (
            scale_for(mapping["value_inr"], INR_SCALES)
            if mapping["value_inr"]
            else 1
        )

        default_flow = flow_from_name(path.name)

        kept = 0

        for row in rows:
            code = "".join(
                char
                for char in str(row.get(mapping["hs8"], ""))
                if char.isdigit()
            )

            if len(code) != 8:
                continue

            usd = (
                parse_number(row.get(mapping["value_usd"]))
                if mapping["value_usd"]
                else None
            )

            inr = (
                parse_number(row.get(mapping["value_inr"]))
                if mapping["value_inr"]
                else None
            )

            if usd is None and inr is None:
                continue

            flow = (
                normalise_flow(row.get(mapping["flow"], ""))
                if mapping["flow"]
                else None
            ) or default_flow

            if not flow:
                raise SystemExit(
                    f"{path.name}: no flow column and the filename does not "
                    "contain 'import' or 'export'"
                )

            fy_raw = str(row.get(mapping["fy"], "")) if mapping["fy"] else ""

            fy_label = fx.normalise_fy(fy_raw)

            if fy_label is None:
                raise SystemExit(
                    f"{path.name}: {fy_raw!r} is not an unambiguous financial "
                    "year. DGCIS reports April-March, so a bare year cannot be "
                    "placed without guessing. Write it as 2024-25 or FY25."
                )

            months = parse_number(
                row.get(mapping["months_covered"])
                if mapping["months_covered"]
                else None
            )

            output.append(
                {
                    "hs8": code,
                    "description": (
                        str(row.get(mapping["description"], "")).strip()
                        if mapping["description"]
                        else ""
                    ),
                    "fy": fy_label,
                    "flow": flow,
                    "value_inr": (
                        f"{inr * inr_scale:.0f}" if inr is not None else ""
                    ),
                    "value_usd": (
                        f"{usd * usd_scale:.0f}" if usd is not None else ""
                    ),
                    "months_covered": (
                        f"{int(months)}" if months is not None else ""
                    ),
                }
            )

            kept += 1

        print(f"  {path.name}: {kept:,} rows")

    if not output:
        raise SystemExit(
            "Incoming files were found but no usable ITC(HS)-8 rows were read."
        )

    CANONICAL.parent.mkdir(parents=True, exist_ok=True)

    with CANONICAL.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)

        writer.writeheader()

        writer.writerows(output)

    print(f"Wrote {CANONICAL} ({len(output):,} rows)")

    return len(output)


# ---------------------------------------------------------------------------
# Validating the canonical file
# ---------------------------------------------------------------------------


def validate() -> dict:
    if not CANONICAL.exists():
        print(
            f"No {CANONICAL.relative_to(ROOT)} present. "
            "Tariff-line detail will be reported as unavailable."
        )

        return {"rows": 0, "codes": 0, "financialYears": [], "native": {}}

    rows = 0

    codes: set[str] = set()

    years: set[str] = set()

    native = {"inr": 0, "usd": 0, "both": 0}

    months_by_fy: dict[str, set[int | None]] = {}

    problems: list[str] = []

    with CANONICAL.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)

        fields = set(reader.fieldnames or [])

        if "fy" not in fields and "year" in fields:
            raise SystemExit(
                f"{CANONICAL.name} still has a 'year' column. DGCIS reports "
                "April-March, so the column is now 'fy' and must hold an "
                "unambiguous financial year such as 2024-25. Rename the column "
                "and label the periods; nothing here can infer which financial "
                "year a bare number meant."
            )

        for line, row in enumerate(reader, start=2):
            code = str(row.get("hs8", "")).strip()

            if not (code.isdigit() and len(code) == 8):
                problems.append(f"line {line}: hs8 {code!r} is not 8 digits")
                continue

            if normalise_flow(row.get("flow", "")) is None:
                problems.append(f"line {line}: flow {row.get('flow')!r}")
                continue

            fy_label = fx.normalise_fy(row.get("fy", ""))

            if fy_label is None:
                problems.append(
                    f"line {line}: fy {row.get('fy')!r} is not a financial "
                    "year (write 2024-25)"
                )
                continue

            inr = parse_number(row.get("value_inr"))
            usd = parse_number(row.get("value_usd"))

            if inr is None and usd is None:
                problems.append(
                    f"line {line}: neither value_inr nor value_usd is set"
                )
                continue

            if (inr is not None and inr < 0) or (usd is not None and usd < 0):
                problems.append(f"line {line}: negative value")
                continue

            months_raw = parse_number(row.get("months_covered"))

            months = int(months_raw) if months_raw is not None else None

            if months is not None and not 1 <= months <= 12:
                problems.append(
                    f"line {line}: months_covered {months} is outside 1-12"
                )
                continue

            if inr is not None and usd is not None:
                native["both"] += 1
            elif inr is not None:
                native["inr"] += 1
            else:
                native["usd"] += 1

            rows += 1
            codes.add(code)
            years.add(fy_label)
            months_by_fy.setdefault(fy_label, set()).add(months)

    if problems:
        for problem in problems[:15]:
            print(f"  {problem}", file=sys.stderr)

        if len(problems) > 15:
            print(f"  ... and {len(problems) - 15} more", file=sys.stderr)

        raise SystemExit(
            f"{len(problems)} malformed rows in {CANONICAL.name}; fix them "
            "before refreshing."
        )

    # One financial year must not be part-year in some rows and full-year in
    # others: the total would be a mixture of two different periods.
    for fy_label, seen in sorted(months_by_fy.items()):
        if len(seen) > 1:
            raise SystemExit(
                f"{CANONICAL.name}: financial year {fy_label} has rows with "
                f"different months_covered values ({sorted(str(m) for m in seen)}). "
                "Every row in a period must cover the same months, or the "
                "total is a mixture of two periods."
            )

    table = fx.load()

    detail = []

    for fy_label in sorted(years):
        months = next(iter(months_by_fy[fy_label]))

        complete = fy_is_complete(fy_label, months)

        detail.append(
            {
                "fy": fy_label,
                "monthsCovered": months,
                "complete": complete,
                "rate": table.rate(fy_label, fx.FY),
            }
        )

    written = write_parquet()

    print(
        f"{CANONICAL.name}: {rows:,} rows | {len(codes)} tariff lines | "
        f"native {native['inr']} INR / {native['usd']} USD / {native['both']} both"
    )

    if written:
        print(f"  -> {CANONICAL_PARQUET.name} ({written})")

    for item in detail:
        flags = []

        if not item["complete"]:
            flags.append(
                f"part year ({item['monthsCovered']} months)"
                if item["monthsCovered"]
                else "not yet ended"
            )

        if item["rate"] is None:
            flags.append("no FX rate")

        suffix = f"  [{'; '.join(flags)}]" if flags else ""

        print(f"  FY {item['fy']}{suffix}")

    missing_rates = [item["fy"] for item in detail if item["rate"] is None]

    if missing_rates:
        print(
            "\nNo rupee/dollar rate for: "
            + ", ".join(f"FY {item}" for item in missing_rates)
            + "\nAdd them to config/fx_inr_usd.csv; until then those periods "
            "publish in their native currency only."
        )

    return {
        "rows": rows,
        "codes": len(codes),
        "financialYears": sorted(years),
        "native": native,
        "detail": detail,
    }


def write_parquet() -> str | None:
    """
    Mirror the validated CSV into Parquet for the pipeline to read.

    Typed, columnar and roughly a quarter the size, which matters once the file
    is real rather than an example. Only ever written from an already-validated
    CSV, so the Parquet can never hold a row the validator would have rejected.
    """
    try:
        import pandas as pd
    except ImportError:
        return None

    frame = pd.read_csv(CANONICAL, dtype=str, keep_default_na=False)

    if frame.empty:
        return None

    frame["hs8"] = frame["hs8"].astype(str).str.zfill(8)
    frame["fy"] = frame["fy"].map(lambda value: fx.normalise_fy(value) or value)

    for column in ("value_inr", "value_usd", "months_covered"):
        if column in frame:
            frame[column] = pd.to_numeric(
                frame[column].replace("", None), errors="coerce"
            )

    frame.to_parquet(CANONICAL_PARQUET, index=False)

    size = CANONICAL_PARQUET.stat().st_size
    csv_size = CANONICAL.stat().st_size

    # Parquet carries a fixed header, so on a toy file it can be the larger of
    # the two. Only claim the saving where there is one.
    ratio = (
        f", {csv_size / size:.1f}x smaller than the CSV"
        if size and csv_size > size
        else ""
    )

    return f"{len(frame):,} rows, {size / 1024:.0f} KB{ratio}"


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--skip-incoming",
        action="store_true",
        help="Validate the canonical CSV without folding in data/dgcis/incoming.",
    )

    args = parser.parse_args()

    INCOMING.mkdir(parents=True, exist_ok=True)

    if not args.skip_incoming:
        converted = convert_incoming()

        if not converted:
            print("No files in data/dgcis/incoming; using the canonical CSV.")

    validate()


if __name__ == "__main__":
    main()
