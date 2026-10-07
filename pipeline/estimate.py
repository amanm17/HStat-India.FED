#!/usr/bin/env python3
"""
Estimation for reporter-years nobody filed.

WHY THIS EXISTS, AND WHAT IT IS NOT ALLOWED TO DO

Until now a year whose reporter coverage could not be defended was withheld:
the figure existed in the store, the gate judged the field behind it too thin,
and the page showed a blank. That is honest and it is also unusable - 2,495
node-years INVALID, 317 CAUTION, 76 more withheld only because India herself
filed nothing, and the whole of 1996 with no predecessor to lean on.

The decision taken on 7 October 2026 is to fill those cells by estimation and
mark every one of them, rather than publish nothing. The gate is untouched:
its thresholds still decide VALID / CAUTION / INVALID, and its verdict is still
shown. What changed is the consequence - a verdict now triggers estimation
instead of suppression.

Three rules outrank everything else in this module:

  1. A FILED VALUE ALWAYS WINS. An estimate may only ever occupy a cell no
     country filled. It never overwrites, adjusts, smooths or reconciles a
     reported number, not even one that looks wrong. Comtrade's own revisions
     may move a filed figure; nothing here may.

  2. ESTIMATES ARE NEVER MIXED INTO FILED FIELDS. They are returned as their
     own objects, and the caller is responsible for keeping the two
     distinguishable all the way to the page and the download.

  3. A COUNTRY THAT HAS NEVER FILED A CODE IS NOT ASSUMED TO TRADE IT. That is
     the one refusal. Everything else publishes, marked.

THE UNIT

Estimation happens at reporter country x HS code x flow x year, and the world
total is then re-summed from the reporter table. Scaling an aggregate up to a
notional full-coverage basis would have been far less code and would have left
the Top Importers and Top Exporters tables built on partial data underneath a
complete-looking headline - a table that does not add up to the total printed
above it.

NO CAP, NO FLOOR

Nothing here clamps an estimate to a band, limits how many consecutive years
may be extended, or withholds a figure for being mostly estimated. A long
extrapolation from a short history can produce a number far from its anchor;
that is what the anomaly flag is for (see `flagged`), and the flagged values
still publish. The review queue is a human's job, not an automatic correction.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict

# A reporter whose estimate lands this far from the value it was projected
# from is worth a human's attention. It is a flag, not a veto: the value
# publishes either way, and the monthly resolution report lists it.
ANOMALY_BAND = 0.50

# Observation windows, in years either side of the anchor, tried in order.
# Five is the working window; ten is the fallback for a sparse series that
# cannot produce two usable points inside five.
WINDOWS = (5, 10)


@dataclass(frozen=True)
class Estimate:
    """One estimated (reporter, code, flow, year) cell."""

    value: float
    # cagr5 | cagr10 | cagr-all | flat - which rung of the ladder produced it.
    method: str
    # How many filed observations stood behind it. One means flat.
    observations: int
    # The filed year and value it was projected from.
    anchor_year: int
    anchor_value: float
    # Compound annual growth applied, or None for a flat carry.
    growth: float | None
    # forward from the last filing, or backward into pre-history.
    direction: str
    # Outside ANOMALY_BAND of the anchor. Published, and reported.
    flagged: bool

    def as_dict(self) -> dict:
        return asdict(self)


def cagr(start_year: int, start_value: float, end_year: int, end_value: float):
    """
    Compound annual growth between two filed observations.

    Returns None where the pair cannot support one: a zero or negative
    endpoint has no ratio, and two observations in the same year have no
    span. Both are ordinary in this data - a reporter files 0 for a line it
    stopped trading - so they are refusals rather than errors, and the caller
    widens its window and tries again.
    """
    span = end_year - start_year

    if span <= 0:
        return None

    if start_value <= 0 or end_value <= 0:
        return None

    return (end_value / start_value) ** (1.0 / span) - 1.0


def _anchor(years: list[int], target: int) -> tuple[int, str]:
    """
    The filed year an estimate is projected from, and which way it runs.

    Forward from the most recent filing at or before the target; where the
    target sits before everything filed, backward from the earliest. A gap
    between two filings is projected forward from the one below it, which
    keeps a run of missing years monotonic with the series it came from
    rather than meeting in the middle at a seam.
    """
    before = [year for year in years if year < target]

    if before:
        return max(before), "forward"

    return min(years), "backward"


def _window(years: list[int], anchor: int, span: int, direction: str) -> list[int]:
    """
    The filed years inside `span` of the anchor, on the side the projection
    runs from. A forward projection learns from the years leading up to the
    anchor; a backward one learns from the years after it.
    """
    if direction == "forward":
        return [y for y in years if anchor - span <= y <= anchor]

    return [y for y in years if anchor <= y <= anchor + span]


def estimate_for(history: dict[int, float], target: int) -> Estimate | None:
    """
    Estimate one reporter's value for one year from that reporter's own
    history of the same code and flow.

    `history` holds filed values only, keyed by year. A target already in it
    is never estimated - rule 1 - and an empty history is the refusal in
    rule 3.
    """
    if not history or target in history:
        return None

    years = sorted(history)

    anchor_year, direction = _anchor(years, target)
    anchor_value = history[anchor_year]

    growth = None
    method = "flat"
    used = 1

    # The ladder: five years, then ten, then whatever the series has. Each
    # rung needs two usable points; a window that cannot produce a ratio
    # widens rather than guessing.
    for span, name in zip(WINDOWS, ("cagr5", "cagr10")):
        inside = _window(years, anchor_year, span, direction)

        if len(inside) < 2:
            continue

        first, last = min(inside), max(inside)

        rate = cagr(first, history[first], last, history[last])

        if rate is None:
            continue

        growth, method, used = rate, name, len(inside)
        break

    if growth is None and len(years) >= 2:
        # Rule 3 of the method: two observations or fewer still estimate from
        # whatever CAGR they support. This also catches a series whose five-
        # and ten-year windows both held an unusable endpoint.
        rate = cagr(years[0], history[years[0]], years[-1], history[years[-1]])

        if rate is not None:
            growth, method, used = rate, "cagr-all", len(years)

    # A rate of exactly -100% is reachable in floating point when a series
    # collapses by eighteen orders of magnitude: 1e-18 - 1 rounds to -1.0.
    # Forward that would publish a flat zero, which is arguable; backward it
    # raises 0 to a negative power and the run dies. Neither is worth the
    # fidelity, so a degenerate rate falls back to the flat carry.
    if growth is not None and 1.0 + growth <= 0:
        growth, method, used = None, "flat", 1

    if growth is None:
        # One observation, or none of the windows could produce a rate. Hold
        # the anchor flat: it is the only defensible reading of a series with
        # no slope to read.
        value = anchor_value
    else:
        value = anchor_value * ((1.0 + growth) ** (target - anchor_year))

    # A projection can only be as positive as its anchor. Negative output
    # would mean the arithmetic ran away, not that a country traded less than
    # nothing, so it is refused rather than published.
    if value < 0 or value != value or value in (float("inf"), float("-inf")):
        return None

    flagged = (
        anchor_value > 0 and abs(value / anchor_value - 1.0) > ANOMALY_BAND
    )

    return Estimate(
        value=value,
        method=method,
        observations=used,
        anchor_year=anchor_year,
        anchor_value=anchor_value,
        growth=growth,
        direction=direction,
        flagged=flagged,
    )


def reporter_histories(tables: dict[str, dict]) -> tuple[dict, dict]:
    """
    Turn {period: {reporter: (name, value)}} into one filed series per
    reporter, plus the reporter names.

    Only annual periods belong here. Months are not estimated: a monthly
    series is short, seasonal and revised, and a CAGR over six of them would
    be arithmetic rather than evidence.
    """
    histories: dict[str, dict[int, float]] = {}
    names: dict[str, str] = {}

    for period, table in tables.items():
        try:
            year = int(period)
        except (TypeError, ValueError):
            continue

        for reporter, entry in (table or {}).items():
            name, value = entry

            if value is None:
                continue

            names.setdefault(reporter, name)
            histories.setdefault(reporter, {})[year] = float(value)

    return histories, names


def first_filed_year(tables: dict[str, dict]) -> int | None:
    """
    The earliest year any reporter anywhere filed this code.

    This is the floor for backward extrapolation, and it is the difference
    between an estimate and an artifact.

    HS 2022 created 851713 and 851714 out of 851712. Asked for 1996, the
    ladder did exactly what it was told: it took the only window it had -
    four observations from 2022 on - and ran that growth rate back twenty-six
    years. The arithmetic is correct and the answer was seventeen quintillion
    dollars, about seven orders of magnitude above world GDP, because a code
    that did not exist cannot have a trend through years it did not exist in.

    Rule 3 of the method already refuses this at reporter level: a country
    that has never filed a line is not assumed to trade it. A line nobody
    anywhere has ever filed is the same refusal one level up. Those years
    belong to the predecessor code and are carried in from it, marked, which
    is what the retired-code rule is for.

    This is a refusal, not a cap: no value is clamped to a band, and no
    estimate inside the code's own lifetime is limited in any way.
    """
    years = [
        int(period)
        for period, table in tables.items()
        if table and str(period).isdigit()
    ]

    return min(years) if years else None


def fill(tables: dict[str, dict], periods) -> dict[str, dict[str, Estimate]]:
    """
    Every estimate for one code and one flow, keyed by period then reporter.

    A reporter is considered for a year only if it filed this code in some
    other year - rule 3 - and no year before the code itself was ever filed
    is estimated at all; see `first_filed_year`.
    """
    histories, _ = reporter_histories(tables)

    if not histories:
        return {}

    floor = first_filed_year(tables)

    out: dict[str, dict[str, Estimate]] = {}

    for period in periods:
        try:
            year = int(period)
        except (TypeError, ValueError):
            continue

        if floor is not None and year < floor:
            continue

        filled: dict[str, Estimate] = {}

        for reporter, history in histories.items():
            estimate = estimate_for(history, year)

            if estimate is not None:
                filled[reporter] = estimate

        if filled:
            out[str(period)] = filled

    return out


def merge(
    filed: dict,
    estimates: dict[str, Estimate],
    names: dict,
    reverse: dict | None = None,
    published_total: float | None = None,
) -> tuple[dict, dict]:
    """
    Lay estimates into a filed reporter table without disturbing it.

    Returns the merged table in the shape `globaltrade.compute` expects, and
    the arithmetic the page and the workbook need to say how much of the
    resulting total was estimated. A filed reporter is copied through
    untouched; the assertion below is rule 1 written as code, because this is
    the one function where breaking it would be silent.

    NET, NOT GROSS

    `reverse` is the re-import (or re-export) table, and `published_total` the
    figure that will actually appear on the page. Both matter because the
    published total is net of re-imports while an estimate is gross, so a
    share taken before netting describes a number nobody is shown.

    It is a small error - a fraction of a percent - and it was found by
    verify_filed.py reconciling the published figure against the raw store,
    which is exactly the job that check exists to do. Omitting both arguments
    gives the gross reading, which is right when there is nothing to net.
    """
    merged = dict(filed or {})

    estimated_value = 0.0
    flagged = 0

    for reporter, estimate in (estimates or {}).items():
        assert reporter not in merged, (
            f"estimate would overwrite a filed value for reporter {reporter}"
        )

        merged[reporter] = (names.get(reporter, reporter), estimate.value)

        # The same netting globaltrade.net_by_reporter applies, including its
        # refusal to manufacture a negative out of an inconsistent filing.
        back = (reverse or {}).get(reporter)

        net = estimate.value

        if back is not None and back[1] <= estimate.value:
            net = estimate.value - back[1]

        estimated_value += net

        if estimate.flagged:
            flagged += 1

    total = published_total

    if total is None:
        total = sum(value for _, value in merged.values()) if merged else 0.0

    return merged, {
        "estimatedReporters": len(estimates or {}),
        "filedReporters": len(filed or {}),
        "estimatedValue": estimated_value,
        "estimatedShare": (estimated_value / total) if total and total > 0 else None,
        "flaggedReporters": flagged,
    }
