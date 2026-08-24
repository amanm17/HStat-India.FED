from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


EXPECTED_HS4 = [
    "8471",
    "8473",
    "8507",
    "8517",
    "8528",
    "8534",
    "8541",
    "8542",
]


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--raw-root",
        required=True,
    )

    parser.add_argument(
        "--out-root",
        required=True,
    )

    parser.add_argument(
        "--analysis-start-year",
        type=int,
        default=2022,
    )

    args = parser.parse_args()

    raw_root = Path(
        args.raw_root
    )

    out_root = Path(
        args.out_root
    )

    out_root.mkdir(
        parents=True,
        exist_ok=True,
    )

    processor = (
        Path(__file__).resolve().parent
        / "process_parent_snapshot.py"
    )

    validator = (
        Path(__file__).resolve().parent
        / "validate_parent_snapshot.py"
    )

    failures = []
    results = []

    for code in EXPECTED_HS4:
        raw_dir = (
            raw_root
            / "4"
            / code
        )

        out_dir = (
            out_root
            / "4"
            / code
        )

        print()
        print("=" * 78)
        print(
            f"PROCESSING HS-4 {code}"
        )
        print("=" * 78)

        process_cmd = [
            sys.executable,
            str(processor),
            "--raw-dir",
            str(raw_dir),
            "--code",
            code,
            "--level",
            "4",
            "--analysis-start-year",
            str(
                args.analysis_start_year
            ),
            "--out",
            str(out_dir),
        ]

        process_result = subprocess.run(
            process_cmd,
            check=False,
        )

        if process_result.returncode != 0:
            failures.append(
                f"HS-4 {code}: processing failed"
            )

            results.append(
                {
                    "code": code,
                    "processed": False,
                    "validated": False,
                }
            )

            continue

        validate_cmd = [
            sys.executable,
            str(validator),
            "--dir",
            str(out_dir),
            "--code",
            code,
            "--level",
            "4",
        ]

        validate_result = subprocess.run(
            validate_cmd,
            check=False,
        )

        validated = (
            validate_result.returncode
            == 0
        )

        if not validated:
            failures.append(
                f"HS-4 {code}: analytical QA failed"
            )

        results.append(
            {
                "code": code,
                "processed": True,
                "validated": validated,
            }
        )

    summary = {
        "level": 4,
        "expected": EXPECTED_HS4,
        "results": results,
        "failures": failures,
    }

    (
        out_root
        / "batch_qa.json"
    ).write_text(
        json.dumps(
            summary,
            indent=2,
        )
        + "\n"
    )

    passed = sum(
        x["validated"]
        for x in results
    )

    print()
    print("=" * 78)
    print(
        "Validated HS-4 categories:",
        f"{passed}/{len(EXPECTED_HS4)}"
    )
    print(
        "Failures:",
        len(failures)
    )

    if failures:
        for item in failures:
            print(
                "FAIL:",
                item
            )

        raise SystemExit(2)

    print()
    print(
        "PASS — all 8 HS-4 analytical "
        "objects validated."
    )


if __name__ == "__main__":
    main()
