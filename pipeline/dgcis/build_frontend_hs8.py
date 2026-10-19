#!/usr/bin/env python3
"""
Turn the processed DGCIS extracts into something a product page can load.

WHY NOT JUST SHIP THE CSV

india_hs8_monthly_exports.csv is 6.2 MB and 48,870 rows, and a product page
needs roughly two hundred of them. Handing the browser the whole file so it
can filter out 99.6% of it would be the single heaviest thing on the page, on
every page, for no benefit.

So this writes one small file per HS-6, and the page loads only its own. An
HS-8 page loads its parent's file too - the same one - which is how a tariff
line gets its siblings, its share of the heading and its way back up for free.

SHAPE

Periods are written once per file and values are arrays aligned to it, rather
than a list of {period, value} objects. Same information, about a third of the
bytes, and the frontend indexes straight into it. A month a tariff line did
not trade is null, not zero: DGCIS leaves it blank, and zero would assert
something the source does not say.

Line descriptions are written once per HS-6 under `lines`; the flows carry
only numbers. With two flows that is the difference between storing every
commodity name twice and storing it once.

Values are carried in the units DGCIS published - INR crore and USD million -
and are never converted between each other. The two are separate measurements
of the same trade, published by the source, and dividing one by the other to
recover an exchange rate is not something this data supports.

FLOWS

One processed file per flow, and a flow appears in the output only if its
extract is on disk. India's exports at the tariff line and India's imports at
the tariff line are different downloads from the portal, and a page must be
able to say which of them it is showing - so nothing here merges them, sums
them, or defaults one to the other.

Run:  python3 pipeline/dgcis/build_frontend_hs8.py
"""
from __future__ import annotations

import csv
import json
import re
import shutil
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import hs8_scope  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PROCESSED = ROOT / "data" / "dgcis" / "processed"
CONFIG = ROOT / "config"
OUT = ROOT / "public" / "data" / "dgcis"

FLOWS = ("exports", "imports")


def number(value):
    text = str(value or "").strip()

    if not text:
        return None

    try:
        return float(text)
    except ValueError:
        return None


def round_or_none(value, places: int):
    return None if value is None else round(value, places)


def heading_names() -> dict[str, str]:
    """hs6 -> the short name we authored for it, from the sector definition."""
    path = CONFIG.parent / "hs_index" / "codes.csv"

    if not path.exists():
        return {}

    rows = csv.DictReader(path.open(newline="", encoding="utf-8-sig"))

    return {
        (r.get("hs6") or "").strip(): (r.get("display_name") or "").strip()
        for r in rows
        if (r.get("hs6") or "").strip()
    }


def official_heading(hs6: str) -> str:
    """
    For a standalone line, whose HS-6 HStat does not carry: the HS-6's own
    official wording, shortened, so the page can still say what heading the
    line sits under. Labelled as the heading, never as the line's name.
    """
    path = CONFIG / "reference" / "comtrade_hs_reference.json"

    if not hasattr(official_heading, "_texts"):
        texts = {}
        if path.exists():
            for row in json.loads(path.read_text(encoding="utf-8")):
                code = str(row.get("code") or "")
                text = str(row.get("description") or "")
                if text.startswith(f"{code} - "):
                    text = text[len(code) + 3:]
                texts[code] = text.strip()
        official_heading._texts = texts

    text = official_heading._texts.get(hs6, "")
    text = re.sub(r"\(.*?\)", "", text)
    text = re.sub(r"\s+", " ", text).strip(" ;,")

    if len(text) > 80:
        text = text[:80].rsplit(" ", 1)[0].rstrip(" ,;") + "…"

    return text


def tariff_names() -> dict[str, dict]:
    """
    hs8 -> its real name, once someone gives us one.

    India publishes an eight-digit tariff schedule; DGCIS's extract does not
    carry it. Until that schedule is in config/, this returns nothing and the
    fallback below does the work. The file is optional on purpose: the day it
    arrives, drop it in and rebuild - nothing else has to change.

        config/itc_hs8_names.csv
        hs8,description,display_name
    """
    path = CONFIG / "itc_hs8_names.csv"

    if not path.exists():
        return {}

    out = {}

    for r in csv.DictReader(path.open(newline="", encoding="utf-8-sig")):
        code = re.sub(r"\D", "", r.get("hs8") or "")

        if len(code) != 8:
            continue

        out[code] = {
            "description": (r.get("description") or "").strip(),
            "displayName": (r.get("display_name") or "").strip(),
        }

    return out


