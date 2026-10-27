#!/usr/bin/env python3
"""
Bring new HS codes into the dashboard's scope.

    python pipeline/hs_intake.py                 # check every file in hs_index/incoming/
    python pipeline/hs_intake.py --apply         # ...and merge each batch that passes
    python pipeline/hs_intake.py --apply BATCH   # merge a batch checked earlier
    python pipeline/hs_intake.py --mark-pulled   # after a refresh: close fully pulled batches
    python pipeline/hs_intake.py --status        # list batches and their pull state

An upload is a CSV, Excel or plain-text file in hs_index/incoming/ with one HS
code per row (a column named like "HS code", "hs6" or "code"; any other
column whose name matches hs_index/codes.csv - display_name, category,
segment, in_fed_definition, stream, search_terms ... - is taken as a tag;
stream defaults to "other" and in_fed_definition to "no", so an upload never
changes the electronics figures or the FED definition by itself).

What happens to each code, in order:

  1  normalised      digits only; Excel's lost leading zero restored; an
                     HS-8 is read as its HS-6
  2  expanded        an HS-2 or HS-4 brings in every HS 2022 six-digit code
                     under it
  3  checked         a real HS 2022 six-digit code; not already in scope
                     (skipped, never an error - scope only grows)
  4  lineage         codes new in HS 2022 get their predecessor from the
                     HS 2017 reference: one retired code in the same heading
                     is drafted as a split, several are listed for review.
                     Without the HS 2017 reference the batch waits.
  5  tagged          tags given in the upload are kept; the rest are drafted:
                     display name from the official wording (never narrower
                     than the code, always unique), category / segment /
                     DGCIS segment from the codes already in the same
                     heading, then chapter; new chapters and headings get a
                     short name from their official title
  6  index check     the whole index, with the batch merged, must pass
                     pipeline/hs_index_check.py

Each upload becomes hs_index/batches/<id>/ with the original file, review.csv
(every code, what was given, what was drafted, and why), and report.md. A
batch that passes is merged with --apply: rows are added to codes.csv,
parents.csv and lineage.csv, and the batch is appended to batches.json with
its pull pending. The nightly backfill pulls it; --mark-pulled closes it once
its codes are live. A batch that cannot pass is moved to incoming/rejected/
with its report. Nothing is ever removed from scope.
"""

from __future__ import annotations

import argparse
import collections
import csv
import io
import json
import re
import shutil
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import definition  # noqa: E402
from common import write_json  # noqa: E402
import hs_rules  # noqa: E402

ROOT = definition.ROOT
HS_INDEX = definition.HS_INDEX
INCOMING = HS_INDEX / "incoming"
REJECTED = INCOMING / "rejected"
BATCHES_DIR = HS_INDEX / "batches"
CATALOGUE = ROOT / "public" / "data" / "snapshots" / "current" / "catalogue.json"

ACCEPTED_SUFFIXES = {".csv", ".xlsx", ".xls", ".txt"}
CODE_HEADERS = ("hs6", "hs_code", "hs code", "hscode", "hs", "code", "hs-6", "hs 6", "commodity code")


# ----------------------------------------------------------------- reading


def _read_upload(path: Path) -> list[dict]:
    """Rows as dicts with lower-cased, underscored keys."""
    suffix = path.suffix.lower()

    if suffix == ".txt":
        return [
            {"hs6": line.strip()}
            for line in path.read_text(encoding="utf-8-sig").splitlines()
            if line.strip() and not line.startswith("#")
        ]

    if suffix in (".xlsx", ".xls"):
        import pandas as pd

        frame = pd.read_excel(path, dtype=str)
        rows = frame.fillna("").to_dict("records")
    else:
        text = path.read_text(encoding="utf-8-sig")
        lines = [line for line in text.splitlines() if line.strip() and not line.startswith("#")]
        rows = list(csv.DictReader(lines))

    return [
        {re.sub(r"[\s\-]+", "_", str(k).strip().lower()): str(v or "").strip() for k, v in row.items() if k is not None}
        for row in rows
    ]


def _code_column(rows: list[dict]) -> str | None:
    if not rows:
        return None

    keys = list(rows[0].keys())

    for wanted in CODE_HEADERS:
        key = re.sub(r"[\s\-]+", "_", wanted)
        if key in keys:
            return key

    for key in keys:
        if "hs" in key or "code" in key:
            return key

    return None


