"""
Build the search index the dashboard ships.

Search has two jobs and they pull in opposite directions:

  someone types a product        "laptop"  -> answer with the code, plainly
  someone types a code           "847130"  -> answer with the products in it

So every index entry carries both: `answerTerms`, the everyday words this
code is the canonical home for, and `keywords`, the device and component
names that make the code up. Both come from the two CSV files in config/;
nothing here calls an API.
"""

from __future__ import annotations

import json
import re

from common import PUBLIC, write_json
from definition import (
    CONFIG,
    hs6_universe,
    load_aliases,
    load_products,
    parent_universe,
    retired_codes,
    successors_of,
)

# Official HS-2 and HS-4 titles are cached here so the index can be built
# offline. The cache is refreshed from Comtrade's reference table whenever
# this runs with network; it is never the source of the code universe.
TITLES_JSON = CONFIG / "hs_titles.json"

STOPWORDS = {
    "and", "the", "for", "with", "other", "than", "whether", "not",
    "including", "included", "thereof", "therein", "kind", "kinds", "nes",
    "nec", "elsewhere", "specified", "item", "heading", "chapter", "similar",
    "used", "use", "apparatus", "machines", "machine", "parts", "part",
    "articles", "article", "types", "type", "their", "from", "into", "under",
    "over", "such", "which", "where", "when", "whose", "primary", "forms",
    "form", "excluding", "exceeding",
}


def normalise(text: str) -> str:
    return re.sub(
        r"\s+",
        " ",
        str(text)
        .lower()
        .replace("&", " and ")
        .replace("/", " ")
        .replace("-", " ")
        .replace(",", " ")
        .replace(";", " ")
        .replace("(", " ")
        .replace(")", " "),
    ).strip()


def words(text: str) -> list[str]:
    return [
        word
        for word in re.findall(r"[a-z0-9]+", normalise(text))
        if len(word) >= 3 and word not in STOPWORDS
    ]


def dedupe(values) -> list[str]:
    seen: list[str] = []

    for value in values:
        cleaned = normalise(value)

        if cleaned and cleaned not in seen:
            seen.append(cleaned)

    return seen


def derive_heading(members) -> str:
    """
    Best-effort HS-4 title from the member descriptions.

    HS-6 descriptions repeat their heading text before the first semicolon,
    so when every member agrees the heading is exact. When they do not, the
    longest common word prefix is the honest fallback — and it is often
    poor (8504's members are converters, transformers and inductors, whose
    common prefix is just "Electrical"), which is why the Comtrade titles
    cache exists.
    """
    heads = [
        member.description.split(";")[0].strip()
        for member in members
        if member.description
    ]

    if not heads:
        return ""

    if len(set(heads)) == 1:
        return heads[0]

    common: list[str] = []

    for parts in zip(*[head.split() for head in heads]):
        if len(set(parts)) == 1:
            common.append(parts[0])
        else:
            break

    if len(common) >= 2:
        return " ".join(common).rstrip(" ,-")

    return ""


def load_titles() -> dict:
    if TITLES_JSON.exists():
        try:
            return json.loads(TITLES_JSON.read_text())
        except json.JSONDecodeError:
            print("  hs_titles.json unreadable; rebuilding from Comtrade")

    return {}


def refresh_titles(titles: dict, wanted: set[str]) -> dict:
    """
    Top the cache up from Comtrade's HS-2022 reference table.

    Optional by design: no network, no key and no package all mean the
    cached titles (or the derived fallback) are used instead. This never
    decides which codes exist — only what they are called.
    """
    missing = wanted - set(titles)

    if not missing:
        return titles

    try:
        import comtradeapicall
    except ImportError:
        print(f"  comtradeapicall unavailable; {len(missing)} titles derived")
        return titles

    try:
        reference = comtradeapicall.getReference("cmd:H6")
    except Exception as error:  # noqa: BLE001 - enrichment is optional
        print(f"  Comtrade reference unavailable ({error}); titles derived")
        return titles

    if reference is None or reference.empty:
        print(f"  Comtrade reference empty; {len(missing)} titles derived")
        return titles

    code_column = next(
        (name for name in ["id", "cmdCode", "code"] if name in reference.columns),
        None,
    )

    text_column = next(
        (
            name
            for name in ["text", "cmdDesc", "description"]
            if name in reference.columns
        ),
        None,
    )

    if not code_column or not text_column:
        print("  unexpected HS reference schema; titles derived")
        return titles

    found = 0

    for _, row in reference.iterrows():
        code = str(row[code_column]).strip()

        if code.endswith(".0"):
            code = code[:-2]

        if code not in missing:
            continue

        text = str(row[text_column]).strip()

        for prefix in (f"{code} - ", f"{code}-", f"{code} – ", f"{code} — "):
            if text.startswith(prefix):
                text = text[len(prefix):].strip()
                break

        if text:
            titles[code] = text
            found += 1

    print(f"  refreshed {found} official HS titles from Comtrade")

    return titles


