"""
Turn the raw Comtrade store into a publishable staging snapshot.

Produces one node file per HS code at three levels — HS-6 products and the
official HS-4 and HS-2 aggregates that contain them — plus the catalogue,
methodology and manifest the dashboard reads.

The headline number on every node is a single global trade figure, net of
re-imports. See globaltrade.py for how it is built and why.
"""

from __future__ import annotations

from pathlib import Path
import argparse
import csv
import json

import datasets as dataset_registry
import fx
import globaltrade
import store
from common import (
    DATA,
    FLOW_EXPORTS,
    FLOW_IMPORTS,
    FLOW_RE_EXPORTS,
    FLOW_RE_IMPORTS,
    INDIA_REPORTER,
    annual_periods,
    round_ratio,
    round_usd,
    utc_now,
    write_json,
)
from coverage import assess_coverage
from definition import (
    categories,
    hs6_universe,
    lineage_for,
    load_products,
    load_scope,
    parent_universe,
    retired_codes,
    segments,
    successors_of,
)

SCHEMA_VERSION = "2.0.0"

HS8_CSV = DATA / "dgcis" / "india_hs8.csv"

# Parquet is preferred where it exists: it is typed, a quarter the size, and
# is written only from an already-validated CSV. The CSV remains what a person
# edits, so a file small enough to hand-maintain still works with no Parquet
# present at all.
HS8_PARQUET = DATA / "dgcis" / "india_hs8.parquet"

ROOT_CONFIG = Path(__file__).resolve().parents[1] / "config"

# Partner and economy tables are the bulk of a node file. Analytical years
# get the full treatment; history years keep scalars only.
TOP_ECONOMIES = 10
TOP_ECONOMIES_BENCHMARK = 25
TOP_PARTNERS = 20

# A financial year and a calendar year are different periods, so the check
# below cannot be tight. Its job is to catch a units blunder - rupees loaded
# into the dollar column would be roughly 85x out - not to reconcile two
# statistical systems that are never going to agree to the percent.
# Overridden by scope.json -> tariffLines.reconcileBand when present.
HS8_RECONCILE_BAND = (0.5, 2.0)

GLOBAL_FLOWS = [FLOW_IMPORTS, FLOW_RE_IMPORTS, FLOW_EXPORTS, FLOW_RE_EXPORTS]

INDIA_FLOWS = [FLOW_IMPORTS, FLOW_EXPORTS]


# ---------------------------------------------------------------------------
# India bilateral detail
# ---------------------------------------------------------------------------


def partner_set(rows, world_total) -> dict:
    """
    India's bilateral breakdown.

    Partner rows are gross: re-imports are not filed by partner, so the
    denominator here is India's gross world total, never the netted one.
    """
    empty = {
        "rows": [],
        "coverage": None,
        "hhi": None,
        "top3Share": None,
        "basis": "gross",
    }

    if not rows or not world_total or world_total <= 0:
        return empty

    partner_total = sum(value for _, _, value in rows)

    coverage = partner_total / world_total

    top = [
        {
            "code": code,
            "name": name,
            "value": round_usd(value),
            "share": round_ratio(value / world_total),
        }
        for code, name, value in rows[:TOP_PARTNERS]
    ]

    # Concentration is only meaningful when the bilateral rows actually
    # add up to the reported world total.
    if 0.95 <= coverage <= 1.05:
        hhi = round_ratio(
            sum((value / world_total) ** 2 for _, _, value in rows)
        )

        top3 = round_ratio(
            sum(value / world_total for _, _, value in rows[:3])
        )
    else:
        hhi = None
        top3 = None

    return {
        "rows": top,
        "coverage": round_ratio(coverage),
        "hhi": hhi,
        "top3Share": top3,
        "basis": "gross",
    }


# ---------------------------------------------------------------------------
# India tariff lines from the static CSV
# ---------------------------------------------------------------------------


def _number(raw) -> float | None:
    text = str(raw or "").replace(",", "").strip()

    if not text:
        return None

    try:
        return float(text)
    except ValueError:
        return None