def title_for(hs8: str, group: str, heading: str, itc: dict) -> tuple[str, str]:
    """
    What to call a tariff line - and when to admit we cannot.

    First attempt at this fixed the wrong problem. 543 pages were titled from a
    vocabulary of seven DGCIS commodity groups, so we substituted the heading's
    authored name: 7 titles became 255. Better, and still wrong, because 29
    lines were then all called "Electrical machines, other". A reader cannot
    reference one of those. Neither could they reference "ELECTRONICS
    COMPONENTS". The repetition simply moved.

    The mistake was looking for a word. A tariff line's name *is* its code:
    85437099 is how customs files it, how a trader quotes it, and how MeitY
    will ask about it. It is unique by construction, which no borrowed word can
    be. So when we have no real description, we return none, the code becomes
    the identity, and the heading becomes context beside it - clearly labelled
    as the heading, not passed off as the line's own name.

    A title is returned only when it genuinely names *this line*:

      1. A curated name in config/itc_hs8_names.csv ("schedule").
      2. DGCIS's own description of the line, when it names that line and
         no other ("dgcis"; see below).
      3. Otherwise nothing, and the frontend leads with the code.

    `headingName` is emitted separately and always, so a page can say
    "one of 29 lines under HS 854370 - Electrical machines, other" without
    ever implying that phrase identifies the line in front of you.
    """
    known = itc.get(hs8) or {}

    if known.get("displayName") or known.get("description"):
        return (known.get("displayName") or known["description"]), "schedule"

    named = dgcis_titles.get(hs8)

    if named:
        return named, "dgcis"

    return "", "none"


# ---------------------------------------------------------------- DGCIS names
#
# Since the 2026-10 portal layout, every row carries DGCIS's own description
# of the line ("HS Description"): the same text config/itc_hs8_names.csv was
# built from, abbreviated and in capitals. It is used as a line's title only
# when it names that line and no other - "OTHERS", "PARTS" or a phrase two
# codes share would be the "Electrical machines, other" problem again - and
# then only re-cased, never reworded. nameSource "dgcis" says where it came
# from. Lines with a curated name in itc_hs8_names.csv keep that name.

GENERIC = {"", "other", "others", "parts", "part", "other parts", "others parts", "nes", "n.e.s."}

ACRONYMS = {
    "ABS", "AC", "ADP", "AM", "ATM", "CD", "CFL", "CNC", "CNG", "CRT", "DC", "DVD",
    "ECG", "EPS", "FM", "GPS", "HDPE", "HF", "IC", "IR", "LCD", "LDPE", "LED",
    "LPG", "MOSFET", "MRI", "NC", "OLED", "PCB", "PE", "PET", "PP", "PVC", "RAM",
    "ROM", "TV", "UHF", "UPS", "USB", "UV", "VHF", "LLDPE", "EVA", "SBR", "NBR",
    "EPDM", "PTFE", "PU", "PMMA", "PC", "PA", "HIPS", "SIM", "RF", "GSM", "CDMA",
    "LAN", "WAN", "DSL", "ISDN", "SMD", "MLCC", "IGBT", "SCR", "LI-ION", "NI-CD",
}

dgcis_titles: dict[str, str] = {}


def recase(text: str) -> str:
    """DGCIS capitals to sentence case, keeping acronyms. Words unchanged."""
    text = re.sub(r"\s+", " ", text.replace("*", " ")).strip(" ,;:-")
    words = []
    for index, word in enumerate(text.split(" ")):
        core = re.sub(r"[^A-Za-z\-]", "", word).upper()
        if core in ACRONYMS:
            words.append(word.upper())
        else:
            lowered = word.lower()
            words.append(lowered[:1].upper() + lowered[1:] if index == 0 else lowered)
    return " ".join(words)


def learn_dgcis_titles(descriptions: dict[str, str], itc: dict) -> None:
    """Fill dgcis_titles with the descriptions that name exactly one line."""
    taken = {
        (v.get("displayName") or v.get("description") or "").strip().lower()
        for v in itc.values()
    }
    cleaned = {code: recase(text) for code, text in descriptions.items()}
    counts: dict[str, int] = defaultdict(int)
    for name in cleaned.values():
        counts[name.lower()] += 1

    dgcis_titles.clear()
    for code, name in cleaned.items():
        key = name.lower()
        if key in GENERIC or counts[key] > 1 or key in taken or len(name) < 3:
            continue
        dgcis_titles[code] = name