def _normalise(raw: str) -> tuple[str | None, str]:
    """(code, note). Restores a leading zero Excel dropped; HS-8 -> HS-6."""
    text = re.sub(r"\.0+$", "", str(raw).strip())   # 851713.0 from Excel
    digits = re.sub(r"\D", "", text)

    if not digits:
        return None, f"{raw!r} has no digits"

    if len(digits) in (1, 3, 5, 7):
        fixed = digits.zfill(len(digits) + 1)
        note = f"{digits} read as {fixed} (leading zero restored)"
        digits = fixed
    else:
        note = ""

    if len(digits) == 8:
        return digits[:6], (note + "; " if note else "") + f"HS-8 {digits} read as its HS-6 {digits[:6]}"

    if len(digits) in (2, 4, 6):
        return digits, note

    return None, f"{raw!r} is not a 2, 4, 6 or 8 digit HS code"


# ----------------------------------------------------------------- batches


def _load_batches() -> dict:
    if definition.BATCHES_JSON.exists():
        return json.loads(definition.BATCHES_JSON.read_text(encoding="utf-8"))
    return {"batches": []}


def _save_batches(data: dict) -> None:
    definition.BATCHES_JSON.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")


def _batch_id(path: Path) -> str:
    stem = re.sub(r"[^a-z0-9]+", "-", path.stem.lower()).strip("-")[:40] or "upload"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    return f"{stamp}-{stem}"


def _codes_csv_columns() -> list[str]:
    with definition.DEFINITION_CSV.open(encoding="utf-8") as handle:
        return next(csv.reader(line for line in handle if not line.startswith("#")))


# ----------------------------------------------------------------- core


def _majority(values: list[str]) -> str:
    values = [v for v in values if v]
    return collections.Counter(values).most_common(1)[0][0] if values else ""


