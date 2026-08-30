"""
The dataset registry.

HStat began as one dashboard over one source. The registry is what lets it
become a shell that several sources plug into without any of them knowing about
the others.

Three ideas carry the whole design:

  1. A dataset declares its key space. Comtrade is keyed by product, partner
     and calendar period; ASI and PLFS are keyed by industry, region and
     financial year. Nothing is inferred from file layout or column names -
     a dataset says what it is indexed by, in its manifest, and that is the
     only thing the shell trusts.

  2. Two datasets meet only through a shared key or a concordance. A product
     code and an industry code describe different things - a good versus an
     activity - and no amount of string matching bridges them. `config/
     concordances/` holds those bridges as reviewable files with a stated basis
     and provenance. No row, no join: the panel stays hidden rather than
     rendering a number built on a guess.

  3. A declared dataset renders nothing. `status` separates "we have agreed
     the shape" from "we have the data", so a manifest can land long before an
     ingest does without putting an empty page in front of anyone.

Adding a source is therefore: write a manifest, write an ingest that lands
Parquet in the declared path, and (if it should meet the trade data) write
concordance rows. No change to the existing pipeline or the existing pages.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
import csv
import json

ROOT = Path(__file__).resolve().parents[1]

DATASETS_DIR = ROOT / "config" / "datasets"

CONCORDANCE_DIR = ROOT / "config" / "concordances"

# The key spaces a dataset may declare. Anything else is refused at load, so a
# typo becomes an error rather than a dataset that silently never joins.
KEY_SPACES = {
    "product": "An HS or ITC(HS) commodity code",
    "industry": "A NIC economic-activity code",
    "region": "An Indian state or district",
    "partner": "A reporting or partner economy",
    "occupation": "An NCO occupation code",
    "entity": "A firm, plant or establishment",
    "period": "The time basis: CY, FY, MONTH or QUARTER",
}

PERIOD_BASES = {"CY", "FY", "MONTH", "QUARTER"}

# declared  the shape is agreed, no data ingested; renders a stub only
# live      data is present and published
# retired   kept for provenance, no longer refreshed
STATUSES = {"declared", "live", "retired"}

CONCORDANCE_BASES = {"exact", "dominant", "partial", "judgement"}


@dataclass(frozen=True)
class Panel:
    """A block one dataset contributes to another dataset's page."""

    id: str
    title: str
    on: str
    via: str | None
    note: str


@dataclass(frozen=True)
class Dataset:
    id: str
    title: str
    subtitle: str
    keys: dict
    period_basis: str
    frequencies: tuple[str, ...]
    storage: dict
    route: str | None
    panels: tuple[Panel, ...]
    provenance: dict
    status: str
    aggregation: dict = field(default_factory=dict)

    @property
    def live(self) -> bool:
        return self.status == "live"

    def key_spaces(self) -> set[str]:
        return {name for name in self.keys if name != "period"}

    def shares_key_with(self, other: "Dataset") -> set[str]:
        """
        Keys both datasets carry *and* agree on the coding of.

        Two datasets both keyed by "region" only meet if both use the same
        region coding, so the coding scheme is compared, not just the key name.
        """
        shared = set()

        for name in self.key_spaces() & other.key_spaces():
            if self.keys[name] == other.keys[name]:
                shared.add(name)

        return shared


@dataclass(frozen=True)
class ConcordanceRow:
    from_key: str
    from_code: str
    to_key: str
    to_code: str
    weight: float | None
    basis: str
    source: str
    note: str


class Concordance:
    """
    One bridge between two key spaces.

    Holds the rows and answers two questions: what does this code map to, and
    may a value be apportioned across that mapping. The second is deliberately
    separate - asserting that a product relates to an industry is cheap, and
    asserting what share of it does is not.
    """

    def __init__(self, name: str, rows: list[ConcordanceRow]):
        self.name = name
        self.rows = rows

        self._forward: dict[tuple[str, str], list[ConcordanceRow]] = {}

        for row in rows:
            self._forward.setdefault((row.from_key, row.from_code), []).append(row)

    def __len__(self) -> int:
        return len(self.rows)

    def maps(self, key: str, code: str) -> list[ConcordanceRow]:
        return self._forward.get((key, str(code)), [])

    def weighted(self, key: str, code: str) -> list[ConcordanceRow] | None:
        """
        The mapping, but only if every row carries a weight.

        Returns None when any row is unweighted, because apportioning a total
        across a partly-weighted mapping would silently drop whatever the
        unweighted rows should have taken.
        """
        rows = self.maps(key, code)

        if not rows or any(row.weight is None for row in rows):
            return None

        return rows

    def problems(self) -> list[str]:
        """Weight sets that do not add up. Reported, never auto-corrected."""
        out: list[str] = []

        for (key, code), rows in sorted(self._forward.items()):
            weights = [row.weight for row in rows if row.weight is not None]

            if not weights or len(weights) != len(rows):
                continue

            total = sum(weights)

            if abs(total - 1.0) > 0.01:
                out.append(
                    f"{self.name}: {key} {code} weights sum to {total:.3f}, "
                    "not 1"
                )

        return out


