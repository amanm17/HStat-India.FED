from __future__ import annotations

import argparse
import json
import shutil
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

SNAPSHOTS = (
    ROOT
    / "public"
    / "data"
    / "snapshots"
)


def load_json(path: Path):
    try:
        return json.loads(
            path.read_text()
        )
    except Exception as exc:
        raise RuntimeError(
            f"Could not read JSON: {path}"
        ) from exc


def validate_staging(
    staging: Path,
):
    if not staging.exists():
        raise RuntimeError(
            f"Staging snapshot does not exist: {staging}"
        )

    if not staging.is_dir():
        raise RuntimeError(
            f"Staging path is not a directory: {staging}"
        )

    qa_path = staging / "qa.json"

    if not qa_path.exists():
        raise RuntimeError(
            "Promotion blocked: qa.json is missing."
        )

    qa = load_json(
        qa_path
    )

    failures = qa.get(
        "failures"
    )

    warnings = qa.get(
        "warnings"
    )

    if not isinstance(
        failures,
        list,
    ):
        raise RuntimeError(
            "Promotion blocked: qa.json has no valid failures list."
        )

    if not isinstance(
        warnings,
        list,
    ):
        raise RuntimeError(
            "Promotion blocked: qa.json has no valid warnings list."
        )

    if failures:
        raise RuntimeError(
            "Promotion blocked: "
            f"{len(failures)} QA failure(s)."
        )

    products = (
        staging
        / "products"
    )

    if not products.exists():
        raise RuntimeError(
            "Promotion blocked: products directory is missing."
        )

    product_files = list(
        products.glob(
            "*.json"
        )
    )

    if not product_files:
        raise RuntimeError(
            "Promotion blocked: no product JSON files found."
        )

    # Current launch contract.
    # Parent HS-2/4 data will later live in a separate
    # level-aware structure and will not weaken this check.
    if len(product_files) != 56:
        raise RuntimeError(
            "Promotion blocked: "
            f"expected 56 HS-6 product files, found {len(product_files)}."
        )

    malformed = []

    for path in product_files:
        data = load_json(
            path
        )

        if (
            data.get("hs6")
            != path.stem
        ):
            malformed.append(
                path.name
            )

    if malformed:
        raise RuntimeError(
            "Promotion blocked: malformed product files: "
            + ", ".join(
                malformed[:10]
            )
        )

    return {
        "products":
            len(product_files),
        "failures":
            len(failures),
        "warnings":
            len(warnings),
    }


def promote(
    staging: Path,
):
    result = validate_staging(
        staging
    )

    SNAPSHOTS.mkdir(
        parents=True,
        exist_ok=True,
    )

    current = (
        SNAPSHOTS
        / "current"
    )

    previous = (
        SNAPSHOTS
        / "previous"
    )

    temp = (
        SNAPSHOTS
        / (
            ".incoming-"
            + uuid.uuid4().hex
        )
    )

    backup = (
        SNAPSHOTS
        / (
            ".old-current-"
            + uuid.uuid4().hex
        )
    )

    try:
        # Copy staging first. Current remains untouched
        # until the complete candidate exists.
        shutil.copytree(
            staging,
            temp,
        )

        # Revalidate the copied candidate.
        validate_staging(
            temp
        )

        if current.exists():
            current.rename(
                backup
            )

        temp.rename(
            current
        )

        # Only after new current is in place do we
        # replace previous.
        if previous.exists():
            shutil.rmtree(
                previous
            )

        if backup.exists():
            backup.rename(
                previous
            )

    except Exception:
        # Restore old current if anything fails
        # after it has been moved.
        if (
            backup.exists()
            and not current.exists()
        ):
            backup.rename(
                current
            )

        if temp.exists():
            shutil.rmtree(
                temp,
                ignore_errors=True,
            )

        raise

    print(
        "Promoted snapshot:",
        staging.name,
    )

    print(
        "HS-6 products:",
        result["products"],
    )

    print(
        "QA failures:",
        result["failures"],
    )

    print(
        "QA warnings:",
        result["warnings"],
    )


def main():
    parser = (
        argparse
        .ArgumentParser()
    )

    parser.add_argument(
        "--staging",
        required=True,
    )

    args = parser.parse_args()

    staging = Path(
        args.staging
    )

    if not staging.is_absolute():
        staging = (
            ROOT
            / staging
        )

    promote(
        staging
    )


if __name__ == "__main__":
    main()
