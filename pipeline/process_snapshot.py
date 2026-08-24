from __future__ import annotations

from pathlib import Path
import argparse
import json

import pandas as pd

from common import (
    ROOT,
    PUBLIC,
    DGCIS_NORMALIZED,
    require_trade_frame,
    filter_classic,
    assert_unique,
    write_json,
    utc_now,
)
from coverage import assess_coverage


def hs_slice(df: pd.DataFrame, hs: str, year: int) -> pd.DataFrame:
    return df[
        (df["cmdCode"] == hs)
        & (df["refYear"] == year)
    ].copy()


def world_row(
    df: pd.DataFrame,
    hs: str,
    year: int,
):
    """
    Return India's World-partner aggregate row for one HS/year/flow.
    """
    z = hs_slice(df, hs, year)

    z = z[
        z["partnerCode"].astype(str).isin(
            ["0", "0.0"]
        )
    ].copy()

    assert_unique(
        z,
        [
            "reporterCode",
            "cmdCode",
            "refYear",
            "flowCode",
        ],
        f"{hs}/{year} India World",
    )

    if z.empty:
        return None

    return z.iloc[0]


def partner_rows(
    df: pd.DataFrame,
    hs: str,
    year: int,
) -> pd.DataFrame:
    """
    Individual partner-economy rows for India.
    Excludes the World aggregate.
    """
    z = hs_slice(df, hs, year)

    z = z[
        ~z["partnerCode"]
        .astype(str)
        .isin(["0", "0.0", ""])
    ].copy()

    assert_unique(
        z,
        [
            "partnerCode",
            "cmdCode",
            "refYear",
            "flowCode",
        ],
        f"{hs}/{year} India partners",
    )

    return z.sort_values(
        "primaryValue",
        ascending=False,
    ).reset_index(drop=True)


def reporter_rows(
    df: pd.DataFrame,
    hs: str,
    year: int,
) -> pd.DataFrame:
    """
    One World-partner total per reporting economy.
    Used for global totals and rankings.
    """
    z = hs_slice(df, hs, year)

    z = z[
        z["partnerCode"]
        .astype(str)
        .isin(["0", "0.0"])
    ].copy()

    assert_unique(
        z,
        [
            "reporterCode",
            "cmdCode",
            "refYear",
            "flowCode",
        ],
        f"{hs}/{year} global reporters",
    )

    return z.sort_values(
        "primaryValue",
        ascending=False,
    ).reset_index(drop=True)


def ranking(
    frame: pd.DataFrame,
    india_code: str = "699",
):
    """
    Calculate reported global total and reporter ranking.

    This function performs arithmetic only.
    Whether these metrics may be published is decided separately
    by the reporter-coverage engine.
    """
    if frame.empty:
        return None

    frame = frame.copy()

    frame["primaryValue"] = pd.to_numeric(
        frame["primaryValue"],
        errors="coerce",
    )

    frame = frame.dropna(
        subset=["primaryValue"]
    )

    frame = frame[
        frame["primaryValue"] >= 0
    ]

    frame = frame.sort_values(
        "primaryValue",
        ascending=False,
    ).reset_index(drop=True)

    if frame.empty:
        return None

    total = float(
        frame["primaryValue"].sum()
    )

    if total <= 0:
        return None

    rows = []

    for i, (_, r) in enumerate(
        frame.iterrows(),
        start=1,
    ):
        value = float(
            r["primaryValue"]
        )

        rows.append(
            {
                "rank": i,
                "code": str(
                    r["reporterCode"]
                ),
                "name": str(
                    r.get(
                        "reporterDesc",
                        r["reporterCode"],
                    )
                ),
                "value": value,
                "share": value / total,
            }
        )

    india = next(
        (
            row
            for row in rows
            if row["code"] == india_code
        ),
        None,
    )

    return {
        "total": total,
        "india": india,
        "top10": rows[:10],
        "reporterCount": len(rows),
    }