def _read_rows(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        lines = [
            line
            for line in handle
            if line.strip() and not line.lstrip().startswith("#")
        ]

    return list(csv.DictReader(lines))


@lru_cache(maxsize=1)
def load_datasets() -> tuple[Dataset, ...]:
    if not DATASETS_DIR.exists():
        return ()

    out: list[Dataset] = []

    for path in sorted(DATASETS_DIR.glob("*.json")):
        raw = json.loads(path.read_text())

        # Keys prefixed with _ are prose for whoever reads the file next.
        raw = {k: v for k, v in raw.items() if not k.startswith("_")}

        identifier = str(raw.get("id") or "").strip()

        if not identifier:
            raise SystemExit(f"{path.name}: dataset has no id")

        if identifier != path.stem:
            raise SystemExit(
                f"{path.name}: id {identifier!r} does not match the filename"
            )

        keys = raw.get("keys") or {}

        for name in keys:
            if name not in KEY_SPACES:
                raise SystemExit(
                    f"{path.name}: unknown key space {name!r}. Known spaces: "
                    + ", ".join(sorted(KEY_SPACES))
                )

        basis = str(raw.get("periodBasis") or "").upper()

        if basis not in PERIOD_BASES:
            raise SystemExit(
                f"{path.name}: periodBasis {basis!r} is not one of "
                + ", ".join(sorted(PERIOD_BASES))
            )

        status = str(raw.get("status") or "declared").lower()

        if status not in STATUSES:
            raise SystemExit(
                f"{path.name}: status {status!r} is not one of "
                + ", ".join(sorted(STATUSES))
            )

        surface = raw.get("surface") or {}

        panels = tuple(
            Panel(
                id=str(item.get("id") or ""),
                title=str(item.get("title") or ""),
                on=str(item.get("on") or ""),
                via=(str(item["via"]) if item.get("via") else None),
                note=str(item.get("note") or ""),
            )
            for item in (surface.get("panels") or [])
            if not str(item.get("id", "")).startswith("_")
        )

        for panel in panels:
            if panel.on not in KEY_SPACES:
                raise SystemExit(
                    f"{path.name}: panel {panel.id!r} attaches to unknown key "
                    f"space {panel.on!r}"
                )

        out.append(
            Dataset(
                id=identifier,
                title=str(raw.get("title") or identifier),
                subtitle=str(raw.get("subtitle") or ""),
                keys=keys,
                period_basis=basis,
                frequencies=tuple(raw.get("frequencies") or ()),
                storage=raw.get("storage") or {},
                route=surface.get("route"),
                panels=panels,
                provenance=raw.get("provenance") or {},
                status=status,
                aggregation=raw.get("aggregation") or {},
            )
        )

    return tuple(out)


@lru_cache(maxsize=1)
def load_concordances() -> dict[str, Concordance]:
    if not CONCORDANCE_DIR.exists():
        return {}

    out: dict[str, Concordance] = {}

    for path in sorted(CONCORDANCE_DIR.glob("*.csv")):
        rows: list[ConcordanceRow] = []

        for line, row in enumerate(_read_rows(path), start=2):
            from_key = str(row.get("from_key") or "").strip()
            to_key = str(row.get("to_key") or "").strip()

            if not from_key and not to_key:
                continue

            for name, value in (("from_key", from_key), ("to_key", to_key)):
                if value not in KEY_SPACES:
                    raise SystemExit(
                        f"{path.name} line {line}: {name} {value!r} is not a "
                        "known key space"
                    )

            basis = str(row.get("basis") or "").strip().lower()

            if basis not in CONCORDANCE_BASES:
                raise SystemExit(
                    f"{path.name} line {line}: basis {basis!r} is not one of "
                    + ", ".join(sorted(CONCORDANCE_BASES))
                )

            if not str(row.get("source") or "").strip():
                raise SystemExit(
                    f"{path.name} line {line}: a mapping must name a source. "
                    "A concordance is a judgement and someone owns it."
                )

            raw_weight = str(row.get("weight") or "").strip()

            weight: float | None = None

            if raw_weight:
                try:
                    weight = float(raw_weight)
                except ValueError:
                    raise SystemExit(
                        f"{path.name} line {line}: weight {raw_weight!r} is "
                        "not a number"
                    )

                if not 0 <= weight <= 1:
                    raise SystemExit(
                        f"{path.name} line {line}: weight must be between 0 "
                        "and 1"
                    )

            rows.append(
                ConcordanceRow(
                    from_key=from_key,
                    from_code=str(row.get("from_code") or "").strip(),
                    to_key=to_key,
                    to_code=str(row.get("to_code") or "").strip(),
                    weight=weight,
                    basis=basis,
                    source=str(row.get("source") or "").strip(),
                    note=str(row.get("note") or "").strip(),
                )
            )

        out[path.stem] = Concordance(path.stem, rows)

    return out


def resolvable_panels() -> list[dict]:
    """
    Panels that could actually render right now.

    A panel needs three things: a live dataset behind it, and - where it
    crosses key spaces - a concordance that exists and has rows. Anything
    short of that is reported as blocked, with the reason, rather than
    quietly omitted.
    """
    concordances = load_concordances()

    out: list[dict] = []

    for dataset in load_datasets():
        for panel in dataset.panels:
            blocked: str | None = None

            if not dataset.live:
                blocked = f"{dataset.id} has no data ingested yet"
            elif panel.via:
                bridge = concordances.get(panel.via)

                if bridge is None:
                    blocked = f"concordance {panel.via} does not exist"
                elif len(bridge) == 0:
                    blocked = f"concordance {panel.via} has no rows yet"

            out.append(
                {
                    "dataset": dataset.id,
                    "panel": panel.id,
                    "title": panel.title,
                    "on": panel.on,
                    "via": panel.via,
                    "note": panel.note,
                    "available": blocked is None,
                    "blockedBy": blocked,
                }
            )

    return out


def manifest() -> dict:
    """What the frontend needs to know about every registered dataset."""
    concordances = load_concordances()

    return {
        "datasets": [
            {
                "id": item.id,
                "title": item.title,
                "subtitle": item.subtitle,
                "keys": item.keys,
                "periodBasis": item.period_basis,
                "frequencies": list(item.frequencies),
                "route": item.route,
                "status": item.status,
                "provenance": item.provenance,
            }
            for item in load_datasets()
        ],
        "concordances": [
            {
                "id": name,
                "rows": len(bridge),
                "problems": bridge.problems(),
            }
            for name, bridge in sorted(concordances.items())
        ],
        "panels": resolvable_panels(),
    }


def summary() -> str:
    items = load_datasets()

    live = [item for item in items if item.live]

    bridges = load_concordances()

    panels = resolvable_panels()

    ready = [panel for panel in panels if panel["available"]]

    lines = [
        f"{len(items)} dataset(s), {len(live)} live",
    ]

    for item in items:
        keys = ", ".join(f"{k}:{v}" for k, v in sorted(item.keys.items()))

        lines.append(f"  {item.id:10} {item.status:9} {item.period_basis:6} {keys}")

    lines.append(
        f"{len(bridges)} concordance(s): "
        + (
            ", ".join(f"{name} ({len(b)} rows)" for name, b in sorted(bridges.items()))
            or "none"
        )
    )

    lines.append(f"{len(ready)} of {len(panels)} cross-dataset panel(s) can render")

    for panel in panels:
        if not panel["available"]:
            lines.append(
                f"  blocked: {panel['dataset']}/{panel['panel']} - {panel['blockedBy']}"
            )

    for name, bridge in sorted(bridges.items()):
        for problem in bridge.problems():
            lines.append(f"  {problem}")

    return "\n".join(lines)


if __name__ == "__main__":
    print(summary())
