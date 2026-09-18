#!/usr/bin/env python3
"""
What Comtrade actually holds right now, and what that costs us.

Mirrors the data behind comtradeplus.un.org/Visualization/DADashboard, then
does the thing that page cannot: joins it to our own 418 products, so the
question stops being "who has filed" and becomes "which of our pages are thin,
and why".

The endpoint is /public/v1/getDA - open, no subscription key, the same tier the
Pull Data links use. Nothing here needs the paid API.

WHY THE BROWSER DOES NOT FETCH THIS

Comtrade refuses cross-origin calls; that is what broke the first Pull Data
download. And a dashboard that phones a third party on every page load acquires
that third party's uptime. So the pipeline fetches, the result is committed as
a small file, and the page reads it like every other number here.

Until this has been run there is no public/data/availability.json, and the page
says so rather than showing an empty frame. Nothing here is ever faked.

Run:  python3 pipeline/comtrade/fetch_availability.py
      python3 pipeline/comtrade/fetch_availability.py --offline
"""
from __future__ import annotations

import argparse
import json
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "public" / "data" / "snapshots" / "current"
RAW = ROOT / "data" / "comtrade" / "availability.json"
OUT = ROOT / "public" / "data" / "availability.json"

BASE = "https://comtradeapi.un.org/public/v1/getDA"

# Annual is what the world figures are built from. Monthly is carried because
# it runs far ahead - to 2026-06 at the time of writing, against an annual
# series that stops at 2024 for many reporters - and a reader deserves to know
# a fresher view exists even where we cannot yet publish one.
ANNUAL_YEARS = [2021, 2022, 2023, 2024, 2025, 2026]
MONTHLY_MONTHS = [f"{y}{m:02d}" for y in (2025, 2026) for m in range(1, 13)]


def fetch(freq: str, periods: list) -> list[dict]:
    url = f"{BASE}/C/{freq}/HS?period={','.join(map(str, periods))}"
    request = urllib.request.Request(url, headers={"User-Agent": "HStat.India/1.0"})

    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read().decode())["data"]


def by_period(rows):
    seen = defaultdict(set)
    released = defaultdict(list)
    names = {}

    for row in rows:
        period = str(row["period"])
        code = str(row["reporterCode"])
        seen[period].add(code)
        names[code] = row.get("reporterDesc") or code

        if row.get("lastReleased"):
            released[period].append(row["lastReleased"][:10])

    return seen, released, names


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()

    RAW.parent.mkdir(parents=True, exist_ok=True)

    if args.offline:
        if not RAW.exists():
            raise SystemExit(f"--offline, but {RAW} does not exist yet.")

        held = json.loads(RAW.read_text())
        print(f"offline: reusing the fetch from {held['fetchedAt'][:19]}")
    else:
        print("fetching annual availability…")
        annual = fetch("A", ANNUAL_YEARS)
        print(f"  {len(annual):,} records")

        print("fetching monthly availability…")
        monthly = fetch("M", MONTHLY_MONTHS)
        print(f"  {len(monthly):,} records")

        held = {
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "annual": annual,
            "monthly": monthly,
        }
        RAW.write_text(json.dumps(held))

    a_seen, a_rel, a_names = by_period(held["annual"])
    m_seen, m_rel, m_names = by_period(held["monthly"])
    names = {**a_names, **m_names}

    annual_periods = [
        {
            "period": period,
            "reporters": len(a_seen[period]),
            "latestRelease": max(a_rel[period]) if a_rel[period] else None,
        }
        for period in sorted(a_seen)
        if a_seen[period]
    ]

    monthly_periods = [
        {
            "period": period,
            "reporters": len(m_seen[period]),
            "latestRelease": max(m_rel[period]) if m_rel[period] else None,
        }
        for period in sorted(m_seen)
        if m_seen[period]
    ]

    # ---------------------------------------------------------------
    # What it costs us: who is missing, and from how many of our pages
    # ---------------------------------------------------------------
    products = sorted(SNAPSHOT.glob("products/*.json"))
    gaps = Counter()
    gap_value = Counter()
    affected = defaultdict(set)
    years_seen = set()

    filed = {
        period: {names.get(code, code) for code in codes}
        for period, codes in a_seen.items()
    }

    for path in products:
        node = json.loads(path.read_text())

        for year, record in (node.get("annual") or {}).items():
            coverage = ((record or {}).get("global") or {}).get("coverage") or {}

            if not coverage.get("missingPriorTop10"):
                continue

            years_seen.add(year)

            for missing in coverage["missingPriorTop10"]:
                key = (year, missing.get("reporterDesc") or "?")
                gaps[key] += 1
                gap_value[key] += missing.get("primaryValue") or 0
                affected[key].add(node["code"])

    recent = {year for year in years_seen if year >= "2024"}

    holes = [
        {
            "period": year,
            "reporter": reporter,
            "products": count,
            "priorValue": round(gap_value[(year, reporter)]),
            "sample": sorted(affected[(year, reporter)])[:8],
            # The actionable bit: a gap Comtrade has since closed is a gap a
            # refresh would close for us too.
            "filedSince": reporter in filed.get(year, set()),
        }
        for (year, reporter), count in gaps.most_common()
        if year in recent
    ]

    payload = {
        "source": "UN Comtrade data availability (public getDA endpoint)",
        "sourceUrl": "https://comtradeplus.un.org/Visualization/DADashboard",
        "fetchedAt": held["fetchedAt"],
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "snapshotRefreshedAt": json.loads(
            (SNAPSHOT / "manifest.json").read_text()
        ).get("refreshedAt"),
        "annual": annual_periods,
        "monthly": monthly_periods,
        "holes": holes[:40],
        "productsTotal": len(products),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1))

    print(f"\nwritten: {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1024:.0f} KB)")
    print(f"annual periods : {len(annual_periods)}")
    print(f"monthly periods: {len(monthly_periods)}")
    print(f"gaps listed    : {len(payload['holes'])}")

    for hole in payload["holes"][:5]:
        mark = "  (has since filed)" if hole["filedSince"] else ""
        print(f"  {hole['period']}  {hole['reporter']:<24}"
              f"{hole['products']:>4} products  ${hole['priorValue'] / 1e9:>8,.1f}bn{mark}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
