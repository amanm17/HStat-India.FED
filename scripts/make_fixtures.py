#!/usr/bin/env python3
"""
Generate a synthetic raw store so the pipeline can be exercised without an
API key or a network connection.

The shapes matter, not the values: reporter-to-World rows for every flow,
India present both in the all-reporters frame and in its own partner-level
frame with the two reconciling exactly, re-import and re-export sub-flows
filed by only some reporters, and a stable reporter set year to year so
the coverage engine has something realistic to judge.

    python scripts/make_fixtures.py --out data/raw/store-fixture --codes 12

Then process it without touching Comtrade:

    python pipeline/process_snapshot.py \
        --raw-store data/raw/store-fixture \
        --out data/staging/fixture \
        --end-year 2025
"""

from __future__ import annotations

from pathlib import Path
import argparse
import random
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))

from common import (  # noqa: E402
    FLOW_EXPORTS,
    FLOW_IMPORTS,
    FLOW_RE_EXPORTS,
    FLOW_RE_IMPORTS,
    INDIA_REPORTER,
    annual_periods,
    monthly_periods,
)
from definition import (  # noqa: E402
    load_lineage,
    pull_universe,
    successors_of as load_successors,
)


def lifespans() -> dict:
    """
    When each code carries data, so the fixture reproduces an HS revision.

    Without this every code has data in every year and the lineage path is
    never exercised - the one thing a fixture for this feature has to get
    right.
    """
    starts: dict[str, int] = {}
    ends: dict[str, int] = {}

    for item in load_lineage():
        if not item.predecessor or item.predecessor_valid_to is None:
            continue

        ends[item.predecessor] = item.predecessor_valid_to

        starts[item.code] = item.predecessor_valid_to + 1

    return {"starts": starts, "ends": ends}

REPORTERS = [
    ("156", "China"),
    ("842", "USA"),
    ("276", "Germany"),
    ("392", "Japan"),
    ("410", "Rep. of Korea"),
    ("158", "Taipei, Chinese"),
    ("702", "Singapore"),
    ("344", "China, Hong Kong SAR"),
    ("458", "Malaysia"),
    ("764", "Thailand"),
    ("704", "Viet Nam"),
    ("528", "Netherlands"),
    ("484", "Mexico"),
    ("124", "Canada"),
    ("826", "United Kingdom"),
    ("250", "France"),
    ("380", "Italy"),
    ("724", "Spain"),
    ("616", "Poland"),
    ("203", "Czechia"),
    ("36", "Australia"),
    ("76", "Brazil"),
    ("784", "United Arab Emirates"),
    ("682", "Saudi Arabia"),
    ("710", "South Africa"),
    ("360", "Indonesia"),
    ("608", "Philippines"),
    ("792", "Türkiye"),
    ("643", "Russian Federation"),
    (INDIA_REPORTER, "India"),
]

# Reporters that file RM / RX as separate sub-flows.
FILES_SUBFLOWS = {
    "344", "702", "528", "784", "826", "156", "842", INDIA_REPORTER,
}

INDIA_PARTNERS = [
    ("156", "China"),
    ("410", "Rep. of Korea"),
    ("702", "Singapore"),
    ("704", "Viet Nam"),
    ("158", "Taipei, Chinese"),
    ("842", "USA"),
    ("392", "Japan"),
    ("344", "China, Hong Kong SAR"),
    ("276", "Germany"),
    ("458", "Malaysia"),
    ("764", "Thailand"),
    ("784", "United Arab Emirates"),
]

COLUMNS = [
    "period",
    "refYear",
    "reporterCode",
    "reporterDesc",
    "partnerCode",
    "partnerDesc",
    "cmdCode",
    "flowCode",
    "primaryValue",
]


def scale_for(code: str, rng: random.Random) -> float:
    """A stable pseudo-size per HS code so figures look plausible."""
    seed = sum(ord(char) * (index + 1) for index, char in enumerate(code))

    rng.seed(seed)

    return rng.uniform(2e8, 9e10)


def write(frame_rows, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)

    pd.DataFrame(frame_rows, columns=COLUMNS).to_parquet(path, index=False)


