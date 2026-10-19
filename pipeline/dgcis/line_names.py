"""
Names for India's eight-digit tariff lines, from official wording only.

Every tariff line page leads with its code and a name. The name must be
correct and readable: no dropped letters, no cut-off text, nothing invented.
Three official sources say what a line is, and each has a gap:

  DGCIS description   the portal's own text for the line. Specific (it spells
                      out what "Other" means at that line) but abbreviated:
                      "OTHR GUMMED OR ADHESIVE PAPR AND PAPRBORD".
  Tariff text         India's tariff schedule as the GST portal publishes it
                      (config/reference/gst_hsn_master.csv, the HSN master).
                      Spelled out, but an eight-digit row only gives the last
                      step of the schedule's indent ("OTHER", "OF IRON").
  HS-6 text           the WCO six-digit description (Comtrade's reference).
                      Complete in itself, but it describes the heading, not
                      the line.

So a DGCIS description is spelled out word by word against an explicit,
reviewed dictionary (config/dgcis_abbreviations.csv). Each row in it was
proposed from the line's own official wording (an abbreviation is only ever
expanded to a word the tariff itself uses for that line or heading) and can
be read and corrected by hand. A word the dictionary does not resolve leaves
the description unusable, and the line is named from official text instead.

Nothing here rewords. Expanding "PAPR" to "paper" restores a word the
source abbreviated; it does not add one.
"""
from __future__ import annotations

import csv
import json
import re
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "config"
DICTIONARY = CONFIG / "dgcis_abbreviations.csv"
GST_MASTER = CONFIG / "reference" / "gst_hsn_master.csv"
COMTRADE_REFERENCES = [
    CONFIG / "reference" / "comtrade_hs_reference.json",
    CONFIG / "reference" / "comtrade_hs_reference_h6.json",
    CONFIG / "reference" / "comtrade_hs_reference_h5.json",
]

# Kept in capitals wherever they appear.
ACRONYMS = {
    "ABS", "AC", "ADP", "AM", "ATM", "CD", "CFL", "CNC", "CNG", "CRT", "DC", "DVD",
    "ECG", "EPS", "FM", "GPS", "HDPE", "HF", "IC", "IR", "LCD", "LDPE", "LED",
    "LPG", "MOSFET", "MRI", "NC", "OLED", "PCB", "PE", "PET", "PP", "PVC", "RAM",
    "ROM", "TV", "UHF", "UPS", "USB", "UV", "VHF", "LLDPE", "EVA", "SBR", "NBR",
    "EPDM", "PTFE", "PU", "PMMA", "PC", "HIPS", "SIM", "RF", "GSM", "CDMA",
    "LAN", "WAN", "DSL", "ISDN", "SMD", "MLCC", "IGBT", "SCR", "DNA", "RNA",
    "HFC", "HFCS", "CFC", "CFCS", "HCFC", "HCFCS", "INN", "ERW", "CCTV", "VCR",
    "CPU", "LNG", "PTC", "NTC", "SMPS", "GI", "MS", "SS", "HSS", "ISO", "BIS",
    "SIM", "OTG", "ADSL", "HDMI", "LTE", "WLAN", "WIFI", "RFID", "NFC", "SSD",
    "HDD", "DRAM", "SRAM", "EPROM", "EEPROM", "UTP", "STP", "IPS", "TFT",
    "AMOLED", "QLED", "BLDC", "PWM", "VFD", "PLC", "DSP", "FPGA", "ASIC",
    "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII",
}

# Standard trade abbreviations, written the way the tariff writes them.
STANDARD = {"NES": "n.e.s.", "NEC": "n.e.c.", "ETC": "etc.", "EG": "e.g.", "IE": "i.e."}

