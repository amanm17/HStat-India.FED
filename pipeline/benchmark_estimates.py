#!/usr/bin/env python3
"""
Check estimated economies against their reported trade, and propose
calibration where the estimate is out of tolerance.

    python3 pipeline/benchmark_estimates.py data/benchmarks/<file>.csv
    python3 pipeline/benchmark_estimates.py data/benchmarks/<file>.csv --write

WHY

HStat estimates an economy's trade for the years it has not filed with
Comtrade (pipeline/estimate.py). Many late filers have already published
those years themselves. A benchmark is that published figure, entered by a
person from the economy's own statistics (or from a licensed source), and
this script says how far the published estimate is from it.

THE BENCHMARK FILE (CSV, one row per economy, flow and year)

    reporter   Comtrade/M49 code of the economy, e.g. 704 for Viet Nam
    flow       imports or exports
    year       calendar year
    value_usd  the reported value in US dollars
    hs6        optional: one HS-6 code. Blank means the whole electronics
               scope (every line in scope.json for that year).
    source     where the figure comes from, as it should be cited

Include at least one year the economy HAS filed with Comtrade. That row is
the alignment check: if the benchmark and Comtrade disagree on a filed year
by more than 2%, the benchmark measures something else (scope, valuation,
coverage) and no calibration is proposed from it.

WHAT IT DOES

For each estimated row whose gap is outside the tolerance in
config/estimate_calibration.json, it proposes a factor that scales that
economy's estimated cells so the total meets the benchmark. With --write the
proposals are recorded there; the next snapshot build applies them
(estimate.fill, `calibration`). Filed values are never changed.

SOURCES

Use the economy's own published statistics. ITC Trade Map figures may be
used for calibration only after ITC's written permission (MAT Terms and
Conditions, sections 10, 12 and 14). Never scrape any site to fill this file.
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
# large means the benchmark or the estimate is wrong in kind, not in degree.
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
    parser.add_argument("benchmark", type=Path)
    parser.add_argument("--write", action="store_true", help="record proposed factors")
    args = parser.parse_args()

    config = json.loads(CALIBRATION.read_text())
    tolerance = float(config.get("tolerance", 0.10))
    entries = config.get("entries", [])
    existing = {(e["reporter"], e["flow"], int(e["year"])): e for e in entries}

    rows = list(csv.DictReader(args.benchmark.open(newline="", encoding="utf-8-sig")))
    results = []
    misaligned: set[tuple[str, str]] = set()

    for row in rows:
        reporter = row["reporter"].strip()
        flow = row["flow"].strip().lower()
        year = row["year"].strip()
        bench = float(row["value_usd"])
        codes = [row["hs6"].strip()] if (row.get("hs6") or "").strip() else scope_codes(year)
        filed, estimated = ours(reporter, flow, year, codes)
        total = filed + estimated
        gap = (total - bench) / bench if bench else None
        results.append((reporter, flow, int(year), bench, filed, estimated, gap, row.get("source", "").strip(), len(codes)))
        if estimated <= 0.01 * total and gap is not None and abs(gap) > ALIGNMENT:
            misaligned.add((reporter, flow))

    print(f"Tolerance {tolerance:.0%}; alignment on filed years within {ALIGNMENT:.0%}\n")
    print("economy flow     year   benchmark      HStat   (estimated)    gap   verdict")
    proposals = []
    for reporter, flow, year, bench, filed, estimated, gap, source, n in sorted(results):
        total = filed + estimated
        if estimated <= 0.01 * total:
            verdict = "filed year: alignment " + ("ok" if (reporter, flow) not in misaligned else "FAILED")
        elif (reporter, flow) in misaligned:
            verdict = "not comparable (alignment failed); no calibration"
        elif abs(gap) <= tolerance:
            verdict = "within tolerance"
        else:
            factor = (bench - filed) / estimated if estimated else None
            prior = existing.get((reporter, flow, year))
            if prior:
                factor = factor * float(prior["factor"]) if factor else None
            if factor is not None and factor <= 0:
                verdict = "filed values alone exceed the benchmark: these estimates should not exist; review"
            elif not factor or not (FACTOR_RANGE[0] <= factor <= FACTOR_RANGE[1]):
                verdict = f"out of tolerance; factor {factor} outside {FACTOR_RANGE}, review by hand"
            else:
                verdict = f"out of tolerance; propose factor {factor:.4f}"
                proposals.append({
                    "reporter": reporter,
                    "flow": flow,
                    "year": year,
                    "factor": round(factor, 6),
                    "benchmarkUsd": round(bench),
                    "estimatedUsdBefore": round(estimated),
                    "filedUsd": round(filed),
                    "gapBefore": round(gap, 4),
                    "codes": n,
                    "source": source,
                    "reviewed": date.today().isoformat(),
                })
        print(f"{reporter:>7} {flow:<8} {year}  {bench/1e9:9.2f}  {total/1e9:9.2f}  ({estimated/1e9:8.2f})  {gap:+6.1%}   {verdict}")

    if args.write and proposals:
        keep = [e for e in entries if (e["reporter"], e["flow"], int(e["year"])) not in
                {(p["reporter"], p["flow"], p["year"]) for p in proposals}]
        config["entries"] = sorted(keep + proposals, key=lambda e: (e["reporter"], e["flow"], e["year"]))
        CALIBRATION.write_text(json.dumps(config, indent=2) + "\n")
        print(f"\nRecorded {len(proposals)} calibration(s) in {CALIBRATION.relative_to(ROOT)}. "
              "Rebuild the snapshot (Actions, Validated data refresh, depth reprocess) to apply them.")
    elif proposals:
        print(f"\n{len(proposals)} calibration(s) proposed. Re-run with --write to record them.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
