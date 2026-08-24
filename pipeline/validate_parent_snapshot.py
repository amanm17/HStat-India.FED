from __future__ import annotations

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--dir",
        required=True,
    )

    parser.add_argument(
        "--code",
        required=True,
    )

    parser.add_argument(
        "--level",
        type=int,
        required=True,
    )

    args = parser.parse_args()

    root = Path(
        args.dir
    )

    category_path = (
        root
        / "category.json"
    )

    qa_path = (
        root
        / "qa.json"
    )

    failures = []
    warnings = []

    if not category_path.exists():
        failures.append(
            "category.json missing"
        )

    if not qa_path.exists():
        failures.append(
            "qa.json missing"
        )

    if failures:
        for item in failures:
            print(
                "FAIL:",
                item
            )

        raise SystemExit(2)

    data = json.loads(
        category_path.read_text()
    )

    qa = json.loads(
        qa_path.read_text()
    )

    if (
        str(
            data.get(
                "code"
            )
        )
        != args.code
    ):
        failures.append(
            "category code mismatch"
        )

    if (
        data.get(
            "level"
        )
        != args.level
    ):
        failures.append(
            "category level mismatch"
        )

    years = data.get(
        "years",
        []
    )

    annual = data.get(
        "annual",
        {}
    )

    if not years:
        failures.append(
            "no years"
        )

    for year in years:
        key = str(year)

        if key not in annual:
            failures.append(
                f"{year}: annual record missing"
            )
            continue

        row = annual[key]

        global_row = row.get(
            "global",
            {}
        )

        india_row = row.get(
            "india",
            {}
        )

        for field in [
            "observedImports",
            "observedExports",
            "importCoverage",
            "exportCoverage",
        ]:
            if field not in global_row:
                failures.append(
                    f"{year}: global.{field} missing"
                )

        for field in [
            "imports",
            "exports",
            "balance",
            "suppliers",
            "destinations",
        ]:
            if field not in india_row:
                failures.append(
                    f"{year}: india.{field} missing"
                )

        for flow in [
            "import",
            "export",
        ]:
            coverage = global_row.get(
                f"{flow}Coverage",
                {}
            )

            status = coverage.get(
                "status"
            )

            publish_value = global_row.get(
                (
                    "imports"
                    if flow == "import"
                    else "exports"
                )
            )

            rank = global_row.get(
                (
                    "importRankIndia"
                    if flow == "import"
                    else "exportRankIndia"
                )
            )

            share = global_row.get(
                (
                    "importShareIndia"
                    if flow == "import"
                    else "exportShareIndia"
                )
            )

            top = global_row.get(
                (
                    "topImporters"
                    if flow == "import"
                    else "topExporters"
                ),
                [],
            )

            if status == "VALID":
                if publish_value is None:
                    failures.append(
                        f"{year}: VALID {flow} has no publishable value"
                    )

            else:
                if publish_value is not None:
                    failures.append(
                        f"{year}: non-VALID {flow} published a global value"
                    )

                if rank is not None:
                    failures.append(
                        f"{year}: non-VALID {flow} published India rank"
                    )

                if share is not None:
                    failures.append(
                        f"{year}: non-VALID {flow} published India share"
                    )

                if top:
                    failures.append(
                        f"{year}: non-VALID {flow} published top-10"
                    )

        india_imports = india_row.get(
            "imports"
        )

        india_exports = india_row.get(
            "exports"
        )

        balance = india_row.get(
            "balance"
        )

        if (
            india_imports is not None
            and india_exports is not None
            and balance is not None
        ):
            expected = (
                india_exports
                - india_imports
            )

            tolerance = max(
                1.0,
                abs(expected)
                * 1e-10,
            )

            if abs(
                balance
                - expected
            ) > tolerance:
                failures.append(
                    f"{year}: India balance arithmetic failure"
                )

        for label in [
            "suppliers",
            "destinations",
        ]:
            p = india_row.get(
                label,
                {}
            )

            coverage = p.get(
                "coverage"
            )

            if (
                coverage is not None
                and not (
                    0.95
                    <= float(
                        coverage
                    )
                    <= 1.05
                )
            ):
                warnings.append(
                    f"{year}: {label} coverage = {coverage:.4f}"
                )

    benchmarks = data.get(
        "benchmarks",
        {}
    )

    for name in [
        "globalImports",
        "globalExports",
    ]:
        benchmark = benchmarks.get(
            name
        )

        if not benchmark:
            failures.append(
                f"{name}: benchmark missing"
            )
            continue

        year = benchmark.get(
            "year"
        )

        status = benchmark.get(
            "status"
        )

        if status != "VALID":
            failures.append(
                f"{name}: benchmark status is not VALID"
            )

        if (
            year is not None
            and str(year)
            not in annual
        ):
            failures.append(
                f"{name}: benchmark year absent from annual"
            )

    for item in qa.get(
        "failures",
        []
    ):
        failures.append(
            "processor QA: "
            + str(item)
        )

    for item in qa.get(
        "warnings",
        []
    ):
        warnings.append(
            "processor QA: "
            + str(item)
        )

    print(
        "=" * 78
    )

    print(
        f"HStat.India parent snapshot QA · "
        f"HS-{args.level} {args.code}"
    )

    print(
        "=" * 78
    )

    print(
        "Years:",
        years
    )

    print(
        "Latest India year:",
        data.get(
            "latestIndiaYear"
        )
    )

    print(
        "Import benchmark:",
        benchmarks.get(
            "globalImports",
            {}
        ).get(
            "year"
        )
    )

    print(
        "Export benchmark:",
        benchmarks.get(
            "globalExports",
            {}
        ).get(
            "year"
        )
    )

    print()
    print(
        "Failures:",
        len(
            failures
        )
    )

    print(
        "Warnings:",
        len(
            warnings
        )
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
        "PASS — parent analytical object "
        "is internally consistent."
    )


if __name__ == "__main__":
    main()
