"""
The monthly refresh, end to end.

    build the search index from the sector definition CSV
    validate the static ITC(HS)-8 CSV
    pull Comtrade into the resumable raw store
    process a staging snapshot
    validate it
    promote it over `current` only if validation passed

Every step fails closed. If the pull is incomplete or QA finds a failure,
the live snapshot is left exactly as it was — a stale but validated
dashboard is always preferable to a fresh but wrong one.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import argparse
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


# pull_comtrade exits with this when the call budget ran out mid-run.
EXIT_INCOMPLETE = 3


def run(*command, allow_failure: bool = False, ok_codes=()) -> int:
    printable = " ".join(str(part) for part in command)

    print(f"\n$ {printable}", flush=True)

    result = subprocess.run(
        [str(part) for part in command],
        cwd=ROOT,
    )

    if result.returncode in ok_codes:
        return result.returncode

    if result.returncode != 0 and not allow_failure:
        raise SystemExit(
            f"Refresh aborted: `{printable}` exited {result.returncode}. "
            "The live snapshot has not been touched."
        )

    return result.returncode


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument("--history-start", type=int, default=None)

    parser.add_argument("--analysis-start", type=int, default=None)

    parser.add_argument("--end-year", type=int, default=None)

    parser.add_argument(
        "--months",
        type=int,
        default=None,
        help="Rolling monthly window. 0 disables monthly data.",
    )

    parser.add_argument(
        "--mode",
        choices=["incremental", "full"],
        default="incremental",
    )

    parser.add_argument(
        "--max-calls",
        type=int,
        default=0,
        help="API call budget for this run. 0 means no limit.",
    )

    parser.add_argument(
        "--refresh-years",
        type=int,
        default=None,
        help="Most recent annual periods to re-pull. Lower is cheaper.",
    )

    parser.add_argument(
        "--refresh-months",
        type=int,
        default=None,
        help="Most recent monthly periods to re-pull. Lower is cheaper.",
    )

    parser.add_argument(
        "--skip-pull",
        action="store_true",
        help="Reprocess the existing raw store without contacting Comtrade.",
    )

    parser.add_argument(
        "--no-promote",
        action="store_true",
        help="Build and validate a staging snapshot but leave `current` alone.",
    )

    args = parser.parse_args()

    sys.path.insert(0, str(ROOT / "pipeline"))

    from definition import load_scope, summary  # noqa: E402

    scope = load_scope()

    history_start = args.history_start or scope["historyStartYear"]

    analysis_start = args.analysis_start or scope["analysisStartYear"]

    now = datetime.now(timezone.utc)

    # Comtrade publishes annual data for a year during the following year.
    # Asking for the current year is harmless: it simply returns the
    # reporters that have already filed, and coverage validation will
    # withhold the headline until enough of them have.
    end_year = args.end_year if args.end_year is not None else now.year

    months = (
        args.months
        if args.months is not None
        else (
            scope["monthly"]["rollingMonths"]
            if scope["monthly"]["enabled"]
            else 0
        )
    )

    stamp = now.strftime("%Y%m%dT%H%M%SZ")

    staging = ROOT / "data" / "staging" / stamp

    run_log = ROOT / "data" / "raw" / stamp

    print("HStat monthly refresh")
    print(f"  started        : {now.isoformat()}")

    for key, value in summary().items():
        print(f"  {key:<14} : {value}")

    print(f"  annual years   : {history_start}-{end_year}")
    print(f"  monthly window : {months} months")
    print(f"  mode           : {args.mode}")

    run(sys.executable, "pipeline/build_hs_library.py")

    run(sys.executable, "pipeline/import_dgcis.py")

    if not args.skip_pull:
        pull = [
            sys.executable,
            "pipeline/pull_comtrade.py",
            "--start-year", history_start,
            "--end-year", end_year,
            "--months", months,
            "--mode", args.mode,
            "--out", run_log,
        ]

        if args.max_calls:
            pull += ["--max-calls", args.max_calls]

        if args.refresh_years is not None:
            pull += ["--refresh-years", args.refresh_years]

        if args.refresh_months is not None:
            pull += ["--refresh-months", args.refresh_months]

        if run(*pull, ok_codes=(EXIT_INCOMPLETE,)) == EXIT_INCOMPLETE:
            # The raw store is consistent but incomplete. Do not build or
            # validate a snapshot from partial data. Exit with the dedicated
            # status so GitHub Actions can save the store and continue on the
            # next run without touching the live snapshot.
            print(
                "\nPull was cut short by the call budget. "
                "Raw store progress has been preserved; snapshot processing "
                "and promotion are deferred until the pull is complete."
            )
            raise SystemExit(EXIT_INCOMPLETE)
    run(
        sys.executable,
        "pipeline/process_snapshot.py",
        "--out", staging,
        "--start-year", history_start,
        "--analysis-start-year", analysis_start,
        "--end-year", end_year,
        "--months", months,
    )

    run(sys.executable, "pipeline/validate_snapshot.py", staging)

    if args.no_promote:
        print(f"\nValidated staging snapshot left at {staging}")
        print("Promotion skipped (--no-promote).")
        return

    run(sys.executable, "pipeline/rotate_snapshot.py", "--staging", staging)

    print("\nMonthly refresh complete. `current` now holds validated data.")


if __name__ == "__main__":
    main()
