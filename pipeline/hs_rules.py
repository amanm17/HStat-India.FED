"""
Rules for the HS index (hs_index/), shared by the intake and the index check.

Two kinds of rule live here.

Structural: every code is a real HS 2022 six-digit code (or a recorded
retired predecessor), every parent exists, nothing is listed twice, every
category and segment comes from the agreed vocabulary.

Tagging: every display name is unique, and every name describes the whole
HS-6 code rather than a narrower product inside it. The second cannot be
decided by a program - "Laptops and notebooks" is a fair name for "portable
automatic data processing machines", "Commercial washing machines" is a
wrong one for a household-type code - so the program finds the names that
use words the official text does not, and a reviewer records a verdict for
each in hs_index/naming_review.csv. A verdict is tied to the exact name it
was given for: rename the code and the old verdict no longer counts.
"""

from __future__ import annotations

import csv
import json
import re
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

HS_INDEX = ROOT / "hs_index"
REFERENCE_DIR = ROOT / "config" / "reference"

# comtrade_hs_reference.json is Comtrade's combined HS list: every edition
# since 1988, so it also holds codes HS 2022 no longer has (850611 ...). It
# serves descriptions; it cannot say whether a code is current. The edition
# tables below can, and scripts/fetch_hs_references.py saves them.
COMBINED_REFERENCE = REFERENCE_DIR / "comtrade_hs_reference.json"
H6_REFERENCE = REFERENCE_DIR / "comtrade_hs_reference_h6.json"
H5_REFERENCE = REFERENCE_DIR / "comtrade_hs_reference_h5.json"

NAMING_REVIEW_CSV = HS_INDEX / "naming_review.csv"
VOCABULARY_JSON = HS_INDEX / "vocabulary.json"

# Words that carry no product meaning, so a name may use them freely.
STOP_WORDS = set(
    """
    a an and or of for the with to in on by from at as other others n.e.c nec
    etc incl including excl excluding not without whether parts part kind
    kinds type types use used its their than this that these those also
    under over up upto below above more less not exceeding exceeding all any
    same such per each non
    """.split()
)


# ---------------------------------------------------------------- reference


def _load_reference(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}

    rows = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}

    for row in rows:
        code = str(row.get("code") or "").strip()

        if not code or not code.isdigit():
            continue

        text = str(row.get("description") or "")
        # Comtrade prefixes the code: "851713 - Telephone sets; ..."
        if " - " in text and text.split(" - ", 1)[0].strip() == code:
            text = text.split(" - ", 1)[1]

        out[code] = {
            "code": code,
            "text": text.strip(),
            "parent": str(row.get("parent") or ""),
            "level": int(row.get("digitLevel") or len(code)),
            "leaf": bool(row.get("isLeaf")),
        }

    return out


@lru_cache(maxsize=1)
def h6() -> dict[str, dict]:
    """
    The HS 2022 nomenclature, as Comtrade publishes it. Until the edition
    table has been fetched this falls back to the combined list (see
    h6_is_strict); the intake refuses to merge on the fallback.
    """
    if H6_REFERENCE.exists():
        return _load_reference(H6_REFERENCE)
    return _load_reference(COMBINED_REFERENCE)


def h6_is_strict() -> bool:
    """True when h6() is the HS 2022 table itself, not the all-editions list."""
    return H6_REFERENCE.exists()


@lru_cache(maxsize=1)
def h5() -> dict[str, dict]:
    """The HS 2017 nomenclature, when it has been fetched (empty otherwise)."""
    return _load_reference(H5_REFERENCE)


def official_text(code: str) -> str:
    return h6().get(code, {}).get("text", "")


def hs6_children(code: str) -> list[str]:
    """Every HS 2022 six-digit code under a chapter or heading."""
    return sorted(
        item["code"]
        for item in h6().values()
        if item["level"] == 6 and item["code"].startswith(code)
    )


def is_hs6(code: str) -> bool:
    item = h6().get(code)
    return bool(item) and item["level"] == 6


# ---------------------------------------------------------------- naming


def content_words(text: str) -> list[str]:
    return [
        word
        for word in re.findall(r"[a-z][a-z\-]+", text.lower())
        if word not in STOP_WORDS and len(word) > 2
    ]


def _stem(word: str) -> str:
    return word.rstrip("s")[:5]


