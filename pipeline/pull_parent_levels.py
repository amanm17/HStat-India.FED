from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import pandas as pd
import comtradeapicall


ROOT = Path(__file__).resolve().parents[1]


def pull(
    key: str,
    year: int,
    code: str,
    flow: str,
    reporter: str | None,
):
    kwargs = dict(
        subscription_key=key,
        typeCode="C",
        freqCode="A",
        clCode="HS",
        period=str(year),
        reporterCode=reporter,
        cmdCode=code,
        flowCode=flow,
        partnerCode=0,
        partner2Code=0,
        customsCode="C00",
        motCode=0,
        maxRecords=250000,
        aggregateBy=None,
        breakdownMode="classic",
        includeDesc=True,
    )

    df = comtradeapicall.getFinalData(
        **kwargs
    )

    if df is None:
        return pd.DataFrame()

    return df


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--start-year",
        type=int,
        default=2022,
    )

    parser.add_argument(
        "--end-year",
        type=int,
        default=2025,
    )

    parser.add_argument(
        "--out",
        default="data/raw/parents_2022_2025",
    )

    parser.add_argument(
        "--only",
        default=None,
        help="Optional single code for testing",
    )

    args = parser.parse_args()

    key = os.environ.get(
        "COMTRADE_API_KEY"
    )

    if not key:
        raise RuntimeError(
            "COMTRADE_API_KEY not loaded"
        )

    universe = json.loads(
        (
            ROOT
            / "config"
            / "parent_universe.json"
        ).read_text()
    )

    codes = []

    for level, items in universe.items():
        for code in items:
            if (
                args.only is None
                or code == args.only
            ):
                codes.append(
                    (
                        int(level),
                        code,
                    )
                )

    out = ROOT / args.out
    out.mkdir(
        parents=True,
        exist_ok=True,
    )

    manifest = []

    for level, code in codes:
        for year in range(
            args.start_year,
            args.end_year + 1,
        ):
            for flow, flow_code in [
                ("imports", "M"),
                ("exports", "X"),
            ]:
                print(
                    f"HS-{level} {code} "
                    f"{year} {flow}"
                )

                # Global reporters -> World
                global_df = pull(
                    key,
                    year,
                    code,
                    flow_code,
                    None,
                )

                # India -> all partners
                india_df = pull(
                    key,
                    year,
                    code,
                    flow_code,
                    "699",
                )

                base = (
                    out
                    / str(level)
                    / code
                    / str(year)
                )

                base.mkdir(
                    parents=True,
                    exist_ok=True,
                )

                global_path = (
                    base
                    / f"global_{flow}.parquet"
                )

                india_path = (
                    base
                    / f"india_{flow}.parquet"
                )

                global_df.to_parquet(
                    global_path,
                    index=False,
                )

                india_df.to_parquet(
                    india_path,
                    index=False,
                )

                manifest.append(
                    {
                        "level": level,
                        "code": code,
                        "year": year,
                        "flow": flow,
                        "globalRows":
                            len(global_df),
                        "indiaRows":
                            len(india_df),
                    }
                )

    (
        out
        / "manifest.json"
    ).write_text(
        json.dumps(
            manifest,
            indent=2,
        )
    )

    print(
        f"\nWrote {len(manifest)} pull records."
    )


if __name__ == "__main__":
    main()
