"""
One global trade number per HS code and period.

The dashboard used to show reported global imports and reported global
exports side by side. Those two figures measure the same trade from
opposite ends and never agree, which reads to a user as an error rather
than as a property of mirror statistics.

HStat now publishes a single figure:

    global trade = sum over reporting economies of
                   (imports from World - re-imports)

Valuation is CIF, matching how import-substitution and PLI analysis is
normally framed. Total imports as filed already contain re-imports
(M = FM + RM + MIP + MOP), so goods that left a country and came back are
counted twice unless RM is removed. Not every reporter files RM
separately, so `adjustmentCoverage` records the share of the world total
that came from reporters who did, and the export side, net of re-exports,
is carried as a mirror check with a published gap.

Reporter tables arrive here as {reporterCode: (name, value)} dictionaries
rather than DataFrames — see store.py for why.
"""

from __future__ import annotations

from common import round_ratio, round_usd

INDIA = "699"


def net_by_reporter(gross: dict, reverse: dict) -> dict:
    """
    Subtract a reverse flow (RM from M, or RX from X) reporter by reporter.

    Returns the netted reporter table plus the diagnostics needed to say
    honestly how much of the total could actually be adjusted.
    """
    if not gross:
        return {
            "rows": [],
            "grossTotal": None,
            "removed": 0.0,
            "adjustmentCoverage": None,
            "adjustedReporters": 0,
            "reporters": 0,
            "clamped": [],
        }

    rows: list[tuple[str, str, float]] = []

    gross_total = 0.0
    adjusted_gross = 0.0
    adjusted_reporters = 0
    removed = 0.0
    clamped: list[str] = []

    for reporter, (name, value) in gross.items():
        gross_total += value

        entry = reverse.get(reporter)

        if entry is None:
            rows.append((reporter, name, value))
            continue

        adjusted_reporters += 1
        adjusted_gross += value

        reverse_value = entry[1]

        if reverse_value > value:
            # A reverse flow larger than the total it belongs to means the
            # reporter filed inconsistent sub-flows. Refuse the adjustment
            # rather than manufacture a negative.
            clamped.append(reporter)
            rows.append((reporter, name, value))
            continue

        removed += reverse_value

        rows.append((reporter, name, value - reverse_value))

    rows.sort(key=lambda item: -item[2])

    return {
        "rows": rows,
        "grossTotal": gross_total,
        "removed": removed,
        "adjustmentCoverage": (
            adjusted_gross / gross_total if gross_total > 0 else None
        ),
        "adjustedReporters": adjusted_reporters,
        "reporters": len(gross),
        "clamped": clamped,
    }


def rank_economies(rows: list[tuple[str, str, float]], top: int = 10):
    """
    Total, per-economy shares and India's position on a netted table.

    Only the top `top` economies are materialised as records. India gets
    one too, wherever it lands.
    """
    if not rows:
        return None

    total = sum(value for _, _, value in rows)

    if total <= 0:
        return None

    def record(position: int, row) -> dict:
        code, name, value = row

        return {
            "rank": position,
            "code": code,
            "name": name,
            "value": round_usd(value),
            "share": round_ratio(value / total),
        }

    ranked = [
        record(position, row)
        for position, row in enumerate(rows[:top], start=1)
    ]

    india = next((row for row in ranked if row["code"] == INDIA), None)

    if india is None:
        for position, row in enumerate(rows, start=1):
            if row[0] == INDIA:
                india = record(position, row)
                break

    return {
        "total": total,
        "india": india,
        "top": ranked,
        "reporterCount": len(rows),
    }


def mirror_gap(import_total, export_total):
    """
    Signed gap between the two sides, expressed against the export side.

    Positive means the import (CIF) side is larger, which is the normal
    direction because CIF includes freight and insurance that FOB excludes.
    """
    if not import_total or not export_total or export_total <= 0:
        return None

    return round_ratio(import_total / export_total - 1.0, 4)


def mirror_status(ratio, bounds) -> str:
    if ratio is None:
        return "UNAVAILABLE"

    low, high = bounds

    return "OK" if low <= ratio <= high else "WARNING"


def compute(
    imports: dict,
    re_imports: dict,
    exports: dict,
    re_exports: dict,
    *,
    mirror_bounds=(0.70, 1.50),
    top: int = 10,
) -> dict:
    """
    Everything the snapshot needs about one HS code in one period.

    Nothing here decides whether the numbers may be published; that stays
    with the reporter-coverage engine in coverage.py.
    """
    import_side = net_by_reporter(imports, re_imports)
    export_side = net_by_reporter(exports, re_exports)

    import_rank = rank_economies(import_side["rows"], top=top)
    export_rank = rank_economies(export_side["rows"], top=top)

    net_imports = import_rank["total"] if import_rank else None
    net_exports = export_rank["total"] if export_rank else None

    ratio = (
        net_imports / net_exports
        if net_imports and net_exports and net_exports > 0
        else None
    )

    return {
        "importSide": import_side,
        "exportSide": export_side,
        "importRank": import_rank,
        "exportRank": export_rank,
        "netImports": net_imports,
        "netExports": net_exports,
        "grossImports": import_side["grossTotal"],
        "grossExports": export_side["grossTotal"],
        "reImportsRemoved": import_side["removed"],
        "reExportsRemoved": export_side["removed"],
        "adjustmentCoverage": import_side["adjustmentCoverage"],
        "exportAdjustmentCoverage": export_side["adjustmentCoverage"],
        "mirrorRatio": round_ratio(ratio, 4) if ratio else None,
        "mirrorGap": mirror_gap(net_imports, net_exports),
        "mirrorStatus": mirror_status(ratio, mirror_bounds),
        "clamped": import_side["clamped"] + export_side["clamped"],
    }