def assess(path: Path) -> dict:
    """Check and draft one upload. Writes nothing to the index."""
    rows = _read_upload(path)
    column = _code_column(rows)

    products = definition.load_products()
    in_scope = {p.hs6 for p in products}
    retired = definition.retired_codes() | {r.code for r in definition.load_retirements()}
    parents = {row["code"]: row for row in definition._read_csv_rows(definition.PARENTS_CSV)}
    names_taken = {p.display_name.strip().lower() for p in products}
    short_taken = {(row.get("short_name") or "").strip().lower() for row in parents.values()}
    columns = _codes_csv_columns()

    report = {
        "file": path.name,
        "rows": len(rows),
        "codeColumn": column,
        "notes": [],
        "blocking": [],
        "codes": [],        # one entry per HS-6 that will be added
        "skipped": [],      # already in scope
        "rejected": [],     # not usable, with the reason
        "parents": [],      # new HS-2 / HS-4 rows
        "lineage": [],      # new lineage rows
        "references": {"hs2022": hs_rules.h6_is_strict(), "hs2017": bool(hs_rules.h5())},
    }

    if not hs_rules.h6_is_strict():
        report["blocking"].append(
            "the HS 2022 table (config/reference/comtrade_hs_reference_h6.json) is missing, so codes "
            "HS 2022 no longer has cannot be told apart. Run scripts/fetch_hs_references.py where "
            "Comtrade is reachable (the HS intake workflow does this), then re-run"
        )
        return report

    if column is None:
        report["blocking"].append("no HS code column found (name one 'HS code', 'hs6' or 'code')")
        return report

    # 1-2: normalise and expand, keeping each row's tags with its codes.
    wanted: dict[str, dict] = {}

    for number, row in enumerate(rows, start=2):
        code, note = _normalise(row.get(column, ""))

        if note:
            report["notes"].append(f"row {number}: {note}")

        if code is None:
            report["rejected"].append({"input": row.get(column, ""), "reason": note})
            continue

        tags = {k: v for k, v in row.items() if k in columns and k != "hs6" and v}

        if len(code) in (2, 4):
            if code not in hs_rules.h6():
                report["rejected"].append({"input": code, "reason": f"{code} is not an HS 2022 chapter or heading"})
                continue
            children = hs_rules.hs6_children(code)
            report["notes"].append(f"row {number}: HS-{len(code)} {code} expanded to its {len(children)} HS-6 codes")
            for child in children:
                wanted.setdefault(child, {}).update({k: v for k, v in tags.items() if k not in ("display_name",)})
            continue

        if code in wanted and tags and wanted[code] and wanted[code] != tags:
            report["notes"].append(f"row {number}: {code} listed twice with different tags; the first kept")
            continue

        wanted.setdefault(code, tags)

    # 3: check each code.
    h5 = hs_rules.h5()

    for code in sorted(wanted):
        if code in in_scope:
            report["skipped"].append(code)
            continue

        if not hs_rules.is_hs6(code):
            if h5 and code in h5:
                reason = "a retired HS 2017 code: upload its HS 2022 successors instead (its history is pulled with them)"
            else:
                reason = "not an HS 2022 six-digit code"
            report["rejected"].append({"input": code, "reason": reason})
            continue

        report["codes"].append({"hs6": code, "given": wanted[code]})

    if not report["codes"]:
        if not report["skipped"]:
            report["blocking"].append("no usable HS codes in the file")
        return report

    # 4: lineage. A code that HS 2017 did not have was created in 2022; its
    # history lives under the code it was split from.
    new_codes = {item["hs6"] for item in report["codes"]}

    if not h5:
        report["blocking"].append(
            "HS 2017 reference (config/reference/comtrade_hs_reference_h5.json) is missing, so codes "
            "created in 2022 cannot be told apart. Run scripts/fetch_hs_references.py where Comtrade is "
            "reachable (the hs-intake workflow does this), then re-run."
        )
    else:
        existing_lineage = {item.code for item in definition.load_lineage()}

        for item in report["codes"]:
            code = item["hs6"]
            if code in h5 or code in existing_lineage:
                item["lineage"] = "continuous since HS 2017 or earlier" if code in h5 else "already recorded"
                continue

            candidates = sorted(
                old for old, entry in h5.items()
                if entry["level"] == 6 and old.startswith(code[:4]) and old not in hs_rules.h6()
            )

            # A retired code that keeps its own page (853950, LED lamps) must
            # not be named as a predecessor: that would take its page away
            # (definition.retired_codes). Draft "new", pointing at it.
            paged = {product.hs6 for product in products}
            if len(candidates) == 1 and candidates[0] in paged:
                old = candidates[0]
                report["lineage"].append({
                    "code": code, "predecessor": "", "relation": "new", "predecessor_valid_to": "",
                    "note": f"Created in HS 2022. Before 2022 this trade was reported under HS {old}, "
                            f"which keeps its own page with those years.",
                })
                item["lineage"] = f"new in HS 2022; HS {old} keeps its own page (drafted - review)"
                report["notes"].append(
                    f"{code}: its likely predecessor HS {old} has its own page, so it is recorded as new, "
                    f"not as a split (naming {old} would remove that page)"
                )
            elif len(candidates) == 1:
                old = candidates[0]
                report["lineage"].append({
                    "code": code, "predecessor": old, "relation": "split", "predecessor_valid_to": "2021",
                    "note": f"Before 2022 this was reported inside HS {old}. The continuous long series is at HS-4 {code[:4]}.",
                })
                item["lineage"] = f"new in HS 2022; split from HS {old} (drafted - review)"
            elif not candidates:
                report["lineage"].append({
                    "code": code, "predecessor": "", "relation": "new", "predecessor_valid_to": "",
                    "note": "New in HS 2022; earlier trade was reported under other headings.",
                })
                item["lineage"] = "new in HS 2022; no retired code in its heading (drafted as new - review)"
            else:
                item["lineage"] = f"new in HS 2022; came from one of {', '.join(candidates)}"
                report["blocking"].append(
                    f"{code} is new in HS 2022 and its heading lost several codes ({', '.join(candidates)}); "
                    "name its predecessor in hs_index/lineage.csv, then re-run"
                )

    # 5: tags.
    by_hs4 = collections.defaultdict(list)
    by_hs2 = collections.defaultdict(list)
    for product in products:
        by_hs4[product.hs4].append(product)
        by_hs2[product.hs6[:2]].append(product)

    terms_taken = {term for product in products for term in product.search_terms}
    terms_taken |= {term for alias in definition.load_aliases() if alias.primary for term in alias.terms}
    # Terms the upload itself gives belong to the code it gives them to.
    terms_taken |= {
        term.strip().lower()
        for item in report["codes"]
        for term in (item["given"].get("search_terms") or "").split(";")
        if term.strip()
    }

    for item in report["codes"]:
        code, given = item["hs6"], item["given"]
        drafted: dict[str, str] = {}

        name = given.get("display_name", "")
        if name and name.lower() in names_taken:
            report["notes"].append(f"{code}: given name {name!r} is already used; a unique one is drafted instead")
            name = ""
        if name and len(name.split()) > hs_rules.MAX_NAME_WORDS:
            report["blocking"].append(
                f"{code}: given name {name!r} runs past {hs_rules.MAX_NAME_WORDS} words (the launch check refuses it)"
            )
        if not name:
            name = hs_rules.draft_name(code, names_taken)
            drafted["display_name"] = name
        if not name:
            name = hs_rules.placeholder_name(code)
            drafted["display_name"] = name
            report.setdefault("needsName", []).append(code)
            report["notes"].append(
                f"{code}: no official wording fits in {hs_rules.MAX_NAME_WORDS} words; "
                f"placeholder {name!r} - give it a display name in hs_index/codes.csv"
            )
        names_taken.add(name.lower())

        siblings = by_hs4.get(code[:4]) or by_hs2.get(code[:2]) or []
        for column in ("category", "segment", "dgcis_segment"):
            if not given.get(column):
                value = _majority([getattr(p, column) for p in siblings])
                if value:
                    drafted[column] = value

        if not given.get("product"):
            drafted["product"] = (parents.get(code[:4]) or {}).get("short_name") or hs_rules.draft_short_name(code[:4], set())

        # The FED sector definition does not grow by upload either.
        if not given.get("in_fed_definition"):
            drafted["in_fed_definition"] = "no"

        # Expanding coverage must never move the electronics figures by
        # itself: a code joins the electronics stream only when the upload
        # says so.
        if not given.get("stream"):
            drafted["stream"] = "other"
        if (given.get("stream") or "").strip() == "electronics":
            report["notes"].append(f"{code}: stream 'electronics' given - it will count toward the electronics totals")

        if not given.get("search_terms"):
            # Only terms no other code answers to (hs_index_check refuses overlaps).
            terms = [t for t in hs_rules.draft_search_terms(name) if t not in terms_taken]
            terms_taken.update(terms)
            drafted["search_terms"] = ";".join(terms)

        tags = {**drafted, **given}
        item["tags"] = tags
        item["drafted"] = sorted(drafted)

        for column in ("category", "segment"):
            if not tags.get(column):
                report["blocking"].append(f"{code}: no {column} given and none to draft from (no codes in its heading or chapter yet)")

        vocab = hs_rules.vocabulary()
        for column in ("category", "segment", "dgcis_segment", "stream"):
            value = tags.get(column)
            if value and vocab.get(column) and value not in vocab[column]:
                report["blocking"].append(f"{code}: {column} {value!r} is not in hs_index/vocabulary.json")

    for parent in sorted({c[:2] for c in new_codes} | {c[:4] for c in new_codes}):
        if parent in parents:
            continue
        short = hs_rules.draft_short_name(parent, short_taken)
        short_taken.add(short.lower())
        report["parents"].append({"code": parent, "level": str(len(parent)), "short_name": short})

    return report