def _hs8_rows():
    """
    Tariff-line rows as plain dicts, from Parquet if present, else CSV.

    Returns None when neither exists, which is the normal state until a DGCIS
    export is supplied.
    """
    parquet = HS8_PARQUET if HS8_PARQUET.exists() else None

    if parquet is not None:
        try:
            import pandas as pd

            frame = pd.read_parquet(parquet)

            return [
                {key: ("" if value is None or value != value else value)
                 for key, value in record.items()}
                for record in frame.to_dict("records")
            ]
        except Exception as error:  # noqa: BLE001 - fall back, but say so
            print(
                f"  {parquet.name} unreadable ({error}); falling back to the CSV"
            )

    if not HS8_CSV.exists():
        return None

    with HS8_CSV.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def load_hs8() -> dict:
    """
    India ITC(HS)-8 detail from a hand-maintained CSV.

    Keyed by financial year, deliberately. DGCIS reports April–March and
    Comtrade reports January–December, and the whole point of this function is
    that the two never end up in the same bucket. Nothing here is ever placed
    into the calendar-year series; tariff lines get their own block on the node
    and their own period label on the page.

    Each row's native currency is preserved exactly as filed. The other
    currency is derived with that financial year's rate from
    config/fx_inr_usd.csv, and is marked as derived so the page can say so. If
    the rate is missing the derived side stays None and the dashboard shows
    only what was actually published.

    A missing file is normal — the dashboard then reports tariff-line detail as
    unavailable rather than inventing it.
    """
    empty = {"byCode": {}, "financialYears": {}, "present": False}

    source = _hs8_rows()

    if source is None:
        return empty

    table = fx.load()

    grouped: dict[tuple[str, str], dict[str, dict]] = {}

    months_by_fy: dict[str, int | None] = {}

    natives: dict[str, set[str]] = {}

    for row in source:
        code = "".join(
            char for char in str(row.get("hs8", "")) if char.isdigit()
        )

        if len(code) != 8:
            continue

        period = fx.normalise_fy(row.get("fy") or row.get("year") or "")

        if period is None:
            # import_dgcis.py refuses these outright; skipping here keeps a
            # hand-edited file from silently landing in the wrong year.
            continue

        flow = str(row.get("flow", "")).strip().lower()

        inr = _number(row.get("value_inr"))
        usd = _number(row.get("value_usd"))

        if inr is None and usd is None:
            continue

        native = "inr" if inr is not None else "usd"

        rate = table.rate(period, fx.FY)

        if usd is None and rate is not None:
            usd = inr / rate

        if inr is None and rate is not None:
            inr = usd * rate

        months_raw = _number(row.get("months_covered"))

        months_by_fy.setdefault(
            period, int(months_raw) if months_raw is not None else None
        )

        natives.setdefault(period, set()).add(native)

        bucket = grouped.setdefault((code[:6], period), {})

        entry = bucket.setdefault(
            code,
            {
                "hs8": code,
                "description": str(row.get("description", "")).strip(),
                "importsUsd": None,
                "exportsUsd": None,
                "importsInr": None,
                "exportsInr": None,
                "native": native,
            },
        )

        key = "imports" if flow.startswith("i") or flow == "m" else (
            "exports" if flow.startswith("e") or flow == "x" else None
        )

        if key is None:
            continue

        for suffix, value in (("Usd", usd), ("Inr", inr)):
            if value is None:
                continue

            field = f"{key}{suffix}"

            entry[field] = (entry[field] or 0.0) + value

        if not entry["description"]:
            entry["description"] = str(row.get("description", "")).strip()

    by_code: dict[tuple[str, str], list] = {}

    for key, bucket in grouped.items():
        rows = []

        for entry in bucket.values():
            imports_usd = entry["importsUsd"]
            exports_usd = entry["exportsUsd"]
            imports_inr = entry["importsInr"]
            exports_inr = entry["exportsInr"]

            rows.append(
                {
                    "hs8": entry["hs8"],
                    "description": entry["description"],
                    "imports": round_usd(imports_usd)
                    if imports_usd is not None
                    else None,
                    "exports": round_usd(exports_usd)
                    if exports_usd is not None
                    else None,
                    "balance": round_usd((exports_usd or 0) - (imports_usd or 0))
                    if imports_usd is not None or exports_usd is not None
                    else None,
                    "importsInr": round_usd(imports_inr)
                    if imports_inr is not None
                    else None,
                    "exportsInr": round_usd(exports_inr)
                    if exports_inr is not None
                    else None,
                    "balanceInr": round_usd((exports_inr or 0) - (imports_inr or 0))
                    if imports_inr is not None or exports_inr is not None
                    else None,
                    "native": entry["native"],
                }
            )

        by_code[key] = sorted(
            rows,
            key=lambda item: (item["imports"] or 0) + (item["exports"] or 0),
            reverse=True,
        )

    financial_years = {}

    for period in sorted(months_by_fy):
        months = months_by_fy[period]

        entry = table.entry(period, fx.FY)

        usable = entry.usable if entry else False

        financial_years[period] = {
            "fy": period,
            "monthsCovered": months,
            "complete": (months >= 12) if months is not None else None,
            "native": sorted(natives.get(period, set())),
            "rate": round(entry.inr_per_usd, 4) if usable else None,
            "rateSource": entry.source if usable else None,
            "overlapsCalendarYear": fx.fy_start_year(period),
        }

    return {
        "byCode": by_code,
        "financialYears": financial_years,
        "present": bool(by_code),
    }


def tariff_lines_for(code: str, level: int, hs8: dict) -> dict:
    """
    The tariff-line block that hangs off a node.

    At HS-6 it is the lines beneath that code. At HS-4 and HS-2 it is every
    line beneath every member six-digit code, aggregated — a heading's tariff
    detail is the union of its products'.
    """
    if not hs8.get("present"):
        return {}

    by_fy: dict[str, list] = {}

    for (prefix, period), rows in hs8["byCode"].items():
        wanted = prefix == code if level == 6 else prefix.startswith(code)

        if not wanted:
            continue

        by_fy.setdefault(period, []).extend(rows)

    if not by_fy:
        return {}

    out: dict[str, dict] = {}

    for period, rows in by_fy.items():
        merged: dict[str, dict] = {}

        for row in rows:
            existing = merged.get(row["hs8"])

            if existing is None:
                merged[row["hs8"]] = dict(row)
                continue

            for field in (
                "imports",
                "exports",
                "balance",
                "importsInr",
                "exportsInr",
                "balanceInr",
            ):
                if row[field] is None:
                    continue

                existing[field] = (existing[field] or 0) + row[field]

        ordered = sorted(
            merged.values(),
            key=lambda item: (item["imports"] or 0) + (item["exports"] or 0),
            reverse=True,
        )

        meta = dict(hs8["financialYears"].get(period, {"fy": period}))

        def total(field: str) -> float | None:
            # None, not zero. A period with no convertible rows has an unknown
            # total, and zero would read as "no trade" rather than "not shown".
            if not any(item[field] is not None for item in ordered):
                return None

            return round_usd(sum(item[field] or 0 for item in ordered))

        meta["lines"] = len(ordered)
        meta["totalImports"] = total("imports")
        meta["totalExports"] = total("exports")
        meta["totalImportsInr"] = total("importsInr")
        meta["totalExportsInr"] = total("exportsInr")

        out[period] = {"meta": meta, "rows": ordered}

    return out


