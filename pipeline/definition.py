"""
The FED sector definition is the single source of truth for HStat.

Everything downstream — which HS codes are pulled from Comtrade, how they
are grouped, what the search index knows, what HStack can add to a basket —
is derived from two hand-editable CSV files:

    config/fed_sector_definition.csv   the HS-6 master list and its metadata
    config/hs_aliases.csv              everyday vocabulary for search

No part of the pipeline discovers HS codes from an API. Change the CSV,
re-run the refresh, and the whole dashboard follows.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

CONFIG = ROOT / "config"

DEFINITION_CSV = CONFIG / "fed_sector_definition.csv"

ALIASES_CSV = CONFIG / "hs_aliases.csv"

LINEAGE_CSV = CONFIG / "hs_lineage.csv"

SCOPE_JSON = CONFIG / "scope.json"


@dataclass(frozen=True)
class Product:
    hs6: str
    description: str
    product: str
    category: str
    segment: str
    dgcis_segment: str
    in_fed_definition: bool
    reference_flags: dict
    world_exports_usd_bn: float | None
    share_of_world_trade: float | None
    comments: str
    search_terms: tuple[str, ...] = field(default=())

    @property
    def hs4(self) -> str:
        return self.hs6[:4]

    @property
    def hs2(self) -> str:
        return self.hs6[:2]


@dataclass(frozen=True)
class Lineage:
    """Where a current HS 2022 code's history sat before it existed."""

    code: str
    predecessor: str
    relation: str
    predecessor_valid_to: int | None
    note: str

    @property
    def splices(self) -> bool:
        """Only an unchanged code may have its predecessor's years joined on."""
        return self.relation == "identical" and bool(self.predecessor)


@dataclass(frozen=True)
class Alias:
    code: str
    terms: tuple[str, ...]
    primary: bool
    note: str


def _flag(value: str) -> bool:
    return str(value or "").strip().lower() in {"yes", "y", "true", "1"}


def _number(value: str):
    text = str(value or "").strip()

    if not text:
        return None

    try:
        return float(text)
    except ValueError:
        return None


def _split_terms(value: str) -> tuple[str, ...]:
    raw = str(value or "")

    parts = [
        segment.strip().lower()
        for chunk in raw.split(";")
        for segment in [chunk]
        if segment.strip()
    ]

    seen: list[str] = []

    for part in parts:
        if part not in seen:
            seen.append(part)

    return tuple(seen)


def _read_csv_rows(path: Path):
    """Read a CSV, skipping blank lines and # comment lines."""
    if not path.exists():
        raise SystemExit(f"Missing required config file: {path}")

    with path.open(newline="", encoding="utf-8-sig") as handle:
        lines = [
            line
            for line in handle
            if line.strip() and not line.lstrip().startswith("#")
        ]

    return list(csv.DictReader(lines))


@lru_cache(maxsize=1)
def load_products() -> tuple[Product, ...]:
    rows = _read_csv_rows(DEFINITION_CSV)

    products: dict[str, Product] = {}

    for row in rows:
        code = str(row.get("hs6") or "").strip().zfill(6)

        if not code.isdigit() or len(code) != 6:
            raise SystemExit(
                f"{DEFINITION_CSV.name}: invalid HS-6 value {row.get('hs6')!r}"
            )

        if code in products:
            raise SystemExit(
                f"{DEFINITION_CSV.name}: duplicate HS-6 code {code}"
            )

        products[code] = Product(
            hs6=code,
            description=(row.get("description") or "").strip(),
            product=(row.get("product") or "").strip(),
            category=(row.get("category") or "").strip(),
            segment=(row.get("segment") or "").strip(),
            dgcis_segment=(row.get("dgcis_segment") or "").strip(),
            in_fed_definition=_flag(row.get("in_fed_definition")),
            reference_flags={
                "oldFedAnalysis": _flag(row.get("in_old_fed_analysis")),
                "telanganaStudy": _flag(row.get("in_telangana_study")),
                "icea": _flag(row.get("in_icea")),
                "dgcis": _flag(row.get("in_dgcis")),
                "icrier": _flag(row.get("in_icrier")),
            },
            world_exports_usd_bn=_number(row.get("world_exports_usd_bn")),
            share_of_world_trade=_number(row.get("share_of_world_trade")),
            comments=(row.get("comments") or "").strip(),
            search_terms=_split_terms(row.get("search_terms")),
        )

    if not products:
        raise SystemExit(f"{DEFINITION_CSV.name} contains no HS codes")

    return tuple(products[code] for code in sorted(products))


@lru_cache(maxsize=1)
def load_aliases() -> tuple[Alias, ...]:
    if not ALIASES_CSV.exists():
        return ()

    aliases: list[Alias] = []

    for row in _read_csv_rows(ALIASES_CSV):
        code = str(row.get("code") or "").strip()

        if not code.isdigit() or len(code) not in (2, 4, 6):
            continue

        terms = _split_terms(row.get("terms"))

        if not terms:
            continue

        aliases.append(
            Alias(
                code=code,
                terms=terms,
                primary=_flag(row.get("primary")),
                note=(row.get("note") or "").strip(),
            )
        )

    return tuple(aliases)


