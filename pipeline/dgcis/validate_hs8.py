#!/usr/bin/env python3
"""
Gate the DGCIS HS-8 extract before anything downstream touches it.

WHAT THIS IS FOR

The Comtrade side of HStat earns its numbers by refusing to publish a period
whose reporter coverage cannot be defended. The DGCIS side has no equivalent,
because the shape of the risk is different: this is one file, downloaded by
hand through a CAPTCHA, and the ways it goes wrong are the ways a manual
download goes wrong. The wrong month. A partial export. The same file twice.
A portal change that silently drops rows.

So the checks here are about provenance and completeness, not about
statistical coverage, and the strongest of them is the one the source gives us
for free: DGCIS publishes its own TOTAL row, so every commodity row can be
summed and compared against it. If those agree to a hundredth of a percent,
the extract is whole. If they do not, something was lost between the portal
and the disk and nothing should be published.

    PASS     safe to process and publish
    WARNING  surfaced, does not stop the run - a thing a person should see
    FAIL     stops the run

Run:  python3 pipeline/dgcis/validate_hs8.py [--source PATH] [--strict]
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DGCIS = ROOT / "data" / "dgcis"
SOURCE = DGCIS / "incoming" / "DGCIS_DATA.csv"
PROCESSED = DGCIS / "processed"
CONFIG = ROOT / "config"

# DGCIS rounds its own TOTAL row, so the sum of the parts never lands exactly
# on it. A hundredth of a percent is far tighter than any rounding error and
# far looser than a dropped row: the worst observed on a good extract is
# 0.0017%, and losing one mid-sized tariff line would show up in the tenths.
RECONCILE_TOLERANCE_PCT = 0.01

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12,
}

COLUMN = re.compile(r"^([A-Za-z]+)-(\d{4})_(INR_Cr|USD_Mn)$")


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []
        self.warnings: list[str] = []
        self.notes: list[str] = []

    def fail(self, condition, message: str) -> bool:
        if not condition:
            self.failures.append(message)
        return bool(condition)

    def warn(self, condition, message: str) -> None:
        if not condition:
            self.warnings.append(message)

    def note(self, message: str) -> None:
        self.notes.append(message)


def number(value) -> float:
    text = str(value or "").replace(",", "").strip()

    try:
        return float(text)
    except ValueError:
        return 0.0


def digits(value) -> str:
    """HS codes are strings. Excel turns 85171300 into 85171300.0 given half
    a chance, and a leading zero is lost the moment anything treats one as an
    integer."""
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def period_of(column: str) -> tuple[str, str] | None:
    match = COLUMN.match(column.strip())

    if not match:
        return None

    name, year, metric = match.groups()
    month = MONTHS.get(name.lower())

    if month is None:
        return None

    return f"{year}-{month:02d}", metric


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=str(SOURCE))
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings as failures.",
    )
    args = parser.parse_args()

    check = Report()
    source = Path(args.source).resolve()

    # 1 - the file is there and readable ------------------------------------
    if not check.fail(source.exists(), f"source file missing: {source}"):
        return finish(check, args)

    raw = source.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()

    rows = list(csv.DictReader(source.open(newline="", encoding="utf-8-sig")))

    if not check.fail(rows, "source file has no rows"):
        return finish(check, args)

    try:
        shown = source.relative_to(ROOT)
    except ValueError:
        # --source can point anywhere, including outside the repo.
        shown = source

    check.note(f"source            : {shown}")
    check.note(f"sha256            : {sha[:16]}…")
    check.note(f"rows              : {len(rows)}")

    # 2 - exactly one aggregate footer --------------------------------------
    footers = [
        row for row in rows
        if (row.get("Country Name") or "").strip().upper() == "TOTAL"
    ]

    check.fail(
        len(footers) == 1,
        f"expected exactly one TOTAL footer row, found {len(footers)}",
    )

    commodities = [row for row in rows if row not in footers]

    check.note(f"commodity rows    : {len(commodities)}")

    # 3 - every commodity row carries a real 8-digit code --------------------
    malformed = [
        row.get("HS Code")
        for row in commodities
        if len(digits(row.get("HS Code"))) != 8
    ]

    check.fail(
        not malformed,
        f"{len(malformed)} commodity rows have a malformed HS-8 code: "
        f"{', '.join(str(code) for code in malformed[:6])}",
    )

    codes = [digits(row.get("HS Code")) for row in commodities]

    # 4 - no duplicate tariff lines -----------------------------------------
    seen: dict[tuple[str, str], int] = {}

    for row, code in zip(commodities, codes):
        key = (code, (row.get("Country Name") or "").strip())
        seen[key] = seen.get(key, 0) + 1

    duplicates = [key for key, count in seen.items() if count > 1]

    check.fail(
        not duplicates,
        f"{len(duplicates)} duplicate HS8/country rows: "
        f"{', '.join(f'{a}/{b}' for a, b in duplicates[:5])}",
    )

    # 5 - the monthly columns parse -----------------------------------------
    monthly = [column for column in rows[0] if period_of(column)]
    unparsed = [
        column for column in rows[0]
        if ("_INR_Cr" in column or "_USD_Mn" in column) and not period_of(column)
    ]

    check.fail(
        not unparsed,
        f"{len(unparsed)} value columns could not be parsed: "
        f"{', '.join(unparsed[:5])}",
    )

    check.fail(monthly, "no monthly value columns found at all")

    periods = sorted({period_of(column)[0] for column in monthly})

    check.note(f"periods           : {len(periods)}  {periods[0]} → {periods[-1]}")

    # 6, 7 - the latest month is real, and is not in the future --------------
    now = datetime.now(timezone.utc)
    current = f"{now.year}-{now.month:02d}"

    check.fail(
        periods[-1] <= current,
        f"latest period {periods[-1]} is in the future (now {current})",
    )

    # DGCIS publishes with a lag; a gap of more than four months usually means
    # the extract was taken with the wrong date range rather than that the
    # source is behind.
    lag = (now.year - int(periods[-1][:4])) * 12 + (now.month - int(periods[-1][5:]))

    check.warn(
        lag <= 4,
        f"latest period {periods[-1]} is {lag} months behind the current month; "
        f"check the extract's date range",
    )

    # 8 - one reporter/partner context, as this extract is built -------------
    partners = {
        (row.get("Country Name") or "").strip()
        for row in commodities
    }

    check.fail(
        partners == {"World"},
        f"expected every commodity row to be Country Name=World, found "
        f"{sorted(partners)[:5]}",
    )

    # 9 - every code lands under something HStat publishes -------------------
    universe = set((CONFIG / "hs6_universe.txt").read_text().split())
    hs4 = {code[:4] for code in universe}
    hs2 = {code[:2] for code in universe}

    unplaceable = [
        code for code in codes
        if code[:6] not in universe and code[:4] not in hs4 and code[:2] not in hs2
    ]

    check.fail(
        not unplaceable,
        f"{len(unplaceable)} HS-8 codes sit under no HStat HS6/HS4/HS2: "
        f"{', '.join(unplaceable[:6])}",
    )

    attached = [code for code in codes if code[:6] in universe]
    orphaned = [code for code in codes if code[:6] not in universe]

    check.note(
        f"attached to product: {len(attached)}  "
        f"({len({c[:6] for c in attached})} of {len(universe)} products)"
    )

    # Not a failure. These are tariff lines under an HS-6 that HStat carries
    # only as a lineage predecessor - 851712 before the smartphone split, for
    # instance - so they are real India history with no product page to sit
    # on. Saying so is the point; dropping them silently is not.
    if orphaned:
        check.note(
            f"no product page   : {len(orphaned)} HS-8 codes under "
            f"{', '.join(sorted({c[:6] for c in orphaned}))} "
            f"(retired predecessors)"
        )

    # 10 - the sum of the parts is the whole ---------------------------------
    if footers and monthly:
        footer = footers[0]
        breaches: list[tuple[str, float]] = []
        worst = (0.0, "")

        for column in monthly:
            total = number(footer.get(column))

            if total == 0:
                continue

            summed = sum(number(row.get(column)) for row in commodities)
            pct = abs(summed - total) / abs(total) * 100

            if pct > worst[0]:
                worst = (pct, column)

            if pct > RECONCILE_TOLERANCE_PCT:
                breaches.append((column, pct))

        check.fail(
            not breaches,
            f"{len(breaches)} periods do not reconcile to the DGCIS TOTAL "
            f"within {RECONCILE_TOLERANCE_PCT}%: "
            + ", ".join(f"{c} {p:.4f}%" for c, p in breaches[:5]),
        )

        check.note(
            f"reconciliation    : {len(monthly)} checks, worst "
            f"{worst[0]:.6f}% ({worst[1]}), tolerance "
            f"{RECONCILE_TOLERANCE_PCT}%"
        )

    # 11, 12 - has anything gone backwards since the last accepted extract? --
    manifest_path = PROCESSED / "manifest.json"

    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text())

        if previous.get("sourceSha256") == sha:
            check.note("this is the same file as the last processed run")

        before = previous.get("sourceHS8") or 0

        check.warn(
            len(set(codes)) >= before,
            f"HS-8 coverage shrank: {before} codes last time, "
            f"{len(set(codes))} now",
        )

        last = previous.get("lastPeriod")

        check.fail(
            not last or periods[-1] >= last,
            f"latest period went backwards: {last} last time, "
            f"{periods[-1]} now",
        )

    # A month where every single line is blank is a portal artefact, not a
    # month in which India imported nothing.
    empty = []

    for period in periods:
        columns = [c for c in monthly if period_of(c)[0] == period]
        if columns and not any(
            number(row.get(column)) for row in commodities for column in columns
        ):
            empty.append(period)

    check.warn(not empty, f"{len(empty)} periods are entirely blank: {empty[:6]}")

    return finish(check, args)


def finish(check: Report, args) -> int:
    print("DGCIS HS-8 validation")

    for note in check.notes:
        print(f"  {note}")

    for warning in check.warnings:
        print(f"WARNING {warning}")

    for failure in check.failures:
        print(f"FAIL    {failure}")

    if check.failures:
        print("\nFAIL — the extract was not accepted.")
        return 2

    if check.warnings and args.strict:
        print("\nFAIL — warnings, and --strict was given.")
        return 2

    print(
        "\nPASS"
        + (f" — with {len(check.warnings)} warning(s)." if check.warnings else ".")
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