# Units: kept as units, never expanded.
UNITS = {
    "MM": "mm", "CM": "cm", "M": "m", "KM": "km", "KG": "kg", "G": "g", "MG": "mg",
    "CC": "cc", "ML": "ml", "L": "l", "KV": "kV", "V": "V", "KW": "kW", "W": "W",
    "MW": "MW", "KVA": "kVA", "VA": "VA", "MVA": "MVA", "A": "A", "MA": "mA",
    "HZ": "Hz", "KHZ": "kHz", "MHZ": "MHz", "GHZ": "GHz", "HP": "hp", "RPM": "rpm",
    "SQM": "sq m", "GSM": "gsm", "MICRON": "micron", "MICRONS": "microns",
    "DTEX": "dtex", "TEX": "tex", "AH": "Ah", "MAH": "mAh", "T": "t", "KN": "kN",
    "N": "N", "C": "C", "K": "K", "B": "B", "GB": "GB", "MB": "MB", "TB": "TB",
    "X": "x", "PCS": "pcs", "KGS": "kg", "MTR": "m", "MTRS": "m", "CMS": "cm",
    "MMS": "mm", "INCH": "inch", "INCHES": "inches", "LTR": "litre", "LTRS": "litres",
}

GENERIC = {"", "other", "others", "parts", "part", "other parts", "others parts", "nes", "n.e.s.", "other -"}

LETTERS = re.compile(r"[A-Za-z]+")


# ------------------------------------------------------------------ sources

@lru_cache(maxsize=1)
def comtrade_texts() -> dict[str, str]:
    """code -> Comtrade's official text, without the "code - " prefix."""
    texts: dict[str, str] = {}
    for path in COMTRADE_REFERENCES:
        if not path.exists():
            continue
        for row in json.loads(path.read_text(encoding="utf-8")):
            code = str(row.get("code") or row.get("id") or "")
            text = str(row.get("description") or row.get("text") or "")
            if text.startswith(f"{code} - "):
                text = text[len(code) + 3:]
            text = re.sub(r"\s+", " ", text).strip()
            # The all-editions list is read first and wins; later files fill gaps.
            if code and text and code not in texts:
                texts[code] = text
    return texts


@lru_cache(maxsize=1)
def tariff_texts() -> dict[str, str]:
    """code (2, 4, 6 or 8 digits) -> the tariff text from the GST HSN master."""
    if not GST_MASTER.exists():
        return {}
    out = {}
    for row in csv.DictReader(GST_MASTER.open(newline="", encoding="utf-8")):
        code = (row.get("hsn") or "").strip()
        text = re.sub(r"\s+", " ", row.get("description") or "").strip()
        if code and text:
            out[code] = text
    return out


@lru_cache(maxsize=1)
def words() -> frozenset[str]:
    """Every word the WCO's own HS texts use, in capitals: the spelling standard."""
    out: set[str] = set()
    for text in comtrade_texts().values():
        out.update(w.upper() for w in LETTERS.findall(text))
    return frozenset(out)


@lru_cache(maxsize=1)
def capitals() -> frozenset[str]:
    """Words the WCO writes in capitals (SBR, XSBR, ABS): acronyms, kept so."""
    out: set[str] = set()
    for text in comtrade_texts().values():
        out.update(w for w in LETTERS.findall(text) if len(w) >= 2 and w.isupper())
    # Words, not acronyms, that a few WCO texts happen to set in capitals.
    return frozenset(out - {"NON", "CODE", "LEGACY", "SAN", "BO"})


@lru_cache(maxsize=1)
def dictionary() -> dict[str, list[tuple[str, str]]]:
    """
    ABBREVIATION -> [(scope, expansion)], longest scope first. Scope is a
    code prefix ("" for everywhere): an abbreviation that means one thing in
    chapter 39 and another in chapter 85 gets one row each. A row with a
    blank expansion marks a word reviewed and left unresolved on purpose
    (its meaning is not certain), so a line using it is named from official
    text instead.
    """
    out: dict[str, list[tuple[str, str]]] = {}
    if not DICTIONARY.exists():
        return out
    for row in csv.DictReader(DICTIONARY.open(newline="", encoding="utf-8")):
        abbr = (row.get("abbreviation") or "").strip().upper()
        expansion = (row.get("expansion") or "").strip()
        scope = re.sub(r"\D", "", row.get("scope") or "")
        if abbr and expansion:
            out.setdefault(abbr, []).append((scope, expansion))
    for rows in out.values():
        rows.sort(key=lambda item: -len(item[0]))
    return out


def lookup(abbr: str, code: str) -> str | None:
    for scope, expansion in dictionary().get(abbr, []):
        if code.startswith(scope):
            return expansion
    return None


# ---------------------------------------------------------------- spelling

