#!/usr/bin/env python3
"""
Save Comtrade's HS edition tables into config/reference/ so the HS index
checks can run offline. (config/reference/comtrade_hs_reference.json, the
all-editions list other scripts read for descriptions, is left alone.)

    python scripts/fetch_hs_references.py            # fetch what is missing
    python scripts/fetch_hs_references.py --force    # refetch both

  comtrade_hs_reference_h6.json   HS 2022 (H6) - the dashboard's base edition;
                                  the intake accepts only codes listed here
  comtrade_hs_reference_h5.json   HS 2017 (H5) - tells the intake which codes
                                  were created in 2022, and what they were
                                  split from

Both are published nomenclatures that never change once released, so they
are fetched once and committed. Needs network to comtradeapi.un.org (GitHub
runners have it; the hs-intake workflow runs this first). No API key needed.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "config" / "reference"

EDITIONS = {
    "H6": OUT / "comtrade_hs_reference_h6.json",
    "H5": OUT / "comtrade_hs_reference_h5.json",
}


def fetch(edition: str) -> list[dict]:
    import comtradeapicall

    frame = comtradeapicall.getReference(f"cmd:{edition}")

    if frame is None or frame.empty:
        raise SystemExit(f"Comtrade returned no {edition} reference")

    columns = {name.lower(): name for name in frame.columns}
    code_col = columns.get("id") or columns.get("cmdcode") or columns.get("code")
    text_col = columns.get("text") or columns.get("description")
    parent_col = columns.get("parent")
    leaf_col = columns.get("isleaf")

    if not code_col or not text_col:
        raise SystemExit(f"unexpected {edition} reference columns: {list(frame.columns)}")

    rows = []
    for _, row in frame.iterrows():
        code = str(row[code_col]).strip()
        if not code.isdigit():
            continue
        rows.append({
            "code": code,
            "description": str(row[text_col]).strip(),
            "parent": str(row[parent_col]).strip() if parent_col else "",
            "isLeaf": bool(row[leaf_col]) if leaf_col else len(code) == 6,
            "digitLevel": len(code),
        })

    # HS 2017 has 5,387 subheadings and HS 2022 5,609. Far fewer means a
    # truncated download; far more means the all-editions list came back.
    sixes = sum(1 for r in rows if r["digitLevel"] == 6)
    if not 5000 <= sixes <= 6000:
        raise SystemExit(f"{edition} reference has {sixes} six-digit codes; expected about 5,400-5,600")

    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)

    for edition, path in EDITIONS.items():
        if path.exists() and not args.force:
            print(f"{path.relative_to(ROOT)} present; kept")
            continue
        rows = fetch(edition)
        path.write_text(json.dumps(rows, indent=0) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}: {len(rows)} codes")

    return 0


if __name__ == "__main__":
    sys.exit(main())
