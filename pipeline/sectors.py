#!/usr/bin/env python3
"""
Sectors: named sets of HS-6 codes with their own totals, tags and pages.

A sector is a lens, not a stream. A stream (hs_index/codes.csv `stream`)
decides which figures a code is added into, and each code has exactly one.
A sector is a published grouping that may take codes from any stream: the
capital goods segment holds 370 codes of its own stream plus 66 machines and
instruments that already belong to the electronics and electronics-inputs
streams. Its totals are its own file (sector-<id>.json); an electronics
figure never moves because a sector exists.

Everything about a sector lives in one folder, so it can be switched off or
removed as a unit:

    hs_index/sectors/<id>/sector.json   label, note, batch, seed, enabled
    hs_index/sectors/<id>/codes.csv     hs6, broad_category, niche_category,
                                        scomet (one row per member code)
    hs_index/sectors/<id>/seed/         Comtrade rows supplied with the
                                        sector (optional, see SEEDS)

    python3 pipeline/sectors.py --list
    python3 pipeline/sectors.py --install-seeds         (the refresh runs this)
    python3 pipeline/sectors.py --build-seed <id> --world W.xlsx --india I.xlsx
    python3 pipeline/hs_intake.py --remove-sector <id>  (takes it all out)

Setting "enabled": false in sector.json hides the sector (no panel, no
totals, no tags) and keeps its codes. Removing it takes its codes out of the
index too, with every chapter and heading only they used.

SEEDS

An upload of codes can bring the Comtrade data FED already holds for them
(an export from comtrade.un.org with Year, Reporter, Flow, Partner, HS Code,
Primary Value). The seed is written into the raw store as its own file, and
the pull asks Comtrade only for the years and flows the seed does not cover.
For the capital goods segment that is 2017 to 2022 of world trade and of
India's trade by partner, both flows. With the segment starting in 2017
(historyStart) and no mirror pulls, its first pull is 212 calls (112 of them
India's monthly figures), against 528 for the full series pulled cold.

A seed only fills in what Comtrade would have returned. It is checked
against the store on arrival (pipeline/sectors.py --check-seed compares it
with any rows already pulled for the same codes), the raw recompute
(verify_filed.py) reads it like any other download, and a later pull of the
same rows replaces it (store.read_frame keeps the last file's row; seeds sort
first). Only settled years are seeded: recent years, where late filers are
still arriving, are always pulled.
"""
from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECTORS_DIR = ROOT / "hs_index" / "sectors"
SEED_PREFIX = "0000-seed__"
SEED_COLUMNS = [
    "period", "refYear", "reporterCode", "reporterDesc", "partnerCode",
    "partnerDesc", "cmdCode", "flowCode", "primaryValue",
]


@dataclass(frozen=True)
class SectorCode:
    hs6: str
    broad_category: str
    niche_category: str
    scomet: bool


@dataclass(frozen=True)
class Sector:
    id: str
    label: str
    note: str
    enabled: bool
    batch: str
    codes: tuple[SectorCode, ...]
    seed: dict = field(default_factory=dict)
    mirror: bool = True
    # First year pulled for the sector's own batch. Earlier years can be
    # added later by lowering it; the nightly backfill then fetches them.
    history_start: int | None = None

    @property
    def folder(self) -> Path:
        return SECTORS_DIR / self.id

    @property
    def members(self) -> frozenset[str]:
        return frozenset(code.hs6 for code in self.codes)

    def seed_years(self, scope: str, flow: str) -> frozenset[str]:
        """Years the seed holds for one scope and flow (strings, as periods)."""
        if not self.seed:
            return frozenset()
        if flow not in (self.seed.get("scopes") or {}).get(scope, []):
            return frozenset()
        return frozenset(str(year) for year in self.seed.get("years", []))

    def seed_codes(self) -> frozenset[str]:
        """Codes the seed was extracted for: absence of a row is a zero."""
        return frozenset(self.seed.get("codes", []))


def _flag(value: str) -> bool:
    return (value or "").strip().lower() in {"yes", "y", "true", "1"}


@lru_cache(maxsize=1)
def load_sectors(include_disabled: bool = False) -> tuple[Sector, ...]:
    if not SECTORS_DIR.exists():
        return ()
    out = []
    for folder in sorted(p for p in SECTORS_DIR.iterdir() if p.is_dir()):
        meta_path = folder / "sector.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        codes = []
        with (folder / "codes.csv").open(encoding="utf-8") as handle:
            for row in csv.DictReader(line for line in handle if not line.startswith("#")):
                codes.append(SectorCode(
                    hs6=row["hs6"].strip(),
                    broad_category=(row.get("broad_category") or "").strip(),
                    niche_category=(row.get("niche_category") or "").strip(),
                    scomet=_flag(row.get("scomet", "")),
                ))
        sector = Sector(
            id=meta["id"],
            label=meta["label"],
            note=meta.get("note", ""),
            enabled=bool(meta.get("enabled", True)),
            batch=meta.get("batch", ""),
            codes=tuple(codes),
            seed=meta.get("seed") or {},
            mirror=bool(meta.get("mirror", True)),
            history_start=int(meta["historyStart"]) if meta.get("historyStart") else None,
        )
        if sector.enabled or include_disabled:
            out.append(sector)
    return tuple(out)