@lru_cache(maxsize=1)
def load_lineage() -> tuple[Lineage, ...]:
    if not LINEAGE_CSV.exists():
        return ()

    rows: list[Lineage] = []

    for row in _read_csv_rows(LINEAGE_CSV):
        code = str(row.get("code") or "").strip()

        if not code.isdigit() or len(code) not in (2, 4, 6):
            continue

        relation = (row.get("relation") or "").strip().lower()

        if relation not in {"identical", "split", "merge", "new"}:
            raise SystemExit(
                f"{LINEAGE_CSV.name}: {code} has unknown relation {relation!r}"
            )

        valid_to = str(row.get("predecessor_valid_to") or "").strip()

        rows.append(
            Lineage(
                code=code,
                predecessor=str(row.get("predecessor") or "").strip(),
                relation=relation,
                predecessor_valid_to=int(valid_to) if valid_to.isdigit() else None,
                note=(row.get("note") or "").strip(),
            )
        )

    return tuple(rows)


@lru_cache(maxsize=1)
def retired_codes() -> frozenset[str]:
    """
    Codes that appear only as somebody's predecessor.

    HS 2022 is the base, so these get no product page. They are still pulled:
    their data is what keeps the HS-4 and HS-2 series continuous across the
    revision, and searching the old number should say where it went.
    """
    return frozenset(
        item.predecessor
        for item in load_lineage()
        if item.predecessor
    )


@lru_cache(maxsize=1)
def lineage_for() -> dict[str, tuple[Lineage, ...]]:
    grouped: dict[str, list[Lineage]] = {}

    for item in load_lineage():
        grouped.setdefault(item.code, []).append(item)

    return {code: tuple(items) for code, items in grouped.items()}


@lru_cache(maxsize=1)
def successors_of() -> dict[str, tuple[str, ...]]:
    grouped: dict[str, list[str]] = {}

    for item in load_lineage():
        if item.predecessor:
            grouped.setdefault(item.predecessor, []).append(item.code)

    return {code: tuple(sorted(set(items))) for code, items in grouped.items()}


@lru_cache(maxsize=1)
def load_scope() -> dict:
    defaults = {
        "classification": "H6",
        "indiaReporterCode": "699",
        "historyStartYear": 2016,
        "analysisStartYear": 2022,
        "monthly": {
            "enabled": True,
            "rollingMonths": 24,
            # Which scopes are pulled monthly. Dropping "global" removes
            # the largest recurring API cost.
            "scopes": ["india", "global"],
        },
        "globalTrade": {
            "basis": "imports",
            "netReExports": True,
            "mirrorWarnRatio": [0.70, 1.50],
        },
        "parents": {"levels": [2, 4]},
        # Comtrade is calendar years, DGCIS is Indian financial years. Kept
        # apart everywhere; see process_snapshot.load_hs8.
        "periods": {
            "comtrade": "CY",
            "tariffLines": "FY",
            "tariffFinancialYearDefault": "startsInSelectedCalendarYear",
        },
        # Rates live in config/fx_inr_usd.csv, one per period, each sourced.
        "currency": {
            "base": "USD",
            "display": ["USD", "INR"],
            "default": "USD",
            "applies": ["india", "tariffLines"],
            "unit": "lakhCrore",
            "missingRatePolicy": "refuse",
        },
        "tariffLines": {"reconcileBand": [0.5, 2.0]},
        # None means the pull sizes each request by the rows it expects to
        # return. A number here fixes it instead.
        "pullChunkSize": None,
    }

    if SCOPE_JSON.exists():
        stored = json.loads(SCOPE_JSON.read_text())

        for key, value in stored.items():
            if isinstance(value, dict) and isinstance(defaults.get(key), dict):
                defaults[key].update(value)
            else:
                defaults[key] = value

    return defaults


def hs6_universe(fed_only: bool = False) -> list[str]:
    """Current HS 2022 six-digit codes. Retired predecessors are excluded."""
    retired = retired_codes()

    return [
        product.hs6
        for product in load_products()
        if product.hs6 not in retired
        and (not fed_only or product.in_fed_definition)
    ]


def parent_universe() -> dict[str, list[str]]:
    """Official Comtrade aggregates that contain at least one FED code."""
    levels = load_scope()["parents"]["levels"]

    universe: dict[str, list[str]] = {}

    for level in levels:
        universe[str(level)] = sorted(
            {product.hs6[:level] for product in load_products()}
        )

    return universe


def pull_universe() -> list[str]:
    """
    Every code the Comtrade pull must request.

    Retired predecessors are included even though they get no product page:
    without them the HS-4 and HS-2 aggregates lose their pre-revision years.
    """
    codes = set(hs6_universe())

    codes.update(
        code for code in retired_codes() if len(code) == 6
    )

    for group in parent_universe().values():
        codes.update(group)

    return sorted(codes)


def by_code() -> dict[str, Product]:
    return {product.hs6: product for product in load_products()}


def categories() -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}

    for product in load_products():
        grouped.setdefault(product.category or "Uncategorised", []).append(
            product.hs6
        )

    return {name: sorted(codes) for name, codes in sorted(grouped.items())}


def segments() -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}

    for product in load_products():
        grouped.setdefault(product.segment or "Unclassified", []).append(
            product.hs6
        )

    return {name: sorted(codes) for name, codes in sorted(grouped.items())}


def summary() -> dict:
    products = load_products()

    return {
        "hs6Codes": len(hs6_universe()),
        "retiredCodes": len(retired_codes()),
        "workbookRows": len(products),
        "inFedDefinition": sum(
            1
            for p in products
            if p.in_fed_definition and p.hs6 not in retired_codes()
        ),
        "categories": len(categories()),
        "hs4Groups": len({p.hs4 for p in products}),
        "hs2Chapters": len({p.hs2 for p in products}),
        "pullCodes": len(pull_universe()),
        "aliasRows": len(load_aliases()),
    }


if __name__ == "__main__":
    for key, value in summary().items():
        print(f"{key:>18}: {value}")