def remembered_groups() -> dict[str, tuple[str, str]]:
    """
    hs8 -> (principal, quick estimate) DGCIS commodity groups from
    config/dgcis_commodity_groups.csv. The 2026-10 portal layout files no
    groups; lines that had them keep them rather than going blank.
    """
    path = CONFIG / "dgcis_commodity_groups.csv"
    if not path.exists():
        return {}
    lines = [
        line for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    ]
    return {
        r["hs8"]: (r.get("principal_commodity") or "", r.get("quick_estimate_commodity") or "")
        for r in csv.DictReader(lines)
    }


def read_flow(flow: str):
    """Rows and manifest for one flow, or (None, None) if not extracted yet."""
    monthly = PROCESSED / f"india_hs8_monthly_{flow}.csv"

    if not monthly.exists():
        return None, None

    rows = list(csv.DictReader(monthly.open(newline="", encoding="utf-8-sig")))

    # An extract processed before flow became explicit is not readable here,
    # and guessing which flow it held is the whole mistake this guards.
    if rows and "value_usd_million" not in rows[0]:
        raise SystemExit(
            f"{monthly.name} predates flow-aware processing (no value_* columns).\n"
            f"Re-run: python3 pipeline/dgcis/process_tia_hs8.py --flow {flow}"
        )

    manifest_path = PROCESSED / f"manifest_{flow}.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    declared = manifest.get("flow")

    if declared and declared != flow:
        raise SystemExit(
            f"{manifest_path.name} declares flow {declared!r} but is named for {flow!r}."
        )

    return rows, manifest


def prune(expected: set[Path]) -> None:
    """
    Delete anything under OUT this build did not write.

    Rebuilding into a directory without clearing it first is how a dashboard
    ends up serving a file for a code that no longer exists - the page fetches
    it, gets a 200, and shows last quarter's numbers with this quarter's
    framing. So leftovers are removed, and if they cannot be removed the build
    fails rather than shipping them.
    """
    stale = [
        path for path in sorted(OUT.rglob("*.json"))
        if path not in expected
    ]

    blocked = []

    for path in stale:
        try:
            path.unlink()
        except OSError:
            blocked.append(path)

    if blocked:
        listing = "\n".join(f"  {path.relative_to(ROOT)}" for path in blocked)

        raise SystemExit(
            f"{len(blocked)} file(s) from a previous build could not be removed "
            f"and would ship as live data:\n{listing}\n"
            "Delete them and re-run."
        )

    if stale:
        print(f"removed {len(stale)} file(s) from a previous build")