def alias_index():
    """Alias rows grouped by the code they belong to."""
    grouped: dict[str, list] = {}

    for alias in load_aliases():
        grouped.setdefault(alias.code, []).append(alias)

    return grouped


def main():
    current = set(hs6_universe())

    retired = retired_codes()

    successors = successors_of()

    # HS 2022 is the base. A retired code is still indexed - somebody will
    # type the old number - but as a signpost to its successors, not as a
    # product with a page of its own.
    products = [
        product for product in load_products() if product.hs6 in current
    ]

    legacy = [
        product for product in load_products() if product.hs6 in retired
    ]

    aliases = alias_index()

    parents = parent_universe()

    by_hs4: dict[str, list] = {}
    by_hs2: dict[str, list] = {}

    for product in products:
        by_hs4.setdefault(product.hs4, []).append(product)
        by_hs2.setdefault(product.hs2, []).append(product)

    wanted_titles = {
        code
        for level_codes in parents.values()
        for code in level_codes
    }

    titles = refresh_titles(load_titles(), wanted_titles)

    write_json(TITLES_JSON, dict(sorted(titles.items())))

    # A product label carried by exactly one code is a safe canonical
    # answer for that code: there is nothing for it to be confused with.
    # Labels shared by several codes ("Cables" covers eight) are left to
    # the curated aliases, which distinguish them.
    label_owners: dict[str, list[str]] = {}

    for product in products:
        key = normalise(product.product)

        if key:
            label_owners.setdefault(key, []).append(product.hs6)

    unique_labels = {
        label: codes[0]
        for label, codes in label_owners.items()
        if len(codes) == 1
    }

    # A hand-written alias always beats the automatic rule. Without this a
    # retired code carrying an old product label (851712 "Mobile phone",
    # replaced by 851713 in HS 2022) would compete with the curated answer.
    claimed = {
        normalise(term)
        for alias in load_aliases()
        if alias.primary
        for term in alias.terms
    }

    records = []

    def alias_terms(code: str) -> list[str]:
        return [
            term
            for alias in aliases.get(code, [])
            for term in alias.terms
        ]

    def answer_rows(code: str):
        return [alias for alias in aliases.get(code, []) if alias.primary]

    # ---------------- HS-6 products ----------------

    for product in products:
        own_aliases = alias_terms(product.hs6)

        parent_aliases = alias_terms(product.hs4) + alias_terms(product.hs2)

        # Curated vocabulary leads. Some workbook product labels are
        # misleading (841510 is labelled "Commercial - ACs" but the code is
        # window and wall units), so a hand-written term should be the first
        # thing a reader sees.
        keywords = dedupe(
            own_aliases
            + [product.product]
            + list(product.search_terms)
        )

        answers = answer_rows(product.hs6)

        answer_terms = dedupe(
            term for alias in answers for term in alias.terms
        )

        auto_label = normalise(product.product)

        if (
            unique_labels.get(auto_label) == product.hs6
            and auto_label not in claimed
            and auto_label not in answer_terms
        ):
            answer_terms.append(auto_label)

        terms = dedupe(
            keywords
            + parent_aliases
            + [product.category, product.segment, product.dgcis_segment]
            + words(product.description)
        )

        # The workbook label is often shared - eight codes under 8544 are
        # all "Cables", which is no help when choosing between them. Where a
        # curated term exists it is the distinguishing one, so it becomes
        # the display label.
        label = keywords[0] if own_aliases else product.product

        records.append(
            {
                "code": product.hs6,
                "level": 6,
                "description": product.description,
                "product": product.product,
                "label": label[:1].upper() + label[1:] if label else "",
                "category": product.category,
                "segment": product.segment,
                "inFedDefinition": product.in_fed_definition,
                "loaded": True,
                "parent2": product.hs2,
                "parent4": product.hs4,
                "keywords": keywords[:14],
                "terms": terms,
                "answerTerms": answer_terms,
                "answerNote": answers[0].note if answers else "",
                "worldExportsUsdBn": product.world_exports_usd_bn,
            }
        )

    # ---------------- HS-4 and HS-2 aggregates ----------------

    def rank(members):
        return sorted(
            members,
            key=lambda item: -(item.world_exports_usd_bn or 0),
        )

    for level, codes in parents.items():
        level = int(level)

        members_by_code = by_hs4 if level == 4 else by_hs2

        for code in codes:
            members = rank(members_by_code.get(code, []))

            product_names = dedupe(item.product for item in members)

            categories = dedupe(item.category for item in members)

            keywords = dedupe(alias_terms(code) + product_names)

            answers = answer_rows(code)

            title = titles.get(code) or derive_heading(members)

            description = title or (
                f"Official HS-{level} aggregate covering "
                f"{len(members)} HStat product line"
                f"{'s' if len(members) != 1 else ''}"
            )

            records.append(
                {
                    "code": code,
                    "level": level,
                    "description": description,
                    "title": title,
                    "memberCount": len(members),
                    "product": ", ".join(product_names[:3]),
                    "label": title or ", ".join(product_names[:2]),
                    "category": categories[0] if categories else "",
                    "segment": "",
                    "inFedDefinition": any(
                        item.in_fed_definition for item in members
                    ),
                    "loaded": True,
                    "parent2": code[:2],
                    "parent4": code[:4] if level >= 4 else None,
                    "keywords": keywords[:14],
                    # Member product names describe an aggregate; they must
                    # not make it compete with the specific code a product
                    # actually sits in. They stay in `keywords` for display.
                    "terms": dedupe(alias_terms(code) + categories),
                    "answerTerms": dedupe(
                        term for alias in answers for term in alias.terms
                    ),
                    "answerNote": answers[0].note if answers else "",
                    "members": [item.hs6 for item in members],
                    "worldExportsUsdBn": sum(
                        item.world_exports_usd_bn or 0 for item in members
                    ),
                }
            )

    # ---------------- retired codes, as signposts ----------------

    for product in legacy:
        targets = successors.get(product.hs6, ())

        records.append(
            {
                "code": product.hs6,
                "level": 6,
                "description": product.description,
                "product": product.product,
                "label": product.product,
                "category": product.category,
                "segment": product.segment,
                "inFedDefinition": product.in_fed_definition,
                "loaded": False,
                "retired": True,
                "successors": list(targets),
                "parent2": product.hs2,
                "parent4": product.hs4,
                "keywords": dedupe(
                    alias_terms(product.hs6) + [product.product]
                )[:14],
                "terms": dedupe(
                    alias_terms(product.hs6)
                    + [product.product]
                    + words(product.description)
                ),
                "answerTerms": [product.hs6],
                "answerNote": (
                    f"Retired in HS 2022. Its trade is now reported under "
                    + ", ".join(targets)
                    + "."
                    if targets
                    else "Retired - no current successor code."
                ),
                "worldExportsUsdBn": product.world_exports_usd_bn,
            }
        )

    records.sort(key=lambda item: (item["level"], item["code"]))

    write_json(PUBLIC / "hs-library.json", records, compact=True)

    # Plain-text mirrors of the universe, so a reviewer can diff what the
    # pull will request without reading JSON.
    (CONFIG / "hs6_universe.txt").write_text(
        "\n".join(sorted(current)) + "\n"
    )

    write_json(CONFIG / "parent_universe.json", parents)

    answer_count = sum(1 for record in records if record["answerTerms"])

    duplicate_answers = find_duplicate_answers(records)

    for term, codes in duplicate_answers.items():
        print(
            f"  warning: '{term}' is marked primary on {len(codes)} codes "
            f"({', '.join(codes)}); the most specific one answers"
        )

    print(f"Search records          : {len(records)}")
    print(f"Retired signposts       : {len(legacy)}")
    print(f"HS-6 products           : {sum(1 for r in records if r['level'] == 6)}")
    print(f"Codes with answer terms : {answer_count}")


def find_duplicate_answers(records) -> dict[str, list[str]]:
    seen: dict[str, list[str]] = {}

    for record in records:
        for term in record["answerTerms"]:
            seen.setdefault(term, []).append(record["code"])

    return {
        term: codes
        for term, codes in seen.items()
        if len(codes) > 1
    }


if __name__ == "__main__":
    main()