def reconcile_tariff_lines(tariff: dict, annual: dict) -> dict:
    """
    Sanity-check the tariff-line totals against the Comtrade six-digit figure.

    These are different statistical systems over different twelve-month
    windows, so this is deliberately not a reconciliation to the percent. A
    ratio near 1 says the two describe the same trade; a ratio near 85 says
    rupees went into the dollar column. That is what it is for.
    """
    for period, block in tariff.items():
        overlap = str(block["meta"].get("overlapsCalendarYear") or "")

        record = annual.get(overlap, {}).get("india", {})

        comtrade = record.get("imports")

        ours = block["meta"].get("totalImports")

        # A part year against a full year tells you nothing: the shortfall is
        # the missing months, not a data fault. Better to skip the check and
        # say so than to publish a ratio nobody should read.
        if block["meta"].get("complete") is False:
            block["meta"]["reconciliation"] = {
                "status": "skipped",
                "reason": "part year",
                "comparedWith": overlap or None,
            }
            continue

        if not comtrade or not ours:
            block["meta"]["reconciliation"] = {
                "status": "unavailable",
                "comparedWith": overlap or None,
            }
            continue

        ratio = ours / comtrade

        low, high = HS8_RECONCILE_BAND

        block["meta"]["reconciliation"] = {
            "status": "ok" if low <= ratio <= high else "out-of-band",
            "ratio": round_ratio(ratio),
            "comparedWith": overlap,
            "basis": (
                f"FY {period} tariff-line imports against CY {overlap} "
                "Comtrade imports; different periods, so this is an order-of-"
                "magnitude check rather than a reconciliation."
            ),
        }

    return tariff


# ---------------------------------------------------------------------------
# Period records
# ---------------------------------------------------------------------------


def reconcile_india(direct_value, frame_value) -> tuple[bool, str | None]:
    """
    India's own filing and India's row inside the all-reporters frame
    describe the same trade. If they disagree, one of the two pulls is
    stale and nothing on this period may be published.
    """
    if direct_value is None:
        return False, "India direct value unavailable"

    if frame_value is None:
        return False, "India absent from global reporter frame"

    delta = abs(float(frame_value) - float(direct_value))

    tolerance = max(1_000_000, abs(direct_value) * 0.01)

    if delta > tolerance:
        return False, f"India direct/global mismatch: {delta:.0f}"

    return True, None


def build_period(
    code: str,
    period: str,
    prior: str | None,
    global_index: dict,
    india_index: dict,
    scope: dict,
    analytical: bool,
    detailed: bool,
) -> dict:
    bounds = tuple(scope["globalTrade"]["mirrorWarnRatio"])

    imports = global_index[FLOW_IMPORTS].get(code, period)

    result = globaltrade.compute(
        imports,
        global_index[FLOW_RE_IMPORTS].get(code, period),
        global_index[FLOW_EXPORTS].get(code, period),
        global_index[FLOW_RE_EXPORTS].get(code, period),
        mirror_bounds=bounds,
        top=TOP_ECONOMIES if detailed else 1,
    )

    if analytical and prior is not None:
        verdict = assess_coverage(
            imports,
            global_index[FLOW_IMPORTS].get(code, prior),
        )
    else:
        verdict = {
            "status": "HISTORICAL" if not analytical else "BASELINE",
            "reason": (
                "Outside the validation window"
                if not analytical
                else "No preceding period inside the validation window"
            ),
        }

    publishable = verdict.get("status") == "VALID"

    india_gross_imports = india_index[FLOW_IMPORTS].world_total(code, period)

    india_gross_exports = india_index[FLOW_EXPORTS].world_total(code, period)

    if publishable:
        india_in_frame = imports.get(INDIA_REPORTER)

        ok, reason = reconcile_india(
            india_gross_imports,
            india_in_frame[1] if india_in_frame else None,
        )

        if not ok:
            publishable = False

            verdict = dict(verdict)
            verdict["status"] = "INVALID"
            verdict["reconciliation"] = reason

    india_rank = (
        result["importRank"]["india"] if result["importRank"] else None
    )

    india_export_rank = (
        result["exportRank"]["india"] if result["exportRank"] else None
    )

    imports_value = round_usd(india_gross_imports)
    exports_value = round_usd(india_gross_exports)

    record: dict = {
        "india": {
            "imports": imports_value,
            "exports": exports_value,
            "balance": (
                round_usd(exports_value - imports_value)
                if imports_value is not None and exports_value is not None
                else None
            ),
            "importsNetReImports": india_rank["value"] if india_rank else None,
            "exportsNetReExports": (
                india_export_rank["value"] if india_export_rank else None
            ),
        },
        "global": {
            "trade": round_usd(result["netImports"]) if publishable else None,
            "tradeStatus": verdict.get("status"),
            "indiaRank": (
                india_rank["rank"] if publishable and india_rank else None
            ),
            "indiaShare": (
                india_rank["share"] if publishable and india_rank else None
            ),
            "observed": {
                "grossImports": round_usd(result["grossImports"]),
                "reImportsRemoved": round_usd(result["reImportsRemoved"]),
                "netImports": round_usd(result["netImports"]),
                "grossExports": round_usd(result["grossExports"]),
                "reExportsRemoved": round_usd(result["reExportsRemoved"]),
                "netExports": round_usd(result["netExports"]),
                "reporters": result["importSide"]["reporters"],
                "adjustedReporters": result["importSide"]["adjustedReporters"],
                "adjustmentCoverage": round_ratio(result["adjustmentCoverage"]),
            },
            "mirror": {
                "ratio": result["mirrorRatio"],
                "gap": result["mirrorGap"],
                "status": result["mirrorStatus"],
            },
            "coverage": verdict,
        },
    }

    if detailed:
        record["global"]["topEconomies"] = (
            result["importRank"]["top"]
            if publishable and result["importRank"]
            else []
        )

        record["global"]["topExporters"] = (
            result["exportRank"]["top"]
            if publishable and result["exportRank"]
            else []
        )

        record["india"]["suppliers"] = partner_set(
            india_index[FLOW_IMPORTS].partners(code, period),
            india_gross_imports,
        )

        record["india"]["destinations"] = partner_set(
            india_index[FLOW_EXPORTS].partners(code, period),
            india_gross_exports,
        )

    return record