def sectors_of(code: str) -> list[dict]:
    """The enabled sectors a code belongs to, with its tags in each."""
    out = []
    for sector in load_sectors():
        for entry in sector.codes:
            if entry.hs6 == code:
                out.append({
                    "id": sector.id,
                    "label": sector.label,
                    "broadCategory": entry.broad_category,
                    "nicheCategory": entry.niche_category,
                    "scomet": entry.scomet,
                })
    return out


def seeded_batches() -> dict[str, Sector]:
    """batch id -> the enabled sector whose seed or start year shapes that
    batch's annual pull."""
    return {s.batch: s for s in load_sectors() if s.batch and (s.seed or s.history_start)}


def history_starts() -> dict[str, int]:
    """code -> first year pulled, for every code of a sector batch that starts late."""
    import definition

    out: dict[str, int] = {}
    batches = {b["id"]: b for b in definition.load_batches()}
    for sector in load_sectors():
        if sector.history_start and sector.batch in batches:
            for code in batches[sector.batch].get("codes", []):
                out[code] = sector.history_start
    return out


# ----------------------------------------------------------------- store


def seed_files(sector: Sector) -> list[tuple[Path, str, str]]:
    """(source parquet, scope, flow) for each seed file a sector carries."""
    out = []
    for scope, flows in (sector.seed.get("scopes") or {}).items():
        for flow in flows:
            path = sector.folder / "seed" / f"{scope}-{flow}.parquet"
            if path.exists():
                out.append((path, scope, flow))
    return out


def install_seeds(store_root: Path | None = None) -> list[str]:
    """
    Put every enabled sector's seed into the raw store, and take out any
    seed whose sector is gone or disabled. Idempotent; costs no API call.
    """
    from common import RAW_STORE

    root = Path(store_root) if store_root else RAW_STORE
    wanted: dict[Path, Path] = {}
    for sector in load_sectors():
        for source, scope, flow in seed_files(sector):
            wanted[root / "A" / scope / flow / f"{SEED_PREFIX}{sector.id}.parquet"] = source

    notes = []
    if root.exists():
        for existing in root.glob(f"A/*/*/{SEED_PREFIX}*.parquet"):
            if existing not in wanted:
                existing.unlink()
                notes.append(f"removed {existing.relative_to(root)}")

    for target, source in wanted.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.read_bytes() != source.read_bytes():
            shutil.copyfile(source, target)
            notes.append(f"installed {target.relative_to(root)}")
    return notes


# ----------------------------------------------------------------- building a seed