def unexplained_words(name: str, code: str) -> list[str]:
    """
    Words in a display name that the official text of the code, or of the
    heading it sits in, does not contain. An empty list means the name only
    reuses official wording, so it cannot be narrower than the code.
    """
    official = official_text(code) + " " + official_text(code[:4])
    known = set()
    for word in content_words(official):
        known.add(_stem(word))
        known.update(_stem(part) for part in word.split("-") if part)

    def explained(word: str) -> bool:
        if _stem(word) in known:
            return True
        # "beverage-vending" in the text explains "vending"; "non-tape" is
        # explained when "tape" is.
        parts = [part for part in word.split("-") if part and part not in STOP_WORDS]
        return len(parts) > 0 and "-" in word and all(_stem(part) in known for part in parts)

    return [word for word in content_words(name) if not explained(word)]


@lru_cache(maxsize=1)
def naming_review() -> dict[str, dict]:
    """code -> {name, verdict, note}: the reviewer's record for each flagged name."""
    if not NAMING_REVIEW_CSV.exists():
        return {}

    lines = [
        line
        for line in NAMING_REVIEW_CSV.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]

    return {
        row["code"]: row
        for row in csv.DictReader(lines)
        if row.get("code")
    }


@lru_cache(maxsize=1)
def vocabulary() -> dict[str, list[str]]:
    if not VOCABULARY_JSON.exists():
        return {}

    return json.loads(VOCABULARY_JSON.read_text(encoding="utf-8"))


# ---------------------------------------------------------------- drafting


_TRIM = [
    r"(?:(?<=\s)|^)\(.*?\)",                     # parentheticals, not "poly(vinyl ...)"
    r"\bn\.e\.c\.?( in (chapter|heading|item|subheading)( no\.?)? ?[\d.]+(\s*(or|and|,)\s*[\d.]+)*)?",
    r"\b(of|in) (chapter|heading|item|subheading)s?( no\.?)? ?[\d.]+(\s*(or|and|to|,)\s*[\d.]+)*",
    r"\bother than those of (heading|item)( no\.?)? ?[\d.]+(\s*(or|and|,)\s*[\d.]+)*",
    r"\bor [\d]{4}\.[\d]{2}\b",
    r"\bn\.?e\.?s\.?(?=\W|$)",                   # "nes", Comtrade's short form of n.e.c.
    r"\bthereof\b",
    r",?\s*\b(not )?(elsewhere )?(specified|stated) or included( elsewhere)?( in this chapter)?",
    r",?\s*\bor included\b",
    r"^[\s\-:]+",                                # indented texts: "- kitchen waste disposers"
]

# A clause is cut where its legal qualifiers begin.
_QUALIFIERS = re.compile(
    r",? (whether or not|including|excluding|other than|not incorporating|"
    r"consisting of|containing|having a|of a kind|of an? (output|capacity|weight|width))\b.*$",
    re.I,
)

# Words a name must not end on.
_DANGLING = {
    "of", "and", "or", "the", "for", "with", "whether", "not", "a", "an",
    "in", "to", "by", "including", "other", "than", "on", "at", "its",
}

# A subheading clause that starts with one of these is a qualifier of the
# heading, not a product of its own: keep the heading noun in front.
_QUALIFIER_START = {
    "for", "of", "with", "whether", "not", "other", "parts", "household",
    "consisting", "incorporating", "containing", "having", "used", "designed",
    "electric", "electronic", "non-electric", "fixed", "portable", "single",
    "prepared", "operated", "comprising", "presented", "able", "capable",
}


def _clean(text: str) -> str:
    for pattern in _TRIM:
        text = re.sub(pattern, "", text, flags=re.I)

    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s*,(\s*,)+", ",", text)
    text = re.sub(r"\s+([,;])", r"\1", text)

    return text.strip(" ,;.-")


def _tidy_end(text: str) -> str:
    words = text.strip(" ,;").split()

    while words and (words[-1].lower().strip(",;") in _DANGLING or not re.search(r"\w", words[-1])):
        words.pop()

    return " ".join(words).strip(" ,;")


def _shorten(text: str, limit: int) -> str:
    text = _tidy_end(text)

    if len(text) <= limit:
        return text

    cut = text[:limit]

    for mark in (", ", " "):
        at = cut.rfind(mark)
        if at > limit // 2:
            return _tidy_end(cut[:at])

    return _tidy_end(cut)


def _clause(text: str) -> str:
    return _QUALIFIERS.sub("", text).strip(" ,;")


MAX_NAME_WORDS = 4  # launch_sanity refuses longer display names


def _fragments(clause: str) -> list[str]:
    return [_tidy_end(part) for part in clause.split(",") if _tidy_end(part)]


def _fit(text: str, max_words: int) -> str:
    """The text, tidied, if it fits in max_words; otherwise empty."""
    text = _tidy_end(re.sub(r"\s+", " ", text))
    if not text or len(text.split()) > max_words:
        return ""
    if text.split()[0].lower() in _QUALIFIER_START | {"of", "and", "or"}:
        return ""
    return text[0].upper() + text[1:]