def spell_out(text: str, code: str = "") -> tuple[str, list[str]]:
    """
    A DGCIS or tariff text in sentence case with every abbreviation spelled
    out. Returns (text, unresolved): unresolved lists the words it could not
    vouch for. A text with any unresolved word must not be used as a name.
    """
    text = (text or "").replace("*", " ")
    # DGCIS keys a zero for the letter O in some words: "ALC0H0L", "ECH0".
    text = re.sub(r"(?<=[A-Za-z])0(?=[A-Za-z])|(?<=[A-Za-z]{2})0(?![0-9])|\b0(?=[A-Za-z]{2})", "O", text)
    text = re.sub(r"\s+", " ", text).strip(" ,;:-.")
    text = re.sub(r"\s+([,;:)])", r"\1", text)
    text = re.sub(r"([,;])(?=[A-Za-z(])", r"\1 ", text)
    text = re.sub(r"\(\s+", "(", text)

    out: list[str] = []
    unresolved: list[str] = []
    position = 0

    for match in LETTERS.finditer(text):
        start, end = match.span()
        out.append(text[position:start])
        position = end
        token = match.group(0)
        upper = token.upper()
        after = text[end] if end < len(text) else ""

        if (re.search(r"\d\s?$", text[:start]) or after.isdigit()) and upper in UNITS:
            out.append(UNITS[upper])
        elif (upper in ACRONYMS or upper in capitals()) and len(upper) > 1:
            out.append(upper)
        elif upper in STANDARD and len(upper) > 2:
            value = STANDARD[upper]
            out.append(value[:-1] if after == "." else value)
        elif len(upper) == 1:
            out.append(token.lower())
        elif (expansion := lookup(upper, code)) is not None:
            # As the dictionary writes it: words in lower case, codes as codes.
            out.append(expansion)
        elif upper in words():
            out.append(token.lower())
        else:
            out.append(token.lower())
            unresolved.append(upper)

    out.append(text[position:])
    result = re.sub(r"\s+", " ", "".join(out)).strip()
    # Spacing the source ran together or pulled apart: "generators(alternators)of",
    # "semi- manufactured".
    result = re.sub(r"(?<=[A-Za-z])\((?=[A-Za-z])", " (", result)
    result = re.sub(r"(?<=[a-z])\)(?=[A-Za-z])", ") ", result)
    result = re.sub(r"(?<=[a-z])- (?=[a-z])", "-", result)
    # "Others" opens many DGCIS texts where the tariff says "Other".
    if result:
        result = result[0].upper() + result[1:]
    return result, unresolved


def is_generic(text: str) -> bool:
    key = re.sub(r"[^a-z.\- ]", " ", (text or "").lower().replace("0", "o"))
    return re.sub(r"\s+", " ", key).strip(" -.") in GENERIC


# ---------------------------------------------------------------- headings

def clean_official(text: str) -> str:
    """
    An official HS text tidied for display: spacing and punctuation only.
    Comtrade's list stores at most 255 characters, so a longer text arrives
    cut mid-clause; it is shortened back to its last complete clause rather
    than shown broken.
    """
    text = re.sub(r"\s+", " ", text or "").strip()
    text = re.sub(r"\s+([,;:)])", r"\1", text)
    text = re.sub(r"\(\s+", "(", text)
    if len(text) >= 250:
        cut = max(text.rfind("; "), text.rfind(", "))
        if cut > 60:
            text = text[:cut]
        # An unmatched bracket left by the cut is closed off at its opening.
        if text.count("(") > text.count(")"):
            text = text[: text.rfind("(")].rstrip(" ,;")
    return text.strip(" ;,")


def hs6_text(hs6: str) -> str:
    """The WCO's text for an HS-6, complete and readable."""
    return clean_official(comtrade_texts().get(hs6, ""))


def tariff_text(code: str) -> tuple[str, list[str]]:
    """
    The tariff schedule's text for a code, spelled and cased. A few rows
    carry the schedule's indent levels joined by colons ("Other articles of
    copper - other: other: articles of brass"); the last level is the line's
    own when it reads as a name.
    """
    raw = tariff_texts().get(code, "").rstrip(" :")
    if not raw:
        return "", []
    if ":" in raw:
        last = raw.rsplit(":", 1)[1].strip(" -")
        spelled, missing = spell_out(last, code)
        if spelled and not missing and self_contained(spelled, 2):
            return spelled, missing
    return spell_out(raw, code)