def build(out: Path, codes, periods, freq: str, seed: int):
    rng = random.Random(seed)

    spans = lifespans()

    global_rows = {flow: [] for flow in
                   [FLOW_IMPORTS, FLOW_RE_IMPORTS, FLOW_EXPORTS, FLOW_RE_EXPORTS]}

    india_rows = {flow: [] for flow in [FLOW_IMPORTS, FLOW_EXPORTS]}

    for code in codes:
        base = scale_for(code, random.Random())

        for period in periods:
            ref_year = int(str(period)[:4])

            if ref_year < spans["starts"].get(code, 0):
                continue

            if ref_year > spans["ends"].get(code, 9999):
                continue

            season = 1.0

            if freq == "M":
                base_month = base / 12.0

                month = int(str(period)[4:])

                season = 0.85 + 0.3 * ((month % 4) / 3)
            else:
                base_month = base

            growth = 1.0 + 0.06 * (ref_year - 2016)

            india_import_total = 0.0
            india_export_total = 0.0

            for reporter, name in REPORTERS:
                rng.seed(hash((code, period, reporter)) & 0xFFFFFFFF)

                weight = rng.uniform(0.005, 0.16)

                imports = base_month * growth * season * weight

                exports = imports * rng.uniform(0.75, 1.25)

                if reporter == INDIA_REPORTER:
                    imports = base_month * growth * season * 0.035
                    exports = imports * 0.22

                    india_import_total = imports
                    india_export_total = exports

                for flow, value in (
                    (FLOW_IMPORTS, imports),
                    (FLOW_EXPORTS, exports),
                ):
                    global_rows[flow].append(
                        {
                            "period": str(period),
                            "refYear": ref_year,
                            "reporterCode": reporter,
                            "reporterDesc": name,
                            "partnerCode": "0",
                            "partnerDesc": "World",
                            "cmdCode": code,
                            "flowCode": flow,
                            "primaryValue": round(value, 2),
                        }
                    )

                if reporter in FILES_SUBFLOWS:
                    # Entrepot economies re-export a large share; everyone
                    # else files a token amount.
                    intensity = 0.22 if reporter in {"344", "702", "528"} else 0.02

                    for flow, value in (
                        (FLOW_RE_IMPORTS, imports * intensity * 0.4),
                        (FLOW_RE_EXPORTS, exports * intensity),
                    ):
                        global_rows[flow].append(
                            {
                                "period": str(period),
                                "refYear": ref_year,
                                "reporterCode": reporter,
                                "reporterDesc": name,
                                "partnerCode": "0",
                                "partnerDesc": "World",
                                "cmdCode": code,
                                "flowCode": flow,
                                "primaryValue": round(value, 2),
                            }
                        )

            # India's own filing must reconcile exactly with its row in the
            # all-reporters frame, because the pipeline refuses to publish
            # a period where the two disagree.
            for flow, total in (
                (FLOW_IMPORTS, india_import_total),
                (FLOW_EXPORTS, india_export_total),
            ):
                rng.seed(hash((code, period, flow, "partners")) & 0xFFFFFFFF)

                weights = [rng.uniform(0.02, 1.0) for _ in INDIA_PARTNERS]

                total_weight = sum(weights)

                allocated = 0.0

                rows = []

                for (partner, name), weight in zip(INDIA_PARTNERS, weights):
                    value = total * (weight / total_weight)

                    allocated += value

                    rows.append((partner, name, value))

                # Push any rounding residue into the largest partner so the
                # bilateral rows sum to the World total.
                residue = total - allocated

                if rows:
                    partner, name, value = rows[0]
                    rows[0] = (partner, name, value + residue)

                for partner, name, value in rows:
                    india_rows[flow].append(
                        {
                            "period": str(period),
                            "refYear": ref_year,
                            "reporterCode": INDIA_REPORTER,
                            "reporterDesc": "India",
                            "partnerCode": partner,
                            "partnerDesc": name,
                            "cmdCode": code,
                            "flowCode": flow,
                            "primaryValue": round(value, 2),
                        }
                    )

                india_rows[flow].append(
                    {
                        "period": str(period),
                        "refYear": ref_year,
                        "reporterCode": INDIA_REPORTER,
                        "reporterDesc": "India",
                        "partnerCode": "0",
                        "partnerDesc": "World",
                        "cmdCode": code,
                        "flowCode": flow,
                        "primaryValue": round(total, 2),
                    }
                )

    group = f"{periods[0]}-{periods[-1]}"

    for flow, rows in global_rows.items():
        write(rows, out / freq / "global" / flow / f"{group}__00.parquet")

    for flow, rows in india_rows.items():
        write(rows, out / freq / "india" / flow / f"{group}__00.parquet")


# ---------------------------------------------------------------------------
# Tariff lines and exchange rates
# ---------------------------------------------------------------------------

# Rates shaped like the real series but not the real series. They are written
# with an unmistakable source string so a fixture table can never be mistaken
# for config/fx_inr_usd.csv, where every rate has to be citable.
FIXTURE_SOURCE = "FIXTURE - fabricated, not a real exchange rate"


