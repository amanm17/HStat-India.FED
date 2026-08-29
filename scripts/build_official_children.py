#!/usr/bin/env python3
"""
How many six-digit lines each heading officially contains.

`config/hs_official_children.json` maps every HS-4 heading and HS-2 chapter in
the universe to the number of codes the official classification puts inside it.
That count is the denominator behind the coverage figure on a parent page:
HStat's selection is a slice of a heading, and the page says how large a slice.

Regenerate from the Comtrade H6 reference table:

    python scripts/build_official_children.py

It reads config/reference/comtrade_hs_reference.json, which is a saved copy of
Comtrade's own reference so the count does not depend on having network. If the
reference is absent the script says so and changes nothing - the dashboard then
omits the coverage line rather than guessing a denominator.
"""

from __future__ import annotations

from pathlib import Path
import collections
import json
import sys

ROOT = Path(__file__).resolve().parents[1]

REFERENCE = ROOT / "config" / "reference" / "comtrade_hs_reference.json"

OUTPUT = ROOT / "config" / "hs_official_children.json"

PARENTS = ROOT / "config" / "parent_universe.json"


def main() -> int:
    if not REFERENCE.exists():
        print(
            f"No {REFERENCE.relative_to(ROOT)}.\n"
            "Save Comtrade's H6 reference table there and re-run; without it "
            "the coverage line is omitted rather than estimated."
        )
        return 1

    reference = json.loads(REFERENCE.read_text())

    # Six-digit lines are the unit of comparison at both parent levels: a
    # chapter's denominator is the six-digit lines it contains, not the
    # four-digit headings, so a chapter share and a heading share mean the
    # same thing and can sit on the same page.
    six = [
        str(row.get("code", ""))
        for row in reference
        if row.get("digitLevel") == 6 and len(str(row.get("code", ""))) == 6
    ]

    children: dict[str, set[str]] = collections.defaultdict(set)

    for code in six:
        children[code[:4]].add(code)
        children[code[:2]].add(code)

    parents = json.loads(PARENTS.read_text())

    counts: dict[str, int] = {}

    missing: list[str] = []

    for level in ("2", "4"):
        for code in parents.get(level, []):
            if code not in children:
                missing.append(code)
                continue

            counts[code] = len(children[code])

    OUTPUT.write_text(
        json.dumps(counts, sort_keys=True, separators=(",", ":")) + "\n"
    )

    print(f"{OUTPUT.relative_to(ROOT)}: {len(counts)} headings and chapters")

    if missing:
        print(
            f"  not in the reference table ({len(missing)}): "
            + ", ".join(sorted(missing)[:10])
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
