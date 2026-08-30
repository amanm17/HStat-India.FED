"""
Pull every flow HStat needs from UN Comtrade into a resumable raw store.

Two things make this different from a single big request:

1.  Four flows, not two. Global trade is published net of re-imports, so
    RM is pulled alongside M, and RX alongside X for the mirror check.

2.  A cached, checkpointed store. 549 codes across annual and monthly
    frequencies is far more API traffic than a quota comfortably allows
    every month. Each (frequency, scope, flow, period-group, code-chunk)
    lands in its own parquet and is recorded in an index; an incremental
    run re-pulls only the periods that can still change.

Inspect the plan before spending quota:

    python pipeline/pull_comtrade.py --dry-run
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import argparse
import hashlib
import json
import sys
import time

import pandas as pd

from common import (
    FLOW_EXPORTS,
    FLOW_IMPORTS,
    FLOW_RE_EXPORTS,
    FLOW_RE_IMPORTS,
    INDIA_REPORTER,
    RAW_STORE,
    WORLD_PARTNER,
    CALL_LOG,
    annual_periods,
    api_key,
    assert_unique,
    chunked,
    filter_classic,
    monthly_periods,
    require_trade_frame,
    utc_now,
    with_retry,
    write_json,
)
from definition import load_scope, pull_universe

# Comtrade's limits differ by subscription and the published figures do not
# agree with each other, so they live in config/scope.json under "api" and
# `--probe` measures the real ones against the key in use.
#
#   free (basic individual)  500 calls/day, 100K records/call, 1 call/sec
#   premium individual      5000 calls/day, 250K records/call, 5 calls/sec
#
# Getting the record cap wrong is not a slow build, it is silent data loss:
# a response truncated at the cap looks like a complete answer.
API_DEFAULTS = {
    "tier": "free",
    "maxRecordsPerCall": 100_000,
    "targetRowsPerCall": 55_000,
    "callsPerDay": 500,
    "minSecondsBetweenCalls": 1.1,

    # Ask for the aggregate row only.
    #
    # Comtrade will otherwise return the second-partner, customs-procedure and
    # mode-of-transport breakdowns *alongside* the aggregate. common.filter_classic
    # drops them on the way in, so the totals were never wrong - but every one of
    # those rows still counted against the 100,000-record cap we are paying calls
    # to stay under. Pinning them at the request means the rows are never sent.
    #
    #   partner2Code 0    World: all second partners as one
    #   customsCode  C00  TOTAL customs procedure
    #   motCode      0    TOTAL modes of transport
    #
    # Changing any of these off the aggregate would make the stored rows
    # non-additive, and the world totals built from them meaningless.
    "aggregates": {
        "partner2Code": "0",
        "customsCode": "C00",
        "motCode": "0",
    },
}

# Below this a response is comfortably inside the record cap; at or above it
# the chunk is refused rather than stored, because it may be truncated.
CAP_WARNING_RATIO = 0.95

# Rows a request returns are roughly codes x periods x reporting economies.
ROWS_PER_ECONOMY = 220

INDEX_PATH = RAW_STORE / "index.json"

# Exit code meaning "the pull is fine but unfinished": the call budget ran
# out with work still queued. The store is consistent, just short, so the
# caller must build from it without promoting.
EXIT_INCOMPLETE = 3


SCOPES = {
    # scope    reporter          partner
    "global": (None, WORLD_PARTNER),
    "india": (INDIA_REPORTER, None),
}

# The global scope carries all four flows: the headline is net of
# re-imports and the mirror check needs the export side net of re-exports.
#
# The India scope is only ever read for its bilateral partner breakdown.
# India's own netted world totals come from its row inside the global
# reporter frame, and re-imports are not filed by partner anyway, so
# pulling RM/RX at partner level would spend a third of the India quota on
# rows nothing reads.
SCOPE_FLOWS = {
    "global": [FLOW_IMPORTS, FLOW_RE_IMPORTS, FLOW_EXPORTS, FLOW_RE_EXPORTS],
    "india": [FLOW_IMPORTS, FLOW_EXPORTS],
}


class Job:
    __slots__ = ("freq", "scope", "flow", "periods", "codes", "chunk")

    def __init__(self, freq, scope, flow, periods, codes, chunk):
        self.freq = freq
        self.scope = scope
        self.flow = flow
        self.periods = periods
        self.codes = codes
        self.chunk = chunk

    @property
    def period_group(self) -> str:
        return f"{self.periods[0]}-{self.periods[-1]}"

    @property
    def key(self) -> str:
        return (
            f"{self.freq}/{self.scope}/{self.flow}/"
            f"{self.period_group}/{self.chunk:02d}"
        )

    @property
    def path(self) -> Path:
        return (
            RAW_STORE
            / self.freq
            / self.scope
            / self.flow
            / f"{self.period_group}__{self.chunk:02d}.parquet"
        )

    @property
    def codes_hash(self) -> str:
        return hashlib.sha1(
            ",".join(self.codes).encode("utf-8")
        ).hexdigest()[:12]

    def __repr__(self) -> str:
        return f"<Job {self.key} codes={len(self.codes)}>"


def load_index() -> dict:
    if INDEX_PATH.exists():
        try:
            return json.loads(INDEX_PATH.read_text())
        except json.JSONDecodeError:
            print("Raw store index unreadable; treating store as empty.")

    return {}


def save_index(index: dict) -> None:
    write_json(INDEX_PATH, index)


def group_periods(periods, volatile: set[str], per_call: int):
    """
    Split periods into request groups.

    Periods Comtrade can still revise get a group each, so a monthly refresh
    re-pulls only those. Settled periods are batched, because they are fetched
    once and then served from the store forever. Batching the two together
    would mean one revisable year forcing a re-pull of the entire history
    alongside it.

    Annual groups are aligned to fixed calendar buckets — 1990-1999, 2000-2009,
    2010-2019 at the default width — rather than cut sequentially from
    whichever year the scope happens to start at. That alignment is what makes
    a stored chunk survive a change of scope.

    Cutting sequentially looked identical and was quietly expensive: a store
    built from 2015 held groups `2015-2024` and `2025-2026`, and moving
    `historyStartYear` back to 1996 re-cut them into `1996-2005`, `2006-2015`
    and `2016-2025`. Different keys, so 162 of 190 already-paid-for chunks
    were re-fetched to obtain data the store already had. Aligned buckets add
    the earlier decades and leave the later ones alone.
    """
    settled = [period for period in periods if period not in volatile]

    annual = [period for period in settled if len(str(period)) == 4]

    monthly = [period for period in settled if len(str(period)) != 4]

    buckets: dict[int, list] = {}

    for period in annual:
        anchor = (int(period) // per_call) * per_call

        buckets.setdefault(anchor, []).append(period)

    groups = [buckets[anchor] for anchor in sorted(buckets)]

    # Monthly periods are nearly all volatile and are re-cut every month
    # anyway, so sequential chunking is right for them.
    groups.extend(group for group in chunked(monthly, per_call) if group)

    groups.extend([period] for period in periods if period in volatile)

    return groups


def api_limits(scope_config: dict) -> dict:
    limits = dict(API_DEFAULTS)

    limits.update(scope_config.get("api", {}) or {})

    return limits


def codes_per_call(
    periods: int,
    total_codes: int,
    override,
    target_rows: int,
) -> int:
    """How many HS codes one request can carry for a group of this length."""
    if override:
        return int(override)

    estimate = target_rows // max(periods * ROWS_PER_ECONOMY, 1)

    return max(1, min(total_codes, estimate))


def build_jobs(args, scope_config, volatile: set[str]) -> list[Job]:
    codes = pull_universe()

    limits = api_limits(scope_config)

    target_rows = int(limits["targetRowsPerCall"])

    override = args.chunk_size or scope_config.get("pullChunkSize")

    jobs: list[Job] = []

    monthly_scopes = set(
        args.monthly_scopes.split(",")
        if getattr(args, "monthly_scopes", None)
        else scope_config["monthly"].get("scopes", ["india", "global"])
    )

    def add(freq: str, groups):
        for group in groups:
            chunk_size = codes_per_call(
                len(group),
                len(codes),
                override,
                target_rows,
            )

            code_chunks = chunked(codes, chunk_size)

            for scope, flows in SCOPE_FLOWS.items():
                # Monthly global data is the single largest recurring cost
                # and the least useful: most reporters file late, so those
                # periods fail coverage and publish nothing anyway.
                if freq == "M" and scope not in monthly_scopes:
                    continue

                for flow in flows:
                    for index, chunk in enumerate(code_chunks):
                        jobs.append(Job(freq, scope, flow, group, chunk, index))

    add(
        "A",
        group_periods(
            annual_periods(args.start_year, args.end_year),
            volatile,
            args.annual_periods_per_call,
        ),
    )

    if args.months > 0:
        add(
            "M",
            group_periods(
                monthly_periods(datetime.now(timezone.utc), args.months),
                volatile,
                args.monthly_periods_per_call,
            ),
        )

    return jobs


def is_fresh(job: Job, index: dict, refresh_periods: set[str]) -> bool:
    """A stored chunk is reusable when it exists, was pulled with the same
    code list, and covers only periods that can no longer be revised."""
    record = index.get(job.key)

    if not record:
        return False

    if not job.path.exists():
        return False

    if record.get("codesHash") != job.codes_hash:
        return False

    if any(period in refresh_periods for period in job.periods):
        return False

    return True


def refresh_window(args) -> set[str]:
    """Periods that are always re-pulled because Comtrade still revises them."""
    window: set[str] = set()

    for year in range(
        max(args.start_year, args.end_year - args.refresh_years + 1),
        args.end_year + 1,
    ):
        window.add(str(year))

    if args.months > 0:
        window.update(
            monthly_periods(
                datetime.now(timezone.utc),
                max(args.refresh_months, 1),
            )
        )

    return window


_last_call_at = 0.0


def throttle(min_interval: float) -> None:
    """Free keys allow one call a second. Pace rather than collect 429s."""
    global _last_call_at

    if min_interval <= 0:
        return

    wait = min_interval - (time.monotonic() - _last_call_at)

    if wait > 0:
        time.sleep(wait)

    _last_call_at = time.monotonic()


def request(
    key: str,
    *,
    freq: str,
    periods: str,
    reporter,
    codes: str,
    flow: str,
    partner,
    max_records: int,
    aggregates: dict | None = None,
):
    import comtradeapicall

    aggregates = aggregates or API_DEFAULTS["aggregates"]

    return comtradeapicall.getFinalData(
        key,
        typeCode="C",
        freqCode=freq,
        clCode="HS",
        period=periods,
        reporterCode=reporter,
        cmdCode=codes,
        flowCode=flow,
        partnerCode=partner,
        partner2Code=aggregates.get("partner2Code"),
        customsCode=aggregates.get("customsCode"),
        motCode=aggregates.get("motCode"),
        maxRecords=max_records,
        format_output="JSON",
        aggregateBy=None,
        breakdownMode="classic",
        countOnly=None,
        includeDesc=True,
    )


def fetch(job: Job, key: str, limits: dict):
    reporter, partner = SCOPES[job.scope]

    def call():
        throttle(float(limits["minSecondsBetweenCalls"]))

        return request(
            key,
            freq=job.freq,
            periods=",".join(job.periods),
            reporter=reporter,
            codes=",".join(job.codes),
            flow=job.flow,
            partner=partner,
            max_records=int(limits["maxRecordsPerCall"]),
            aggregates=limits.get("aggregates"),
        )

    def note(record):
        stats["retries"] = stats.get("retries", 0) + 1

        if record["final"]:
            stats["failed"] = stats.get("failed", 0) + 1

    return with_retry(call, label=job.key, on_error=note)


def run_job(job: Job, key: str, index: dict, stats: dict, limits: dict) -> None:
    frame = fetch(job, key, limits)

    if frame is None or len(frame) == 0:
        # A genuinely empty response is normal: not every reporter files RM,
        # and early months have no data yet. Record it so incremental runs
        # do not keep asking.
        empty = pd.DataFrame(
            columns=[
                "refYear",
                "period",
                "reporterCode",
                "reporterDesc",
                "partnerCode",
                "partnerDesc",
                "cmdCode",
                "flowCode",
                "primaryValue",
            ]
        )

        job.path.parent.mkdir(parents=True, exist_ok=True)
        empty.to_parquet(job.path, index=False)

        index[job.key] = {
            "rows": 0,
            "codesHash": job.codes_hash,
            "periods": job.periods,
            "pulledAt": utc_now(),
            "empty": True,
        }

        stats["empty"] += 1

        return

    cap = int(limits["maxRecordsPerCall"])

    if len(frame) >= cap * CAP_WARNING_RATIO:
        raise RuntimeError(
            f"{job.key}: response reached {len(frame):,} rows, at or near the "
            f"{cap:,} record cap for the {limits['tier']} tier. This response "
            "may be truncated, so it has not been stored. Lower "
            "api.targetRowsPerCall in config/scope.json (or --chunk-size) "
            "and re-run."
        )

    cleaned = filter_classic(require_trade_frame(frame, job.key))

    # The request pins partner2 / customs / mode-of-transport to their
    # aggregates, so the filter should have nothing to remove. If it does, the
    # API is sending breakdowns anyway: the totals are still right, because the
    # filter caught them, but every dropped row was quota spent on data we then
    # threw away. Worth knowing rather than absorbing silently.
    dropped = len(frame) - len(cleaned)

    if dropped > 0:
        stats["disaggregated"] = stats.get("disaggregated", 0) + dropped

    # Nothing downstream can survive two rows for one reporter/partner/code/
    # period: world totals are built by summing reporters, and a duplicate
    # would either inflate the total or, worse, silently replace the aggregate
    # with one slice of it.
    assert_unique(
        cleaned,
        ["cmdCode", "period", "reporterCode", "partnerCode", "flowCode"],
        job.key,
    )

    job.path.parent.mkdir(parents=True, exist_ok=True)
    cleaned.to_parquet(job.path, index=False)

    index[job.key] = {
        "rows": int(len(cleaned)),
        "codesHash": job.codes_hash,
        "periods": job.periods,
        "pulledAt": utc_now(),
        "empty": False,
    }

    stats["rows"] += int(len(cleaned))
    stats["fetched"] += 1


def probe(scope_config: dict) -> None:
    """
    Measure the real limits against the key in use.

    Comtrade's own documentation disagrees with itself about the free tier -
    the Python package says preview data is capped at 500 records, the
    subscriptions page says a registered free key gets 100K. The difference
    decides whether this dashboard is a few hundred calls or impossible, so
    it is measured rather than assumed.

    Costs three calls.
    """
    limits = api_limits(scope_config)

    key = api_key()

    codes = pull_universe()

    print("Probing the Comtrade key in use.\n")

    year = str(datetime.now(timezone.utc).year - 2)

    # Keep the HS-code list short enough to stay below Comtrade's URL
    # length limit. Increase the number of periods instead to test whether
    # the key can return responses approaching the configured record cap.
    probe_year = int(year)
    ladder = [
        ("single code, one year, all reporters", codes[:1], year),
        ("50 codes, one year, all reporters", codes[:50], year),
        (
            "50 codes, twelve years, all reporters",
            codes[:50],
            ",".join(str(y) for y in range(probe_year - 11, probe_year + 1)),
        ),
    ]

    observed = 0

    for label, chunk, probe_periods in ladder:
        try:
            throttle(float(limits["minSecondsBetweenCalls"]))

            frame = request(
                key,
                freq="A",
                periods=probe_periods,
                reporter=None,
                codes=",".join(chunk),
                flow=FLOW_IMPORTS,
                partner=WORLD_PARTNER,
                max_records=int(limits["maxRecordsPerCall"]),
                aggregates=limits.get("aggregates"),
            )
        except Exception as error:  # noqa: BLE001 - the point is to report it
            print(f"  {label:<42} FAILED: {error}")

            print(
                "\nIf this is an authorisation error, the key cannot reach "
                "the data API. Free keys are documented as preview-only in "
                "one place and data-API-capable in another; if it is the "
                "former, this universe is not viable on the free tier - see "
                "the note at the end of the README."
            )

            return

        rows = 0 if frame is None else len(frame)

        observed = max(observed, rows)

        print(f"  {label:<42} {rows:>7,} rows")

    print()

    if observed <= 500:
        print(
            "  Ceiling looks like 500 records. That is the unauthenticated "
            "preview limit, not a usable data feed: 549 codes would need tens "
            "of thousands of calls. Either the key is not being applied, or "
            "this tier cannot serve the dashboard."
        )
    elif observed < 90_000:
        print(
            f"  Largest response seen: {observed:,} rows. Set "
            f"api.maxRecordsPerCall a little above that and "
            f"api.targetRowsPerCall to about half of it, in config/scope.json."
        )
    else:
        print(
            f"  Largest response seen: {observed:,} rows - consistent with a "
            "100K record cap. The shipped free-tier settings are correct."
        )

    print(
        "\n  Nothing was written. Re-run with --dry-run to see the call plan."
    )


def main():
    scope_config = load_scope()

    now = datetime.now(timezone.utc)

    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--start-year",
        type=int,
        default=scope_config["historyStartYear"],
    )

    parser.add_argument(
        "--end-year",
        type=int,
        default=now.year,
    )

    parser.add_argument(
        "--months",
        type=int,
        default=(
            scope_config["monthly"]["rollingMonths"]
            if scope_config["monthly"]["enabled"]
            else 0
        ),
        help="Rolling window of monthly periods. 0 disables monthly pulls.",
    )

    parser.add_argument(
        "--mode",
        choices=["incremental", "full"],
        default="incremental",
    )

    parser.add_argument(
        "--refresh-years",
        type=int,
        default=3,
        help="Most recent annual periods always re-pulled.",
    )

    parser.add_argument(
        "--refresh-months",
        type=int,
        default=3,
        help="Most recent monthly periods always re-pulled.",
    )

    parser.add_argument(
        "--chunk-size",
        type=int,
        default=None,
        help=(
            "Fix the codes per request instead of sizing it by the expected "
            "row count. Lower this if a request nears the 250,000-row cap."
        ),
    )

    parser.add_argument(
        "--monthly-scopes",
        default=None,
        help=(
            "Comma-separated scopes to pull monthly (india,global). "
            "Overrides config/scope.json. Dropping global removes the "
            "largest recurring cost."
        ),
    )

    parser.add_argument("--annual-periods-per-call", type=int, default=10)

    parser.add_argument("--monthly-periods-per-call", type=int, default=6)

    parser.add_argument(
        "--max-calls",
        type=int,
        default=0,
        help="Stop after this many API calls. 0 means no limit.",
    )

    parser.add_argument("--dry-run", action="store_true")

    parser.add_argument(
        "--check",
        action="store_true",
        help=(
            "Report whether the store is complete for this plan and exit. "
            "Costs no API calls. Exits 3 when work is outstanding, so a "
            "follow-up run can decide whether to spend anything."
        ),
    )

    parser.add_argument(
        "--probe",
        action="store_true",
        help=(
            "Spend three calls measuring the real record ceiling for this "
            "key, then exit. Run this once before a first build."
        ),
    )

    parser.add_argument(
        "--out",
        default=None,
        help="Optional path for the run log written after a successful pull.",
    )

    args = parser.parse_args()

    if args.probe:
        probe(scope_config)
        return

    window = refresh_window(args)

    jobs = build_jobs(args, scope_config, window)

    # Always load the raw-store index so a multi-day full cold build can
    # resume from chunks already fetched. In full mode we still set the
    # refresh window empty below, meaning every matching cached chunk is
    # reusable rather than deliberately refreshed.
    index = load_index()

    if args.mode != "incremental":
        window = set()

    pending = [job for job in jobs if not is_fresh(job, index, window)]

    reused = len(jobs) - len(pending)

    limits = api_limits(scope_config)

    daily = int(limits["callsPerDay"])

    print(f"Subscription tier         : {limits['tier']}")
    print(
        f"Per-call ceiling          : "
        f"{int(limits['maxRecordsPerCall']):,} records, "
        f"{daily} calls/day, "
        f"{limits['minSecondsBetweenCalls']}s between calls"
    )
    print(f"HS codes in pull universe : {len(pull_universe())}")
    print(f"Total chunk jobs          : {len(jobs)}")
    print(f"Reused from store         : {reused}")
    print(f"API calls required        : {len(pending)}")

    if len(pending) > daily:
        # Suggest a budget that leaves real headroom rather than one that only
        # just fits. Three retry attempts per call means a bad day costs more
        # than the nominal number, and a run that exhausts the allowance
        # mid-way leaves a short store rather than a finished one.
        days = max(2, -(-len(pending) // (daily // 2)))

        budget = -(-len(pending) // days)

        print(
            f"\n  This run needs more calls than the {daily}/day allowance.\n"
            f"  Spread it over {days} days at --max-calls {budget}, which "
            f"leaves {daily - budget} calls of headroom each day for retries.\n"
            "  The store keeps everything already fetched, so each day picks "
            "up exactly where the last one stopped."
        )

    if args.check:
        # A completeness probe that costs nothing. The follow-up runs on the
        # days after a scheduled refresh call this first: if the store is
        # already complete they stop here, before spending anything.
        if pending:
            print(
                f"\nStore is incomplete: {len(pending)} chunk(s) outstanding."
            )

            return EXIT_INCOMPLETE

        print("\nStore is complete for this plan; nothing to fetch.")

        return 0

    if args.dry_run:
        by_freq: dict[str, int] = {}

        for job in pending:
            by_freq[job.freq] = by_freq.get(job.freq, 0) + 1

        for freq, count in sorted(by_freq.items()):
            label = "annual" if freq == "A" else "monthly"
            print(f"  {label:>8}: {count} calls")

        # What next month costs, given this run completes.
        next_run = [
            job
            for job in jobs
            if any(period in window for period in job.periods)
        ]

        print(
            f"\nOnce the store is warm, an incremental run re-pulls only the "
            f"{args.refresh_years} most recent years and "
            f"{args.refresh_months} most recent months: "
            f"{len(next_run)} calls."
        )

        for job in pending[:8]:
            print(f"  e.g. {job.key} ({len(job.codes)} codes)")

        if len(pending) > 8:
            print(f"  ... and {len(pending) - 8} more")

        print("\nDry run: nothing fetched, nothing written.")
        return

    if not pending:
        print("Raw store already current. Nothing to fetch.")
        return

    remaining = 0

    if args.max_calls and len(pending) > args.max_calls:
        remaining = len(pending) - args.max_calls

        print(
            f"Call budget {args.max_calls} is below the {len(pending)} calls "
            f"required; fetching {args.max_calls} now and leaving {remaining} "
            "for the next run."
        )

        pending = pending[: args.max_calls]

    key = api_key()

    stats = {
        "fetched": 0,
        "empty": 0,
        "rows": 0,
        "disaggregated": 0,
        "retries": 0,
        "failed": 0,
    }

    try:
        for position, job in enumerate(pending, start=1):
            print(f"[{position}/{len(pending)}] {job.key}")

            run_job(job, key, index, stats, limits)
    finally:
        # Persist progress even if a later call fails, so a re-run resumes
        # instead of starting over.
        save_index(index)

    print(
        f"Fetched {stats['fetched']} chunks "
        f"({stats['empty']} empty), {stats['rows']:,} rows."
    )

    if stats["retries"]:
        recovered = stats["retries"] - stats["failed"]

        print(
            f"  {stats['retries']} call attempt(s) failed and were retried"
            + (f", {recovered} recovered" if recovered else "")
            + f". Full detail in {CALL_LOG.name}."
        )

    if stats["disaggregated"]:
        print(
            f"  {stats['disaggregated']:,} rows arrived broken down by second "
            "partner, customs procedure or mode of transport despite the "
            "request asking for the aggregate, and were dropped. The stored "
            "totals are correct; the rows were quota spent for nothing. If "
            "this is large, check api.aggregates in config/scope.json."
        )

    if remaining:
        print(
            f"\n{remaining} chunks still outstanding. The store is "
            "consistent but incomplete, so a snapshot built from it now would "
            "be short of data. Re-run to finish before promoting."
        )

    if args.out:
        write_json(
            Path(args.out) / "manifest.json",
            {
                "pulledAt": utc_now(),
                "mode": args.mode,
                "classification": scope_config["classification"],
                "annualPeriods": annual_periods(args.start_year, args.end_year),
                "monthlyPeriods": (
                    monthly_periods(now, args.months) if args.months else []
                ),
                "codes": len(pull_universe()),
                "callsMade": stats["fetched"] + stats["empty"],
                "rows": stats["rows"],
                "disaggregatedRowsDropped": stats["disaggregated"],
                "failedAttempts": stats["retries"],
                "outstanding": remaining,
                "complete": remaining == 0,
                "store": str(RAW_STORE),
            },
        )

    if remaining:
        raise SystemExit(EXIT_INCOMPLETE)


if __name__ == "__main__":
    try:
        # main() returns an exit code: 0 finished, 3 the store is consistent
        # but short. Propagating it is what lets the scheduled follow-up runs
        # decide whether there is anything left to do.
        raise SystemExit(main() or 0)
    except RuntimeError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(2)
