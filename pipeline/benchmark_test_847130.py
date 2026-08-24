from pathlib import Path
import pandas as pd

from coverage import assess_coverage


ROOT = Path("data/raw/test_847130")


def load(flow: str, year: int) -> pd.DataFrame:
    path = ROOT / f"{flow}_{year}.parquet"

    if not path.exists():
        raise RuntimeError(f"Missing {path}")

    df = pd.read_parquet(path).copy()

    required = {
        "reporterCode",
        "reporterDesc",
        "primaryValue",
    }

    missing = required - set(df.columns)

    if missing:
        raise RuntimeError(
            f"{path.name}: missing {sorted(missing)}"
        )

    df["reporterCode"] = df["reporterCode"].astype(str)

    df["primaryValue"] = pd.to_numeric(
        df["primaryValue"],
        errors="coerce",
    )

    df = df.dropna(subset=["primaryValue"])

    df = df.sort_values(
        "primaryValue",
        ascending=False,
    ).reset_index(drop=True)

    return df


def audit(flow: str):
    print("\n" + "=" * 90)
    print(flow.upper())
    print("=" * 90)

    frames = {
        year: load(flow, year)
        for year in [2023, 2024, 2025]
    }

    results = {}

    for year in [2024, 2025]:
        result = assess_coverage(
            frames[year],
            frames[year - 1],
        )

        results[year] = result

        total = float(
            frames[year]["primaryValue"].sum()
        )

        print(f"\nYEAR {year}")
        print(
            "Reported total:",
            f"${total / 1e9:,.3f} bn",
        )

        print("Status:", result["status"])

        for key in [
            "candidateReporters",
            "previousReporters",
            "reporterCountRatio",
            "priorTop1Present",
            "priorTop10Present",
            "priorTop20ValueCoverage",
        ]:
            value = result.get(key)

            if isinstance(value, float):
                print(key, f"{value:.3%}")
            else:
                print(key, value)

        missing = result.get(
            "missingPriorTop10",
            [],
        )

        if missing:
            print("Missing prior top-10 reporters:")

            for row in missing:
                print(
                    " ",
                    row.get("reporterCode"),
                    row.get("reporterDesc"),
                    f"${row.get('primaryValue', 0)/1e9:,.3f} bn",
                )

    latest_valid = next(
        (
            year
            for year in [2025, 2024]
            if results[year]["status"] == "VALID"
        ),
        None,
    )

    latest_usable = next(
        (
            year
            for year in [2025, 2024]
            if results[year]["status"]
            in {"VALID", "CAUTION"}
        ),
        None,
    )

    print("\nLatest VALID benchmark:", latest_valid)
    print("Latest usable benchmark:", latest_usable)


for flow in [
    "global_imports",
    "global_exports",
]:
    audit(flow)
