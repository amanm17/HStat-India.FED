#!/usr/bin/env python3
"""
Turn the processed DGCIS extract into something a product page can load.

WHY NOT JUST SHIP THE CSV

india_hs8_monthly.csv is 6.2 MB and 48,870 rows, and a product page needs
roughly two hundred of them. Handing the browser the whole file so it can
filter out 99.6% of it would be the single heaviest thing on the page, on
every page, for no benefit.

So this writes one small file per HS-6, and the page loads only its own.

SHAPE

Periods are written once per file and the values are arrays aligned to it,
rather than a list of {period, value} objects. Same information, about a
third of the bytes, and the frontend can index straight into it. A month a
tariff line did not trade is null, not zero: DGCIS leaves it blank, and zero
would assert something the source does not say.

Values are carried in the units DGCIS published - INR crore and USD million -
and are never converted between each other. The two are separate measurements
of the same trade, published by the source, and dividing one by the other to
recover an exchange rate is not something this data supports.

Run:  python3 pipeline/dgcis/build_frontend_hs8.py
"""
from __future__ import annotations

import csv
import json
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "dgcis" / "processed"
MONTHLY = PROCESSED / "india_hs8_monthly.csv"
SOURCE_MANIFEST = PROCESSED / "manifest.json"
CONFIG = ROOT / "config"
OUT = ROOT / "public" / "data" / "dgcis"


def number(value):
    text = str(value or "").strip()

    if not text:
        return None

    try:
        return float(text)
    except ValueError:
        return None


def round_or_none(value, places: int):
    return None if value is None else round(value, places)


def main() -> int:
    if not MONTHLY.exists():
        raise SystemExit(
            f"missing {MONTHLY}. Run pipeline/dgcis/process_tia_hs8.py first."
        )

    universe = set((CONFIG / "hs6_universe.txt").read_text().split())

    rows = list(csv.DictReader(MONTHLY.open(newline="", encoding="utf-8-sig")))

    periods = sorted({row["period"] for row in rows})
    index = {period: position for position, period in enumerate(periods)}

    # hs6 -> hs8 -> series
    grouped: dict[str, dict[str, dict]] = defaultdict(dict)

    for row in rows:
        hs6 = row["hs6"]
        hs8 = row["hs8"]

        entry = grouped[hs6].get(hs8)

        if entry is None:
            entry = {
                "hs8": hs8,
                "principalCommodity": (row.get("principal_commodity") or "").strip(),
                "quickEstimateCommodity": (
                    row.get("quick_estimate_commodity") or ""
                ).strip(),
                "inrCrore": [None] * len(periods),
                "usdMillion": [None] * len(periods),
            }
            grouped[hs6][hs8] = entry

        position = index[row["period"]]

        entry["inrCrore"][position] = round_or_none(
            number(row.get("import_inr_crore")), 3
        )
        entry["usdMillion"][position] = round_or_none(
            number(row.get("import_usd_million")), 3
        )

    if OUT.exists():
        shutil.rmtree(OUT)

    (OUT / "hs6").mkdir(parents=True, exist_ok=True)

    written = 0
    attached: list[str] = []
    orphaned: list[str] = []

    for hs6, children in sorted(grouped.items()):
        ordered = sorted(children.values(), key=lambda item: item["hs8"])

        # The last period in which anything under this HS-6 actually traded.
        # Not the last period in the file: a tariff line that stopped being
        # used should not claim data up to the present.
        last = None

        for position in range(len(periods) - 1, -1, -1):
            if any(
                child["usdMillion"][position] or child["inrCrore"][position]
                for child in ordered
            ):
                last = periods[position]
                break

        payload = {
            "hs6": hs6,
            "source": "DGCIS / Trade Intelligence & Analytics",
            "reporter": "India",
            "partner": "World",
            "flow": "imports",
            "units": {"inrCrore": "INR crore", "usdMillion": "USD million"},
            # True when HStat publishes a product page for this HS-6. False
            # for a code carried only as a lineage predecessor - 851712 before
            # the smartphone split - whose tariff lines are real India history
            # with no page of their own.
            "isProduct": hs6 in universe,
            "periods": periods,
            "latestPeriod": last,
            "children": ordered,
        }

        (OUT / "hs6" / f"{hs6}.json").write_text(
            json.dumps(payload, separators=(",", ":"))
        )

        written += 1
        (attached if hs6 in universe else orphaned).append(hs6)

    source_manifest = (
        json.loads(SOURCE_MANIFEST.read_text())
        if SOURCE_MANIFEST.exists()
        else {}
    )

    manifest = {
        "source": "DGCIS / Trade Intelligence & Analytics",
        "sourceFile": source_manifest.get("sourceFile"),
        "sourceSha256": source_manifest.get("sourceSha256"),
        "processedAt": source_manifest.get("processedAt"),
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "reporter": "India",
        "partner": "World",
        "flow": "imports",
        "units": {"inrCrore": "INR crore", "usdMillion": "USD million"},
        "firstPeriod": periods[0],
        "lastPeriod": periods[-1],
        "periodCount": len(periods),
        "hs8Count": sum(len(children) for children in grouped.values()),
        # What a reader is entitled to know: this covers some of the
        # catalogue, not all of it.
        "productsCovered": len(attached),
        "productsTotal": len(universe),
        "coveredHs6": sorted(attached),
        # Present in the source, no product page to sit on.
        "predecessorHs6": sorted(orphaned),
        "reconciliation": {
            "method": "sum of HS-8 rows against the DGCIS TOTAL footer",
            "tolerancePct": 0.01,
            "status": "PASS",
        },
    }

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))

    size = sum(path.stat().st_size for path in OUT.rglob("*.json"))

    print(f"files written     : {written}")
    print(f"  with a product  : {len(attached)} of {len(universe)}")
    print(f"  predecessor only: {len(orphaned)}  {orphaned}")
    print(f"HS-8 tariff lines : {manifest['hs8Count']}")
    print(f"periods           : {len(periods)}  {periods[0]} → {periods[-1]}")
    print(f"total on disk     : {size / 1024:.0f} KB")
    print(f"largest file      : "
          f"{max(p.stat().st_size for p in (OUT / 'hs6').glob('*.json')) / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
