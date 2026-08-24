from __future__ import annotations

from pathlib import Path
import argparse
import json


def close(a, b, tol=1e-6):
    if a is None or b is None:
        return False
    return abs(a - b) <= max(
        tol,
        max(abs(a), abs(b)) * 1e-9,
    )


def fail(errors, hs, year, message):
    errors.append(
        {
            "hs6": hs,
            "year": year,
            "message": message,
        }
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot")
    args = parser.parse_args()

    root = Path(args.snapshot)

    errors = []
    warnings = []

    catalogue_path = root / "catalogue.json"

    if not catalogue_path.exists():
        raise SystemExit(
            "FAIL: catalogue.json missing"
        )

    catalogue = json.loads(
        catalogue_path.read_text()
    )

    if not catalogue:
        raise SystemExit(
            "FAIL: empty catalogue"
        )

    for item in catalogue:
        hs = item["hs6"]

        product_path = (
            root
            / "products"
            / f"{hs}.json"
        )

        if not product_path.exists():
            fail(
                errors,
                hs,
                None,
                "product file missing",
            )
            continue

        product = json.loads(
            product_path.read_text()
        )

        annual = product.get(
            "annual",
            {},
        )

        for year_string, record in annual.items():
            year = int(year_string)

            india = record["india"]
            glob = record["global"]

            imports = india["imports"]
            exports = india["exports"]
            balance = india["balance"]

            # -------------------------------------------------
            # India arithmetic
            # -------------------------------------------------

            if (
                imports is not None
                and imports < 0
            ):
                fail(
                    errors,
                    hs,
                    year,
                    "negative India imports",
                )

            if (
                exports is not None
                and exports < 0
            ):
                fail(
                    errors,
                    hs,
                    year,
                    "negative India exports",
                )

            if (
                imports is not None
                and exports is not None
            ):
                expected_balance = (
                    exports - imports
                )

                if not close(
                    balance,
                    expected_balance,
                ):
                    fail(
                        errors,
                        hs,
                        year,
                        "trade balance arithmetic mismatch",
                    )

            # -------------------------------------------------
            # Bilateral partner checks
            # -------------------------------------------------

            for label in [
                "suppliers",
                "destinations",
            ]:
                partner_set = india[label]

                coverage = partner_set.get(
                    "coverage"
                )

                hhi = partner_set.get(
                    "hhi"
                )

                top3 = partner_set.get(
                    "top3Share"
                )

                rows = partner_set.get(
                    "rows",
                    [],
                )

                if (
                    coverage is not None
                    and not (
                        0 <= coverage <= 1.20
                    )
                ):
                    fail(
                        errors,
                        hs,
                        year,
                        (
                            f"{label} coverage "
                            f"impossible: {coverage}"
                        ),
                    )

                if (
                    hhi is not None
                    and not (
                        0 <= hhi <= 1
                    )
                ):
                    fail(
                        errors,
                        hs,
                        year,
                        (
                            f"{label} HHI "
                            "out of bounds"
                        ),
                    )

                if (
                    top3 is not None
                    and not (
                        0 <= top3 <= 1.05
                    )
                ):
                    fail(
                        errors,
                        hs,
                        year,
                        (
                            f"{label} top3 share "
                            "out of bounds"
                        ),
                    )

                if rows:
                    for i in range(
                        len(rows) - 1
                    ):
                        if (
                            rows[i]["value"]
                            < rows[i + 1]["value"]
                        ):
                            fail(
                                errors,
                                hs,
                                year,
                                (
                                    f"{label} not "
                                    "sorted descending"
                                ),
                            )
                            break

            # -------------------------------------------------
            # Global publication checks
            # -------------------------------------------------

            for flow in [
                "import",
                "export",
            ]:
                coverage_key = (
                    f"{flow}Coverage"
                )

                coverage = glob.get(
                    coverage_key,
                    {},
                )

                status = coverage.get(
                    "status"
                )

                value_key = (
                    "imports"
                    if flow == "import"
                    else "exports"
                )

                observed_key = (
                    "observedImports"
                    if flow == "import"
                    else "observedExports"
                )

                rank_key = (
                    f"{flow}RankIndia"
                )

                share_key = (
                    f"{flow}ShareIndia"
                )

                top_key = (
                    "topImporters"
                    if flow == "import"
                    else "topExporters"
                )

                published_value = glob.get(
                    value_key
                )

                observed_value = glob.get(
                    observed_key
                )

                rank = glob.get(
                    rank_key
                )

                share = glob.get(
                    share_key
                )

                top = glob.get(
                    top_key,
                    [],
                )

                # Raw observed totals may exist for any status.
                if (
                    observed_value is not None
                    and observed_value < 0
                ):
                    fail(
                        errors,
                        hs,
                        year,
                        (
                            f"{flow} observed "
                            "global total negative"
                        ),
                    )

                # Only VALID coverage may expose headline metrics.
                if status != "VALID":
                    if (
                        published_value is not None
                        or rank is not None
                        or share is not None
                        or len(top) > 0
                    ):
                        fail(
                            errors,
                            hs,
                            year,
                            (
                                f"{flow} metrics exposed "
                                f"with coverage status "
                                f"{status}"
                            ),
                        )

                # VALID coverage should have a usable total.
                if status == "VALID":
                    if (
                        published_value is None
                        or published_value <= 0
                    ):
                        fail(
                            errors,
                            hs,
                            year,
                            (
                                f"{flow} VALID coverage "
                                "without positive "
                                "published total"
                            ),
                        )

                if (
                    share is not None
                    and not (
                        0 <= share <= 1
                    )
                ):
                    fail(
                        errors,
                        hs,
                        year,
                        (
                            f"{flow} India share "
                            "out of bounds"
                        ),
                    )

                if top:
                    for i in range(
                        len(top) - 1
                    ):
                        if (
                            top[i]["value"]
                            < top[i + 1]["value"]
                        ):
                            fail(
                                errors,
                                hs,
                                year,
                                (
                                    f"top {flow}ers "
                                    "not sorted"
                                ),
                            )
                            break

                    ranks = [
                        row["rank"]
                        for row in top
                    ]

                    expected = list(
                        range(
                            1,
                            len(ranks) + 1,
                        )
                    )

                    if ranks != expected:
                        fail(
                            errors,
                            hs,
                            year,
                            (
                                f"top {flow}er "
                                "ranks not sequential"
                            ),
                        )

            # -------------------------------------------------
            # Global import/export plausibility
            # Warning only.
            # -------------------------------------------------

            gi = glob.get("imports")
            gx = glob.get("exports")

            if (
                gi is not None
                and gx is not None
                and gx > 0
            ):
                ratio = gi / gx

                if not (
                    0.70 <= ratio <= 1.50
                ):
                    warnings.append(
                        {
                            "hs6": hs,
                            "year": year,
                            "message": (
                                "global import/export "
                                f"ratio {ratio:.3f}"
                            ),
                        }
                    )

        # -------------------------------------------------
        # Benchmark checks
        # -------------------------------------------------

        benchmarks = product.get(
            "benchmarks",
            {},
        )

        for label, benchmark in benchmarks.items():
            if benchmark is None:
                continue

            year = benchmark.get(
                "year"
            )

            status = benchmark.get(
                "status"
            )

            if status != "VALID":
                fail(
                    errors,
                    hs,
                    year,
                    (
                        f"{label} benchmark "
                        "is not VALID"
                    ),
                )

            if (
                year is None
                or str(year) not in annual
            ):
                fail(
                    errors,
                    hs,
                    year,
                    (
                        f"{label} benchmark year "
                        "missing from annual data"
                    ),
                )
                continue

            annual_global = (
                annual[str(year)]["global"]
            )

            if label == "globalImports":
                annual_status = (
                    annual_global[
                        "importCoverage"
                    ].get("status")
                )

                annual_value = (
                    annual_global["imports"]
                )

            else:
                annual_status = (
                    annual_global[
                        "exportCoverage"
                    ].get("status")
                )

                annual_value = (
                    annual_global["exports"]
                )

            if annual_status != "VALID":
                fail(
                    errors,
                    hs,
                    year,
                    (
                        f"{label} benchmark points "
                        "to non-VALID annual data"
                    ),
                )

            if not close(
                benchmark.get("value"),
                annual_value,
            ):
                fail(
                    errors,
                    hs,
                    year,
                    (
                        f"{label} benchmark value "
                        "does not match annual value"
                    ),
                )

    report = {
        "products": len(catalogue),
        "failures": errors,
        "warnings": warnings,
    }

    qa_path = root / "qa.json"

    qa_path.write_text(
        json.dumps(
            report,
            indent=2,
        )
    )

    print(
        f"QA: {len(catalogue)} products | "
        f"{len(errors)} failures | "
        f"{len(warnings)} warnings"
    )

    if errors:
        for error in errors[:20]:
            print(
                "FAIL",
                error,
            )

        raise SystemExit(2)


if __name__ == "__main__":
    main()
