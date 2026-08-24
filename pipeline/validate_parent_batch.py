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

    root = Path(args.raw_root)

    batch_manifest = (
        root
        / "batch_manifest.json"
    )

    failures = []

    if not batch_manifest.exists():
        raise SystemExit(
            "FAIL: batch_manifest.json missing"
        )

    batch = json.loads(
        batch_manifest.read_text()
    )

    successes = sorted(
        str(x)
        for x in batch.get(
            "successes",
            []
        )
    )

    batch_failures = (
        batch.get(
            "failures",
            []
        )
    )

    if successes != EXPECTED_HS4:
        failures.append(
            "Batch successes do not equal "
            f"expected HS-4 universe: {successes}"
        )

    if batch_failures:
        failures.append(
            f"Batch manifest contains "
            f"{len(batch_failures)} pull failure(s)"
        )

    print("=" * 78)
    print("HStat.India · HS-4 batch raw QA")
    print("=" * 78)
    print(
        "Expected:",
        len(EXPECTED_HS4)
    )
    print(
        "Successful pulls:",
        len(successes)
    )
    print(
        "Pull failures:",
        len(batch_failures)
    )

    if failures:
        for item in failures:
            print(
                "FAIL:",
                item
            )

        raise SystemExit(2)

    validator = (
        Path(__file__).resolve().parent
        / "validate_parent_raw.py"
    )

    per_code = []

    for code in EXPECTED_HS4:
        raw_dir = (
            root
            / "4"
            / code
        )

        print()
        print("#" * 78)
        print(
            f"RAW QA · HS-4 {code}"
        )
        print("#" * 78)

        cmd = [
            sys.executable,
            str(validator),
            "--raw-dir",
            str(raw_dir),
            "--code",
            code,
            "--level",
            "4",
            "--start-year",
            str(args.start_year),
            "--end-year",
            str(args.end_year),
        ]

        result = subprocess.run(
            cmd,
            check=False,
        )

        per_code.append(
            {
                "code": code,
                "returnCode":
                    result.returncode,
            }
        )

        if result.returncode != 0:
            failures.append(
                f"HS-4 {code}: raw QA failed"
            )

    print()
    print("=" * 78)

    passed = sum(
        x["returnCode"] == 0
        for x in per_code
    )

    print(
        "Per-code raw QA passed:",
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
        "PASS — all 8 HS-4 raw datasets "
        "passed the acquisition gate."
    )


if __name__ == "__main__":
    main()