# ---------------------------------------------------------------------------
# Lineage
# ---------------------------------------------------------------------------


def first_year_with_data(annual: dict) -> int | None:
    for year in sorted(annual, key=int):
        observed = annual[year]["global"]["observed"]

        if observed.get("grossImports"):
            return int(year)

    return None


def predecessor_series(
    codes: dict,
    years: list[str],
    global_index: dict,
    india_index: dict,
    scope: dict,
) -> dict:
    """
    The old code's own numbers, kept separate.

    A split cannot be apportioned across its successors without inventing a
    share, so this is never added to the six-digit series. It is carried
    alongside it so the page can show what the line used to be reported as.
    """
    output: dict[str, dict] = {}

    for code, valid_to in codes.items():
        rows: dict[str, dict] = {}

        for year in years:
            # Filings under a dead code after its revision are stragglers,
            # not history. 851712 still shows a trickle in 2023.
            if valid_to is not None and int(year) > valid_to:
                continue

            result = globaltrade.compute(
                global_index[FLOW_IMPORTS].get(code, year),
                global_index[FLOW_RE_IMPORTS].get(code, year),
                global_index[FLOW_EXPORTS].get(code, year),
                global_index[FLOW_RE_EXPORTS].get(code, year),
                mirror_bounds=tuple(scope["globalTrade"]["mirrorWarnRatio"]),
                top=1,
            )

            india_imports = india_index[FLOW_IMPORTS].world_total(code, year)
            india_exports = india_index[FLOW_EXPORTS].world_total(code, year)

            if result["netImports"] is None and india_imports is None:
                continue

            rows[year] = {
                "globalTrade": round_usd(result["netImports"]),
                "indiaImports": round_usd(india_imports),
                "indiaExports": round_usd(india_exports),
            }

        if rows:
            output[code] = rows

    return output


def build_lineage(
    code: str,
    level: int,
    annual: dict,
    years: list[str],
    global_index: dict,
    india_index: dict,
    scope: dict,
):
    entries = lineage_for().get(code, ())

    if not entries:
        return None

    predecessors = [
        {
            "code": item.predecessor,
            "relation": item.relation,
            "validTo": item.predecessor_valid_to,
            "note": item.note,
        }
        for item in entries
    ]

    spliceable = [item.predecessor for item in entries if item.splices]

    mentioned = {
        item.predecessor: item.predecessor_valid_to
        for item in entries
        if item.predecessor
    }

    # Every code that together covers this concept across the revision: the
    # code itself, the codes it came from, and its siblings - the other codes
    # the same predecessor split into.
    #
    # This is the set that may legitimately be *summed*. A split cannot be
    # apportioned between its successors without inventing a share, but the
    # union of the old code and all of its successors needs no share at all:
    # before the revision only the old code has data, after it only the new
    # ones, so the two never overlap and the combined series is continuous by
    # construction. That is the difference between joining a series (refused)
    # and stacking a family (offered).
    successors = successors_of()

    family = {code}

    for predecessor in mentioned:
        family.add(predecessor)
        family.update(successors.get(predecessor, ()))

    return {
        "predecessors": predecessors,
        # Only an unchanged code may have its predecessor's years joined on.
        "spliced": bool(spliceable),
        "seriesStartsAt": first_year_with_data(annual),
        # Where the split is internal, so the long series really is continuous.
        "continuousAt": code[:4] if level == 6 else None,
        "family": sorted(family),
        "familyNote": (
            "These codes together cover this product across the HS 2022 "
            "revision. They do not overlap in time, so stacking them gives a "
            "continuous series without apportioning anything."
        ),
        "series": predecessor_series(
            mentioned,
            years,
            global_index,
            india_index,
            scope,
        ),
    }


