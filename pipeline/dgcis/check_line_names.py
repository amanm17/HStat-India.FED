#!/usr/bin/env python3
"""
Check every published tariff-line name and heading is written out in full.

    python3 pipeline/dgcis/check_line_names.py

Fails when a name or heading
  - is cut off ("…") or carries stray spacing (" ,"),
  - keeps a word that is neither an official HS word nor in the reviewed
    dictionary (config/dgcis_abbreviations.csv): an abbreviation or typo the
    naming rules let through.

Curated schedule names (config/itc_hs8_names.csv) are checked for cuts and
spacing only; their wording is a reviewed choice ("Megger insulation
testers"). A failure is fixed in the dictionary or the naming rules
(line_names.py), never by editing the published files.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import line_names as ln  # noqa: E402

INDEX = ln.ROOT / "public" / "data" / "dgcis" / "hs8-index.json"


def vouched() -> set[str]:
    """Every word a name may use: official HS words and reviewed dictionary words."""
    # Dictionary keys are not on the list: an abbreviation is the thing this
    # catches. Its expansions are.
    out = set(ln.words()) | set(ln.ACRONYMS) | set(ln.capitals())
    for rows in ln.dictionary().values():
        for _, expansion in rows:
            out.update(w.upper() for w in ln.LETTERS.findall(expansion))
    out.update(w.upper() for w in ln.STANDARD.values() for w in ln.LETTERS.findall(w))
    out.update(w.upper() for w in ln.UNITS.values() for w in ln.LETTERS.findall(w))
    # HStat's own reviewed short names, which a name may carry as its heading.
    from build_frontend_hs8 import heading_names
    for name in heading_names().values():
        out.update(w.upper() for w in ln.LETTERS.findall(name))
    return out | {"HS", "TARIFF", "ITEM"}


def problems(line: dict, known: set[str]) -> list[str]:
    found = []
    title = line.get("title") or ""
    heading = line.get("headingName") or ""
    for label, text in (("name", title), ("heading", heading)):
        if "…" in text or " ," in text or "  " in text:
            found.append(f"{label} cut or badly spaced: {text[:90]}")
    if line.get("nameSource") != "schedule":
        missing = [w for w in ln.LETTERS.findall(title) if len(w) > 1 and w.upper() not in known]
        if missing:
            found.append(f"name keeps unvouched words {sorted(set(w.upper() for w in missing))}: {title[:90]}")
    return found


def main() -> int:
    if not INDEX.exists():
        print("no published tariff lines; nothing to check")
        return 0
    lines = json.loads(INDEX.read_text())["lines"]
    known = vouched()
    failures = [(line["hs8"], issue) for line in lines for issue in problems(line, known)]
    if failures:
        print(f"FAIL: {len(failures)} tariff-line name problem(s)")
        for hs8, issue in failures[:40]:
            print(f"  {hs8}  {issue}")
        return 1
    print(f"ok: {len(lines)} tariff-line names and headings written out in full")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
