from pathlib import Path
import argparse

from common import (
    ROOT,
    api_key,
    require_trade_frame,
    filter_classic,
    utc_now,
    write_json,
)

from pull_comtrade import call_final


MAX_RECORDS = 250000


def main():
    p = argparse.ArgumentParser()

    p.add_argument(
        "--code",
        required=True,
    )

    p.add_argument(
        "--level",
        type=int,
        choices=[2, 4],
        required=True,
    )

    p.add_argument(
        "--start-year",
        type=int,
        required=True,
    )

    p.add_argument(
        "--end-year",
        type=int,
        required=True,
    )

    p.add_argument(
        "--out",
        required=True,
    )

    a = p.parse_args()

    if len(a.code) != a.level:
        raise RuntimeError(
            f"Code {a.code} is not HS-{a.level}"
        )

    if not a.code.isdigit():
        raise RuntimeError(
            "HS code must be numeric"
        )

    key = api_key()

    periods = ",".join(
        str(y)
        for y in range(
            a.start_year,
            a.end_year + 1,
        )
    )

    out = Path(a.out)

    out.mkdir(
        parents=True,
        exist_ok=True,
    )

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

    manifest = {
        "pulledAt": utc_now(),
        "classification": "HS",
        "requestedLevel": a.level,
        "requestedCode": a.code,
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
            f"Fetching HS-{a.level} "
            f"{a.code} · {label}..."
        )

        raw = call_final(
            key,
            periods,
            reporter,
            a.code,
            flow,
            partner,
        )

        df = filter_classic(
            require_trade_frame(
                raw,
                label,
            )
        )

        if len(df) >= MAX_RECORDS:
            raise RuntimeError(
                f"{label}: response reached "
                f"{MAX_RECORDS:,} rows; "
                "query must be split before use"
            )

        path = (
            out
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
        out / "manifest.json",
        manifest,
    )

    print(
        "\nRaw parent test stored:",
        out,
    )


if __name__ == "__main__":
    main()