def _review_rows(report: dict) -> list[list[str]]:
    rows = [["hs6", "status", "display_name", "category", "segment", "dgcis_segment",
             "in_fed_definition", "lineage", "drafted", "official_hs_description"]]

    for item in report["codes"]:
        tags = item["tags"]
        rows.append([item["hs6"], "add", tags.get("display_name", ""), tags.get("category", ""),
                     tags.get("segment", ""), tags.get("dgcis_segment", ""), tags.get("in_fed_definition", ""),
                     item.get("lineage", ""), ", ".join(item["drafted"]), hs_rules.official_text(item["hs6"])])
    for code in report["skipped"]:
        rows.append([code, "already in scope", "", "", "", "", "", "", "", hs_rules.official_text(code)])
    for item in report["rejected"]:
        rows.append([item["input"], "rejected: " + item["reason"], "", "", "", "", "", "", "", ""])

    return rows


def _report_md(report: dict, batch: str, verdict: str) -> str:
    lines = [
        f"# HS intake batch {batch}",
        "",
        f"- File: `{report['file']}` ({report['rows']} rows, code column `{report['codeColumn']}`)",
        f"- Verdict: **{verdict}**",
        f"- To add: {len(report['codes'])} HS-6 codes; new parents: {len(report['parents'])}; "
        f"new lineage rows: {len(report['lineage'])}",
        f"- Already in scope (skipped): {len(report['skipped'])}; rejected: {len(report['rejected'])}",
        f"- Placeholder names to replace: {len(report.get('needsName', []))}",
        f"- References: HS 2022 {'yes' if report['references']['hs2022'] else 'MISSING'}, "
        f"HS 2017 {'yes' if report['references']['hs2017'] else 'MISSING'}",
        "",
    ]

    if report["blocking"]:
        lines += ["## Must be resolved", ""] + [f"- {b}" for b in report["blocking"]] + [""]

    if report.get("indexErrors"):
        lines += ["## Index check with this batch merged", ""] + [f"- {e}" for e in report["indexErrors"][:50]] + [""]

    if report["codes"]:
        lines += ["## Codes to add", "", "| HS-6 | Display name | Category | Segment | Drafted | Lineage |", "|---|---|---|---|---|---|"]
        for item in report["codes"]:
            t = item["tags"]
            lines.append(f"| {item['hs6']} | {t.get('display_name','')} | {t.get('category','')} | {t.get('segment','')} | "
                         f"{', '.join(item['drafted']) or '-'} | {item.get('lineage','')} |")
        lines.append("")

    if report["parents"]:
        lines += ["## New chapters and headings", ""] + [f"- {p['code']}: {p['short_name']}" for p in report["parents"]] + [""]

    if report["lineage"]:
        lines += ["## Lineage drafted", ""] + [
            f"- {l['code']} ← {l['predecessor'] or '(none)'} ({l['relation']}): {l['note']}" for l in report["lineage"]] + [""]

    if report["rejected"]:
        lines += ["## Rejected", ""] + [f"- {r['input']}: {r['reason']}" for r in report["rejected"]] + [""]

    if report["notes"]:
        lines += ["## Notes", ""] + [f"- {n}" for n in report["notes"][:100]] + [""]

    lines += [
        "Drafted tags use only the official HS wording and are unique; review.csv lists every one. "
        "Edit hs_index/codes.csv after merging to refine a name - the index check keeps the rules.",
    ]

    return "\n".join(lines) + "\n"