def partners(
    frame: pd.DataFrame,
    world_total,
):
    """
    India bilateral partner analysis.

    HHI and top-3 share are published only when the sum of
    partner rows reconciles reasonably with India's World total.
    """
    if (
        frame.empty
        or world_total is None
        or world_total <= 0
    ):
        return {
            "rows": [],
            "coverage": None,
            "hhi": None,
            "top3Share": None,
        }

    frame = frame.copy()

    frame["primaryValue"] = pd.to_numeric(
        frame["primaryValue"],
        errors="coerce",
    )

    frame = frame.dropna(
        subset=["primaryValue"]
    )

    frame = frame[
        frame["primaryValue"] >= 0
    ]

    frame = frame.sort_values(
        "primaryValue",
        ascending=False,
    )

    partner_sum = float(
        frame["primaryValue"].sum()
    )

    coverage = (
        partner_sum / world_total
        if world_total > 0
        else None
    )

    rows = []

    for _, r in frame.head(15).iterrows():
        value = float(
            r["primaryValue"]
        )

        rows.append(
            {
                "code": str(
                    r["partnerCode"]
                ),
                "name": str(
                    r.get(
                        "partnerDesc",
                        r["partnerCode"],
                    )
                ),
                "value": value,
                "share": value / world_total,
            }
        )

    # Concentration metrics are withheld if bilateral
    # partner rows do not reconcile with the World aggregate.
    if (
        coverage is not None
        and 0.95 <= coverage <= 1.05
    ):
        shares = (
            frame["primaryValue"]
            / world_total
        )

        hhi = float(
            (shares ** 2).sum()
        )

        top3_share = float(
            shares.head(3).sum()
        )

    else:
        hhi = None
        top3_share = None

    return {
        "rows": rows,
        "coverage": coverage,
        "hhi": hhi,
        "top3Share": top3_share,
    }


def dgcis_for(
    hs: str,
    year: int,
):
    """
    Return national ITC(HS)-8 rows beneath an HS-6 code
    where a normalized DGCIS / TradeStat export exists.
    """
    path = (
        DGCIS_NORMALIZED
        / "latest.parquet"
    )

    if not path.exists():
        return []

    df = pd.read_parquet(path)

    z = df[
        df["hs6"].astype(str) == hs
    ].copy()

    if z.empty:
        return []

    if "year" in z.columns:
        year_rows = z[
            z["year"]
            .astype(str)
            .str.contains(
                str(year),
                regex=False,
            )
        ]

        if not year_rows.empty:
            z = year_rows

    if z.empty:
        return []

    grouped = (
        z.groupby(
            [
                "hs8",
                "description",
                "flow",
            ],
            dropna=False,
        )["value"]
        .sum()
        .reset_index()
    )

    pivot = grouped.pivot_table(
        index=[
            "hs8",
            "description",
        ],
        columns="flow",
        values="value",
        aggfunc="sum",
        fill_value=0,
    ).reset_index()

    rows = []

    for _, r in pivot.iterrows():
        imports = float(
            r.get("M", 0)
        )

        exports = float(
            r.get("X", 0)
        )

        rows.append(
            {
                "hs8": str(
                    r["hs8"]
                ),
                "description": str(
                    r["description"]
                ),
                "imports": imports,
                "exports": exports,
                "balance": (
                    exports - imports
                ),
            }
        )

    return sorted(
        rows,
        key=lambda x: (
            x["imports"]
            + x["exports"]
        ),
        reverse=True,
    )


def reconcile_india(
    direct_value,
    ranking_result,
):
    """
    Reconcile India's direct India→World value with the India row
    in the all-reporters global frame.

    Returns:
        (True, None) if reconciled,
        (False, reason) otherwise.
    """
    if direct_value is None:
        return (
            False,
            "India direct value unavailable",
        )

    if (
        ranking_result is None
        or ranking_result.get("india")
        is None
    ):
        return (
            False,
            "India absent from global reporter frame",
        )

    global_value = float(
        ranking_result["india"]["value"]
    )

    delta = abs(
        global_value - direct_value
    )

    tolerance = max(
        1_000_000,
        abs(direct_value) * 0.01,
    )

    if delta > tolerance:
        return (
            False,
            (
                "India direct/global mismatch: "
                f"{delta:.2f}"
            ),
        )

    return True, None