def write_fx(
    path: Path,
    years: list[str],
    financial_years: list[str],
    months: list[str] | None = None,
) -> None:
    """
    A rate table covering the fabricated periods.

    The real table ships only rates somebody can point at a published source
    for, which means a fixture run would have almost nothing to convert and the
    rupee toggle would go untested. So fixtures get their own table.
    """
    path.parent.mkdir(parents=True, exist_ok=True)

    def rate_for(start_year: int) -> float:
        # A gentle drift from ~63 to ~87 across the fixture window, so the
        # per-period rule is visibly doing something.
        return round(63.0 + (start_year - 2016) * 2.6, 3)

    lines = [
        "period,basis,inr_per_usd,status,source,note",
        "# Fabricated rates for fixture runs. Never promote this file.",
    ]

    for year in years:
        lines.append(
            f"{year},CY,{rate_for(int(year))},supplied,{FIXTURE_SOURCE},"
        )

    for fy in financial_years:
        start = int(fy.split("-")[0])

        # Half a step above the calendar year it starts in, so a CY and its
        # overlapping FY never share a rate and a mix-up would be visible.
        lines.append(
            f"{fy},FY,{rate_for(start) + 1.3},supplied,{FIXTURE_SOURCE},"
        )

    for period in months or []:
        year = int(str(period)[:4])

        month = int(str(period)[4:6])

        lines.append(
            f"{period},MONTH,{rate_for(year) + month * 0.05:.3f},"
            f"supplied,{FIXTURE_SOURCE},"
        )

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_hs8(path: Path, codes, end_year: int, seed: int) -> list[str]:
    """
    Synthetic ITC(HS)-8 detail, in Indian financial years.

    Deliberately awkward in the ways real DGCIS data is awkward:

      - the latest financial year is a part year (9 of 12 months), so the
        "is it fully built out" path gets exercised;
      - some rows are filed in rupees and some in dollars, so both the native
        and the derived currency paths run;
      - one financial year is older than the fixture rate table's coverage, so
        the missing-rate path runs too.
    """
    rng = random.Random(seed)

    hs6 = sorted(code for code in codes if len(code) == 6)

    financial_years = [
        f"{year}-{str(year + 1)[-2:]}"
        for year in range(end_year - 3, end_year)
    ]

    rows = ["hs8,description,fy,flow,value_inr,value_usd,months_covered"]

    for index, fy in enumerate(financial_years):
        part_year = index == len(financial_years) - 1

        months = 9 if part_year else 12

        # Alternate the filing currency by financial year, which is what
        # actually happens when exports come from different TradeStat screens.
        in_rupees = index % 2 == 0

        for code in hs6:
            for suffix in ("10", "90"):
                line = f"{code}{suffix}"

                for flow in ("import", "export"):
                    usd = rng.uniform(2e8, 9e9) * (months / 12)

                    if flow == "export":
                        usd *= 0.4

                    if in_rupees:
                        inr = usd * 80.0
                        value_inr = f"{inr:.0f}"
                        value_usd = ""
                    else:
                        value_inr = ""
                        value_usd = f"{usd:.0f}"

                    label = (
                        "Primary line" if suffix == "10" else "Residual line"
                    )

                    rows.append(
                        f"{line},{label} under HS {code},{fy},{flow},"
                        f"{value_inr},{value_usd},{months}"
                    )

    path.parent.mkdir(parents=True, exist_ok=True)

    path.write_text("\n".join(rows) + "\n", encoding="utf-8")

    return financial_years


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument("--out", default="data/raw/store-fixture")

    parser.add_argument(
        "--codes",
        type=int,
        default=12,
        help="Number of HS-6 codes to fabricate. 0 means the whole universe.",
    )

    parser.add_argument("--start-year", type=int, default=2016)

    parser.add_argument("--end-year", type=int, default=2025)

    parser.add_argument("--months", type=int, default=6)

    parser.add_argument("--seed", type=int, default=7)

    args = parser.parse_args()

    universe = pull_universe()

    if args.codes:
        hs6 = [code for code in universe if len(code) == 6][: args.codes]

        # Always carry at least one complete lineage family - a retired code
        # and every successor it split into. Without one, the revision path
        # renders as an empty series and looks fine, which is exactly the
        # failure a fixture is supposed to catch.
        for predecessor, successors in load_successors().items():
            if predecessor in hs6 or any(item in hs6 for item in successors):
                continue

            hs6.extend([predecessor, *successors])
            break

        hs6 = sorted(set(hs6))

        parents = sorted(
            {code[:4] for code in hs6} | {code[:2] for code in hs6}
        )

        codes = sorted(set(hs6) | set(parents))
    else:
        codes = universe

    out = Path(args.out)

    years = annual_periods(args.start_year, args.end_year)

    build(out, codes, years, "A", args.seed)

    months: list[str] = []

    if args.months:
        from datetime import datetime, timezone

        months = monthly_periods(datetime.now(timezone.utc), args.months)

        build(out, codes, months, "M", args.seed + 1)

    hs8_path = Path("data/dgcis/india_hs8.fixture.csv")

    financial_years = write_hs8(hs8_path, codes, args.end_year, args.seed + 2)

    fx_path = Path("config/fx_inr_usd.fixture.csv")

    # One financial year deliberately left out of the rate table, so the
    # "no rate, show dollars, say so" path is exercised on every fixture run.
    write_fx(fx_path, years, financial_years[1:], months)

    print(f"Fixture store written to {out}")
    print(f"  codes   : {len(codes)}")
    print(f"  years   : {years[0]}-{years[-1]}")
    print(f"  months  : {args.months}")
    print(f"  hs8     : {hs8_path} ({', '.join(financial_years)})")
    print(f"  fx      : {fx_path} (FY {financial_years[0]} left uncovered)")


if __name__ == "__main__":
    main()
