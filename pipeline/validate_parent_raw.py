from __future__ import annotations

import argparse
from pathlib import Path
import json

import pandas as pd


REQUIRED_FILES = [
    "india_imports",
    "india_exports",
    "global_imports",
    "global_exports",
]


def numeric(series):
    return pd.to_numeric(
        series,
        errors="coerce",
    )


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--raw-dir",
        required=True,
    )

    parser.add_argument(
        "--code",
        required=True,
    )

    parser.add_argument(
        "--level",
        type=int,
        choices=[2, 4],
        required=True,
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

    args = parser.parse_args()

    root = Path(
        args.raw_dir
    )

    failures = []
    warnings = []

    print("=" * 78)
    print(
        f"HStat.India parent raw QA · "
        f"HS-{args.level} {args.code}"
    )
    print("=" * 78)

    if not root.exists():
        raise SystemExit(
            f"Raw directory missing: {root}"
        )

    manifest_path = (
        root
        / "manifest.json"
    )

    if not manifest_path.exists():
        failures.append(
            "manifest.json missing"
        )
        manifest = {}
    else:
        manifest = json.loads(
            manifest_path.read_text()
        )

        if (
            str(
                manifest.get(
                    "requestedCode"
                )
            )
            != args.code
        ):
            failures.append(
                "manifest requestedCode mismatch"
            )

        if (
            manifest.get(
                "requestedLevel"
            )
            != args.level
        ):
            failures.append(
                "manifest requestedLevel mismatch"
            )

        if (
            manifest.get(
                "classification"
            )
            != "HS"
        ):
            failures.append(
                "manifest classification must be HS"
            )

    expected_years = set(
        range(
            args.start_year,
            args.end_year + 1,
        )
    )

    frames = {}

    for name in REQUIRED_FILES:
        path = (
            root
            / f"{name}.parquet"
        )

        print()
        print(name.upper())
        print("-" * 78)

        if not path.exists():
            failures.append(
                f"{name}: file missing"
            )
            continue

        df = pd.read_parquet(
            path
        )

        frames[name] = df

        print(
            "rows:",
            f"{len(df):,}"
        )

        if df.empty:
            failures.append(
                f"{name}: empty"
            )
            continue

        if len(df) >= 250_000:
            failures.append(
                f"{name}: response reached record cap"
            )

        required_columns = {
            "cmdCode",
            "period",
            "reporterCode",
            "primaryValue",
        }

        missing = (
            required_columns
            - set(df.columns)
        )

        if missing:
            failures.append(
                f"{name}: missing columns "
                + ", ".join(
                    sorted(missing)
                )
            )
            continue

        codes = set(
            df["cmdCode"]
            .astype(str)
        )

        print(
            "codes:",
            sorted(codes)
        )

        if codes != {
            args.code
        }:
            failures.append(
                f"{name}: unexpected cmdCode values "
                f"{sorted(codes)}"
            )

        years = set(
            numeric(
                df["period"]
            )
            .dropna()
            .astype(int)
        )

        print(
            "years:",
            sorted(years)
        )

        unexpected_years = (
            years
            - expected_years
        )

        if unexpected_years:
            failures.append(
                f"{name}: unexpected years "
                f"{sorted(unexpected_years)}"
            )

        missing_years = (
            expected_years
            - years
        )

        if missing_years:
            warnings.append(
                f"{name}: no records for "
                f"{sorted(missing_years)}"
            )

        values = numeric(
            df["primaryValue"]
        )

        if (
            values.dropna()
            < 0
        ).any():
            failures.append(
                f"{name}: negative primaryValue"
            )

        print(
            "primary value:",
            f"${values.sum():,.0f}"
        )

        reporters = (
            numeric(
                df["reporterCode"]
            )
            .dropna()
            .astype(int)
        )

        print(
            "reporters:",
            reporters.nunique()
        )

        if name.startswith(
            "india_"
        ):
            bad = (
                set(
                    reporters.unique()
                )
                - {699}
            )

            if bad:
                failures.append(
                    f"{name}: non-India reporters "
                    f"{sorted(bad)}"
                )


    # ------------------------------------------------------
    # India direct World ↔ global India reporter reconciliation
    # ------------------------------------------------------

    for flow in [
        "imports",
        "exports",
    ]:
        india_key = (
            f"india_{flow}"
        )

        global_key = (
            f"global_{flow}"
        )

        if (
            india_key
            not in frames
            or global_key
            not in frames
        ):
            continue

        india = frames[
            india_key
        ]

        glob = frames[
            global_key
        ]

        if (
            "partnerCode"
            not in india.columns
        ):
            failures.append(
                f"{india_key}: partnerCode missing"
            )
            continue

        print()
        print(
            f"RECONCILIATION · {flow.upper()}"
        )
        print("-" * 78)

        for year in sorted(
            expected_years
        ):
            india_y = india[
                numeric(
                    india["period"]
                )
                == year
            ]

            world = india_y[
                numeric(
                    india_y[
                        "partnerCode"
                    ]
                )
                == 0
            ]

            direct = numeric(
                world[
                    "primaryValue"
                ]
            ).sum()

            global_india = glob[
                (
                    numeric(
                        glob[
                            "period"
                        ]
                    )
                    == year
                )
                &
                (
                    numeric(
                        glob[
                            "reporterCode"
                        ]
                    )
                    == 699
                )
            ]

            global_value = numeric(
                global_india[
                    "primaryValue"
                ]
            ).sum()

            diff = abs(
                direct
                - global_value
            )

            tolerance = max(
                1_000_000,
                abs(direct)
                * 0.01,
            )

            status = (
                "PASS"
                if diff
                <= tolerance
                else "FAIL"
            )

            print(
                year,
                "| direct:",
                f"${direct / 1e9:,.4f}bn",
                "| global:",
                f"${global_value / 1e9:,.4f}bn",
                "| diff:",
                f"${diff:,.0f}",
                "|",
                status,
            )

            if (
                diff
                > tolerance
            ):
                failures.append(
                    f"{flow}/{year}: "
                    "India/global reconciliation failed"
                )


    # ------------------------------------------------------
    # Reporter coverage
    # ------------------------------------------------------

    print()
    print(
        "GLOBAL REPORTER COVERAGE"
    )
    print("-" * 78)

    for flow in [
        "imports",
        "exports",
    ]:
        key = (
            f"global_{flow}"
        )

        if key not in frames:
            continue

        df = frames[key]

        previous_reporters = None

        for year in sorted(
            expected_years
        ):
            y = df[
                numeric(
                    df["period"]
                )
                == year
            ]

            reporter_count = (
                numeric(
                    y[
                        "reporterCode"
                    ]
                )
                .dropna()
                .nunique()
            )

            value = numeric(
                y[
                    "primaryValue"
                ]
            ).sum()

            print(
                flow,
                year,
                "| reporters:",
                reporter_count,
                "| observed:",
                f"${value / 1e9:,.3f}bn",
            )

            if (
                previous_reporters
                is not None
                and reporter_count
                < previous_reporters
                * 0.75
            ):
                warnings.append(
                    f"{flow}/{year}: reporter count "
                    "below 75% of preceding year"
                )

            previous_reporters = (
                reporter_count
            )


    print()
    print("=" * 78)
    print(
        "Failures:",
        len(failures)
    )
    print(
        "Warnings:",
        len(warnings)
    )

    for item in failures:
        print(
            "FAIL:",
            item
        )

    for item in warnings:
        print(
            "WARN:",
            item
        )

    if failures:
        raise SystemExit(2)

    print()
    print(
        "PASS — parent raw acquisition "
        "is structurally valid."
    )


if __name__ == "__main__":
    main()