# A tariff row that only finishes its parent's sentence cannot name a line on
# its own: "OF IRON", "FOR LIQUID CRYSTAL DEVICES", "OTHER", "EXCEEDING 10 KG".
FRAGMENT_START = {
    "of", "for", "with", "without", "in", "on", "not", "whether", "containing",
    "having", "exceeding", "excluding", "including", "used", "made", "by",
    "from", "to", "and", "or", "as", "at", "less", "more", "weighing",
    "measuring", "consisting", "put", "presented", "obtained", "mounted",
    "fitted", "designed", "suitable", "operated", "capable", "being", "the",
    "a", "an", "nes", "n.e.s.", "below", "above", "upto", "up",
    "over", "under", "between", "each", "solely", "mainly", "wholly",
    "principally", "chiefly", "only", "but", "if", "where", "which", "when",
    "than", "exclusively", "otherwise", "also", "-",
}


LINKS = {"by", "with", "in", "on", "for", "of", "to", "from", "and", "or", "as", "at", "under", "into", "but", "than", "over"}


def self_contained(text: str, min_words: int = 1) -> bool:
    """True when a row reads as a name by itself, not as the end of its parent's sentence."""
    if not text or text[0].isdigit():
        return False
    words_ = [w.lower().strip(",;:()") for w in text.split()]
    if words_[0] in FRAGMENT_START or len(words_) < min_words or len(text) > 160:
        return False
    # "Other, including combined ball or roller bearings": the goods are named above.
    if words_[0] in ("other", "others") and text.split()[0].endswith(","):
        return False
    # "Sorted by chemical type", "Mounted on a base": a participle that
    # qualifies goods named a step above. "Coated paper" names its goods.
    if len(words_) > 1 and words_[0].endswith(("ed", "ing")) and words_[1] in LINKS:
        return False
    return True


def tariff_names_line(tariff: str, hs6: str) -> bool:
    """
    A tariff row names its line when it reads as a name and names the kind of
    goods its heading covers: "Machinery for making paper or paperboard"
    does; "Flexible, plain" (a film's finish, the goods named a step above)
    does not.
    """
    if not self_contained(tariff, 2):
        return False
    around = content(comtrade_texts().get(hs6, "")) | content(comtrade_texts().get(hs6[:4], ""))
    around |= content(tariff_texts().get(hs6[:4], "")) | content(tariff_texts().get(hs6, ""))
    return bool(content(tariff) & around)


def stem(word: str) -> str:
    word = word.lower()
    for ending in ("ing", "ed", "es", "s"):
        if word.endswith(ending) and len(word) - len(ending) >= 3:
            return word[: -len(ending)]
    return word


def content(text: str) -> set[str]:
    stop = {"of", "or", "and", "the", "for", "with", "in", "a", "an", "other", "others", "not", "etc", "nes", "than", "but", "type"}
    return {stem(w) for w in LETTERS.findall(text or "") if w.lower() not in stop and len(w) > 2}


# ------------------------------------------------------------------- titles

def heading_name(hs6: str, headings: dict[str, str]) -> str:
    """What a page calls an HS-6: HStat's own name, else the WCO text in full."""
    return headings.get(hs6) or hs6_text(hs6) or f"HS {hs6}"


def tariff_item(hs8: str) -> str:
    return f"tariff item {hs8[:4]} {hs8[4:6]} {hs8[6:]}"


def candidates(hs8: str, hs6: str, description: str) -> dict:
    """The usable official names for one line, before uniqueness."""
    dgcis, dgcis_missing = spell_out(description, hs8)
    tariff, tariff_missing = tariff_text(hs8)
    return {
        "dgcis": dgcis if dgcis and not dgcis_missing and not is_generic(dgcis) and len(dgcis) >= 3 else "",
        "tariff": tariff if tariff and not tariff_missing and not is_generic(tariff) else "",
        "tariffWhole": bool(tariff) and not tariff_missing and not is_generic(tariff) and tariff_names_line(tariff, hs6),
        # What the sources say when they say nothing specific.
        "generic": next(
            (("parts" if "part" in text.lower() else "other")
             for text in (description, tariff_texts().get(hs8, "")) if text and is_generic(spell_out(text)[0])),
            "",
        ),
    }