def _fix_text(value: str) -> str:
    """Undo the UTF-8-read-as-Latin-1 damage Comtrade CSV exports pick up."""
    try:
        return value.encode("latin1").decode("utf8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


def _country_codes() -> dict[str, str]:
    """Comtrade name -> code, from the reference and every published page."""
    names: dict[str, str] = {}
    reference = ROOT / "config" / "reference" / "comtrade_country_reference.json"
    if reference.exists():
        for row in json.loads(reference.read_text(encoding="utf-8")):
            names.setdefault(row["name"], str(row["code"]))
    detail = ROOT / "public" / "data" / "snapshots" / "current" / "detail"
    for path in sorted(detail.glob("*.json")) if detail.exists() else []:
        for code, name in (json.loads(path.read_text(encoding="utf-8")).get("reporters") or {}).items():
            names.setdefault(name, str(code))
    return names


def _read_sheet(path: Path, sheet: str | None):
    import pandas as pd

    if path.suffix.lower() == ".parquet":
        return pd.read_parquet(path)
    import openpyxl

    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheet_obj = book[sheet] if sheet else book.worksheets[0]
    rows = sheet_obj.iter_rows(values_only=True)
    header = [str(h).strip() if h is not None else "" for h in next(rows)]
    data = [row[: len(header)] for row in rows if row and row[0] is not None]
    return pd.DataFrame(data, columns=header)


def build_seed(sector_id: str, world: Path | None, india: Path | None,
               world_sheet: str | None, india_sheet: str | None) -> dict:
    """
    Turn Comtrade exports into the sector's seed files, for the years and
    codes sector.json names. world: every reporter with partner World.
    india: India's trade by partner.
    """
    import pandas as pd

    folder = SECTORS_DIR / sector_id
    meta = json.loads((folder / "sector.json").read_text(encoding="utf-8"))
    seed = meta.get("seed") or {}
    years = {int(y) for y in seed.get("years", [])}
    codes = set(seed.get("codes", []))
    names = _country_codes()
    flows = {"Import": "M", "Export": "X"}
    out_dir = folder / "seed"
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {"unmapped": set(), "rows": {}}

    world_frame = None

    def frame(source: Path, sheet: str | None, scope: str):
        df = _read_sheet(source, sheet)
        value = "Primary Value" if "Primary Value" in df.columns else "Primary"
        df = df[df["Year"].astype(int).isin(years)].copy()
        df["cmdCode"] = df["HS Code"].astype(str).str.replace(r"\.0$", "", regex=True).str.zfill(6)
        df = df[df["cmdCode"].isin(codes)]
        df["Reporter"] = df["Reporter"].astype(str).map(_fix_text)
        df["Partner"] = df["Partner"].astype(str).map(_fix_text)
        for column in ("Reporter", "Partner"):
            missing = set(df[column]) - set(names) - {"World"}
            report["unmapped"].update(missing)
        df = df[df["Reporter"].isin(names) & (df["Partner"].isin(names) | (df["Partner"] == "World"))]
        # Regional groups (EU 97, ASEAN 975) repeat their members' rows.
        df = df[~df["Reporter"].map(names).isin({"97", "975"}) & ~df["Partner"].map(names).isin({"97", "975"})]
        result = pd.DataFrame({
            "period": df["Year"].astype(int).astype(str),
            "refYear": df["Year"].astype(int),
            "reporterCode": df["Reporter"].map(names).astype(str),
            "reporterDesc": df["Reporter"],
            "partnerCode": df["Partner"].map(lambda p: "0" if p == "World" else names[p]).astype(str),
            "partnerDesc": df["Partner"],
            "cmdCode": df["cmdCode"],
            "flowCode": df["Flow"].map(flows),
            "primaryValue": pd.to_numeric(df[value], errors="coerce").astype("float64"),
        })
        result = result[result["flowCode"].notna() & result["primaryValue"].notna()]
        if scope == "india" and world_frame is not None:
            # India's own total with the World: the partner sheet holds only
            # named partners, the world sheet holds India's World row.
            totals = world_frame[world_frame["reporterCode"] == "699"]
            result = pd.concat([result, totals], ignore_index=True)
        keys = ["period", "reporterCode", "partnerCode", "cmdCode", "flowCode"]
        duplicated = int(result.duplicated(keys).sum())
        if duplicated:
            raise SystemExit(f"{source.name}: {duplicated} duplicate rows; a seed must hold one row per key")
        for flow, rows in result.groupby("flowCode"):
            if flow not in (seed.get("scopes") or {}).get(scope, []):
                continue
            rows = rows.sort_values(keys).reset_index(drop=True)
            rows.to_parquet(out_dir / f"{scope}-{flow}.parquet", index=False)
            report["rows"][f"{scope}-{flow}"] = len(rows)
        return result

    world_frame = None
    if world:
        world_frame = frame(world, world_sheet, "global")
    if india:
        frame(india, india_sheet, "india")
    report["unmapped"] = sorted(report["unmapped"])
    return report


def check_seed(sector_id: str, store_root: Path | None = None) -> list[str]:
    """
    Compare a seed with rows already in the store for the same keys. A seed
    is an extract of Comtrade, so where both exist they should agree.
    """
    import pandas as pd
    import store

    sector = next(s for s in load_sectors(include_disabled=True) if s.id == sector_id)
    lines = []
    for source, scope, flow in seed_files(sector):
        seed = pd.read_parquet(source)
        pulled = store.read_frame("A", scope, flow, store_root)
        if pulled.empty:
            lines.append(f"{scope}-{flow}: nothing pulled yet to compare")
            continue
        keys = ["period", "reporterCode", "partnerCode", "cmdCode"]
        joined = seed.merge(pulled[keys + ["primaryValue"]], on=keys, suffixes=("", "_pulled"))
        if joined.empty:
            lines.append(f"{scope}-{flow}: no overlapping rows")
            continue
        gap = (joined["primaryValue"] - joined["primaryValue_pulled"]).abs().sum()
        lines.append(f"{scope}-{flow}: {len(joined):,} overlapping rows, total gap {gap / max(joined['primaryValue_pulled'].sum(), 1):.4%}")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--install-seeds", action="store_true")
    parser.add_argument("--build-seed", metavar="SECTOR")
    parser.add_argument("--check-seed", metavar="SECTOR")
    parser.add_argument("--world", type=Path)
    parser.add_argument("--world-sheet")
    parser.add_argument("--india", type=Path)
    parser.add_argument("--india-sheet")
    args = parser.parse_args()

    sys.path.insert(0, str(Path(__file__).resolve().parent))

    if args.list:
        for sector in load_sectors(include_disabled=True):
            state = "enabled" if sector.enabled else "disabled"
            print(f"{sector.id:<20} {len(sector.codes):>4} codes  {state}  batch {sector.batch or '-'}"
                  f"  seed {sorted(sector.seed.get('scopes', {}).items()) if sector.seed else '-'}")
        return 0
    if args.install_seeds:
        for note in install_seeds() or ["seeds already in place"]:
            print(note)
        return 0
    if args.build_seed:
        report = build_seed(args.build_seed, args.world, args.india, args.world_sheet, args.india_sheet)
        print(json.dumps(report, indent=1))
        return 0
    if args.check_seed:
        for line in check_seed(args.check_seed):
            print(line)
        return 0
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
