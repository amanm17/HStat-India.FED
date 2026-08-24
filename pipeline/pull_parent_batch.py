from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from common import (
    api_key,
    filter_classic,
    require_trade_frame,
    utc_now,
    write_json,
)

from pull_comtrade import call_final


MAX_RECORDS = 250000


def load_codes(path: Path):
    data = json.loads(
        path.read_text()
    )

    codes = []

    for level in ["4"]:
        for code in data.get(level, []):
            code = str(code).strip()

            if (
                code.isdigit()
                and len(code) == 4
            ):
                codes.append(code)

    return sorted(set(codes))


def pull_one(
    key,
    code,
    periods,
    out,
):
    jobs = [
        (
            "india_imports",
            "699",
            "M",
            None,
        ),
        (
            "india_exports",
            "699",
            "X",
            None,
        ),
        (
            "global_imports",
            None,
            "M",
            "0",
        ),
        (
            "global_exports",
            None,
            "X",
            "0",
        ),
    ]

    code_dir = (
        out
        / "4"
        / code
    )

    code_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    manifest = {
        "pulledAt": utc_now(),
        "classification": "HS",
        "requestedLevel": 4,
        "requestedCode": code,
        "periods": periods,
        "files": {},
    }

    for (
        label,
        reporter,
        flow,
        partner,
    ) in jobs:
        print(
            f"HS-4 {code} · {label}"
        )

        raw = call_final(
            key,
            periods,
            reporter,
            code,
            flow,
            partner,
        )

        df = filter_classic(
            require_trade_frame(
                raw,
                f"{code}/{label}",
            )
        )

        if len(df) >= MAX_RECORDS:
            raise RuntimeError(
                f"{code}/{label}: reached "
                f"{MAX_RECORDS:,} rows"
            )

        if df.empty:
            raise RuntimeError(
                f"{code}/{label}: empty response"
            )

        actual = set(
            df["cmdCode"]
            .astype(str)
        )

        if actual != {code}:
            raise RuntimeError(
                f"{code}/{label}: unexpected "
                f"cmdCode values {sorted(actual)}"
            )

        path = (
            code_dir
            / f"{label}.parquet"
        )

        df.to_parquet(
            path,
            index=False,
        )

        manifest["files"][
            label
        ] = {
            "path": str(path),
            "rows": len(df),
        }

        print(
            f"  {len(df):,} rows"
        )

    write_json(
        code_dir
        / "manifest.json",
        manifest,
    )


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--universe",
        default=(
            "config/"
            "parent_universe.json"
        ),
    )

    parser.add_argument(
        "--start-year",
        type=int,
        required=True,
    )

    parser.add_argument(
        "--end-year",
        type=int,
        required=True,
    )

    parser.add_argument(
        "--out",
        required=True,
    )

    args = parser.parse_args()

    universe = Path(
        args.universe
    )

    if not universe.exists():
        raise RuntimeError(
            f"Missing universe: {universe}"
        )

    codes = load_codes(
        universe
    )

    if len(codes) != 8:
        raise RuntimeError(
            f"Expected 8 HS-4 codes, "
            f"found {len(codes)}: {codes}"
        )

    periods = ",".join(
        str(year)
        for year in range(
            args.start_year,
            args.end_year + 1,
        )
    )

    out = Path(
        args.out
    )

    out.mkdir(
        parents=True,
        exist_ok=True,
    )

    key = api_key()

    batch = {
        "pulledAt": utc_now(),
        "classification": "HS",
        "level": 4,
        "periods": periods,
        "codes": codes,
        "successes": [],
        "failures": [],
    }

    for code in codes:
        print()
        print("=" * 78)
        print(
            f"PULLING HS-4 {code}"
        )
        print("=" * 78)

        try:
            pull_one(
                key,
                code,
                periods,
                out,
            )

            batch[
                "successes"
            ].append(code)

        except Exception as exc:
            batch[
                "failures"
            ].append(
                {
                    "code": code,
                    "error": repr(exc),
                }
            )

            print(
                "FAIL:",
                code,
                repr(exc),
            )

    write_json(
        out
        / "batch_manifest.json",
        batch,
    )

    print()
    print("=" * 78)
    print(
        "Successes:",
        len(
            batch["successes"]
        ),
    )

    print(
        "Failures:",
        len(
            batch["failures"]
        ),
    )

    if batch["failures"]:
        raise SystemExit(2)

    print(
        "PASS — all HS-4 raw pulls completed."
    )


if __name__ == "__main__":
    main()
