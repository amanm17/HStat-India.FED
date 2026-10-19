#!/usr/bin/env python3
"""
Propose rows for config/dgcis_abbreviations.csv: how each abbreviated word in
DGCIS's line descriptions is spelled out.

    python3 pipeline/dgcis/mine_abbreviations.py            # report only
    python3 pipeline/dgcis/mine_abbreviations.py --write    # add new rows

A DGCIS description drops letters ("PAPR", "PAPRBORD", "OTHR"). Every
proposal is anchored in official wording for the same line: an abbreviation
is only expanded to a word that the tariff schedule (GST HSN master) or the
WCO text uses for that line, its HS-6 or its heading, and whose letters
contain the abbreviation's in order with the same first letter. A word joined
to the next ("CASINGANDTUBING") is split only into words the HS texts use.

Existing rows are never changed by this script: the file is reviewed by hand,
and a hand correction must survive the next run. New rows are appended with
the method that proposed them, so a reviewer can start from the weak ones
(`elsewhere`, `nearest`, `spelling`).

wordfreq, when installed, lets a plain English word that the HS texts happen
not to use ("speakers", "antenna") pass as itself. Without it those words are
reported as unresolved for a reviewer to add.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import line_names as ln  # noqa: E402

ROOT = ln.ROOT
PUBLISHED = ROOT / "public" / "data" / "dgcis" / "hs6"
FIELDS = ["abbreviation", "expansion", "scope", "method", "lines", "example"]
SMALL = {"AND", "OF", "OR", "FOR", "THE", "IN", "ON", "WITH", "TO", "BY", "NOT", "AS", "AT"}
VOWELS = set("AEIOU")

try:  # optional
    from wordfreq import zipf_frequency
except Exception:  # noqa: BLE001
    zipf_frequency = None


def zipf(token: str) -> float:
    return zipf_frequency(token.lower(), "en") if zipf_frequency else 0.0


def english(token: str, floor: float = 3.0) -> bool:
    return len(token) >= 4 and zipf(token) >= floor


def wordlike(token: str) -> bool:
    """
    A real word the HS texts do not use: a known English word, however rare
    ("galvanised", "agate"), or a name with a word's shape ("Duranol", a dye
    brand). Abbreviations have dropped their vowels; these have not.
    """
    if len(token) < 3 or misspelt(token):
        return False
    if zipf(token) >= 1.0 and len(token) >= 4:
        return True
    vowels = sum(ch in VOWELS for ch in token)
    return len(token) >= 5 and vowels / len(token) >= 0.3 and not re.search(r"[^AEIOUY]{4,}", token)


def subsequence(short: str, long: str) -> bool:
    letters = iter(long)
    return all(ch in letters for ch in short)


def skeleton(word: str) -> str:
    """First letter, then consonants, doubles collapsed: PAPERBOARD -> PPRBRD."""
    body = word[0] + "".join(ch for ch in word[1:] if ch not in VOWELS)
    return re.sub(r"(.)\1+", r"\1", body)


def distance(a: str, b: str) -> int:
    """Edit distance, a swap of two neighbouring letters counting as one."""
    rows = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        rows[i][0] = i
    for j in range(len(b) + 1):
        rows[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = a[i - 1] != b[j - 1]
            rows[i][j] = min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                rows[i][j] = min(rows[i][j], rows[i - 2][j - 2] + 1)
    return rows[-1][-1]


def misspelt(token: str) -> bool:
    """
    Within a letter or two of a word the HS texts use ("POLEYTHYLENE",
    "DIALATORS"): a typo, not a word. Left unresolved for a reviewer rather
    than passed as spelled.
    """
    if len(token) < 5 or zipf(token) >= 1.0:
        return False
    limit = 1 if len(token) < 10 else 2
    for word in ln.words():
        if word != token and abs(len(word) - len(token)) <= limit and word[0] == token[0]:
            if distance(token, word) <= limit:
                return True
    return False


def published_lines() -> list[dict]:
    out = []
    for path in sorted(PUBLISHED.glob("*.json")):
        payload = json.loads(path.read_text())
        for line in payload.get("lines", []):
            out.append({"hs8": line["hs8"], "hs6": payload["hs6"], "description": line.get("description", "")})
    return out


def local_words(hs8: str, hs6: str, by_prefix: dict[str, set[str]]) -> set[str]:
    """Official words for the line, its HS-6 and heading, and their siblings."""
    found: set[str] = set()
    for code in (hs8, hs6, hs6[:4], hs6[:2]):
        found.update(w.upper() for w in ln.LETTERS.findall(ln.tariff_texts().get(code, "")))
        found.update(w.upper() for w in ln.LETTERS.findall(ln.comtrade_texts().get(code, "")))
    found |= by_prefix.get(hs6, set()) | by_prefix.get(hs6[:4], set())
    # Only correctly spelled words: the tariff schedule has typos of its own.
    return {w for w in found if w in ln.words() or english(w)}


CONNECTORS = {"AND", "OF", "OR", "FOR", "WITH", "IN", "ON", "AN", "INCL"}


def segment(token: str) -> list[str] | None:
    """
    Split a run-together token ("CASINGANDTUBING") into known words. Every
    part is a connector ("and", "of") or an HS word of three letters or more,
    and a split needs a connector unless the token is long and every part is
    a real word of its own ("MOTORVEHICLES"). Among splits with the fewest
    parts, the one with most connectors wins: "FATS AND OILS", not "FAT SAND
    OILS".
    """
    # Parts may be HS words or abbreviations the dictionary already spells
    # out ("PRTSANDACCSSRS" -> parts and accessories).
    known = set(ln.dictionary())
    vocab = ln.words() | known
    best: dict[int, tuple[int, int, list[str]]] = {0: (0, 0, [])}
    for end in range(1, len(token) + 1):
        for start in range(max(0, end - 24), end):
            if start not in best:
                continue
            part = token[start:end]
            connector = part in CONNECTORS
            if not connector and not (len(part) >= 3 and part in vocab and (part in ln.words() or part in known)):
                continue
            parts, links, chosen = best[start]
            candidate = (parts + 1, links - connector, chosen + [part])
            if end not in best or candidate[:2] < best[end][:2]:
                best[end] = candidate
    if len(token) not in best:
        return None
    parts, links, chosen = best[len(token)]
    if parts < 2:
        return None
    if links == 0 and not (len(token) >= 12 and all(len(p) >= 4 for p in chosen)):
        return None
    return chosen


def resolve(token: str, local: set[str], code: str = "") -> tuple[str, str] | None:
    if english(token, 4.0):
        return token.lower(), "english"

    # An abbreviation: an official word for this line whose letters contain
    # the token's in order. A short token must match the word's consonants
    # exactly ("FR" for "for", "WTH" for "with"); "CH" matches nothing.
    options = [w for w in local if w[0] == token[0] and len(w) > len(token) and subsequence(token, w)]
    exact = [w for w in options if skeleton(w) == skeleton(token)]
    if len(token) <= 3:
        options = exact
    if options:
        pool = exact or options
        ending = [w for w in pool if w[-1] == token[-1]] or pool
        if len(ending) == 1:
            return ending[0].lower(), "local"
        # Several words fit. Singular and plural of one word is not a real
        # ambiguity: the token's last letter already chose between them.
        stems = {w.rstrip("S") for w in ending}
        if len(stems) == 1:
            return min(ending, key=len).lower(), "local"
        return None

    if zipf(token) >= 1.0 and len(token) >= 4 and not misspelt(token):
        return token.lower(), "english"

    parts = segment(token)
    if parts:
        spelled = [ln.lookup(p, code) or p.lower() for p in parts]
        return " ".join(spelled), "split"

    # Misspellings ("CIRCUALR") are not guessed here: a near match picks the
    # wrong word too often ("EXCLDING" is nearer "exceeding" in some lines'
    # wording). They are left for a reviewer, who adds a `manual` row.
    # A word-shaped token no dictionary knows passes as itself only where
    # proper names are the norm (dye brands in 32, active ingredients in
    # 38) or where the line's own tariff row spells it the same way. In any
    # other chapter it is far more often a typo or two words run together.
    official = {w.upper() for w in ln.LETTERS.findall(ln.tariff_texts().get(code, ""))}
    if wordlike(token) and (code[:2] in ("32", "38") or token in official):
        return token.lower(), "word"
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="append new rows to the dictionary")
    args = parser.parse_args()

    lines = published_lines()

    # Sibling wording: every tariff row under an HS-6 and a heading.
    by_prefix: dict[str, set[str]] = defaultdict(set)
    for code, text in ln.tariff_texts().items():
        if len(code) == 8:
            found = {w.upper() for w in ln.LETTERS.findall(text)}
            by_prefix[code[:6]] |= found
            by_prefix[code[:4]] |= found

    # Every abbreviation already in the file, including those reviewed and
    # deliberately left blank, is settled.
    existing = set()
    if ln.DICTIONARY.exists():
        with ln.DICTIONARY.open(newline="", encoding="utf-8") as handle:
            existing = {(row.get("abbreviation") or "").strip().upper() for row in csv.DictReader(handle)}
    proposals: dict[str, Counter] = defaultdict(Counter)
    methods: dict[tuple[str, str], str] = {}
    examples: dict[tuple[str, str], str] = {}
    scoped: dict[str, list[tuple[str, str]]] = defaultdict(list)
    unresolved: Counter = Counter()
    unresolved_example: dict[str, str] = {}

    texts = [(line["hs8"], line["hs6"], line["description"]) for line in lines]
    # The tariff's own rows are spelled out with the same dictionary.
    texts += [(line["hs8"], line["hs6"], ln.tariff_texts().get(line["hs8"], "")) for line in lines]

    for hs8, hs6, text in texts:
        _, missing = ln.spell_out(text, hs8)
        if not missing:
            continue
        local = local_words(hs8, hs6, by_prefix)
        for token in missing:
            if token in existing:
                continue
            found = resolve(token, local, hs8)
            if not found:
                unresolved[token] += 1
                unresolved_example.setdefault(token, f"{hs8} {text}")
                continue
            expansion, method = found
            # A code with no vowels ("XSBR", "BFFB") stays a code.
            if expansion == token.lower() and not set(token) & set("AEIOUY"):
                expansion = token
            proposals[token][expansion] += 1
            methods.setdefault((token, expansion), method)
            examples.setdefault((token, expansion), f"{hs8} {text}")
            scoped[token].append((hs6, expansion))

    # A word no line could resolve from its own wording takes the expansion
    # other lines found for it.
    for token in list(unresolved):
        if token in proposals:
            del unresolved[token]

    rows = []
    for token, counts in sorted(proposals.items()):
        main_expansion, _ = counts.most_common(1)[0]
        rows.append({
            "abbreviation": token, "expansion": main_expansion, "scope": "",
            "method": methods[(token, main_expansion)], "lines": sum(counts.values()),
            "example": examples[(token, main_expansion)][:120],
        })
        # A different meaning in one heading gets its own scoped row, but
        # only on evidence from that heading's own wording: "OTHR" left as
        # itself in one line because no word there fits is not a meaning.
        for hs6, expansion in sorted(set(scoped[token])):
            if expansion != main_expansion and methods[(token, expansion)] in ("local", "split"):
                rows.append({
                    "abbreviation": token, "expansion": expansion, "scope": hs6,
                    "method": methods[(token, expansion)], "lines": counts[expansion],
                    "example": examples[(token, expansion)][:120],
                })

    print(f"{len(proposals)} new abbreviations proposed ({len(rows)} rows); "
          f"{len(unresolved)} words unresolved ({sum(unresolved.values())} uses)")
    print("by method:", dict(Counter(r["method"] for r in rows)))
    for token, count in unresolved.most_common(40):
        print(f"  unresolved {token:<16} x{count:<3} {unresolved_example[token][:90]}")

    if args.write and rows:
        new_file = not ln.DICTIONARY.exists()
        with ln.DICTIONARY.open("a", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            if new_file:
                writer.writeheader()
            writer.writerows(rows)
        print(f"appended {len(rows)} rows to {ln.DICTIONARY.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