# ----------------------------------------------------------------- merging


def _append_csv(path: Path, header: list[str], rows: list[dict]) -> None:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    for row in rows:
        writer.writerow([row.get(column, "") for column in header])
    text = path.read_text(encoding="utf-8")
    if not text.endswith("\n"):
        text += "\n"
    path.write_text(text + out.getvalue(), encoding="utf-8")


def _csv_header(path: Path) -> list[str]:
    with path.open(encoding="utf-8") as handle:
        return next(csv.reader(line for line in handle if line.strip() and not line.startswith("#")))


def _clear_caches() -> None:
    for name in dir(definition):
        fn = getattr(definition, name)
        if hasattr(fn, "cache_clear"):
            fn.cache_clear()
    for name in dir(hs_rules):
        fn = getattr(hs_rules, name)
        if hasattr(fn, "cache_clear"):
            fn.cache_clear()


def merge(report: dict, batch: str) -> None:
    """Add the batch's rows to the index files and register the batch."""
    code_rows = []
    for item in report["codes"]:
        row = {"hs6": item["hs6"], "description": hs_rules.official_text(item["hs6"]), "batch": batch}
        row.update(item["tags"])
        code_rows.append(row)

    _append_csv(definition.DEFINITION_CSV, _csv_header(definition.DEFINITION_CSV), code_rows)
    _append_csv(definition.PARENTS_CSV, _csv_header(definition.PARENTS_CSV),
                [{**p, "batch": batch} for p in report["parents"]])
    if report["lineage"]:
        _append_csv(definition.LINEAGE_CSV, _csv_header(definition.LINEAGE_CSV), report["lineage"])

    # The pull order: this batch's codes after every earlier batch's, so no
    # earlier download is invalidated (definition.pull_groups).
    batches = _load_batches()
    claimed = {code for earlier in batches["batches"] for code in earlier.get("codes", [])}
    new_codes = {item["hs6"] for item in report["codes"]}
    # Every chapter and heading above the new codes that no earlier batch
    # pulls - drafted here or named by hand in parents.csv beforehand - is
    # pulled with this batch, never left to the "unbatched" group (whose
    # chunks would change, and re-download, with each later hand edit).
    parents_here = {code[:2] for code in new_codes} | {code[:4] for code in new_codes}
    pull_codes = sorted(
        new_codes
        | {p["code"] for p in report["parents"]}
        | {code for code in parents_here if code not in claimed}
        | {l["predecessor"] for l in report["lineage"] if l["predecessor"]}
    )
    batches["batches"].append({
        "id": batch,
        "addedOn": date.today().isoformat(),
        "source": report["file"],
        "codes": pull_codes,
        "pull": {"status": "pending"},
    })
    _save_batches(batches)

    refresh_derived()


