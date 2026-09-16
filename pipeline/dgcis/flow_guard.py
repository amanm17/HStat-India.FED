#!/usr/bin/env python3
"""
Decide, from the numbers alone, whether a DGCIS extract is imports or exports.

WHY THIS EXISTS

The DGCIS extract carries no flow column. Nothing in the file says whether
these are India's imports or India's exports - the portal knows, the CSV does
not, and the person who ran the query is the only carrier of that fact. The
first version of this pipeline wrote `"flow": "imports"` as a literal and
published every figure under that word. The data was exports.

That mistake survived a reconciliation that passed: summing our rows against
the portal's own TOTAL footer proves we transcribed the file correctly, and
says nothing whatever about what the file is. Internal consistency cannot
detect a mislabelled dimension. Only an outside measurement can.

THE OUTSIDE MEASUREMENT

HStat already holds one: Comtrade's India series, imports and exports, for the
same HS-6 codes. Comtrade's India figures originate with DGCIS, so a correctly
labelled extract should sit almost exactly on one of them and nowhere near the
other - and it does. Summed to HS-6 for 2024, the extract read 20,441 USD mn
against smartphones: India's exports that year were 20,139 and its imports
502. Across 244 codes the median ratio to exports was 1.02 and to imports
0.15.

So: for every HS-6 the extract covers, compare its annual total against both
Comtrade series and see which one it is closer to in log space - log because
these are ratios, and being out by a factor of forty should count the same
whichever direction it falls. The flow the evidence picks must be the flow the
caller declared, or this refuses to go on.

WHAT IT WILL NOT DO

It will not guess a flow for the caller. The caller declares, the guard
agrees or stops. A guard that filled in the answer would be back to writing a
literal, only with more machinery in front of it.

It abstains rather than failing when it cannot see enough: fewer than
MIN_PAIRS comparable codes, or a margin too narrow to call, returns
UNDECIDED. An abstention is reported loudly and does not block - a future year
where Comtrade has not yet published India is a real state, and it is not
evidence of mislabelling.

Run standalone against whatever is already processed:

    python3 pipeline/dgcis/flow_guard.py --flow exports
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "public" / "data" / "snapshots" / "current" / "products"

FLOWS = ("imports", "exports")

# Below this many comparable HS-6 codes the guard abstains. Thirty is well
# past the point where a 90/10 split could be chance, and well below the 244
# the current extract offers.
MIN_PAIRS = 30

# The winning flow must take at least this share of the compared codes.
# The real separation is 94% against 6%; anything under 70% is not a signal.
MIN_SHARE = 0.70

# A code whose two Comtrade series are within this factor of each other cannot
# discriminate between them and is skipped, however large it is.
MIN_SEPARATION = 1.5


def _number(value):
    try:
        text = str(value).strip()
        return float(text) if text else None
    except (TypeError, ValueError):
        return None


def annual_totals_by_hs6(rows, value_field: str) -> dict:
    """DGCIS monthly rows -> {(hs6, year): USD million}."""
    totals: dict[tuple[str, str], float] = defaultdict(float)

    for row in rows:
        value = _number(row.get(value_field))

        if value is None:
            continue

        totals[(row["hs6"], str(row["year"]))] += value

    return totals


def comtrade_india(hs6: str) -> dict:
    """{year: {"imports": usd_mn, "exports": usd_mn}} from the live snapshot."""
    path = SNAPSHOT / f"{hs6}.json"

    if not path.exists():
        return {}

    payload = json.loads(path.read_text())
    out = {}

    for year, record in (payload.get("annual") or {}).items():
        india = (record or {}).get("india") or {}
        imports, exports = india.get("imports"), india.get("exports")

        out[str(year)] = {
            "imports": None if not imports else imports / 1e6,
            "exports": None if not exports else exports / 1e6,
        }

    return out


def assess(rows, value_field: str = "value_usd_million") -> dict:
    """
    Weigh the extract against both Comtrade India series.

    Returns a verdict dict. `flow` is one of "imports", "exports" or None.
    """
    totals = annual_totals_by_hs6(rows, value_field)

    if not totals:
        return {"flow": None, "status": "UNDECIDED", "reason": "no values in extract",
                "pairs": 0, "wins": {"imports": 0, "exports": 0}, "examples": []}

    india_cache: dict[str, dict] = {}
    wins = {"imports": 0, "exports": 0}
    ratios = {"imports": [], "exports": []}
    examples = []
    skipped_flat = 0

    for (hs6, year), observed in sorted(totals.items()):
        if observed <= 0:
            continue

        if hs6 not in india_cache:
            india_cache[hs6] = comtrade_india(hs6)

        reference = india_cache[hs6].get(year) or {}
        imports, exports = reference.get("imports"), reference.get("exports")

        if not imports or not exports:
            continue

        # Two series too close together cannot tell us anything.
        if max(imports, exports) / min(imports, exports) < MIN_SEPARATION:
            skipped_flat += 1
            continue

        distance = {
            "imports": abs(math.log(observed / imports)),
            "exports": abs(math.log(observed / exports)),
        }

        winner = min(FLOWS, key=lambda flow: distance[flow])
        wins[winner] += 1

        for flow in FLOWS:
            ratios[flow].append(observed / reference[flow])

        examples.append({
            "hs6": hs6, "year": year, "observed": round(observed, 1),
            "imports": round(imports, 1), "exports": round(exports, 1),
            "closer": winner,
        })

    pairs = sum(wins.values())

    if pairs < MIN_PAIRS:
        return {"flow": None, "status": "UNDECIDED",
                "reason": f"only {pairs} comparable HS-6 codes; {MIN_PAIRS} needed",
                "pairs": pairs, "wins": wins, "skippedFlat": skipped_flat,
                "examples": []}

    leader = max(FLOWS, key=lambda flow: wins[flow])
    share = wins[leader] / pairs

    def median(values):
        ordered = sorted(values)
        return ordered[len(ordered) // 2] if ordered else None

    verdict = {
        "flow": leader if share >= MIN_SHARE else None,
        "status": "DECIDED" if share >= MIN_SHARE else "UNDECIDED",
        "pairs": pairs,
        "wins": wins,
        "share": round(share, 4),
        "skippedFlat": skipped_flat,
        "medianRatio": {
            flow: (None if median(ratios[flow]) is None
                   else round(median(ratios[flow]), 4))
            for flow in FLOWS
        },
        # The loudest disagreements, which are what a reader should look at
        # first if this ever fires.
        "examples": sorted(
            examples,
            key=lambda item: -max(item["imports"], item["exports"]),
        )[:8],
    }

    if verdict["status"] == "UNDECIDED":
        verdict["reason"] = (
            f"no flow took {MIN_SHARE:.0%} of {pairs} codes "
            f"(imports {wins['imports']}, exports {wins['exports']})"
        )

    return verdict


def check(rows, declared: str, value_field: str = "value_usd_million") -> dict:
    """
    assess(), plus the comparison against what the caller said it was.

    `ok` is False only on positive disagreement. An abstention passes.
    """
    if declared not in FLOWS:
        raise ValueError(f"flow must be one of {FLOWS}, not {declared!r}")

    verdict = assess(rows, value_field)
    verdict["declared"] = declared
    verdict["ok"] = verdict["flow"] is None or verdict["flow"] == declared

    return verdict


def report(verdict: dict) -> str:
    lines = []
    declared = verdict.get("declared", "?")

    if verdict["status"] == "UNDECIDED":
        lines.append(
            f"FLOW GUARD  ABSTAINED  declared={declared}  "
            f"({verdict.get('reason', 'not enough evidence')})"
        )
        lines.append("  Not a failure. The extract was not contradicted; it was")
        lines.append("  not confirmed either. Check the portal query by hand.")
        return "\n".join(lines)

    outcome = "AGREES" if verdict["ok"] else "DISAGREES"

    lines.append(
        f"FLOW GUARD  {outcome}  declared={declared}  evidence={verdict['flow']}  "
        f"({verdict['wins']['exports']} exports / {verdict['wins']['imports']} imports "
        f"of {verdict['pairs']} codes)"
    )
    lines.append(
        f"  median ratio to Comtrade India  exports {verdict['medianRatio']['exports']}"
        f"   imports {verdict['medianRatio']['imports']}"
    )

    if not verdict["ok"]:
        lines.append("")
        lines.append("  largest codes compared (USD mn):")
        lines.append(f"    {'HS6':8}{'year':6}{'extract':>12}{'CT imports':>13}"
                     f"{'CT exports':>13}   closer")

        for item in verdict["examples"]:
            lines.append(
                f"    {item['hs6']:8}{item['year']:6}{item['observed']:>12,.1f}"
                f"{item['imports']:>13,.1f}{item['exports']:>13,.1f}   {item['closer']}"
            )

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--flow", required=True, choices=FLOWS)
    parser.add_argument(
        "--source",
        default=None,
        help="processed monthly CSV (default: the one for --flow)",
    )
    args = parser.parse_args()

    source = Path(args.source) if args.source else (
        ROOT / "data" / "dgcis" / "processed" / f"india_hs8_monthly_{args.flow}.csv"
    )

    if not source.exists():
        raise SystemExit(f"missing {source}")

    rows = list(csv.DictReader(source.open(newline="", encoding="utf-8-sig")))

    field = ("value_usd_million" if rows and "value_usd_million" in rows[0]
             else "import_usd_million")

    verdict = check(rows, args.flow, field)
    print(report(verdict))

    return 0 if verdict["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
