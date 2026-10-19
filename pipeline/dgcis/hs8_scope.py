#!/usr/bin/env python3
"""
Which India tariff lines HStat keeps, and how each one relates to the rest of
the dashboard. One place, read by the validator, the processor, the frontend
build and the refresh's portal instructions, so they cannot disagree.

    python3 pipeline/dgcis/hs8_scope.py      # print the scope and the
                                              # chapter list for the portal

SCOPE (hs_index/hs8_scope.json)

  chapters  every HS-8 under an HS-2 chapter the HS index covers. Derived from
            hs_index/codes.csv and lineage.csv, so adding codes in a new
            chapter widens the tariff-line scope with no other edit.
  list      only the chapters named in the file.
  all       every HS-8 the DGCIS extract holds.

Until 2026-10 a tariff line was kept only when it traced back to an HStat
HS-6 (or its retired predecessor). That rule is gone: every line in scope is
kept, and one whose HS-6 has no product page gets a page of its own.

RELATION (per HS-6, so per tariff line)

  product      the HS-6 has an HStat product page
  predecessor  the HS-6 is a retired code HStat carries for lineage
  standalone   neither: the line stands on its own page, with no Comtrade
               card, because there is no HStat heading to link up to
"""
from __future__ import annotations

import csv
import json
import re
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SCOPE_JSON = ROOT / "hs_index" / "hs8_scope.json"
CODES_CSV = ROOT / "hs_index" / "codes.csv"
LINEAGE_CSV = ROOT / "hs_index" / "lineage.csv"
UNIVERSE = ROOT / "config" / "hs6_universe.txt"
CATALOGUE = ROOT / "public" / "data" / "snapshots" / "current" / "catalogue.json"

MODES = ("chapters", "list", "all")
RELATIONS = ("product", "predecessor", "standalone")


def _rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    lines = [
        line for line in path.read_text(encoding="utf-8-sig").splitlines()
        if line.strip() and not line.startswith("#")
    ]
    return list(csv.DictReader(lines))


def _digits(value: str) -> str:
    return re.sub(r"\D", "", str(value or ""))


@lru_cache(maxsize=1)
def config() -> dict:
    data = json.loads(SCOPE_JSON.read_text(encoding="utf-8")) if SCOPE_JSON.exists() else {}
    mode = data.get("mode", "chapters")

    if mode not in MODES:
        raise SystemExit(f"{SCOPE_JSON}: mode {mode!r} is not one of {', '.join(MODES)}")

    listed = sorted({_digits(c).zfill(2) for c in data.get("chapters", []) if _digits(c)})

    if mode == "list" and not listed:
        raise SystemExit(f"{SCOPE_JSON}: mode 'list' needs at least one chapter")

    return {"mode": mode, "chapters": listed}


@lru_cache(maxsize=1)
def products() -> frozenset[str]:
    """
    HS-6 codes with an HStat product page. The HS-6 universe, narrowed to the
    pages the published snapshot actually has: a code merged by the HS intake
    is in the universe before its first pull, and a tariff line must not link
    to a product page that is not live yet.
    """
    codes = set(universe())

    if CATALOGUE.exists():
        live = {
            str(entry.get("code"))
            for entry in json.loads(CATALOGUE.read_text(encoding="utf-8"))
            if entry.get("level") == 6
        }
        codes &= live

    return frozenset(codes)


@lru_cache(maxsize=1)
def predecessors() -> frozenset[str]:
    """Retired HS-6 codes HStat carries for lineage (and has no page for)."""
    codes = set()
    for row in _rows(LINEAGE_CSV):
        predecessor = _digits(row.get("predecessor"))
        if len(predecessor) == 6:
            codes.add(predecessor)
        # A row about a code that was itself retired.
        if (row.get("relation") or "").strip() == "retired" and len(_digits(row.get("code"))) == 6:
            codes.add(_digits(row.get("code")))
    return frozenset(codes - products())


@lru_cache(maxsize=1)
def universe() -> frozenset[str]:
    """Every HS-6 in the HS index, including codes whose first pull is pending."""
    if UNIVERSE.exists():
        return frozenset(c for c in UNIVERSE.read_text().split() if len(c) == 6)
    return frozenset(
        _digits(r.get("hs6")) for r in _rows(CODES_CSV) if len(_digits(r.get("hs6"))) == 6
    )


@lru_cache(maxsize=1)
def chapters() -> tuple[str, ...] | None:
    """The HS-2 chapters in scope, or None for 'all'."""
    cfg = config()

    if cfg["mode"] == "all":
        return None
    if cfg["mode"] == "list":
        return tuple(cfg["chapters"])

    # The whole index, pending codes included, so the next portal query
    # already covers a chapter an intake has just opened.
    return tuple(sorted({code[:2] for code in universe() | predecessors()}))


def in_scope(hs8: str) -> bool:
    wanted = chapters()
    return wanted is None or hs8[:2] in wanted


@lru_cache(maxsize=1)
def _streams() -> dict[str, str]:
    return {
        _digits(r.get("hs6")): (r.get("stream") or "").strip() or "other"
        for r in _rows(CODES_CSV)
        if len(_digits(r.get("hs6"))) == 6
    }


def stream(hs6: str) -> str:
    """
    The stream a tariff line counts toward: its HS-6's in the HS index
    (electronics / electronics-inputs / other), and "other" for a line
    whose HS-6 HStat does not carry. Only "electronics" lines are summed
    into an electronics figure anywhere on the dashboard.
    """
    return _streams().get(hs6, "other")


def relation(hs6: str) -> str:
    if hs6 in products():
        return "product"
    if hs6 in predecessors():
        return "predecessor"
    return "standalone"


def describe() -> str:
    cfg = config()
    wanted = chapters()
    scope = "every chapter" if wanted is None else f"{len(wanted)} chapters: {', '.join(wanted)}"
    return f"HS-8 scope ({cfg['mode']}): {scope}"


def portal_selection() -> str:
    """What to pick in the DGCIS portal's commodity selector."""
    wanted = chapters()
    if wanted is None:
        return "All commodities (every chapter)"
    return "HS-2 chapters " + ", ".join(wanted)


if __name__ == "__main__":
    print(describe())
    print(f"products: {len(products())}, lineage predecessors: {len(predecessors())}")
    print(f"portal  : {portal_selection()}")
