"""
Decide whether a period's global figures may be published at all.

Comtrade is a rolling collection: a recent year contains whichever
economies have filed so far. Summing that as though it were the world
understates the total, and the shortfall moves around from month to month,
so a dashboard that publishes it looks like it is reporting a collapse in
trade when it is only reporting late paperwork.

The test is comparative: does this period still contain the economies that
mattered in the period before it?

VALID
  - the previous period's largest reporter is present
  - at least 9 of the previous top 10 are present
  - at least 95% of the previous top-20 value is retained
  - reporter count is at least 80% of the previous period

CAUTION
  - largest reporter present, at least 8 of the previous top 10
  - at least 90% of previous top-20 value, count at least 75%

Anything else is INVALID. Only VALID periods carry a headline, a rank or
a share.

Reporter tables are {reporterCode: (name, value)} dictionaries.
"""

from __future__ import annotations


def _ordered(table: dict) -> list[tuple[str, str, float]]:
    rows = [
        (code, name, value)
        for code, (name, value) in table.items()
        if value is not None and value == value and value >= 0
    ]

    rows.sort(key=lambda item: -item[2])

    return rows


def assess_coverage(candidate: dict | None, previous: dict | None) -> dict:
    if candidate is None or previous is None:
        return {"status": "INVALID", "reason": "missing comparison period"}

    if not candidate or not previous:
        return {"status": "INVALID", "reason": "empty comparison period"}

    current = _ordered(candidate)
    prior = _ordered(previous)

    if not current or not prior:
        return {"status": "INVALID", "reason": "no usable reporter values"}

    current_codes = {code for code, _, _ in current}

    count_ratio = len(current) / len(prior)

    prior_top10 = prior[:10]
    prior_top20 = prior[:20]

    top1_present = prior[0][0] in current_codes

    top10_present = sum(
        1 for code, _, _ in prior_top10 if code in current_codes
    )

    top20_total = sum(value for _, _, value in prior_top20)

    top20_retained = sum(
        value
        for code, _, value in prior_top20
        if code in current_codes
    )

    top20_value_coverage = (
        top20_retained / top20_total if top20_total > 0 else 0.0
    )

    valid = (
        top1_present
        and top10_present >= 9
        and top20_value_coverage >= 0.95
        and count_ratio >= 0.80
    )

    caution = (
        top1_present
        and top10_present >= 8
        and top20_value_coverage >= 0.90
        and count_ratio >= 0.75
    )

    if valid:
        status = "VALID"
    elif caution:
        status = "CAUTION"
    else:
        status = "INVALID"

    return {
        "status": status,
        "candidateReporters": len(current),
        "previousReporters": len(prior),
        "reporterCountRatio": round(count_ratio, 4),
        "priorTop1Present": bool(top1_present),
        "priorTop10Present": int(top10_present),
        "priorTop20ValueCoverage": round(top20_value_coverage, 4),
        "missingPriorTop10": [
            {"reporterCode": code, "reporterDesc": name, "primaryValue": value}
            for code, name, value in prior_top10
            if code not in current_codes
        ],
    }