def refresh_derived() -> None:
    """
    Rewrite the files derived from the index, offline, so a merged batch is
    complete without waiting for a data refresh: the HS-6 and parent
    universes, official titles for any new chapter or heading (from the HS
    2022 reference), and the official six-digit counts behind coverage.
    """
    import subprocess

    _clear_caches()
    config = ROOT / "config"

    (config / "hs6_universe.txt").write_text("\n".join(definition.hs6_universe()) + "\n", encoding="utf-8")
    write_json(config / "parent_universe.json", definition.parent_universe())

    titles_path = config / "hs_titles.json"
    titles = json.loads(titles_path.read_text(encoding="utf-8")) if titles_path.exists() else {}
    parents = {code for codes in definition.parent_universe().values() for code in codes}
    for code in parents:
        if code not in titles and hs_rules.official_text(code):
            titles[code] = hs_rules.official_text(code)
    # Only chapters and headings HStat carries: a removed batch takes its
    # titles with it (the site's name table needs a short name for each).
    titles = {code: text for code, text in titles.items() if code in parents}
    write_json(titles_path, dict(sorted(titles.items())))

    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_official_children.py")], cwd=ROOT, check=True)

    # The website's chapter and heading names (src/lib/hsnames.generated.ts).
    if shutil.which("node"):
        subprocess.run(["node", str(ROOT / "scripts" / "build_hs_names.mjs")], cwd=ROOT, check=True)
    else:
        print("node not found: run `node scripts/build_hs_names.mjs` before building the site")


# ----------------------------------------------------------------- commands


def _index_errors() -> set[str]:
    import hs_index_check

    _clear_caches()
    return {
        f"{f['rule']} {f['code']}: {f['message']}"
        for f in hs_index_check.check()
        if f["level"] == "E"
    }


def process(path: Path, apply: bool) -> str:
    batch = _batch_id(path)
    folder = BATCHES_DIR / batch
    folder.mkdir(parents=True, exist_ok=True)

    report = assess(path)
    verdict = "ready to merge" if not report["blocking"] and report["codes"] else (
        "nothing to add" if not report["blocking"] else "needs attention")

    merged = False
    # A check (no --apply) runs the same merge and the same whole-index check
    # as --apply, then puts every file back: "ready to merge" from a check
    # means the workflow's merge will pass too.
    if verdict == "ready to merge":
        config = ROOT / "config"
        files = [definition.DEFINITION_CSV, definition.PARENTS_CSV, definition.LINEAGE_CSV, definition.BATCHES_JSON,
                 config / "hs6_universe.txt", config / "parent_universe.json", config / "hs_titles.json",
                 config / "hs_official_children.json", ROOT / "src" / "lib" / "hsnames.generated.ts"]
        saved = {p: p.read_bytes() for p in files if p.exists()}
        before = _index_errors()
        merge(report, batch)
        after = _index_errors()
        introduced = sorted(after - before)
        if introduced:
            for p, data in saved.items():
                p.write_bytes(data)
            for p in files:
                if p not in saved and p.exists():
                    p.unlink()
            _clear_caches()
            report["indexErrors"] = introduced
            report["blocking"].append(f"merging would add {len(introduced)} index-check error(s); nothing was merged")
            verdict = "needs attention"
        elif apply:
            merged = True
            verdict = "merged; pull pending"
        else:
            for p, data in saved.items():
                p.write_bytes(data)
            for p in files:
                if p not in saved and p.exists():
                    p.unlink()
            _clear_caches()
            report["notes"].append("check only: the batch merged cleanly and was rolled back")

    with (folder / "review.csv").open("w", newline="", encoding="utf-8") as handle:
        csv.writer(handle).writerows(_review_rows(report))
    (folder / "report.md").write_text(_report_md(report, batch, verdict), encoding="utf-8")
    (folder / "status.json").write_text(json.dumps({
        "batch": batch, "verdict": verdict, "merged": merged,
        "blocking": report["blocking"], "toAdd": [c["hs6"] for c in report["codes"]],
        "skipped": report["skipped"], "rejected": report["rejected"],
    }, indent=1) + "\n", encoding="utf-8")

    # A check (no --apply) leaves the upload where it is: it only reports.
    # The file moves when a run acts on it - into its batch folder once
    # merged, or to incoming/rejected/ with the report when it cannot pass.
    if not apply:
        # The report goes beside the upload, not into batches/: a check is
        # not a batch. The run that merges the upload deletes it.
        check_report = path.with_name(f"{path.stem}.check.md")
        shutil.copy(folder / "report.md", check_report)
        shutil.rmtree(folder)
        return f"{path.name}: {verdict} (check only, nothing changed) -> {check_report.relative_to(ROOT)}"

    stale_check = path.with_name(f"{path.stem}.check.md")
    if stale_check.exists():
        stale_check.unlink()

    destination = folder if verdict != "needs attention" else REJECTED
    destination.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(destination / path.name))
    if destination == REJECTED:
        shutil.copy(folder / "report.md", REJECTED / f"{path.stem}.report.md")

    return f"{path.name}: {verdict} -> hs_index/batches/{batch}/report.md"


