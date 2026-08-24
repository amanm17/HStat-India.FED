from pathlib import Path
import os
import pandas as pd
import comtradeapicall

OUT = Path("data/raw/test_847130")
OUT.mkdir(parents=True, exist_ok=True)

KEY = os.getenv("COMTRADE_API_KEY")
if not KEY:
    raise RuntimeError("COMTRADE_API_KEY is not loaded")

CMD = "847130"

jobs = [
    ("india_imports", "699", "M", None),
    ("india_exports", "699", "X", None),
    ("global_imports", None, "M", "0"),
    ("global_exports", None, "X", "0"),
]

for year in ["2024", "2025"]:
    for label, reporter, flow, partner in jobs:
        name = f"{label}_{year}"

        print(f"\nFetching {name}...")

        df = comtradeapicall.getFinalData(
            KEY,
            typeCode="C",
            freqCode="A",
            clCode="HS",
            period=year,
            reporterCode=reporter,
            cmdCode=CMD,
            flowCode=flow,
            partnerCode=partner,
            partner2Code=None,
            customsCode=None,
            motCode=None,
            maxRecords=250000,
            format_output="JSON",
            aggregateBy=None,
            breakdownMode="classic",
            countOnly=None,
            includeDesc=True,
        )

        if df is None:
            raise RuntimeError(f"{name}: API returned None")

        if df.empty:
            print(f"WARNING: {name} returned 0 rows")
            print("Columns:", list(df.columns))
            continue

        required = {
            "refYear",
            "reporterCode",
            "partnerCode",
            "cmdCode",
            "primaryValue",
        }

        missing = required - set(df.columns)

        if missing:
            raise RuntimeError(
                f"{name}: missing expected columns {sorted(missing)}"
            )

        print("Rows:", len(df))
        print("Reporters:", df["reporterCode"].nunique())
        print("Partners:", df["partnerCode"].nunique())

        path = OUT / f"{name}.parquet"
        df.to_parquet(path, index=False)

        print("Saved:", path)

print("\nControlled pull complete.")