# ---------------------------------------------------------------------------
# Benchmarks
# ---------------------------------------------------------------------------


def latest_benchmark(annual: dict, analysis_start: int):
    """
    Most recent analytical year whose reporter coverage passed.

    A year that failed coverage is never used for a headline, a rank or a
    share, no matter how recent it is.
    """
    for year in sorted(
        (int(y) for y in annual if int(y) >= analysis_start),
        reverse=True,
    ):
        record = annual[str(year)]["global"]

        if record.get("coverage", {}).get("status") != "VALID":
            continue

        if record.get("trade") is None:
            continue

        return {
            "year": year,
            "status": "VALID",
            "value": record["trade"],
            "basis": "imports",
            "netReImports": True,
            "indiaRank": record.get("indiaRank"),
            "indiaShare": record.get("indiaShare"),
            "adjustmentCoverage": record["observed"].get("adjustmentCoverage"),
            "mirror": record.get("mirror"),
            "topEconomies": record.get("topEconomies", [])[
                :TOP_ECONOMIES_BENCHMARK
            ],
        }

    return None


# ---------------------------------------------------------------------------
# Node assembly
# ---------------------------------------------------------------------------


def definition_share(
    code: str,
    level: int,
    members: list[str],
    hs6_values: dict,
    annual: dict,
    official_children: dict,
    analysis_start: int,
) -> dict | None:
    """
    How much of an official heading HStat's selection actually covers.

    The HS-4 and HS-2 figures on this dashboard are Comtrade's own aggregates,
    pulled at that level. They are the whole heading, including six-digit lines
    the FED definition does not track. That is the right number to publish, but
    it invites a reasonable misreading: that the heading *is* the sector.

    So each parent page also carries the other number - what the tracked lines
    come to, and what share of the heading that is. Heading 8501 holds
    seventeen six-digit lines and the definition tracks one of them; a reader
    who knows that will not mistake the heading total for electronics.

    The value sum is only over members whose own period passed coverage, and
    the count of those is published alongside, because a sum missing a withheld
    member understates and should not be read as precise.
    """
    if level == 6 or not members:
        return None

    official = official_children.get(code)

    years_out: dict[str, dict] = {}

    for period, record in annual.items():
        if int(period) < analysis_start:
            continue

        heading_trade = record["global"].get("trade")
        heading_imports = record["india"].get("imports")
        heading_exports = record["india"].get("exports")

        defined_trade = 0.0
        defined_imports = 0.0
        defined_exports = 0.0

        with_trade = 0
        with_india = 0

        for member in members:
            values = hs6_values.get(member, {}).get(period)

            if not values:
                continue

            if values.get("trade") is not None:
                defined_trade += values["trade"]
                with_trade += 1

            if values.get("imports") is not None:
                defined_imports += values["imports"]
                with_india += 1

            if values.get("exports") is not None:
                defined_exports += values["exports"]

        entry = {
            "members": len(members),
            "membersWithTrade": with_trade,
            "membersWithIndia": with_india,
            "headingGlobalTrade": heading_trade,
            "definedGlobalTrade": round_usd(defined_trade) if with_trade else None,
            "headingIndiaImports": heading_imports,
            "definedIndiaImports": round_usd(defined_imports) if with_india else None,
            "headingIndiaExports": heading_exports,
            "definedIndiaExports": round_usd(defined_exports) if with_india else None,
        }

        entry["globalShare"] = (
            round_ratio(defined_trade / heading_trade)
            if heading_trade and with_trade
            else None
        )

        entry["indiaImportShare"] = (
            round_ratio(defined_imports / heading_imports)
            if heading_imports and with_india
            else None
        )

        years_out[period] = entry

    return {
        "officialLines": official,
        "definedLines": len(members),
        "lineShare": (
            round_ratio(len(members) / official) if official else None
        ),
        "countSource": "config/hs_official_children.json",
        "basis": (
            "The heading figure is Comtrade's own aggregate at this level, "
            "covering every six-digit line in the heading. The defined figure "
            "is the sum of the HStat product lines inside it. The gap is the "
            "part of the heading the sector definition does not track."
        ),
        "caution": (
            "Summed values omit any member whose own period failed coverage "
            "validation, so the share is a lower bound where members are "
            "missing."
        ),
        "years": years_out,
    }


