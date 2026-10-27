#!/usr/bin/env python3
"""
Check the whole HS index (hs_index/) against its rules.

    python pipeline/hs_index_check.py            # report; exit 1 on any error
    python pipeline/hs_index_check.py --json     # machine-readable findings

Runs in CI on every push, and inside the intake before a batch is merged, so
a bad edit cannot reach a data pull. Errors block; warnings are reported.

Structural
  E  every HS-6 is a real HS 2022 code, or a retired predecessor in lineage.csv
  E  no code listed twice; every HS-2 / HS-4 parent has a row in parents.csv
  E  category, segment, DGCIS segment and stream come from vocabulary.json;
     stream is never blank
  E  every lineage row names codes that exist in the index or the reference

Tagging
  E  display names are present, unique (case-insensitive) and at most four
     words (launch_sanity refuses longer ones)
  W  a display name is still an intake placeholder ("... 903039")
  E  parent short names are present and unique
  E  a display name that uses words the official text does not has a review
     verdict in naming_review.csv for exactly that name (see hs_rules.py)
  E  no search term is a primary alias of two different codes, and no
     codes.csv search term also belongs to another HS-6 code
  W  codes with no search vocabulary at all
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import hs_rules  # noqa: E402
from definition import (  # noqa: E402
    PARENTS_CSV,
    _read_csv_rows,
    load_aliases,
    load_lineage,
    load_products,
    load_retirements,
    retired_codes,
)


def load_parents() -> dict[str, dict]:
    return {row["code"]: row for row in _read_csv_rows(PARENTS_CSV) if row.get("code")}


def check() -> list[dict]:
    findings: list[dict] = []

    def add(level: str, rule: str, code: str, message: str) -> None:
        findings.append({"level": level, "rule": rule, "code": code, "message": message})

    products = load_products()
    parents = load_parents()
    retired = retired_codes() | {item.code for item in load_retirements()}
    vocab = hs_rules.vocabulary()
    review = hs_rules.naming_review()
    have_reference = bool(hs_rules.h6())

    if not have_reference:
        add("E", "reference", "-", "config/reference/comtrade_hs_reference.json is missing")
    elif not hs_rules.h6_is_strict():
        add("W", "reference", "-",
            "HS 2022 table not fetched yet; codes checked against Comtrade's all-editions list "
            "(scripts/fetch_hs_references.py)")

    current = [p for p in products if p.hs6 not in retired]

    # ------------------------------------------------------------ structure
    for product in products:
        code = product.hs6

        if have_reference and not hs_rules.is_hs6(code) and code not in retired:
            add("E", "hs2022", code, "not an HS 2022 six-digit code and not a recorded retired code")

        for parent in (code[:2], code[:4]):
            if code in retired:
                continue
            if parent not in parents:
                add("E", "parent", code, f"parent {parent} has no row in hs_index/parents.csv")

        for column in ("category", "segment", "dgcis_segment", "stream"):
            allowed = vocab.get(column)
            value = getattr(product, column)
            if allowed and value and value not in allowed:
                add("E", "vocabulary", code, f"{column} {value!r} is not in hs_index/vocabulary.json")
            if column in ("category", "segment") and not value and code not in retired:
                add("E", "vocabulary", code, f"{column} is empty")

    # A blank stream would load as "other": say so instead of deciding it.
    for row in _read_csv_rows(hs_rules.HS_INDEX / "codes.csv"):
        if row.get("hs6") and not (row.get("stream") or "").strip():
            add("E", "vocabulary", row["hs6"], "stream is empty (electronics, electronics-inputs or other)")

    for code, row in parents.items():
        if have_reference and code not in hs_rules.h6():
            add("E", "hs2022", code, "parent is not an HS 2022 chapter or heading")

    for item in load_lineage():
        known = {p.hs6 for p in products} | retired
        if item.code not in known and item.code not in hs_rules.h6():
            add("E", "lineage", item.code, "lineage row for a code that is in neither the index nor HS 2022")

    # ------------------------------------------------------------ tagging
    names = collections.defaultdict(list)
    for product in current:
        if not product.display_name:
            add("E", "name", product.hs6, "display name is empty")
        names[product.display_name.strip().lower()].append(product.hs6)

    for product in current:
        if len(product.display_name.split()) > hs_rules.MAX_NAME_WORDS:
            add("E", "name-length", product.hs6,
                f"display name {product.display_name!r} runs past {hs_rules.MAX_NAME_WORDS} words")
        elif product.display_name.strip().endswith(product.hs6):
            add("W", "placeholder", product.hs6,
                f"display name {product.display_name!r} is an intake placeholder; give it a real name")

    for name, codes in names.items():
        if name and len(codes) > 1:
            add("E", "name-unique", ",".join(codes), f"display name {name!r} is shared")

    short = collections.defaultdict(list)
    for code, row in parents.items():
        value = (row.get("short_name") or "").strip()
        if not value:
            add("E", "short-name", code, "short name is empty")
        short[value.lower()].append(code)

    for name, codes in short.items():
        if name and len(codes) > 1:
            add("E", "short-name-unique", ",".join(codes), f"short name {name!r} is shared")

    if have_reference:
        for product in current:
            extra = hs_rules.unexplained_words(product.display_name, product.hs6)
            if not extra:
                continue
            record = review.get(product.hs6)
            if not record or record.get("display_name", "").strip() != product.display_name.strip():
                add(
                    "E",
                    "whole-code",
                    product.hs6,
                    f"{product.display_name!r} uses words outside the official text "
                    f"({', '.join(extra)}) and has no review verdict for this name",
                )
            elif (record.get("verdict") or "").strip().lower() != "ok":
                add("E", "whole-code", product.hs6, f"review verdict for {product.display_name!r} is not ok")

    primary = collections.defaultdict(set)
    for alias in load_aliases():
        if alias.primary:
            for term in alias.terms:
                primary[term].add(alias.code)

    # A chapter or heading may share a term with a code inside it (search
    # prefers the narrower one); two unrelated codes may not.
    def nested(a: str, b: str) -> bool:
        return a.startswith(b) or b.startswith(a)

    for term, codes in primary.items():
        ordered = sorted(codes)
        clash = [(a, b) for i, a in enumerate(ordered) for b in ordered[i + 1:] if not nested(a, b)]
        if clash:
            add("E", "alias-overlap", ",".join(ordered), f"primary search term {term!r} points at unrelated codes")

    # A search term written on a code (codes.csv search_terms) must not also
    # belong to another HS-6 code, as its search term or primary alias.
    owners = collections.defaultdict(set)
    for product in current:
        for term in product.search_terms:
            owners[term].add(product.hs6)
    for term, codes in primary.items():
        owners[term].update(code for code in codes if len(code) == 6)

    for product in current:
        for term in product.search_terms:
            others = owners[term] - {product.hs6}
            if others:
                add("E", "search-overlap", product.hs6,
                    f"search term {term!r} also belongs to {', '.join(sorted(others))}")

    vocab_codes = {alias.code for alias in load_aliases()}
    for product in current:
        if product.hs6 not in vocab_codes and not product.search_terms:
            add("W", "search", product.hs6, f"{product.display_name!r} has no search vocabulary")

    # Sectors (hs_index/sectors/): every member is an HS-6 code with a page,
    # each carries both FED tags, the batch it names exists, and its seed
    # covers only codes of that batch.
    import sectors as sector_index
    from definition import load_batches

    sector_index.load_sectors.cache_clear()
    paged = {product.hs6 for product in current}
    batch_codes = {batch["id"]: set(batch.get("codes", [])) for batch in load_batches()}
    seen_ids = set()
    for sector in sector_index.load_sectors(include_disabled=True):
        if sector.id in seen_ids or sector.folder.name != sector.id:
            add("E", "sector", sector.id, "sector id must be unique and match its folder name")
        seen_ids.add(sector.id)
        if sector.batch and sector.batch not in batch_codes:
            add("E", "sector", sector.id, f"names batch {sector.batch!r}, which batches.json does not hold")
        codes_seen = set()
        for entry in sector.codes:
            if entry.hs6 in codes_seen:
                add("E", "sector", entry.hs6, f"listed twice in sector {sector.id}")
            codes_seen.add(entry.hs6)
            if entry.hs6 not in paged:
                add("E", "sector", entry.hs6, f"in sector {sector.id} but not a current HS-6 code in codes.csv")
            if not entry.broad_category or not entry.niche_category:
                add("E", "sector", entry.hs6, f"sector {sector.id}: broad and niche category are both required")
        stray = sector.seed_codes() - batch_codes.get(sector.batch, set())
        if stray:
            add("E", "sector", sector.id, f"seed covers {len(stray)} code(s) outside batch {sector.batch}: {', '.join(sorted(stray)[:5])}")

    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    findings = check()

    if args.json:
        print(json.dumps(findings, indent=1))
    else:
        errors = [f for f in findings if f["level"] == "E"]
        warnings = [f for f in findings if f["level"] == "W"]
        by_rule = collections.Counter(f["rule"] for f in findings)

        for item in errors[:60]:
            print(f"ERROR  {item['rule']:<17} {item['code']:<14} {item['message']}")
        if len(errors) > 60:
            print(f"... {len(errors) - 60} more errors")
        print(
            f"\nHS index: {len(errors)} errors, {len(warnings)} warnings"
            + (f"  ({', '.join(f'{k} {v}' for k, v in sorted(by_rule.items()))})" if findings else "")
        )

    return 1 if any(f["level"] == "E" for f in findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