def apply_batch(batch: str) -> str:
    """Re-assess a checked batch's original file and merge it."""
    folder = BATCHES_DIR / batch
    sources = [p for p in folder.iterdir() if p.suffix.lower() in ACCEPTED_SUFFIXES and p.name != "review.csv"] if folder.exists() else []
    if not sources:
        return f"{batch}: no original upload found in hs_index/batches/{batch}/"
    staged = INCOMING / sources[0].name
    shutil.copy(sources[0], staged)
    shutil.rmtree(folder)
    return process(staged, apply=True)


def _has_figure(code: str) -> bool:
    """A page is not enough: the code must carry a global trade figure, or the
    launch sanity check would then require one that the store does not hold."""
    path = CATALOGUE.parent / "products" / f"{code}.json"
    try:
        node = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return any(((r or {}).get("global") or {}).get("trade") for r in (node.get("annual") or {}).values())


def mark_pulled() -> str:
    """Close pending batches whose HS-6 codes all have a page in the live snapshot."""
    if not CATALOGUE.exists():
        return "no live catalogue; nothing marked"
    live = {str(e.get("code")) for e in json.loads(CATALOGUE.read_text(encoding="utf-8"))}
    data = _load_batches()
    closed = []
    products = {p.hs6 for p in definition.load_products()}
    for batch in data["batches"]:
        if batch.get("pull", {}).get("status") != "pending":
            continue
        wanted = [c for c in batch["codes"] if len(c) == 6 and c in products]
        if wanted and all(c in live and _has_figure(c) for c in wanted):
            batch["pull"] = {"status": "complete", "completedOn": date.today().isoformat()}
            closed.append(batch["id"])
    if closed:
        _save_batches(data)
    return f"closed: {', '.join(closed)}" if closed else "no pending batch is fully live yet"


# ----------------------------------------------------------------- removal


def _filter_csv(path: Path, keep) -> int:
    """Drop data rows for which keep(row) is False; comments and header stay."""
    if not path.exists():
        return 0
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    header = None
    out, dropped = [], 0
    for line in lines:
        if not line.strip() or line.startswith("#"):
            out.append(line)
            continue
        row = next(csv.reader([line]))
        if header is None:
            header = row
            out.append(line)
            continue
        if keep(dict(zip(header, row))):
            out.append(line)
        else:
            dropped += 1
    path.write_text("".join(out), encoding="utf-8")
    return dropped