def pick(hs8: str, hs6: str, found: dict, sole: bool, headings: dict[str, str]) -> tuple[str, str]:
    """
    The best correct name for a line, and where it came from:

      tariff    the tariff schedule's own row, when it names the line by
                itself and says at least what DGCIS says
      dgcis     DGCIS's description, every abbreviation spelled out
      heading   the line is the only one under its HS-6, so the HS-6's name
                is its name
      derived   the HS-6's name with the tariff's last step ("other",
                "of iron"), when no source names the line by itself
    """
    dgcis, tariff = found["dgcis"], found["tariff"]

    if dgcis and self_contained(dgcis):
        # The tariff's own wording, when it says at least what DGCIS says.
        if found["tariffWhole"] and content(dgcis) <= content(tariff):
            return tariff, "tariff"
        return dgcis, "dgcis"
    if found["tariffWhole"]:
        return tariff, "tariff"
    if sole:
        return heading_name(hs6, headings), "heading"

    # Neither names the line by itself: the HS-6's name, then the step that
    # sets this line apart ("of iron", "for film of less than 16 mm width").
    base = heading_name(hs6, headings)
    # Some tariff rows repeat the whole schedule above them; only a short
    # step is a step.
    step = next((text for text in (dgcis, tariff) if text and len(text) <= 80), "")
    def join(leaf: str) -> str:
        # "High-voltage switchgear, other" does not take a second "other".
        return base if base.lower().endswith(leaf.lower()) else f"{base}, {leaf}"

    if step:
        return join(step[0].lower() + step[1:]), "derived"
    if found["generic"]:
        return join(found["generic"]), "derived"
    # The sources name the line in words we cannot vouch for: the heading
    # and the line's own number, rather than a guess.
    return f"{base} ({tariff_item(hs8)})", "derived"


def assign(lines: dict[str, dict], itc: dict, headings: dict[str, str]) -> dict[str, tuple[str, str]]:
    """
    hs8 -> (title, nameSource) for every line: correct, readable, unique.

    `lines` is hs8 -> {"hs6": ..., "description": DGCIS's raw text}; `itc`
    is the curated schedule (config/itc_hs8_names.csv), which always wins.
    Two lines that would share a name each add their HS-6's name, and if
    that still repeats, their tariff item number.
    """
    per_hs6: dict[str, int] = {}
    for meta in lines.values():
        per_hs6[meta["hs6"]] = per_hs6.get(meta["hs6"], 0) + 1

    chosen: dict[str, tuple[str, str]] = {}
    for hs8 in sorted(lines):
        known = itc.get(hs8) or {}
        name = known.get("displayName") or known.get("description")
        if name:
            chosen[hs8] = (name, "schedule")
            continue
        hs6 = lines[hs8]["hs6"]
        found = candidates(hs8, hs6, lines[hs8].get("description") or "")
        chosen[hs8] = pick(hs8, hs6, found, per_hs6[hs6] == 1, headings)

    # Uniqueness. A shared name first says which heading it is under
    # (HStat's short name, or the HS-6 code); if two lines under one heading
    # still share it, each says its own tariff item instead.
    def clashes(names: dict[str, tuple[str, str]]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for name, _ in names.values():
            counts[name.lower()] = counts.get(name.lower(), 0) + 1
        return counts

    counts = clashes(chosen)
    labelled: dict[str, tuple[str, str]] = {}
    for hs8, (name, source) in chosen.items():
        if counts[name.lower()] > 1 and source != "schedule":
            hs6 = lines[hs8]["hs6"]
            label = headings.get(hs6) or f"HS {hs6}"
            if label.lower() not in name.lower():
                name = f"{name} ({label})"
        labelled[hs8] = (name, source)

    counts = clashes(labelled)
    out: dict[str, tuple[str, str]] = {}
    for hs8, (name, source) in sorted(labelled.items()):
        if counts[name.lower()] > 1 and not name.endswith(")") or counts[name.lower()] > 1 and source == "schedule":
            name = f"{name} ({tariff_item(hs8)})"
        elif counts[name.lower()] > 1:
            original = chosen[hs8][0]
            name = f"{original} ({tariff_item(hs8)})"
        out[hs8] = (name, source)
    return out