def _official_clauses(code: str) -> tuple[str, str]:
    """(heading clause, subheading clause) of the code's official text."""
    raw = official_text(code) or ""

    # Some Comtrade texts are only the indented subheading ("Of polymers of
    # vinyl chloride :-- Flexible"); put the heading's own words in front.
    if ":-" in raw:
        before, _, after = raw.partition(":-")
        after = after.lstrip("-: ")
        heading = _clause(_clean(official_text(code[:4])).split(";")[0])
        raw = f"{heading}; {after}, {before}" if heading else f"{before}; {after}"

    text = _clean(raw) or code
    clauses = [_clause(part) for part in text.split(";") if part.strip()]
    clauses = [part for part in clauses if part]

    head = clauses[0] if clauses else text
    tail = clauses[-1] if len(clauses) > 1 else ""
    return head, tail


def name_candidates(code: str, max_words: int = MAX_NAME_WORDS) -> list[str]:
    """
    Display names built only from the code's official wording, best first,
    each at most max_words long. HS texts read "Heading; subheading"; the
    subheading clause is the specific part, and when it starts as a qualifier
    ("household type", "for electric control") the heading noun stays in
    front of it. Legal qualifiers ("whether or not ...") are cut first.
    """
    head, tail = _official_clauses(code)
    head_parts = _fragments(head) or [head]
    tail_parts = _fragments(tail)

    raw: list[str] = []

    if tail:
        first = tail.split()[0].lower().strip(",")
        if first not in _QUALIFIER_START and (first.endswith("s") or tail.split()[-1].lower().endswith("s")):
            raw.append(tail)
        # A fragment that opens as a qualifier ("for cleaning") says nothing
        # on its own after a comma.
        usable = [part for part in tail_parts if part.split()[0].lower() not in _QUALIFIER_START]
        # Three or more fragments are a list ("table, floor, wall, window,
        # ceiling or roof fans"): any one item would name part of the code,
        # so a list gives no fragment candidates and the name falls back to
        # a placeholder for a person to write.
        if usable and len(tail_parts) < 3:
            raw.append(f"{head}, {usable[-1]}")
            raw.append(f"{head_parts[0]}, {usable[-1]}")
        raw.append(f"{head}, {tail}")
    else:
        raw.append(head)
        if len(head_parts) > 1:
            raw.append(f"{head_parts[0]}, {head_parts[-1]}")

    seen: list[str] = []
    for text in raw:
        name = _fit(text, max_words)
        if name and name.lower() not in {s.lower() for s in seen}:
            seen.append(name)

    return seen


def draft_name(code: str, taken: set[str], max_words: int = MAX_NAME_WORDS) -> str:
    """
    The best unique official-wording name of at most max_words, or "" when
    there is none: the intake then holds the code until the upload gives it a
    display_name (a cut-down phrase could read as a narrower product).
    """
    for name in name_candidates(code, max_words):
        if name.lower() not in taken:
            return name
    return ""


def placeholder_name(code: str, max_words: int = MAX_NAME_WORDS) -> str:
    """
    When no official-wording name fits: the heading's own first words and the
    code ("Instruments and apparatus 903039"). Broader than the code, never
    narrower, unique by construction, and listed in the batch report as a
    name to replace.
    """
    head, _ = _official_clauses(code)
    words = (_fragments(head) or [head])[0].split()[: max_words - 1]
    core = _tidy_end(" ".join(words)) or "HS"
    core = core[0].upper() + core[1:]
    return f"{core} {code}"


def draft_short_name(code: str, taken: set[str], limit: int = 44) -> str:
    """A chapter or heading short name: its first official clause, cleaned."""
    text = _clean(official_text(code)) or f"HS {code}"
    name = _shorten(_clause(text.split(";")[0].strip()), limit)
    name = name[0].upper() + name[1:]

    if name.lower() in taken:
        name = _shorten(text.replace(";", ","), limit + 16)
        name = name[0].upper() + name[1:]

    # Still the same words as a chapter or another heading ("Machinery and
    # mechanical appliances" is both 84 and the start of 8479): the code
    # tells them apart without inventing words.
    if name.lower() in taken:
        name = f"{_shorten(name, limit - 10)} (HS {code})"

    return name


def draft_search_terms(name: str) -> list[str]:
    """A few lower-case search terms from a drafted name."""
    words = content_words(name)
    terms = [name.lower()]

    if len(words) >= 2:
        terms.append(" ".join(words[:2]))

    return sorted(set(terms))
