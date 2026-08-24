from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from common import utc_now, write_json
from coverage import assess_coverage
from process_snapshot import (
    ranking,
    partners,
    reconcile_india,
    latest_valid_benchmark,
)


def num(series):
    return pd.to_numeric(
        series,
        errors="coerce",
    )


def year_frame(
    frame: pd.DataFrame,
    year: int,
):
    return frame[
        num(frame["period"])
        == year
    ].copy()


def world_value(
    frame: pd.DataFrame,
):
    if frame.empty:
        return None

    rows = frame[
        num(frame["partnerCode"])
        == 0
    ]

    if rows.empty:
        return None

    values = num(
        rows["primaryValue"]
    ).dropna()

    if values.empty:
        return None

    return float(
        values.sum()
    )


def bilateral_frame(
    frame: pd.DataFrame,
):
    if frame.empty:
        return frame.copy()

    return frame[
        num(frame["partnerCode"])
        != 0
    ].copy()


def mirror(
    imports,
    exports,
):
    if (
        imports is None
        or exports is None
        or exports <= 0
    ):
        return {
            "importExportRatio": None,
            "status": None,
        }

    ratio = float(
        imports / exports
    )

    return {
        "importExportRatio":
            ratio,
        "status":
            (
                "OK"
                if 0.70
                <= ratio
                <= 1.50
                else "WARNING"
            ),
    }


def baseline_coverage(
    reporters: int,
):
    return {
        "status": "BASELINE",
        "candidateReporters":
            reporters,
        "previousReporters":
            None,
        "reporterCountRatio":
            None,
        "priorTop1Present":
            None,
        "priorTop10Present":
            None,
        "priorTop20ValueCoverage":
            None,
        "missingPriorTop10":
            [],
    }


def clean_source_contract():
    """
    Reuse the existing production source-object format,
    but retain only Comtrade-labelled sources.

    This prevents an HS-4 aggregate from claiming DGCIS
    HS-8 data that it does not contain.
    """
    path = Path(
        "public/data/snapshots/current/"
        "products/847130.json"
    )

    if not path.exists():
        return []

    template = json.loads(
        path.read_text()
    )

    sources = template.get(
        "sources",
        []
    )

    if not isinstance(
        sources,
        list,
    ):
        return sources

    comtrade = [
        source
        for source in sources
        if "comtrade"
        in json.dumps(
            source
        ).lower()
    ]

    return (
        comtrade
        if comtrade
        else sources[:1]
    )


