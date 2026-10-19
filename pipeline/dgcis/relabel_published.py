#!/usr/bin/env python3
"""
Bring the published tariff-line pages (public/data/dgcis) up to date with the
HS index, without the DGCIS extract.

    python3 pipeline/dgcis/relabel_published.py

Every HS-8 in scope is kept whether or not its HS-6 is an HStat product, and
each page says which it is (`relation`: product / predecessor / standalone).
That can change between DGCIS refreshes: an HS intake adds a code, the
nightly backfill publishes its product page, and the lines under it stop
being standalone. The monthly refresh workflow runs this after promoting a
snapshot, so a tariff line links up to a product page from the day that page
exists - not from the next hand download.

Only labels change: relation, isProduct, the heading name, and the
manifest's coverage lists. Figures are never touched. Files are rewritten only
when something in them changed, in the same format build_frontend_hs8.py
writes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import hs8_scope  # noqa: E402
from build_frontend_hs8 import heading_names, official_heading  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "data" / "dgcis"


def compact(payload) -> str:
    return json.dumps(payload, separators=(",", ":"))


def main() -> int:
    manifest_path = OUT / "manifest.json"
    index_path = OUT / "hs8-index.json"

    if not manifest_path.exists() or not index_path.exists():
        print("no published tariff-line data; nothing to relabel")
        return 0

    headings = heading_names()
    changed = 0
    groups = {"product": [], "predecessor": [], "standalone": []}
    lines_per_hs6: dict[str, int] = {}

    for path in sorted((OUT / "hs6").glob("*.json")):
        payload = json.loads(path.read_text())
        hs6 = payload["hs6"]
        relation = hs8_scope.relation(hs6)
        heading = headings.get(hs6, "") or official_heading(hs6)

        before = compact(payload)
        payload["relation"] = relation
        payload["isProduct"] = relation == "product"
        for line in payload.get("lines", []):
            line["headingName"] = heading

        # Keep relation next to isProduct, as the build writes it.
        ordered = {}
        for key, value in payload.items():
            if key == "relation":
                continue
            if key == "isProduct":
                ordered["relation"] = payload["relation"]
            ordered[key] = value

        after = compact(ordered)
        if after != before:
            path.write_text(after)
            changed += 1

        groups[relation].append(hs6)
        lines_per_hs6[hs6] = len(payload.get("lines", []))

    index = json.loads(index_path.read_text())
    before = compact(index)
    for line in index["lines"]:
        relation = hs8_scope.relation(line["hs6"])
        line["headingName"] = headings.get(line["hs6"], "") or official_heading(line["hs6"])
        line["relation"] = relation
        line["isProduct"] = relation == "product"
    if compact(index) != before:
        index_path.write_text(compact(index))
        changed += 1

    manifest = json.loads(manifest_path.read_text())
    before = json.dumps(manifest, indent=1)
    universe = hs8_scope.products()
    manifest.update({
        "productsCovered": len(groups["product"]),
        "productsTotal": len(universe),
        "coveredHs6": sorted(groups["product"]),
        "predecessorHs6": sorted(groups["predecessor"]),
        "standaloneHs6": sorted(groups["standalone"]),
        "standaloneHs8": sum(lines_per_hs6[code] for code in groups["standalone"]),
        "scope": hs8_scope.config()["mode"],
        "scopeChapters": list(hs8_scope.chapters() or []),
    })
    if json.dumps(manifest, indent=1) != before:
        manifest_path.write_text(json.dumps(manifest, indent=1))
        changed += 1

    print(
        f"tariff-line pages: {len(groups['product'])} product, "
        f"{len(groups['predecessor'])} predecessor, {len(groups['standalone'])} standalone "
        f"HS-6 headings; {changed} file(s) updated"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