def remove_batch(batch: str, vocabulary: dict | None = None) -> list[str]:
    """
    Take one intake batch out of the index: its codes, their aliases, name
    reviews and lineage rows, every chapter and heading no remaining code
    needs, and the batch record. Codes the batch did not add are untouched.
    """
    notes = []
    batches = _load_batches()
    record = next((b for b in batches["batches"] if b["id"] == batch), None)
    if record is None:
        raise SystemExit(f"no batch {batch!r} in hs_index/batches.json")

    removed = {
        row["hs6"] for row in definition._read_csv_rows(definition.DEFINITION_CSV)
        if (row.get("batch") or "").strip() == batch
    }
    notes.append(f"codes.csv: {_filter_csv(definition.DEFINITION_CSV, lambda r: r.get('batch') != batch)} codes removed")
    notes.append(f"aliases.csv: {_filter_csv(definition.ALIASES_CSV, lambda r: r.get('code') not in removed)} rows removed")
    notes.append(f"naming_review.csv: {_filter_csv(HS_INDEX / 'naming_review.csv', lambda r: r.get('code') not in removed)} rows removed")
    notes.append(f"lineage.csv: {_filter_csv(definition.LINEAGE_CSV, lambda r: r.get('code') not in removed)} rows removed")

    remaining = {
        row["hs6"] for row in definition._read_csv_rows(definition.DEFINITION_CSV)
    }
    needed = {code[:2] for code in remaining} | {code[:4] for code in remaining}
    notes.append("parents.csv: " + str(_filter_csv(
        definition.PARENTS_CSV,
        lambda r: (r.get("batch") or "").strip() != batch or r.get("code") in needed,
    )) + " chapters and headings removed")

    batches["batches"] = [b for b in batches["batches"] if b["id"] != batch]
    _save_batches(batches)
    folder = BATCHES_DIR / batch
    if folder.exists():
        shutil.rmtree(folder)
    notes.append(f"batch {batch} removed")

    # Vocabulary the batch brought, taken back out when no code still uses it.
    if vocabulary:
        vocab_path = HS_INDEX / "vocabulary.json"
        vocab = json.loads(vocab_path.read_text(encoding="utf-8"))
        rows = definition._read_csv_rows(definition.DEFINITION_CSV)
        for column, values in vocabulary.items():
            used = {(row.get(column) or "").strip() for row in rows}
            for value in values:
                if value in vocab.get(column, []) and value not in used:
                    vocab[column].remove(value)
                    vocab.get(f"_{column}s", {}).pop(value, None)
                    notes.append(f"vocabulary: {column} {value!r} removed")
        vocab_path.write_text(json.dumps(vocab, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return notes


def remove_sector(sector_id: str) -> str:
    """
    Take a sector out entirely: its folder (tags, seed), and the intake batch
    that added its own codes. Codes it shares with other streams stay in the
    index; only the sector tag goes. The next refresh drops its seed from the
    raw store and its pages from the snapshot.
    """
    import sectors as sector_index

    sector_index.load_sectors.cache_clear()
    sector = next((s for s in sector_index.load_sectors(include_disabled=True) if s.id == sector_id), None)
    if sector is None:
        raise SystemExit(f"no sector {sector_id!r} in hs_index/sectors/")
    meta = json.loads((sector.folder / "sector.json").read_text(encoding="utf-8"))
    notes = []
    if sector.batch:
        notes += remove_batch(sector.batch, meta.get("vocabulary"))
    shutil.rmtree(sector.folder)
    notes.append(f"hs_index/sectors/{sector_id}/ removed")
    _clear_caches()
    sector_index.load_sectors.cache_clear()
    refresh_derived()
    errors = _index_errors()
    notes.append(f"index check: {len(errors)} error(s)" + (": " + "; ".join(sorted(errors)[:5]) if errors else ""))
    return "\n".join(notes)


def status() -> str:
    lines = []
    for batch in _load_batches()["batches"]:
        lines.append(f"{batch['id']:<40} {batch.get('addedOn',''):<12} {len(batch['codes']):>5} codes  pull {batch.get('pull',{}).get('status')}")
    return "\n".join(lines) or "no batches"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", nargs="?", const=True, default=False)
    parser.add_argument("--mark-pulled", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--remove-sector", metavar="SECTOR", help="take a sector and the batch that added its codes out of the index")
    parser.add_argument("--remove-batch", metavar="BATCH", help="take one intake batch's codes out of the index")
    args = parser.parse_args()

    if args.remove_sector:
        print(remove_sector(args.remove_sector))
        return 0
    if args.remove_batch:
        notes = remove_batch(args.remove_batch)
        _clear_caches()
        refresh_derived()
        print("\n".join(notes))
        return 0

    if args.status:
        print(status())
        return 0
    if args.mark_pulled:
        print(mark_pulled())
        return 0
    if isinstance(args.apply, str):
        print(apply_batch(args.apply))
        return 0

    files = sorted(
        p for p in INCOMING.iterdir()
        if p.is_file() and p.suffix.lower() in ACCEPTED_SUFFIXES
        and not p.name.lower().startswith(("readme", ".", "_"))
    ) if INCOMING.exists() else []
    if not files:
        print("hs_index/incoming/ has no upload to process")
        return 0

    failed = 0
    for path in files:
        line = process(path, apply=bool(args.apply))
        print(line)
        failed += "needs attention" in line
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