def main() -> int:
    available = {}

    for flow in FLOWS:
        rows, manifest = read_flow(flow)

        if rows:
            available[flow] = {"rows": rows, "manifest": manifest}

    if not available:
        raise SystemExit(
            "No processed DGCIS extract found. Run, for each flow you have:\n"
            "  python3 pipeline/dgcis/process_tia_hs8.py --flow exports\n"
            "  python3 pipeline/dgcis/process_tia_hs8.py --flow imports"
        )

    universe = set((CONFIG / "hs6_universe.txt").read_text().split())

    # One period axis for the whole build, so a page can put two flows on the
    # same x without aligning anything itself.
    periods = sorted({
        row["period"]
        for flow in available.values()
        for row in flow["rows"]
    })
    index = {period: position for position, period in enumerate(periods)}

    headings = heading_names()
    itc = tariff_names()
    groups_on_file = remembered_groups()

    # DGCIS's own line descriptions, from whichever flow carries them.
    descriptions: dict[str, str] = {}
    for bundle in available.values():
        for row in bundle["rows"]:
            text = (row.get("hs_description") or "").strip()
            if text and row["hs8"] not in descriptions and hs8_scope.in_scope(row["hs8"]):
                descriptions[row["hs8"]] = text
    learn_dgcis_titles(descriptions, itc)

    # hs6 -> hs8 -> {hs8, title, nameSource, principalCommodity, ...}
    lines: dict[str, dict[str, dict]] = defaultdict(dict)

    # hs6 -> flow -> hs8 -> {"inrCrore": [...], "usdMillion": [...]}
    series: dict[str, dict[str, dict[str, dict]]] = defaultdict(
        lambda: defaultdict(dict)
    )

    for flow, bundle in available.items():
        for row in bundle["rows"]:
            hs6, hs8 = row["hs6"], row["hs8"]

            # The processor already applied the scope; this guards a stale
            # processed file built under a wider one.
            if not hs8_scope.in_scope(hs8):
                continue

            if hs8 not in lines[hs6]:
                remembered = groups_on_file.get(hs8, ("", ""))
                group = (row.get("principal_commodity") or "").strip() or remembered[0]
                heading = headings.get(hs6, "") or official_heading(hs6)
                title, source = title_for(hs8, group, heading, itc)

                lines[hs6][hs8] = {
                    "hs8": hs8,
                    "title": title,
                    "nameSource": source,
                    # The heading this line sits under, carried so a page can
                    # show the relationship without loading the catalogue.
                    "headingName": heading,
                    "description": (
                        (itc.get(hs8) or {}).get("description", "")
                        or descriptions.get(hs8, "")
                    ),
                    # DGCIS's own commodity groupings. The extract carries no
                    # tariff-line description and one is not invented here.
                    "principalCommodity": group,
                    "quickEstimateCommodity": (
                        (row.get("quick_estimate_commodity") or "").strip()
                        or remembered[1]
                    ),
                }

            entry = series[hs6][flow].get(hs8)

            if entry is None:
                entry = {
                    "inrCrore": [None] * len(periods),
                    "usdMillion": [None] * len(periods),
                }
                series[hs6][flow][hs8] = entry

            position = index[row["period"]]

            entry["inrCrore"][position] = round_or_none(
                number(row.get("value_inr_crore")), 3
            )
            entry["usdMillion"][position] = round_or_none(
                number(row.get("value_usd_million")), 3
            )

    (OUT / "hs6").mkdir(parents=True, exist_ok=True)

    # Everything this build is responsible for. Anything else found under OUT
    # afterwards is from a previous build and must not survive: an HS-6 that
    # has dropped out of the extract would otherwise keep serving its old file
    # to a page that still asks for it, and nothing on that page would say so.
    expected: set[Path] = {OUT / "manifest.json", OUT / "hs8-index.json"}

    written = 0
    attached: list[str] = []
    orphaned: list[str] = []
    standalone: list[str] = []
    catalogue: list[dict] = []

    for hs6 in sorted(lines):
        ordered = [lines[hs6][hs8] for hs8 in sorted(lines[hs6])]
        relation = hs8_scope.relation(hs6)
        is_product = relation == "product"

        flows_out = {}

        for flow in FLOWS:
            if flow not in series[hs6]:
                continue

            # The last period in which anything under this HS-6 actually
            # traded on this flow. Not the last period in the file: a tariff
            # line that stopped being used should not claim data up to today.
            last = None

            for position in range(len(periods) - 1, -1, -1):
                if any(
                    entry["usdMillion"][position] or entry["inrCrore"][position]
                    for entry in series[hs6][flow].values()
                ):
                    last = periods[position]
                    break

            flows_out[flow] = {
                "latestPeriod": last,
                "series": {
                    hs8: series[hs6][flow][hs8]
                    for hs8 in sorted(series[hs6][flow])
                },
            }

        payload = {
            "hs6": hs6,
            "source": "DGCIS / Trade Intelligence & Analytics",
            "reporter": "India",
            "partner": "World",
            "units": {"inrCrore": "INR crore", "usdMillion": "USD million"},
            # How the HS-6 sits in HStat (pipeline/dgcis/hs8_scope.py):
            #   product      it has a product page
            #   predecessor  a retired code carried for lineage - 851712
            #                before the smartphone split - no page of its own
            #   standalone   HStat does not carry it; each line stands alone
            # isProduct is kept for pages built before `relation` existed.
            "relation": relation,
            "isProduct": is_product,
            "periods": periods,
            "lines": ordered,
            "flows": flows_out,
        }

        target = OUT / "hs6" / f"{hs6}.json"
        target.write_text(json.dumps(payload, separators=(",", ":")))
        expected.add(target)

        written += 1
        {"product": attached, "predecessor": orphaned, "standalone": standalone}[relation].append(hs6)

        # The HS-8 catalogue. Every tariff line needs to be findable by
        # search and reachable by URL without loading 255 files to discover
        # that it exists, so its identity - and enough of its size to rank it
        # - is lifted out here.
        for line in ordered:
            hs8 = line["hs8"]
            entry = {
                "hs8": hs8,
                "hs6": hs6,
                "title": line["title"],
                "nameSource": line["nameSource"],
                "headingName": line["headingName"],
                "principalCommodity": line["principalCommodity"],
                "quickEstimateCommodity": line["quickEstimateCommodity"],
                "relation": relation,
                "isProduct": is_product,
                "flows": {},
            }

            for flow, block in flows_out.items():
                values = block["series"].get(hs8, {}).get("usdMillion")

                if values is None:
                    continue

                recent = [v for v in values[-12:] if v is not None]
                latest = next(
                    (
                        {"period": periods[i], "usdMillion": values[i]}
                        for i in range(len(values) - 1, -1, -1)
                        if values[i]
                    ),
                    None,
                )

                entry["flows"][flow] = {
                    "latest": latest,
                    # Twelve months to the end of the period axis. Used only
                    # to rank a search result by size; a page computes its own.
                    "last12UsdMillion": round(sum(recent), 3) if recent else None,
                }

            catalogue.append(entry)

    manifest = {
        "source": "DGCIS / Trade Intelligence & Analytics",
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "reporter": "India",
        "partner": "World",
        "units": {"inrCrore": "INR crore", "usdMillion": "USD million"},
        "flows": sorted(available),
        "flowDetail": {
            flow: {
                "sourceFile": bundle["manifest"].get("sourceFile"),
                "sourceSha256": bundle["manifest"].get("sourceSha256"),
                "processedAt": bundle["manifest"].get("processedAt"),
                "firstPeriod": bundle["manifest"].get("firstPeriod"),
                "lastPeriod": bundle["manifest"].get("lastPeriod"),
                # How the flow label was established, carried through to the
                # page so a reader can see it was checked and not assumed.
                "flowVerdict": bundle["manifest"].get("flowVerdict"),
            }
            for flow, bundle in sorted(available.items())
        },
        "firstPeriod": periods[0],
        "lastPeriod": periods[-1],
        "periodCount": len(periods),
        "hs8Count": sum(len(children) for children in lines.values()),
        # What a reader is entitled to know: this covers some of the
        # catalogue, not all of it.
        "productsCovered": len(attached),
        "productsTotal": len(universe),
        "coveredHs6": sorted(attached),
        # Present in the source, no product page to sit on.
        "predecessorHs6": sorted(orphaned),
        # HS-6 codes HStat does not carry, whose lines have standalone pages.
        "standaloneHs6": sorted(standalone),
        "standaloneHs8": sum(len(lines[code]) for code in standalone),
        "scope": hs8_scope.config()["mode"],
        "scopeChapters": list(hs8_scope.chapters() or []),
        "reconciliation": {
            "method": "sum of HS-8 rows against the DGCIS TOTAL footer",
            "tolerancePct": 0.01,
            "note": (
                "Proves transcription, not identity. The flow label is "
                "established separately by flow_guard.py against Comtrade."
            ),
        },
    }

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))

    (OUT / "hs8-index.json").write_text(json.dumps(
        {
            "builtAt": manifest["builtAt"],
            "flows": manifest["flows"],
            "periods": {"first": periods[0], "last": periods[-1]},
            "lines": sorted(catalogue, key=lambda item: item["hs8"]),
        },
        separators=(",", ":"),
    ))

    prune(expected)

    size = sum(path.stat().st_size for path in OUT.rglob("*.json"))

    print(f"flows             : {', '.join(manifest['flows'])}")
    print(f"files written     : {written}")
    print(f"  with a product  : {len(attached)} of {len(universe)}")
    print(f"  predecessor only: {len(orphaned)}  {orphaned}")
    print(f"  standalone      : {len(standalone)} HS-6, "
          f"{manifest['standaloneHs8']} HS-8 lines")
    print(f"HS-8 tariff lines : {manifest['hs8Count']}")
    print(f"periods           : {len(periods)}  {periods[0]} → {periods[-1]}")
    print(f"total on disk     : {size / 1024:.0f} KB")
    print(f"  hs8-index.json  : {(OUT / 'hs8-index.json').stat().st_size / 1024:.0f} KB")
    print(f"largest hs6 file  : "
          f"{max(p.stat().st_size for p in (OUT / 'hs6').glob('*.json')) / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