def build_node(
    code: str,
    level: int,
    meta: dict,
    global_index: dict,
    india_index: dict,
    monthly_global: dict,
    monthly_india: dict,
    scope: dict,
    years: list[str],
    months: list[str],
    hs8: dict,
    hs6_values: dict | None = None,
    official_children: dict | None = None,
) -> dict:
    analysis_start = scope["analysisStartYear"]

    annual: dict[str, dict] = {}

    for position, year in enumerate(years):
        annual[year] = build_period(
            code,
            year,
            years[position - 1] if position > 0 else None,
            global_index,
            india_index,
            scope,
            analytical=int(year) >= analysis_start,
            detailed=int(year) >= analysis_start,
        )

    monthly: dict[str, dict] = {}

    if months and scope["monthly"]["enabled"]:
        for position, period in enumerate(months):
            record = build_period(
                code,
                period,
                months[position - 1] if position > 0 else None,
                monthly_global,
                monthly_india,
                scope,
                analytical=True,
                detailed=False,
            )

            has_data = (
                record["india"]["imports"] is not None
                or record["india"]["exports"] is not None
                or record["global"]["observed"]["grossImports"] is not None
            )

            if has_data:
                monthly[period] = record

    lineage = build_lineage(
        code,
        level,
        annual,
        years,
        global_index,
        india_index,
        scope,
    )

    benchmark = latest_benchmark(annual, analysis_start)

    latest_india_year = None

    for year in sorted((int(y) for y in annual), reverse=True):
        india = annual[str(year)]["india"]

        if india["imports"] is not None or india["exports"] is not None:
            latest_india_year = year
            break

    latest_india_month = None

    for period in sorted(monthly, reverse=True):
        india = monthly[period]["india"]

        if india["imports"] is not None or india["exports"] is not None:
            latest_india_month = period
            break

    tariff = reconcile_tariff_lines(tariff_lines_for(code, level, hs8), annual)

    share = definition_share(
        code,
        level,
        meta.get("members", []),
        hs6_values or {},
        annual,
        official_children or {},
        analysis_start,
    )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "level": level,
        "code": code,
        "hs6": code,
        "description": meta["description"],
        "product": meta.get("product", ""),
        "category": meta.get("category", ""),
        "segment": meta.get("segment", ""),
        "dgcisSegment": meta.get("dgcisSegment", ""),
        "inFedDefinition": meta.get("inFedDefinition", False),
        "referenceFlags": meta.get("referenceFlags", {}),
        "members": meta.get("members", []),
        "parentCode": (
            code[:4] if level == 6 else (code[:2] if level == 4 else None)
        ),
        "classification": "HS 2022 (H6)",
        "years": [int(year) for year in years],
        "analyticalYears": [
            int(year) for year in years if int(year) >= analysis_start
        ],
        "months": sorted(monthly),
        "latestIndiaYear": latest_india_year,
        "latestIndiaMonth": latest_india_month,
        "lineage": lineage,

        # Parent nodes only: what share of this official heading the FED
        # definition actually tracks. Null at HS-6, where the question does
        # not arise.
        "definitionShare": share,

        "globalTrade": benchmark,
        "annual": annual,
        "monthly": monthly,

        # Tariff lines live here, outside `annual`, because they are financial
        # years and `annual` is calendar years. Keeping them in separate blocks
        # is what makes it structurally impossible to add the two together.
        "tariffLines": {
            "basis": "FY",
            "periodLabel": "Indian financial year, April to March",
            "source": "DGCIS / TradeStat static CSV",
            "financialYears": tariff,
        }
        if tariff
        else {
            "basis": "FY",
            "source": "Not supplied",
            "financialYears": {},
        },

        "sources": {
            "global": "UN Comtrade",
            "indiaHs6": "UN Comtrade",
            "indiaHs8": (
                "DGCIS / TradeStat static CSV"
                if tariff
                else "Not supplied"
            ),
        },
    }


def node_meta(code: str, level: int, products: dict) -> dict:
    if level == 6:
        product = products.get(code)

        if product is None:
            return {"description": "", "product": "", "category": ""}

        return {
            "description": product.description,
            "product": product.product,
            "category": product.category,
            "segment": product.segment,
            "dgcisSegment": product.dgcis_segment,
            "inFedDefinition": product.in_fed_definition,
            "referenceFlags": product.reference_flags,
        }

    members = [item for item in products.values() if item.hs6.startswith(code)]

    member_categories = sorted({item.category for item in members if item.category})

    return {
        "description": (
            f"Official HS-{level} aggregate covering {len(members)} HStat "
            f"product line{'s' if len(members) != 1 else ''}"
        ),
        "product": ", ".join(
            sorted({item.product for item in members if item.product})[:3]
        ),
        "category": member_categories[0] if member_categories else "",
        "segment": "",
        "dgcisSegment": "",
        "inFedDefinition": any(item.in_fed_definition for item in members),
        "referenceFlags": {},
        "members": sorted(item.hs6 for item in members),
    }


# ---------------------------------------------------------------------------


