#!/usr/bin/env python3
"""
Prove that estimation changed no filed value.

    python3 pipeline/verify_filed.py public/data/snapshots/current
    python3 pipeline/verify_filed.py <snapshot> --raw-store data/raw/store

This is §1.10's acceptance test: "No filed value differs from the raw store
except through a Comtrade revision, proven by a raw-vs-published recompute."

WHAT IT DOES

For every published product-year it re-sums the world total straight out of
the raw store - the same netting `globaltrade.compute` does, independently
coded here so a bug in that module cannot hide itself - and compares the
result against the snapshot.

A published figure should equal either:

  * the raw sum exactly, when nothing was estimated; or
  * the raw sum plus the estimated value the snapshot itself declares.

Anything else means an estimate displaced a filing, which is the one failure
this whole design is built to make impossible. `merge()` asserts it at write
time; this proves it at rest, from the other end, against the source.

Run it in CI after a reprocess, where the store lives. It needs no network and
no API key.

Exit 0 when every published figure reconciles, 1 otherwise.
"""

from __future__ import annotations

from pathlib import Path
import argparse
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import RAW_STORE  # noqa: E402
import store as raw_store  # noqa: E402

FLOW_IMPORTS = "M"
FLOW_RE_IMPORTS = "RM"

# A hundredth of a percent. The snapshot rounds to whole dollars and the raw
# store carries floats, so an exact equality test would fail on arithmetic
# that is not wrong.
TOLERANCE = 1e-4


def net_total(gross: dict, reverse: dict) -> float | None:
    """
    World imports net of re-imports, summed reporter by reporter.

    Deliberately a second implementation of globaltrade.net_by_reporter rather
    than a call to it: a check that shares code with the thing it checks only
    proves the code is self-consistent.
    """
    if not gross:
        return None

    total = 0.0

    for reporter, (_, value) in gross.items():
        entry = reverse.get(reporter)

        if entry is None:
            total += value
            continue

        back = entry[1]

        # A reverse flow larger than the total it belongs to is a reporter
        # filing inconsistent sub-flows; the pipeline refuses the adjustment
        # rather than manufacture a negative, and so does this.
        total += value if back > value else value - back

    return total


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--raw-store", type=Path, default=None)
    parser.add_argument(
        "--max-report",
        type=int,
        default=20,
        help="How many mismatches to print before summarising.",
    )
    args = parser.parse_args()

    root = args.raw_store or RAW_STORE

    if not Path(root).exists():
        print(f"No raw store at {root}. This check needs one; in CI it is the")
        print("restored cache. Nothing was verified.")
        return 1

    index = {
        flow: raw_store.reporter_index("A", "global", flow, root)
        for flow in (FLOW_IMPORTS, FLOW_RE_IMPORTS)
    }

    products = sorted((args.snapshot / "products").glob("*.json"))

    if not products:
        print(f"No products under {args.snapshot}.")
        return 1

    checked = 0
    estimated_years = 0
    clean_years = 0
    mismatches: list[dict] = []

    for path in products:
        node = json.loads(path.read_text())
        code = node["code"]

        for year, record in node.get("annual", {}).items():
            published = record["global"].get("trade")

            if published is None:
                continue

            checked += 1

            raw = net_total(
                index[FLOW_IMPORTS].get(code, year),
                index[FLOW_RE_IMPORTS].get(code, year),
            )

            meta = (record["global"].get("estimation") or {}).get("imports") or {}

            added = meta.get("estimatedValue") or 0.0

            if added:
                estimated_years += 1
            else:
                clean_years += 1

            expected = (raw or 0.0) + added

            if expected <= 0:
                continue

            drift = abs(published - expected) / expected

            if drift > TOLERANCE:
                mismatches.append(
                    {
                        "code": code,
                        "year": year,
                        "published": published,
                        "rawFiled": raw,
                        "estimatedAdded": added,
                        "expected": expected,
                        "drift": drift,
                    }
                )

    print(f"published product-years checked : {checked}")
    print(f"  entirely filed                : {clean_years}")
    print(f"  containing estimates          : {estimated_years}")
    print(f"mismatches                      : {len(mismatches)}")

    for row in mismatches[: args.max_report]:
        print(
            f"  {row['code']} {row['year']}  published {row['published']:,.0f} "
            f"vs filed {row['rawFiled'] or 0:,.0f} + estimated "
            f"{row['estimatedAdded']:,.0f}  (off by {row['drift']:.4%})"
        )

    if len(mismatches) > args.max_report:
        print(f"  … and {len(mismatches) - args.max_report} more")

    if mismatches:
        print(
            "\nFAIL: a published figure does not equal what the store holds "
            "plus what the snapshot says it estimated."
        )
        return 1

    print("\nPASS: every published figure reconciles with the raw store.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
