#!/usr/bin/env python3
"""
Hold-out test of the estimation method on filed data.

    python3 pipeline/backtest_estimates.py                 # anchor 2023
    python3 pipeline/backtest_estimates.py --anchor 2022

For every reporter, code and flow that filed both the anchor year and a
later target year, hide everything after the anchor, estimate the target the
way pipeline/estimate.py does, and compare with what was actually filed.
Reported per target year, weighted by value:

    bias   total estimated / total filed - 1
    WAPE   sum of absolute cell errors / total filed

Two methods: the country's own rate alone (`blend=False`, the method until
21 October 2026) and the blend with the peer signal (the current method).
The mirror signal needs the mirror store and is not tested here.

Reads the published snapshot's detail files (every reporter from 2016 on),
so it runs anywhere, without the raw store or an API key. Re-run it after a
method change, and quote its numbers in estimate.py when they move.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import estimate as E

ROOT = Path(__file__).resolve().parents[1]
DETAIL = ROOT / "public" / "data" / "snapshots" / "current" / "detail"
SIDES = {"imports": "importers", "exports": "exporters"}


def filed_histories(path: Path, side: str) -> dict[str, dict[int, float]]:
    out: dict[str, dict[int, float]] = {}
    for year, block in json.loads(path.read_text())["years"].items():
        for reporter, value, estimated in block.get(side, {}).get("rows", []):
            if not estimated:
                out.setdefault(reporter, {})[int(year)] = float(value)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--anchor", type=int, default=2023)
    parser.add_argument("--targets", default="")
    args = parser.parse_args()
    targets = [int(t) for t in args.targets.split(",") if t] or [args.anchor + 1, args.anchor + 2]

    tally = {(t, m): [0.0, 0.0, 0.0, 0] for t in targets for m in ("own", "blend")}

    for path in sorted(DETAIL.glob("*.json")):
        if len(path.stem) != 6:
            continue
        for side in SIDES.values():
            histories = filed_histories(path, side)
            for target in targets:
                both = {r: h for r, h in histories.items() if args.anchor in h and target in h and h[args.anchor] > 0}
                total_a = sum(h[args.anchor] for h in both.values())
                total_t = sum(h[target] for h in both.values())
                for reporter, history in both.items():
                    hidden = {y: v for y, v in history.items() if y <= args.anchor}
                    peers_a = total_a - history[args.anchor]
                    peers_t = total_t - history[target]

                    def signal(anchor, tgt, a=peers_a, t=peers_t):
                        return (t / a, "peer") if a > 0 and t > 0 else None

                    actual = history[target]
                    for method, sig in (("own", None), ("blend", signal)):
                        estimate = E.estimate_for(hidden, target, sig)
                        value = estimate.value if estimate else 0.0
                        row = tally[(target, method)]
                        row[0] += actual
                        row[1] += value
                        row[2] += abs(value - actual)
                        row[3] += 1

    print(f"Anchor {args.anchor}; cells filed in the anchor and the target year\n")
    print("target  method   cells     bias    WAPE")
    for (target, method), (actual, estimated, error, cells) in sorted(tally.items()):
        if actual:
            print(f"{target}    {method:<7} {cells:7d}  {estimated / actual - 1:+6.1%}  {error / actual:6.1%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
