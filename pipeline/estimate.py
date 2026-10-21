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

BOUNDED GROWTH - A DELIBERATE DEPARTURE FROM "NO CAP"

The method as written said nothing here clamps an estimate or limits how far
a series may be extended. It met real Comtrade data on 7 October and
published laptops' 2025 world trade as $1.19e28.

A reporter whose filed value jumps by orders of magnitude inside a five-year
window - a unit error, a first-year partial filing, a reclassification -
yields a compound growth rate in the thousands of percent, and compounding
that over the years a projection spans reached x2.2e137 for one cell
(Bangladesh, 850990 exports). One such cell outweighs every filed value in
the world total, so the median published product-year came out 98.8%
estimated. The arithmetic was faithful and the result was not a number.

Two bounds, chosen on 7 October:

  MAX_GROWTH    the rate applied is held within +/-50% a year, whatever the
                series' own slope. A steeper slope is still read - its sign
                and the fact it was steep - but not compounded at face value.
  MAX_HORIZON   growth is applied for at most three years from the filing
                it projects from. Beyond that the value holds where the third
                year left it. No estimate is ever more than 1.5^3 = 3.375x,
                or less than 0.5^3 = 0.125x, the filing behind it.

RECENCY - a country is estimated only near its own filings

The bounded run of 7 October was sane and still wrong in one way. A country
that stopped filing a line in 2010 was carried flat into every year since,
because "held flat beyond three years" never ended. For a collapsing
product that is a resurrection: CRT tubes (854011) came out 95% estimated
in 2025, at 22 times the filed total, and India's rank fell from 21st to
43rd behind countries that had not traded CRTs in a decade.

So a reporter is estimated for a year only when it filed the same line
within MAX_GAP years of it, on either side. That keeps what estimation is
for - a late filer's missing 2025, a one-year hole in a series - and
refuses what it is not: inventing trade for a country that has stopped.
With MAX_GAP equal to MAX_HORIZON, no estimate is ever a flat hold.

ONLY A YEAR NOBODY FILED - added 21 October 2026

A reporter is estimated only for a year in which it filed nothing at all in
that flow. A country that filed the year has answered for every code in it:
a code it left out is a zero, a suppression, or trade it classified under
another number. Projecting one anyway counted the same goods twice. A check
of Viet Nam against its own reported figures found $20bn of 2022 exports
counted twice this way, because Viet Nam filed 2022 flat-panel modules under
851779 while the engine also projected 852492 back from 2023; across all
reporters the doubles came to $30bn of exports in 2022 and $128bn in 2021.
`fill` takes the set of reporters that filed each year (`filers`) and skips
them.

GROWTH FROM THE FIELD, NOT ONLY THE COUNTRY - added 21 October 2026

A country's own five-year rate is a poor guide to its next year: it carries
every reclassification and one-off in the window, and a hold-out test on
about 91,000 filed reporter-code cells (hide 2024 and 2025, re-estimate,
compare) put its error above simply holding the last value flat. The growth
the rest of the field filed for the same code and years does better.

So where a growth signal is available the estimate blends the two:
W_OWN of the country's own capped rate and the rest from the signal, in
log terms. The signal is

  mirror   what partners report trading with this country, where that has
           been pulled (late filers only; see config/scope.json "mirror")
  peer     the growth of every reporter that filed both the anchor year and
           the target year

The combined ratio keeps the same bounds as before: never beyond
(1 +/- MAX_GROWTH) a year, for at most MAX_HORIZON years. Hold-out error,
one year ahead: 18.1% (own rate) to 13.9% (blend), bias 0.0% to -0.4%; two
years ahead: 30.8% to 22.6%, bias -5.6% to -2.7%.
`pipeline/backtest_estimates.py` reruns the test.

CALIBRATION - added 21 October 2026, three layers from 22 October