def main():
    scope = load_scope()

    parser = argparse.ArgumentParser()

    parser.add_argument("--out", required=True)

    parser.add_argument("--raw-store", default=None)

    parser.add_argument(
        "--fixture",
        action="store_true",
        help=(
            "Mark the snapshot as built from fabricated data. Set by "
            "scripts/dev-fixture.sh. A snapshot carrying this mark is refused "
            "at deploy time."
        ),
    )

    parser.add_argument(
        "--hs8-csv",
        default=None,
        help=(
            "Alternate ITC(HS)-8 file. For fixture runs only; a real refresh "
            "reads data/dgcis/india_hs8.csv."
        ),
    )

    parser.add_argument(
        "--fx-csv",
        default=None,
        help=(
            "Alternate rupee/dollar table. For fixture runs only; a real "
            "refresh reads config/fx_inr_usd.csv."
        ),
    )

    parser.add_argument(
        "--start-year",
        type=int,
        default=scope["historyStartYear"],
    )

    parser.add_argument(
        "--analysis-start-year",
        type=int,
        default=scope["analysisStartYear"],
    )

    parser.add_argument("--end-year", type=int, required=True)

    parser.add_argument(
        "--only",
        default=None,
        help=(
            "Comma-separated codes to process instead of the whole universe. "
            "For debugging one product; the result is not promotable."
        ),
    )

    parser.add_argument(
        "--months",
        type=int,
        default=(
            scope["monthly"]["rollingMonths"]
            if scope["monthly"]["enabled"]
            else 0
        ),
    )

    args = parser.parse_args()

    scope["analysisStartYear"] = args.analysis_start_year

    if args.fx_csv:
        fx.use(args.fx_csv)

    band = (scope.get("tariffLines") or {}).get("reconcileBand")

    if band and len(band) == 2:
        global HS8_RECONCILE_BAND

        HS8_RECONCILE_BAND = (float(band[0]), float(band[1]))

    global HS8_CSV

    if args.hs8_csv:
        HS8_CSV = Path(args.hs8_csv)

    root = Path(args.raw_store) if args.raw_store else None

    out = Path(args.out)

    all_rows = {product.hs6: product for product in load_products()}

    current = set(hs6_universe())

    # HS 2022 is the base: a code that exists only as somebody's predecessor
    # is pulled but never published as a product of its own.
    products = {
        code: product
        for code, product in all_rows.items()
        if code in current
    }

    global_index = {
        flow: store.reporter_index("A", "global", flow, root)
        for flow in GLOBAL_FLOWS
    }

    india_index = {
        flow: store.partner_index("A", "india", flow, INDIA_REPORTER, root)
        for flow in INDIA_FLOWS
    }

    monthly_global = {
        flow: store.reporter_index("M", "global", flow, root)
        for flow in GLOBAL_FLOWS
    }

    monthly_india = {
        flow: store.partner_index("M", "india", flow, INDIA_REPORTER, root)
        for flow in INDIA_FLOWS
    }

    if len(global_index[FLOW_IMPORTS]) == 0:
        raise SystemExit(
            "Raw store holds no annual global import rows. "
            "Run pipeline/pull_comtrade.py first."
        )

    years = annual_periods(args.start_year, args.end_year)

    months: list[str] = []

    if args.months > 0:
        available = sorted(
            monthly_global[FLOW_IMPORTS].periods()
            | monthly_india[FLOW_IMPORTS].periods()
        )

        months = [
            period
            for period in available
            if period.isdigit() and len(period) == 6
        ][-args.months:]

    hs8 = load_hs8()

    # Which rates the snapshot actually needs, so coverage is reported against
    # the periods in play rather than against the whole table.
    rate_table = fx.load()

    wanted = [(fx.CY, year) for year in years]
    wanted += [(fx.MONTH, period) for period in months]
    wanted += [(fx.FY, period) for period in hs8["financialYears"]]

    rate_coverage = rate_table.coverage(wanted)

    if rate_coverage["missing"]:
        print(
            f"Rupee conversion unavailable for "
            f"{len(rate_coverage['missing'])} of {rate_coverage['periods']} "
            "periods; those show dollars only. "
            "Run `python pipeline/fx.py --report` for the list."
        )

    parents = parent_universe()

    plan = [(code, 6) for code in sorted(products)]

    if retired_codes():
        print(
            f"Retired codes excluded from products: "
            f"{', '.join(sorted(retired_codes()))}"
        )

    for level_name, codes in parents.items():
        plan.extend((code, int(level_name)) for code in codes)

    if args.only:
        wanted = {code.strip() for code in args.only.split(",") if code.strip()}

        plan = [entry for entry in plan if entry[0] in wanted]

        if not plan:
            raise SystemExit(f"None of {sorted(wanted)} are in the universe")

    catalogue = []

    official_children = {}

    children_path = ROOT_CONFIG / "hs_official_children.json"

    if children_path.exists():
        official_children = json.loads(children_path.read_text())
    else:
        print(
            "No config/hs_official_children.json; parent pages will omit the "
            "definition-coverage figure. Run "
            "`python scripts/build_official_children.py` to generate it."
        )

    # HS-6 nodes are built first (the plan is ordered that way), so by the
    # time a parent is built every member's figures are already known and no
    # second pass over the store is needed.
    hs6_values: dict[str, dict] = {}

    for code, level in plan:
        node = build_node(
            code,
            level,
            node_meta(code, level, products),
            global_index,
            india_index,
            monthly_global,
            monthly_india,
            scope,
            years,
            months,
            hs8,
            hs6_values,
            official_children,
        )

        if level == 6:
            hs6_values[code] = {
                period: {
                    "trade": record["global"].get("trade"),
                    "imports": record["india"].get("imports"),
                    "exports": record["india"].get("exports"),
                }
                for period, record in node["annual"].items()
                if int(period) >= args.analysis_start_year
            }

        destination = (
            out / "products" / f"{code}.json"
            if level == 6
            else out / "parents" / str(level) / f"{code}.json"
        )

        write_json(destination, node, compact=True)

        latest = node["annual"].get(str(args.end_year), {})

        catalogue.append(
            {
                "code": code,
                "level": level,
                "description": node["description"],
                "product": node["product"],
                "category": node["category"],
                "segment": node["segment"],
                "inFedDefinition": node["inFedDefinition"],
                "latestIndiaYear": node["latestIndiaYear"],
                "latestIndiaMonth": node["latestIndiaMonth"],
                "globalTradeYear": (
                    node["globalTrade"]["year"] if node["globalTrade"] else None
                ),
                "globalTrade": (
                    node["globalTrade"]["value"] if node["globalTrade"] else None
                ),
                "indiaRank": (
                    node["globalTrade"]["indiaRank"]
                    if node["globalTrade"]
                    else None
                ),
                "indiaShare": (
                    node["globalTrade"]["indiaShare"]
                    if node["globalTrade"]
                    else None
                ),
                "indiaImports": latest.get("india", {}).get("imports"),
                "indiaExports": latest.get("india", {}).get("exports"),
            }
        )

    write_json(out / "catalogue.json", catalogue, compact=True)

    write_json(
        out / "methodology.json",
        {
            "globalTrade": {
                "label": scope["globalTrade"]["label"],
                "basis": scope["globalTrade"]["basis"],
                "netReExports": scope["globalTrade"]["netReExports"],
                "statement": scope["globalTrade"]["methodology"],
                "formula": (
                    "global trade = SUM over reporting economies of "
                    "(imports from World - re-imports filed by that reporter)"
                ),
                "notes": [
                    "Total imports as filed already include re-imports "
                    "(M = FM + RM + MIP + MOP), so re-imported goods would "
                    "otherwise be counted twice.",
                    "Reporters that do not file RM separately are left "
                    "unadjusted. Adjustment coverage reports the share of the "
                    "world total that could be adjusted.",
                    "The export side, net of re-exports, is computed as a "
                    "mirror check. The published gap is the CIF/FOB and "
                    "reporting difference between the two sides.",
                    "No figure is published for a period whose reporter "
                    "coverage failed validation.",
                    "India's bilateral partner rows are gross: re-imports are "
                    "not filed by partner.",
                ],
            },
            "definition": {
                "source": "config/fed_sector_definition.csv",
                "products": len(products),
                "inFedDefinition": sum(
                    1 for item in products.values() if item.in_fed_definition
                ),
                "categories": categories(),
                "segments": segments(),
            },
            "periods": {
                "comtrade": "Calendar year, January to December",
                "tariffLines": "Indian financial year, April to March",
                "statement": (
                    "UN Comtrade reports calendar years and DGCIS reports "
                    "Indian financial years. HStat keeps them in separate "
                    "blocks and labels every figure with its own basis. They "
                    "are never summed, spliced or plotted on a shared axis; "
                    "where the page shows both, it is showing two adjacent "
                    "measurements of overlapping but different periods."
                ),
            },
            "currency": {
                "base": "USD",
                "display": ["USD", "INR"],
                "applies": (
                    "India's own figures and the tariff-line detail. Global "
                    "trade, economy rankings and partner tables stay in US "
                    "dollars, because an Indian reference rate is not the "
                    "right way to read another country's customs filing."
                ),
                "statement": (
                    "Every stored value is in US dollars, because that is how "
                    "both sources are denominated. The rupee view converts "
                    "each period at that period's own average rate - never a "
                    "single fixed rate, which would turn an exchange-rate "
                    "movement into an apparent trade movement. Financial-year "
                    "figures use the financial-year rate and calendar-year "
                    "figures use the calendar-year rate."
                ),
                "source": "config/fx_inr_usd.csv",
                "convention": (
                    "RBI annual average reference rate. Financial-year rates "
                    "come from the Economic Survey Statistical Appendix, Table "
                    "5.4; calendar-year rates are the mean of that year's RBI "
                    "monthly averages."
                ),
                "missingRatePolicy": (
                    "A period with no rate is not converted. It shows dollars "
                    "and says the rate is missing. No interpolation, no "
                    "nearest-year fallback, no carry-forward."
                ),
                "rates": rate_table.published(),
                "coverage": rate_coverage,
            },
        },
    )

    write_json(
        out / "manifest.json",
        {
            "schemaVersion": SCHEMA_VERSION,
            "refreshedAt": utc_now(),

            # A fixture snapshot looks exactly like a real one - that is the
            # point of it - so it says so here and launch_sanity.py refuses to
            # ship anything carrying the mark. Detected from the flag and,
            # independently, from the store it was built out of, because the
            # flag is the thing someone forgets.
            "fixture": bool(args.fixture or "fixture" in str(root or "").lower()),
            "classification": "HS 2022 (H6)",
            "startYear": args.start_year,
            "endYear": args.end_year,
            "analysisStartYear": args.analysis_start_year,
            "months": months,
            "financialYears": sorted(hs8["financialYears"]),
            "registry": dataset_registry.manifest(),
            "tariffLines": {
                "present": hs8["present"],
                "basis": "FY",
                "financialYears": hs8["financialYears"],
            },
            "currency": {
                "base": "USD",
                "display": ["USD", "INR"],
                "applies": ["india", "tariffLines"],
                "rates": rate_table.published(),
                "coverage": rate_coverage,
            },
            "products": sum(1 for _, level in plan if level == 6),
            "parents": {level: len(codes) for level, codes in parents.items()},
            "nodes": len(plan),
            "globalTradeBasis": scope["globalTrade"]["basis"],
            "monthlyEnabled": bool(months),
        },
    )

    print(
        f"Staging snapshot: {len(plan)} nodes "
        f"({sum(1 for _, level in plan if level == 6)} HS-6) -> {out}"
    )

    if months:
        print(f"Monthly periods: {months[0]} .. {months[-1]}")


if __name__ == "__main__":
    main()
