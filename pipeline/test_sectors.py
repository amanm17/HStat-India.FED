#!/usr/bin/env python3
"""
Checks for sectors (pipeline/sectors.py): the seed is well formed, the pull
plan asks Comtrade only for what the seed lacks, and seeds go into and out of
the raw store cleanly. Runs in CI (qa.yml); needs no network.

    cd pipeline && python test_sectors.py
"""
from __future__ import annotations

import argparse
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pandas as pd  # noqa: E402

import definition  # noqa: E402
import pull_comtrade as pc  # noqa: E402
import sectors  # noqa: E402

passed = failed = 0


def ok(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
    else:
        failed += 1
        print(f"FAIL {name} {detail}")


all_sectors = sectors.load_sectors(include_disabled=True)
ok("at least one sector", bool(all_sectors))
universe = set(definition.hs6_universe())
batches = {b["id"]: set(b.get("codes", [])) for b in definition.load_batches()}

for sector in all_sectors:
    ok(f"{sector.id}: members are current HS-6 codes", sector.members <= universe,
       ", ".join(sorted(sector.members - universe)[:5]))
    ok(f"{sector.id}: batch exists", not sector.batch or sector.batch in batches)
    ok(f"{sector.id}: seed codes are the batch's", sector.seed_codes() <= batches.get(sector.batch, set()))

    for source, scope, flow in sectors.seed_files(sector):
        frame = pd.read_parquet(source)
        keys = ["period", "reporterCode", "partnerCode", "cmdCode", "flowCode"]
        ok(f"{source.name}: columns", list(frame.columns) == sectors.SEED_COLUMNS, str(list(frame.columns)))
        ok(f"{source.name}: one row per key", not frame.duplicated(keys).any())
        ok(f"{source.name}: one flow", set(frame["flowCode"]) == {flow})
        ok(f"{source.name}: only seeded years", set(frame["period"]) <= sector.seed_years(scope, flow))
        ok(f"{source.name}: only seed codes", set(frame["cmdCode"]) <= sector.seed_codes())
        ok(f"{source.name}: no negative values", (frame["primaryValue"] >= 0).all())
        if scope == "india":
            ok(f"{source.name}: India's World rows present", (frame["partnerCode"] == "0").any())
            ok(f"{source.name}: India reports", set(frame["reporterCode"]) == {"699"})
        else:
            ok(f"{source.name}: partner World only", set(frame["partnerCode"]) == {"0"})

# The plan: no job for a seeded batch asks for a seeded year of a seed code.
scope_config = definition.load_scope()
args = argparse.Namespace(
    start_year=scope_config["historyStartYear"], end_year=datetime.now(timezone.utc).year, months=24,
    mode="incremental", refresh_years=0, refresh_months=0, chunk_size=None, monthly_scopes=None,
    annual_periods_per_call=10, monthly_periods_per_call=6,
)
jobs = pc.build_jobs(args, scope_config, pc.refresh_window(args))
keys = [job.key for job in jobs]
ok("job keys unique", len(keys) == len(set(keys)))
for batch_id, sector in sectors.seeded_batches().items():
    covered = sector.seed_codes()
    mine = [job for job in jobs if job.freq == "A" and set(job.codes) & batches[batch_id]]
    ok(f"{sector.id}: seeded batch has annual jobs", bool(mine))
    overlap = [
        job.key for job in mine
        if set(job.codes) & covered and set(job.periods) & sector.seed_years(job.scope, job.flow)
    ]
    ok(f"{sector.id}: no seeded year is pulled", not overlap, ", ".join(overlap[:3]))
    if sector.history_start:
        early = [job.key for job in mine if min(job.periods) < str(sector.history_start)]
        ok(f"{sector.id}: nothing before {sector.history_start}", not early, ", ".join(early[:3]))
    others = [job for job in jobs if job.freq == "A" and not (set(job.codes) & batches[batch_id])]
    ok(f"{sector.id}: other batches keep the shared numbering", all(job.chunk < 100 for job in others))

# Seeds in and out of a store.
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    stale = root / "A" / "global" / "M" / f"{sectors.SEED_PREFIX}gone.parquet"
    stale.parent.mkdir(parents=True)
    stale.write_bytes(b"x")
    notes = sectors.install_seeds(root)
    ok("install removes a seed whose sector is gone", not stale.exists(), str(notes))
    wanted = sum(len(sectors.seed_files(s)) for s in sectors.load_sectors())
    ok("install places every seed", len(list(root.glob(f"A/*/*/{sectors.SEED_PREFIX}*.parquet"))) == wanted)
    ok("install is idempotent", sectors.install_seeds(root) == [])
    ok("seeds sort before pulled chunks", sorted([f"{sectors.SEED_PREFIX}x.parquet", "1996-1999__00.parquet"])[0].startswith(sectors.SEED_PREFIX))

print(f"{passed}/{passed + failed} passed")
sys.exit(1 if failed else 0)