The figures come in three layers, and an upper layer never overrides a lower
one:

  1. Comtrade filings. The truth. Never changed by anything below.
  2. HStat's estimates, for what nobody has filed (this module).
  3. A reference check. A person reads an economy's reported totals in a
     reference source (ITC Trade Map, or the economy's own statistics) for
     the years HStat estimates. Where HStat's estimate is further from the
     reference than the tolerance, the estimates are realigned by one factor
     for that economy, flow, year and, optionally, HS chapter or heading.
     The reference figure is never published or stored as data; only the
     factor is, in config/estimate_calibration.json, with its source.

A factor only ever scales estimates; a filed value is never touched (rule 1),
and it travels on the estimate (`calibration`) so the page can say so.

Still no floor on what publishes: an estimate is never withheld for being
far from its anchor or for being most of a total. An estimate whose rate was
held back by MAX_GROWTH is flagged for review, as is one that lands outside
the anomaly band; both publish.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict, replace

# A reporter whose estimate lands this far from the value it was projected
# from is worth a human's attention. It is a flag, not a veto: the value
# publishes either way, and the monthly resolution report lists it.
ANOMALY_BAND = 0.50

# Observation windows, in years either side of the anchor, tried in order.
# Five is the working window; ten is the fallback for a sparse series that
# cannot produce two usable points inside five.
WINDOWS = (5, 10)

# See BOUNDED GROWTH in the module docstring.
MAX_GROWTH = 0.50
MAX_HORIZON = 3

# See RECENCY in the module docstring.
MAX_GAP = 3

# See GROWTH FROM THE FIELD. The share of the country's own rate in a blended
# estimate; the rest is the mirror or peer signal.
W_OWN = 0.25


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
    # Outside ANOMALY_BAND of the anchor, or its rate was held back by
    # MAX_GROWTH. Published, and reported.
    flagged: bool
    # The series' own rate, before MAX_GROWTH; equal to `growth` unless held.
    raw_growth: float | None = None
    # True when MAX_GROWTH held the rate back.
    capped: bool = False
    # Which growth signal was blended in: "peer", "mirror" or None.
    signal: str | None = None
    # A calibration factor applied after projection, and where it came from.
    calibration: float | None = None
    calibration_source: str | None = None

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


def estimate_for(history: dict[int, float], target: int, signal=None) -> Estimate | None:
    """
    Estimate one reporter's value for one year from that reporter's own
    history of the same code and flow.

    `history` holds filed values only, keyed by year. A target already in it
    is never estimated - rule 1 - and an empty history is the refusal in
    rule 3.

    `signal`, when given, is a function (anchor_year, target) -> (ratio,
    kind) or None: the growth the field (kind "peer") or the country's
    partners (kind "mirror") recorded between those two years. It is blended
    with the country's own rate; see GROWTH FROM THE FIELD.
    """
    if not history or target in history:
        return None

    years = sorted(history)

    # Recency: only a country that filed this line near the target year.
    if min(abs(year - target) for year in years) > MAX_GAP:
        return None

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

    raw_growth = growth
    capped = False

    if growth is not None and abs(growth) > MAX_GROWTH:
        growth = MAX_GROWTH if growth > 0 else -MAX_GROWTH
        capped = True

    distance = target - anchor_year
    steps = min(abs(distance), MAX_HORIZON)

    if growth is None:
        # One observation, or none of the windows could produce a rate. Hold
        # the anchor flat: it is the only defensible reading of a series with
        # no slope to read.
        own_ratio = 1.0
    else:
        own_ratio = (1.0 + growth) ** (steps if distance > 0 else -steps)

    ratio = own_ratio
    used_signal = None

    found = signal(anchor_year, target) if signal is not None else None

    if found is not None:
        signal_ratio, kind = found

        if signal_ratio is not None and signal_ratio > 0 and own_ratio > 0:
            ratio = math.exp(
                W_OWN * math.log(own_ratio) + (1.0 - W_OWN) * math.log(signal_ratio)
            )
            # The blend keeps the bounds the own rate always had.
            low, high = (1.0 - MAX_GROWTH) ** steps, (1.0 + MAX_GROWTH) ** steps
            if ratio < low or ratio > high:
                ratio = min(max(ratio, low), high)
                capped = True
            used_signal = kind
            method = f"blend-{kind}"
            if steps:
                growth = ratio ** (1.0 / steps if distance > 0 else -1.0 / steps) - 1.0

    value = anchor_value * ratio

    # A projection can only be as positive as its anchor. Negative output
    # would mean the arithmetic ran away, not that a country traded less than
    # nothing, so it is refused rather than published.
    if value < 0 or value != value or value in (float("inf"), float("-inf")):
        return None

    flagged = capped or (
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
        raw_growth=raw_growth,
        capped=capped,
        signal=used_signal,
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


def last_filed_year(tables: dict[str, dict]) -> int | None:
    """
    The latest year any reporter anywhere filed this code.

    The ceiling for forward projection, and the floor's twin.

    A year nobody has filed is not a gap in anyone's series - it is a year
    that has not been reported yet. In October 2026 not one economy has filed
    annual 2026 data for anything, because the year is not over. Without this
    the ladder projected every reporter forward from 2025 and published a
    complete-looking 2026 world total with no filing anywhere beneath it:
    for laptops, $171bn of nothing.

    Once a single economy files the year, it is a year with a field, and the
    rest of the field is estimated and marked like any other - that is the
    method working as intended, with the estimated share saying how much.

    A refusal, not a cap: nothing inside the filed range is limited.
    """
    years = [
        int(period)
        for period, table in tables.items()
        if table and str(period).isdigit()
    ]

    return max(years) if years else None


def peer_ratios(histories: dict[str, dict[int, float]]):
    """
    A signal function: the growth every reporter that filed both years
    recorded between them, summed. The reporter being estimated never filed
    the target year, so it is never among its own peers.
    """
    cache: dict[tuple[int, int], float | None] = {}

    def signal(anchor: int, target: int):
        key = (anchor, target)
        if key not in cache:
            before = after = 0.0
            for history in histories.values():
                if anchor in history and target in history:
                    before += history[anchor]
                    after += history[target]
            cache[key] = after / before if before > 0 and after > 0 else None
        ratio = cache[key]
        return (ratio, "peer") if ratio is not None else None

    return signal


def mirror_ratio(series: dict[int, float] | None):
    """
    A signal function from a mirror series: what partners reported trading
    with this reporter, by year. None where the series lacks either year.
    """
    if not series:
        return None

    def total(value) -> float:
        return sum(value.values()) if isinstance(value, dict) else float(value or 0)

    def signal(anchor: int, target: int):
        before, after = series.get(anchor), series.get(target)
        if not before or not after:
            return None
        if isinstance(before, dict) and isinstance(after, dict):
            # Only partners that filed both years: a partner yet to file the
            # target year would read as a fall in trade.
            common = set(before) & set(after)
            before = {k: before[k] for k in common}
            after = {k: after[k] for k in common}
        b, a = total(before), total(after)
        if b > 0 and a > 0:
            return a / b, "mirror"
        return None

    return signal


def fill(
    tables: dict[str, dict],
    periods,
    filers: dict | None = None,
    mirror: dict | None = None,
    calibration: dict | None = None,
    blend: bool = True,
) -> dict[str, dict[str, Estimate]]:
    """
    Every estimate for one code and one flow, keyed by period then reporter.

    A reporter is considered for a year only if it filed this code in some
    other year - rule 3 - and no year outside the span in which anyone filed
    the code at all is estimated; see `first_filed_year` and
    `last_filed_year`.

    `filers` maps a year to the reporters that filed anything at all in this
    flow that year; they are never estimated for it (ONLY A YEAR NOBODY
    FILED). `mirror` maps a reporter to its mirror series for this code and
    flow, preferred over the peer signal. `calibration` maps (reporter, year)
    to (factor, source). `blend=False` gives the country's own rate alone.
    """
    histories, _ = reporter_histories(tables)

    if not histories:
        return {}

    floor = first_filed_year(tables)
    ceiling = last_filed_year(tables)
    peers = peer_ratios(histories) if blend else None

    out: dict[str, dict[str, Estimate]] = {}

    for period in periods:
        try:
            year = int(period)
        except (TypeError, ValueError):
            continue

        if floor is not None and year < floor:
            continue

        if ceiling is not None and year > ceiling:
            continue

        answered = set()
        if filers:
            answered = filers.get(year) or filers.get(str(year)) or set()

        filled: dict[str, Estimate] = {}

        for reporter, history in histories.items():
            if reporter in answered:
                continue

            signal = None
            if blend:
                signal = mirror_ratio((mirror or {}).get(reporter)) or peers
                if signal is not peers:
                    own_mirror, peer_signal = signal, peers
                    signal = (lambda a, t, m=own_mirror, p=peer_signal: m(a, t) or p(a, t))

            estimate = estimate_for(history, year, signal)

            if estimate is None:
                continue

            factor = (calibration or {}).get((reporter, year))
            if factor:
                scale, source = factor
                estimate = replace(
                    estimate,
                    value=estimate.value * scale,
                    calibration=scale,
                    calibration_source=source,
                )

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
    calibrated = 0
    calibrated_value = 0.0

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

        if estimate.calibration:
            calibrated += 1
            calibrated_value += net

    total = published_total

    if total is None:
        total = sum(value for _, value in merged.values()) if merged else 0.0

    return merged, {
        "estimatedReporters": len(estimates or {}),
        "filedReporters": len(filed or {}),
        "estimatedValue": estimated_value,
        "estimatedShare": (estimated_value / total) if total and total > 0 else None,
        "flaggedReporters": flagged,
        # Estimates realigned to a reference benchmark (CALIBRATION).
        "calibratedReporters": calibrated,
        "calibratedValue": calibrated_value,
    }
