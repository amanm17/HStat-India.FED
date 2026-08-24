from __future__ import annotations

from pathlib import Path
from datetime import datetime, timezone
import argparse
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def run(*cmd):
    print("+", " ".join(map(str, cmd)))

    subprocess.run(
        list(map(str, cmd)),
        cwd=ROOT,
        check=True,
    )


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--history-start",
        type=int,
        default=2016,
    )

    parser.add_argument(
        "--analysis-start",
        type=int,
        default=2022,
    )

    parser.add_argument(
        "--end-year",
        type=int,
        default=None,
    )

    args = parser.parse_args()

    now = datetime.now(timezone.utc)

    end_year = (
        args.end_year
        if args.end_year is not None
        else now.year - 1
    )

    stamp = now.strftime(
        "%Y%m%dT%H%M%SZ"
    )

    raw = (
        ROOT
        / "data"
        / "raw"
        / stamp
    )

    staging = (
        ROOT
        / "data"
        / "staging"
        / stamp
    )

    run(
        sys.executable,
        "pipeline/build_hs_library.py",
    )

    run(
        sys.executable,
        "pipeline/import_dgcis.py",
    )

    run(
        sys.executable,
        "pipeline/pull_comtrade.py",
        "--start-year",
        args.history_start,
        "--end-year",
        end_year,
        "--out",
        raw,
    )

    run(
        sys.executable,
        "pipeline/process_snapshot.py",
        "--raw-dir",
        raw,
        "--out",
        staging,
        "--start-year",
        args.history_start,
        "--analysis-start-year",
        args.analysis_start,
        "--end-year",
        end_year,
    )

    run(
        sys.executable,
        "pipeline/validate_snapshot.py",
        staging,
    )

    run(
        sys.executable,
        "pipeline/rotate_snapshot.py",
        "--staging",
        staging,
    )

    print(
        "Monthly refresh complete."
    )


if __name__ == "__main__":
    main()
