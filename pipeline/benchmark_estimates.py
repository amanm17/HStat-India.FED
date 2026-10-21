#!/usr/bin/env python3
"""
The reference check: layer 3 of HStat's figures.

    python3 pipeline/benchmark_estimates.py data/benchmarks/<file>.csv
    python3 pipeline/benchmark_estimates.py data/benchmarks/<file>.csv --write
    python3 pipeline/benchmark_estimates.py --codes 2025 [--group 84] > codes.txt

THE THREE LAYERS

  1. Comtrade filings. The truth; nothing here changes them.
  2. HStat's estimates for what has not been filed (pipeline/estimate.py).
  3. A reference check. A person reads an economy's reported totals in a
     reference source, for the HStat electronics codes, for the years HStat
     estimates. Where the estimate is further from the reference than the
     tolerance (config/estimate_calibration.json, 10%), this script proposes
     one factor that realigns the estimates for that economy, flow, year and,
     optionally, HS chapter or heading. With --write the factors are recorded;
     the next snapshot build applies them. The reference figures themselves
     are never published or stored as data, only the factors.

THE REFERENCE FILE (CSV, one row per economy, flow, year and group)

    reporter    Comtrade/M49 code of the economy, e.g. 704 for Viet Nam
    flow        imports or exports
    year        calendar year
    group       optional HS prefix: a chapter ("84"), a heading ("8471") or
                one code. Blank means every HStat electronics code that year.
    value_usd   the reported total in US dollars over that group's codes
    source      the citation, e.g. "Trade Map, International Trade Centre,
                www.trademap.org (Viet Nam, direct data)"
    checked_by  who read the figure in the source, and when (required for
                --write: a person, never a script)

Include at least one year the economy HAS filed with Comtrade, for each
group. That row is the alignment check: a reference that differs from the
filing by more than 2% measures something else, and no factor is proposed
from it.

Where both a group row and an economy-wide row exist for the same economy,
flow and year, the economy-wide row is compared over the codes no group row
covers, so no code is realigned twice.

READING TRADE MAP BY HAND

`--codes <year>` prints the HStat electronics codes (optionally one chapter
with --group). In Trade Map, build a custom product group from that list,
select the economy as reporter and World as partner, yearly values, and read
the totals. Never extract Trade Map content with scripts or automation (MAT
Terms and Conditions, section 12); a permission request to ITC is open
(itcreg@intracen.org).
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "public" / "data" / "snapshots" / "current"
CALIBRATION = ROOT / "config" / "estimate_calibration.json"
SIDES = {"imports": "importers", "exports": "exporters"}
ALIGNMENT = 0.02
# A factor outside this range is reported but never written: a gap that
# large means the reference or the estimate is wrong in kind, not in degree.
FACTOR_RANGE = (0.25, 4.0)


def scope_codes(year: str) -> list[str]:
    scope = json.loads((SNAPSHOT / "scope.json").read_text())
    products = scope["years"].get(year, {}).get("products", [])
    return [p[0] if isinstance(p, list) else p.get("code") for p in products]


def ours(reporter: str, flow: str, year: str, codes: list[str]) -> tuple[float, float]:
    """(filed, estimated) for one economy over the given codes."""
    filed = estimated = 0.0
    for code in codes:
        path = SNAPSHOT / "detail" / f"{code}.json"
        if not path.exists():
            continue
        rows = json.loads(path.read_text())["years"].get(year, {}).get(SIDES[flow], {}).get("rows", [])
        for row in rows:
            if row[0] != reporter:
                continue
            if row[2]:
                estimated += row[1]
            else:
                filed += row[1]
    return filed, estimated


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("reference", type=Path, nargs="?")
    parser.add_argument("--write", action="store_true", help="record proposed factors")
    parser.add_argument("--codes", metavar="YEAR", help="print the HStat electronics codes for a year")
    parser.add_argument("--group", default="", help="with --codes: only codes under this HS prefix")
    args = parser.parse_args()

    if args.codes:
        for code in scope_codes(args.codes):
            if code.startswith(args.group):
                print(code)
        return 0
    if not args.reference:
        parser.error("give a reference CSV, or --codes YEAR")

    config = json.loads(CALIBRATION.read_text())
    tolerance = float(config.get("tolerance", 0.10))
    entries = config.get("entries", [])
    key_of = lambda e: (str(e["reporter"]), e["flow"], int(e["year"]), str(e.get("group") or ""))  # noqa: E731
    existing = {key_of(e): e for e in entries}

    rows = [
        row for row in csv.DictReader(args.reference.open(newline="", encoding="utf-8-sig"))
        if (row.get("value_usd") or "").strip()  # a row still to be filled in is skipped
    ]
    groups_by: dict[tuple[str, str, str], set[str]] = {}
    for row in rows:
        group = (row.get("group") or "").strip()
        if group:
            groups_by.setdefault((row["reporter"].strip(), row["flow"].strip().lower(), row["year"].strip()), set()).add(group)

    results = []
    misaligned: set[tuple[str, str, str]] = set()
    for row in rows:
        reporter = row["reporter"].strip()
        flow = row["flow"].strip().lower()
        year = row["year"].strip()
        group = (row.get("group") or "").strip()
        reference = float(row["value_usd"])
        codes = [c for c in scope_codes(year) if c.startswith(group)]
        if not group:
            # The economy-wide row covers what no group row covers.
            covered = groups_by.get((reporter, flow, year), set())
            codes = [c for c in codes if not any(c.startswith(g) for g in covered)]
        filed, estimated = ours(reporter, flow, year, codes)
        total = filed + estimated
        gap = (total - reference) / reference if reference else None
        results.append({
            "reporter": reporter, "flow": flow, "year": int(year), "group": group,
            "reference": reference, "filed": filed, "estimated": estimated, "gap": gap,
            "source": (row.get("source") or "").strip(),
            "checked_by": (row.get("checked_by") or "").strip(), "codes": len(codes),
        })
        if estimated <= 0.01 * total and gap is not None and abs(gap) > ALIGNMENT:
            misaligned.add((reporter, flow, group))

    print(f"Tolerance {tolerance:.0%}; filed years must align within {ALIGNMENT:.0%}\n")
    print("economy flow     year group  reference      HStat   (estimated)    gap   verdict")
    proposals, unchecked = [], 0
    for r in sorted(results, key=lambda r: (r["reporter"], r["flow"], r["group"], r["year"])):
        total = r["filed"] + r["estimated"]
        gap = r["gap"]
        scope_key = (r["reporter"], r["flow"], r["group"])
        if r["estimated"] <= 0.01 * total:
            verdict = "filed year: alignment " + ("ok" if scope_key not in misaligned else "FAILED")
        elif scope_key in misaligned:
            verdict = "not comparable (alignment failed); no factor"
        elif abs(gap) <= tolerance:
            verdict = "within tolerance; estimate stands"
        else:
            factor = (r["reference"] - r["filed"]) / r["estimated"] if r["estimated"] else None
            prior = existing.get((r["reporter"], r["flow"], r["year"], r["group"]))
            if prior and factor:
                factor *= float(prior["factor"])
            if factor is not None and factor <= 0:
                verdict = "filed values alone exceed the reference; review by hand"
            elif not factor or not (FACTOR_RANGE[0] <= factor <= FACTOR_RANGE[1]):
                verdict = f"out of tolerance; factor {factor} outside {FACTOR_RANGE}, review by hand"
            elif not r["checked_by"] or not r["source"]:
                verdict = f"out of tolerance; factor {factor:.4f} needs source and checked_by"
                unchecked += 1
            else:
                verdict = f"out of tolerance; propose factor {factor:.4f}"
                proposals.append({
                    "reporter": r["reporter"], "flow": r["flow"], "year": r["year"],
                    "group": r["group"], "factor": round(factor, 6),
                    "gapBefore": round(gap, 4), "codes": r["codes"],
                    "source": r["source"], "checkedBy": r["checked_by"],
                    "recorded": date.today().isoformat(),
                })
        print(f"{r['reporter']:>7} {r['flow']:<8} {r['year']} {r['group'] or 'all':<5} "
              f"{r['reference']/1e9:9.2f}  {total/1e9:9.2f}  ({r['estimated']/1e9:8.2f})  {gap:+6.1%}   {verdict}")

    if args.write and proposals:
        recorded = {key_of(p) for p in proposals}
        keep = [e for e in entries if key_of(e) not in recorded]
        config["entries"] = sorted(keep + proposals, key=key_of)
        CALIBRATION.write_text(json.dumps(config, indent=2) + "\n")
        print(f"\nRecorded {len(proposals)} factor(s) in {CALIBRATION.relative_to(ROOT)}. "
              "Rebuild the snapshot (Actions, Validated data refresh, depth reprocess) to apply them.")
    elif proposals:
        print(f"\n{len(proposals)} factor(s) proposed. Re-run with --write to record them.")
    if unchecked:
        print(f"{unchecked} row(s) need `source` and `checked_by` before a factor can be recorded.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