def template_metadata():
    path = Path(
        "public/data/snapshots/current/"
        "products/847130.json"
    )

    if not path.exists():
        return {
            "schemaVersion": None,
            "classification": "HS",
        }

    data = json.loads(
        path.read_text()
    )

    return {
        "schemaVersion":
            data.get(
                "schemaVersion"
            ),
        "classification":
            data.get(
                "classification"
            ),
    }


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
        "--out",
        required=True,
    )

    parser.add_argument(
        "--analysis-start-year",
        type=int,
        default=2022,
    )

    args = parser.parse_args()

    if (
        not args.code.isdigit()
        or len(args.code)
        != args.level
    ):
        raise RuntimeError(
            f"{args.code} is not "
            f"a valid HS-{args.level} code"
        )

    raw = Path(
        args.raw_dir
    )

    out = Path(
        args.out
    )

    out.mkdir(
        parents=True,
        exist_ok=True,
    )

    frames = {}

    for name in [
        "india_imports",
        "india_exports",
        "global_imports",
        "global_exports",
    ]:
        path = (
            raw
            / f"{name}.parquet"
        )

        if not path.exists():
            raise RuntimeError(
                f"Missing raw file: {path}"
            )

        frames[name] = (
            pd.read_parquet(
                path
            )
        )

    all_years = sorted(
        {
            int(x)
            for frame
            in frames.values()
            for x
            in num(
                frame["period"]
            )
            .dropna()
            .astype(int)
        }
    )

    if not all_years:
        raise RuntimeError(
            "No years found in raw parent data"
        )

    descriptions = []

    for frame in frames.values():
        if (
            "cmdDesc"
            not in frame.columns
        ):
            continue

        values = (
            frame["cmdDesc"]
            .dropna()
            .astype(str)
            .unique()
            .tolist()
        )

        descriptions.extend(
            values
        )

    description = (
        descriptions[0]
        if descriptions
        else f"HS {args.code}"
    )

    annual = {}
    qa_failures = []
    qa_warnings = []

    previous_imports = None
    previous_exports = None

    for year in all_years:
        gimp = year_frame(
            frames[
                "global_imports"
            ],
            year,
        )

        gexp = year_frame(
            frames[
                "global_exports"
            ],
            year,
        )

        iimp = year_frame(
            frames[
                "india_imports"
            ],
            year,
        )

        iexp = year_frame(
            frames[
                "india_exports"
            ],
            year,
        )

        import_rank = ranking(
            gimp
        )

        export_rank = ranking(
            gexp
        )

        observed_imports = (
            float(
                import_rank["total"]
            )
            if import_rank
            and import_rank.get(
                "total"
            )
            is not None
            else None
        )

        observed_exports = (
            float(
                export_rank["total"]
            )
            if export_rank
            and export_rank.get(
                "total"
            )
            is not None
            else None
        )

        if (
            year
            < args.analysis_start_year
        ):
            import_coverage = {
                "status":
                    "HISTORICAL"
            }

            export_coverage = {
                "status":
                    "HISTORICAL"
            }

        elif (
            year
            == args.analysis_start_year
            or previous_imports
            is None
        ):
            import_coverage = (
                baseline_coverage(
                    int(
                        import_rank.get(
                            "reporterCount",
                            0,
                        )
                    )
                )
            )

        else:
            import_coverage = (
                assess_coverage(
                    gimp,
                    previous_imports,
                )
            )

        if (
            year
            < args.analysis_start_year
        ):
            pass

        elif (
            year
            == args.analysis_start_year
            or previous_exports
            is None
        ):
            export_coverage = (
                baseline_coverage(
                    int(
                        export_rank.get(
                            "reporterCount",
                            0,
                        )
                    )
                )
            )

        else:
            export_coverage = (
                assess_coverage(
                    gexp,
                    previous_exports,
                )
            )

        import_valid = (
            import_coverage.get(
                "status"
            )
            == "VALID"
        )

        export_valid = (
            export_coverage.get(
                "status"
            )
            == "VALID"
        )

        import_india = (
            import_rank.get(
                "india"
            )
            or {}
        )

        export_india = (
            export_rank.get(
                "india"
            )
            or {}
        )

        india_imports = (
            world_value(
                iimp
            )
        )

        india_exports = (
            world_value(
                iexp
            )
        )

        suppliers = partners(
            bilateral_frame(
                iimp
            ),
            india_imports,
        )

        destinations = partners(
            bilateral_frame(
                iexp
            ),
            india_exports,
        )

        rec_import_ok, rec_import_msg = (
            reconcile_india(
                india_imports,
                import_rank,
            )
        )

        rec_export_ok, rec_export_msg = (
            reconcile_india(
                india_exports,
                export_rank,
            )
        )

        if not rec_import_ok:
            qa_failures.append(
                {
                    "year": year,
                    "flow": "imports",
                    "message":
                        rec_import_msg
                        or (
                            "India/global import "
                            "reconciliation failed"
                        ),
                }
            )

        if not rec_export_ok:
            qa_failures.append(
                {
                    "year": year,
                    "flow": "exports",
                    "message":
                        rec_export_msg
                        or (
                            "India/global export "
                            "reconciliation failed"
                        ),
                }
            )

        for label, result in [
            (
                "suppliers",
                suppliers,
            ),
            (
                "destinations",
                destinations,
            ),
        ]:
            coverage = (
                result.get(
                    "coverage"
                )
            )

            if (
                coverage
                is not None
                and not (
                    0.95
                    <= float(
                        coverage
                    )
                    <= 1.05
                )
            ):
                qa_warnings.append(
                    {
                        "year": year,
                        "metric":
                            label,
                        "message":
                            (
                                "Bilateral partner "
                                "coverage is "
                                f"{coverage:.4f}"
                            ),
                    }
                )

        balance = (
            float(
                india_exports
                - india_imports
            )
            if (
                india_imports
                is not None
                and india_exports
                is not None
            )
            else None
        )

        annual[
            str(year)
        ] = {
            "global": {
                "observedImports":
                    observed_imports,
                "observedExports":
                    observed_exports,

                "imports":
                    (
                        observed_imports
                        if import_valid
                        else None
                    ),

                "exports":
                    (
                        observed_exports
                        if export_valid
                        else None
                    ),

                "importRankIndia":
                    (
                        import_india.get(
                            "rank"
                        )
                        if import_valid
                        else None
                    ),

                "importShareIndia":
                    (
                        import_india.get(
                            "share"
                        )
                        if import_valid
                        else None
                    ),

                "exportRankIndia":
                    (
                        export_india.get(
                            "rank"
                        )
                        if export_valid
                        else None
                    ),

                "exportShareIndia":
                    (
                        export_india.get(
                            "share"
                        )
                        if export_valid
                        else None
                    ),

                "topImporters":
                    (
                        import_rank.get(
                            "top10",
                            [],
                        )
                        if import_valid
                        else []
                    ),

                "topExporters":
                    (
                        export_rank.get(
                            "top10",
                            [],
                        )
                        if export_valid
                        else []
                    ),

                "mirror":
                    mirror(
                        observed_imports,
                        observed_exports,
                    ),

                "importCoverage":
                    import_coverage,

                "exportCoverage":
                    export_coverage,
            },

            "india": {
                "imports":
                    india_imports,

                "exports":
                    india_exports,

                "balance":
                    balance,

                "suppliers":
                    suppliers,

                "destinations":
                    destinations,

                # Parent HS categories do not
                # represent ITC(HS)-8 tariff lines.
                "hs8": [],
            },
        }

        previous_imports = gimp
        previous_exports = gexp

    benchmarks = {
        "globalImports":
            latest_valid_benchmark(
                annual,
                "imports",
            ),

        "globalExports":
            latest_valid_benchmark(
                annual,
                "exports",
            ),
    }

    latest_india_year = max(
        year
        for year in all_years
        if (
            annual[
                str(year)
            ]["india"][
                "imports"
            ]
            is not None
            or annual[
                str(year)
            ]["india"][
                "exports"
            ]
            is not None
        )
    )

    metadata = (
        template_metadata()
    )

    parent_code = (
        args.code[:2]
        if args.level == 4
        else None
    )

    category = {
        "schemaVersion":
            metadata[
                "schemaVersion"
            ],

        "classification":
            metadata[
                "classification"
            ],

        "level":
            args.level,

        "code":
            args.code,

        "description":
            description,

        "parentCode":
            parent_code,

        "latestIndiaYear":
            latest_india_year,

        "years":
            all_years,

        "annual":
            annual,

        "benchmarks":
            benchmarks,

        "sources":
            clean_source_contract(),

        "refreshedAt":
            utc_now(),
    }

    write_json(
        out
        / "category.json",
        category,
    )

    qa = {
        "level":
            args.level,
        "code":
            args.code,
        "years":
            all_years,
        "failures":
            qa_failures,
        "warnings":
            qa_warnings,
    }

    write_json(
        out
        / "qa.json",
        qa,
    )

    print(
        "=" * 78
    )

    print(
        f"Processed HS-{args.level} "
        f"{args.code}"
    )

    print(
        "Years:",
        all_years
    )

    print(
        "Import benchmark:",
        benchmarks[
            "globalImports"
        ]
    )

    print(
        "Export benchmark:",
        benchmarks[
            "globalExports"
        ]
    )

    print(
        "QA failures:",
        len(
            qa_failures
        )
    )

    print(
        "QA warnings:",
        len(
            qa_warnings
        )
    )

    print(
        "Output:",
        out
        / "category.json"
    )


if __name__ == "__main__":
    main()