def latest_valid_benchmark(
    annual: dict,
    flow: str,
):
    """
    Select the latest year that passed VALID reporter coverage.

    CAUTION and INVALID years are not used for headline benchmarks.
    """
    if flow == "imports":
        coverage_key = (
            "importCoverage"
        )
        value_key = "imports"
        rank_key = (
            "importRankIndia"
        )
        share_key = (
            "importShareIndia"
        )
        top_key = "topImporters"

    elif flow == "exports":
        coverage_key = (
            "exportCoverage"
        )
        value_key = "exports"
        rank_key = (
            "exportRankIndia"
        )
        share_key = (
            "exportShareIndia"
        )
        top_key = "topExporters"

    else:
        raise ValueError(
            f"Unknown flow: {flow}"
        )

    years = sorted(
        (
            int(y)
            for y in annual.keys()
        ),
        reverse=True,
    )

    for year in years:
        record = (
            annual[str(year)]["global"]
        )

        coverage = record.get(
            coverage_key,
            {},
        )

        if (
            coverage.get("status")
            != "VALID"
        ):
            continue

        value = record.get(
            value_key
        )

        if value is None:
            continue

        return {
            "year": year,
            "status": "VALID",
            "value": value,
            "indiaRank": record.get(
                rank_key
            ),
            "indiaShare": record.get(
                share_key
            ),
            "top10": record.get(
                top_key,
                [],
            ),
        }

    return None


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--raw-dir",
        required=True,
    )

    parser.add_argument(
        "--out",
        required=True,
    )

    parser.add_argument(
        "--start-year",
        type=int,
        required=True,
    )

    parser.add_argument(
        "--analysis-start-year",
        type=int,
        default=2022,
    )

    parser.add_argument(
        "--end-year",
        type=int,
        required=True,
    )

    args = parser.parse_args()

    raw = Path(
        args.raw_dir
    )

    out = Path(
        args.out
    )

    products_dir = (
        out / "products"
    )

    products_dir.mkdir(
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
            raw / f"{name}.parquet"
        )

        frame = pd.read_parquet(
            path
        )

        frame = require_trade_frame(
            frame,
            name,
        )

        frame = filter_classic(
            frame
        )

        frames[name] = frame

    codes = [
        x.strip()
        for x in (
            ROOT
            / "config"
            / "hs6_universe.txt"
        )
        .read_text()
        .splitlines()
        if x.strip()
    ]

    library = json.loads(
        (
            PUBLIC
            / "hs-library.json"
        ).read_text()
    )

    descriptions = {
        x["code"]: x["description"]
        for x in library
    }

    catalogue = []

    for hs in codes:
        annual = {}

        for year in range(
            args.start_year,
            args.end_year + 1,
        ):
            india_import_world = (
                world_row(
                    frames[
                        "india_imports"
                    ],
                    hs,
                    year,
                )
            )

            india_export_world = (
                world_row(
                    frames[
                        "india_exports"
                    ],
                    hs,
                    year,
                )
            )

            india_imports = (
                float(
                    india_import_world[
                        "primaryValue"
                    ]
                )
                if india_import_world
                is not None
                else None
            )

            india_exports = (
                float(
                    india_export_world[
                        "primaryValue"
                    ]
                )
                if india_export_world
                is not None
                else None
            )

            suppliers = partners(
                partner_rows(
                    frames[
                        "india_imports"
                    ],
                    hs,
                    year,
                ),
                india_imports,
            )

            destinations = partners(
                partner_rows(
                    frames[
                        "india_exports"
                    ],
                    hs,
                    year,
                ),
                india_exports,
            )

            global_import_frame = (
                reporter_rows(
                    frames[
                        "global_imports"
                    ],
                    hs,
                    year,
                )
            )

            global_export_frame = (
                reporter_rows(
                    frames[
                        "global_exports"
                    ],
                    hs,
                    year,
                )
            )

            observed_imports = (
                float(
                    global_import_frame[
                        "primaryValue"
                    ].sum()
                )
                if not global_import_frame.empty
                else None
            )

            observed_exports = (
                float(
                    global_export_frame[
                        "primaryValue"
                    ].sum()
                )
                if not global_export_frame.empty
                else None
            )

            if (
                year > args.analysis_start_year
            ):
                prior_import_frame = (
                    reporter_rows(
                        frames[
                            "global_imports"
                        ],
                        hs,
                        year - 1,
                    )
                )

                prior_export_frame = (
                    reporter_rows(
                        frames[
                            "global_exports"
                        ],
                        hs,
                        year - 1,
                    )
                )

                import_coverage = (
                    assess_coverage(
                        global_import_frame,
                        prior_import_frame,
                    )
                )

                export_coverage = (
                    assess_coverage(
                        global_export_frame,
                        prior_export_frame,
                    )
                )

            else:
                status = (
                    "HISTORICAL"
                    if year < args.analysis_start_year
                    else "BASELINE"
                )

                reason = (
                    "Historical context outside the HS-2022 benchmark window"
                    if status == "HISTORICAL"
                    else "No preceding year inside validation window"
                )

                import_coverage = {
                    "status": status,
                    "reason": reason,
                }

                export_coverage = {
                    "status": status,
                    "reason": reason,
                }

            import_rank_raw = ranking(
                global_import_frame
            )

            export_rank_raw = ranking(
                global_export_frame
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

            # Reconcile India's value in the global reporter
            # universe against its direct India→World value.
            if import_valid:
                ok, reason = (
                    reconcile_india(
                        india_imports,
                        import_rank_raw,
                    )
                )

                if not ok:
                    import_valid = False
                    import_coverage[
                        "status"
                    ] = "INVALID"

                    import_coverage[
                        "reconciliation"
                    ] = reason

            if export_valid:
                ok, reason = (
                    reconcile_india(
                        india_exports,
                        export_rank_raw,
                    )
                )

                if not ok:
                    export_valid = False
                    export_coverage[
                        "status"
                    ] = "INVALID"

                    export_coverage[
                        "reconciliation"
                    ] = reason

            publish_imports = (
                import_rank_raw
                if import_valid
                else None
            )

            publish_exports = (
                export_rank_raw
                if export_valid
                else None
            )

            mirror_ratio = None
            mirror_status = "UNAVAILABLE"

            if (
                observed_imports is not None
                and observed_exports is not None
                and observed_exports > 0
            ):
                mirror_ratio = (
                    observed_imports
                    / observed_exports
                )

                if 0.70 <= mirror_ratio <= 1.50:
                    mirror_status = "OK"
                else:
                    mirror_status = "WARNING"

            annual[str(year)] = {
                "india": {
                    "imports": (
                        india_imports
                    ),
                    "exports": (
                        india_exports
                    ),
                    "balance": (
                        india_exports
                        - india_imports
                        if (
                            india_exports
                            is not None
                            and india_imports
                            is not None
                        )
                        else None
                    ),
                    "suppliers": (
                        suppliers
                    ),
                    "destinations": (
                        destinations
                    ),
                    "hs8": dgcis_for(
                        hs,
                        year,
                    ),
                },

                "global": {
                    # Raw observable reporter sums.
                    # Retained for QA and audit.
                    "observedImports": (
                        observed_imports
                    ),
                    "observedExports": (
                        observed_exports
                    ),

                    # Publishable metrics.
                    # Null unless coverage == VALID.
                    "imports": (
                        publish_imports[
                            "total"
                        ]
                        if publish_imports
                        else None
                    ),

                    "exports": (
                        publish_exports[
                            "total"
                        ]
                        if publish_exports
                        else None
                    ),

                    "importRankIndia": (
                        publish_imports[
                            "india"
                        ]["rank"]
                        if (
                            publish_imports
                            and publish_imports[
                                "india"
                            ]
                        )
                        else None
                    ),

                    "importShareIndia": (
                        publish_imports[
                            "india"
                        ]["share"]
                        if (
                            publish_imports
                            and publish_imports[
                                "india"
                            ]
                        )
                        else None
                    ),

                    "exportRankIndia": (
                        publish_exports[
                            "india"
                        ]["rank"]
                        if (
                            publish_exports
                            and publish_exports[
                                "india"
                            ]
                        )
                        else None
                    ),

                    "exportShareIndia": (
                        publish_exports[
                            "india"
                        ]["share"]
                        if (
                            publish_exports
                            and publish_exports[
                                "india"
                            ]
                        )
                        else None
                    ),

                    "topImporters": (
                        publish_imports[
                            "top10"
                        ]
                        if publish_imports
                        else []
                    ),

                    "topExporters": (
                        publish_exports[
                            "top10"
                        ]
                        if publish_exports
                        else []
                    ),

                    "mirror": {
                        "importExportRatio": (
                            mirror_ratio
                        ),
                        "status": (
                            mirror_status
                        ),
                    },

                    "importCoverage": (
                        import_coverage
                    ),

                    "exportCoverage": (
                        export_coverage
                    ),
                },
            }

        analytical_annual = {
            y: record
            for y, record in annual.items()
            if int(y) >= args.analysis_start_year
        }

        global_import_benchmark = (
            latest_valid_benchmark(
                analytical_annual,
                "imports",
            )
        )

        global_export_benchmark = (
            latest_valid_benchmark(
                analytical_annual,
                "exports",
            )
        )

        # Latest year for which India itself has at least one
        # direct trade value.
        latest_india_year = None

        for year in sorted(
            (
                int(y)
                for y in annual.keys()
            ),
            reverse=True,
        ):
            india = annual[
                str(year)
            ]["india"]

            if (
                india["imports"]
                is not None
                or india["exports"]
                is not None
            ):
                latest_india_year = year
                break

        product = {
            "schemaVersion": "1.0.0",

            "hs6": hs,

            "description": (
                descriptions.get(
                    hs,
                    "",
                )
            ),

            "classification": (
                "HS 2022 (H6)"
            ),

            "refreshedAt": utc_now(),

            "years": list(
                range(
                    args.start_year,
                    args.end_year + 1,
                )
            ),

            "analyticalYears": list(
                range(
                    args.analysis_start_year,
                    args.end_year + 1,
                )
            ),

            "latestIndiaYear": (
                latest_india_year
            ),

            "benchmarks": {
                "globalImports": (
                    global_import_benchmark
                ),
                "globalExports": (
                    global_export_benchmark
                ),
            },

            "annual": annual,

            "sources": {
                "global": (
                    "UN Comtrade"
                ),
                "indiaHs6": (
                    "UN Comtrade"
                ),
                "indiaHs8": (
                    "DGCIS / TradeStat "
                    "official export "
                    "when supplied"
                ),
            },
        }

        write_json(
            products_dir
            / f"{hs}.json",
            product,
        )

        catalogue.append(
            {
                "hs6": hs,
                "description": (
                    product[
                        "description"
                    ]
                ),
                "years": (
                    product["years"]
                ),
                "latestIndiaYear": (
                    latest_india_year
                ),
                "globalImportBenchmarkYear": (
                    global_import_benchmark[
                        "year"
                    ]
                    if global_import_benchmark
                    else None
                ),
                "globalExportBenchmarkYear": (
                    global_export_benchmark[
                        "year"
                    ]
                    if global_export_benchmark
                    else None
                ),
            }
        )

    write_json(
        out / "catalogue.json",
        catalogue,
    )

    write_json(
        out / "hs-library.json",
        library,
    )

    write_json(
        out / "manifest.json",
        {
            "schemaVersion": "1.0.0",
            "refreshedAt": utc_now(),
            "classification": (
                "HS 2022 (H6)"
            ),
            "startYear": (
                args.start_year
            ),
            "endYear": (
                args.end_year
            ),
            "products": (
                len(catalogue)
            ),
        },
    )

    print(
        f"Staging snapshot: "
        f"{len(catalogue)} products "
        f"-> {out}"
    )


if __name__ == "__main__":
    main()
