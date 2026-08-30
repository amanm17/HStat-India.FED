"""
Rupees per dollar, by period.

Everything in the snapshot is stored in US dollars. The rupee view on the
dashboard is a conversion, and this module is the only place that knows how to
do it. Three rules shape the whole file:

  1. A period converts at its own rate. Applying one fixed rate across the
     history would turn a currency movement into an apparent trade movement,
     which is the single most misleading thing a trade dashboard can do.

  2. Calendar years and financial years are different periods and never share
     a rate. UN Comtrade reports calendar years; the DGCIS tariff-line export
     reports Indian financial years. Both are converted, each on its own basis.

  3. A missing rate is missing. No interpolation, no nearest-year fallback, no
     carry-forward. `rate()` returns None and the caller publishes dollars and
     says why. Guessing a rate would produce a rupee figure that looks exactly
     as authoritative as a sourced one.

Read `config/fx_inr_usd.csv` for the convention and the sourcing.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
import argparse
import csv
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]

RATES_CSV = ROOT / "config" / "fx_inr_usd.csv"

CY = "CY"
FY = "FY"
MONTH = "MONTH"

BASES = (CY, FY, MONTH)

# A rate is only used if someone stands behind it. "needed" rows are the
# worksheet of what is still missing and must never be treated as data.
USABLE_STATUS = ("verified", "supplied")

CY_RE = re.compile(r"^(19|20)\d{2}$")
FY_RE = re.compile(r"^((?:19|20)\d{2})-(\d{2})$")
MONTH_RE = re.compile(r"^((?:19|20)\d{2})-(0[1-9]|1[0-2])$")

# The pipeline carries monthly periods as YYYYMM. Both forms are accepted and
# stored as YYYY-MM, so a rate row and a snapshot period always meet.
COMPACT_MONTH_RE = re.compile(r"^((?:19|20)\d{2})(0[1-9]|1[0-2])$")


# ---------------------------------------------------------------------------
# Period labels
# ---------------------------------------------------------------------------


def normalise_fy(label: str) -> str | None:
    """
    Accept the several ways an Indian financial year gets written and return
    the unambiguous one: 2024-25.

        2024-25, 2024-2025, FY2024-25, FY 2024-25, FY25, FY 25, 2024/25

    FY25 means the year *ending* March 2025, so it normalises to 2024-25.
    That convention is the usual source of an off-by-one-year error, which is
    why it is resolved here once rather than at each call site.
    """
    text = str(label or "").strip().upper().replace(" ", "").replace("/", "-")

    if not text:
        return None

    text = text.removeprefix("FY")

    # FY25 -> 2024-25
    if text.isdigit() and len(text) == 2:
        end = 2000 + int(text)
        return f"{end - 1}-{text.zfill(2)}"

    # FY2025 written as a bare end year is ambiguous with a calendar year,
    # so it is refused rather than guessed at.
    if text.isdigit() and len(text) == 4:
        return None

    parts = text.split("-")

    if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
        return None

    start = int(parts[0])

    if len(parts[0]) != 4:
        return None

    end = int(parts[1]) if len(parts[1]) == 4 else 2000 + int(parts[1])

    if len(parts[1]) == 2 and start >= 2000 and end != start + 1:
        # e.g. 2024-24. Not a financial year.
        return None

    if end != start + 1:
        return None

    return f"{start}-{str(end)[-2:]}"


def normalise_month(label: str) -> str | None:
    """Accept 2026-02 or 202602 and return 2026-02."""
    text = str(label or "").strip()

    if MONTH_RE.match(text):
        return text

    match = COMPACT_MONTH_RE.match(text)

    return f"{match.group(1)}-{match.group(2)}" if match else None


def fy_for_calendar_year(year: int) -> str:
    """
    The financial year that *starts* inside a calendar year.

    CY 2024 -> FY 2024-25. Nine of the financial year's twelve months fall in
    the calendar year, which is the closest pairing available; the dashboard
    still labels the two separately and never adds them together.
    """
    return f"{year}-{str(year + 1)[-2:]}"


def fy_start_year(fy: str) -> int:
    match = FY_RE.match(fy)

    if not match:
        raise ValueError(f"not a financial year: {fy!r}")

    return int(match.group(1))


def fy_end_year(fy: str) -> int:
    return fy_start_year(fy) + 1


def previous_fy(fy: str) -> str:
    start = fy_start_year(fy) - 1

    return f"{start}-{str(start + 1)[-2:]}"


def basis_of(period: str) -> str | None:
    """Infer the basis from the shape of the label."""
    text = str(period or "").strip()

    if CY_RE.match(text):
        return CY

    if MONTH_RE.match(text) or COMPACT_MONTH_RE.match(text):
        return MONTH

    if FY_RE.match(text):
        return FY

    return None


# ---------------------------------------------------------------------------
# The table
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Rate:
    period: str
    basis: str
    inr_per_usd: float | None
    status: str
    source: str
    note: str

    @property
    def usable(self) -> bool:
        return (
            self.inr_per_usd is not None
            and self.inr_per_usd > 0
            and self.status in USABLE_STATUS
            and bool(self.source)
        )


class RateTable:
    """Rates keyed by (basis, period)."""

    def __init__(self, rates: dict[tuple[str, str], Rate]):
        self._rates = rates

    def __len__(self) -> int:
        return sum(1 for rate in self._rates.values() if rate.usable)

    def entry(self, period: str, basis: str | None = None) -> Rate | None:
        basis = basis or basis_of(period)

        if basis is None:
            return None

        if basis == FY:
            period = normalise_fy(period) or period
        elif basis == MONTH:
            period = normalise_month(period) or period

        return self._rates.get((basis, str(period)))

    def rate(self, period: str, basis: str | None = None) -> float | None:
        """The rate for a period, or None. None means "do not convert"."""
        entry = self.entry(period, basis)

        return entry.inr_per_usd if entry and entry.usable else None

    def to_inr(
        self, value_usd: float | None, period: str, basis: str | None = None
    ) -> float | None:
        rate = self.rate(period, basis)

        if value_usd is None or rate is None:
            return None

        return value_usd * rate

    def to_usd(
        self, value_inr: float | None, period: str, basis: str | None = None
    ) -> float | None:
        rate = self.rate(period, basis)

        if value_inr is None or rate is None:
            return None

        return value_inr / rate

    def published(self) -> dict:
        """
        The rates that travel with the snapshot, so any rupee figure on the
        page can be traced to the number that produced it.
        """
        out: dict[str, dict] = {}

        for (basis, period), rate in sorted(self._rates.items()):
            if not rate.usable:
                continue

            out.setdefault(basis, {})[period] = {
                "rate": round(rate.inr_per_usd, 4),
                "status": rate.status,
                "source": rate.source,
                **({"note": rate.note} if rate.note else {}),
            }

        return out

    def coverage(self, wanted: list[tuple[str, str]]) -> dict:
        """
        Given the (basis, period) pairs the snapshot actually uses, report what
        can and cannot be converted.
        """
        have: list[str] = []
        missing: list[str] = []

        for basis, period in sorted(set(wanted)):
            if basis == MONTH:
                period = normalise_month(period) or period
            elif basis == FY:
                period = normalise_fy(period) or period

            label = f"{basis} {period}"

            if self.rate(period, basis) is not None:
                have.append(label)
            else:
                missing.append(label)

        total = len(have) + len(missing)

        return {
            "periods": total,
            "convertible": len(have),
            "missing": missing,
            "complete": not missing,
            "fraction": (len(have) / total) if total else 1.0,
        }


_ACTIVE: Path | None = None


def use(path: str | Path | None) -> None:
    """
    Point the loader at a different rate table.

    Only for fixture runs, which need a table that covers the fabricated
    periods. A real refresh always reads config/fx_inr_usd.csv.
    """
    global _ACTIVE

    _ACTIVE = Path(path) if path else None

    load.cache_clear()


def _read_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []

    with path.open(newline="", encoding="utf-8-sig") as handle:
        lines = [
            line
            for line in handle
            if line.strip() and not line.lstrip().startswith("#")
        ]

    return list(csv.DictReader(lines))


@lru_cache(maxsize=1)
def load(path: str | None = None) -> RateTable:
    target = Path(path) if path else (_ACTIVE or RATES_CSV)

    rates: dict[tuple[str, str], Rate] = {}

    for line, row in enumerate(_read_rows(target), start=2):
        period = str(row.get("period") or "").strip()
        basis = str(row.get("basis") or "").strip().upper()

        if not period:
            continue

        if basis not in BASES:
            raise SystemExit(
                f"{target.name} line {line}: basis {basis!r} is not one of "
                f"{', '.join(BASES)}"
            )

        if basis == FY:
            canonical = normalise_fy(period)

            if canonical is None:
                raise SystemExit(
                    f"{target.name} line {line}: {period!r} is not a financial "
                    "year. Write it as 2024-25."
                )

            period = canonical

        elif basis == CY and not CY_RE.match(period):
            raise SystemExit(
                f"{target.name} line {line}: {period!r} is not a calendar year."
            )

        elif basis == MONTH:
            canonical = normalise_month(period)

            if canonical is None:
                raise SystemExit(
                    f"{target.name} line {line}: {period!r} is not a month. "
                    "Write it as 2024-07."
                )

            period = canonical

        raw = str(row.get("inr_per_usd") or "").strip()

        value: float | None = None

        if raw:
            try:
                value = float(raw)
            except ValueError:
                raise SystemExit(
                    f"{target.name} line {line}: {raw!r} is not a number."
                )

            if value <= 0:
                raise SystemExit(
                    f"{target.name} line {line}: rate must be positive."
                )

        status = str(row.get("status") or "").strip().lower() or "needed"
        source = str(row.get("source") or "").strip()

        if status in USABLE_STATUS and not source:
            raise SystemExit(
                f"{target.name} line {line}: a {status} rate must cite a "
                "source. An unsourced rate is a guess with better handwriting."
            )

        if status in USABLE_STATUS and value is None:
            raise SystemExit(
                f"{target.name} line {line}: status is {status} but no rate is "
                "given."
            )

        key = (basis, period)

        if key in rates:
            raise SystemExit(
                f"{target.name} line {line}: {basis} {period} appears twice."
            )

        rates[key] = Rate(
            period=period,
            basis=basis,
            inr_per_usd=value,
            status=status,
            source=source,
            note=str(row.get("note") or "").strip(),
        )

    return RateTable(rates)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _snapshot_periods() -> list[tuple[str, str]]:
    """
    Every (basis, period) the current snapshot would need a rate for, read from
    the published manifest and catalogue rather than assumed.
    """
    wanted: set[tuple[str, str]] = set()

    manifest_path = (
        ROOT / "public" / "data" / "snapshots" / "current" / "manifest.json"
    )

    if not manifest_path.exists():
        return []

    manifest = json.loads(manifest_path.read_text())

    start = manifest.get("startYear")
    end = manifest.get("endYear")

    if start and end:
        for year in range(int(start), int(end) + 1):
            wanted.add((CY, str(year)))

    for month in manifest.get("months", []):
        wanted.add((MONTH, str(month)))

    for fy in manifest.get("financialYears", []):
        canonical = normalise_fy(fy)

        if canonical:
            wanted.add((FY, canonical))

    return sorted(wanted)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Inspect and extend the rupee/dollar rate table."
    )

    parser.add_argument(
        "--report",
        action="store_true",
        help="List which periods the current snapshot can and cannot convert.",
    )

    parser.add_argument(
        "--template",
        action="store_true",
        help="Append blank rows for every period that has no rate yet.",
    )

    args = parser.parse_args(argv)

    table = load()

    print(f"{RATES_CSV.name}: {len(table)} usable rates")

    wanted = _snapshot_periods()

    if not wanted:
        print("No published snapshot to check against.")
        return 0

    report = table.coverage(wanted)

    print(
        f"snapshot needs {report['periods']} periods; "
        f"{report['convertible']} convertible"
    )

    if args.report and report["missing"]:
        print("\nNo rate for:")

        for label in report["missing"]:
            print(f"  {label}")

    if args.template and report["missing"]:
        with RATES_CSV.open("a", encoding="utf-8") as handle:
            for label in report["missing"]:
                basis, period = label.split(" ", 1)
                handle.write(f"{period},{basis},,needed,,\n")

        print(f"\nAppended {len(report['missing'])} blank rows to fill in.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
