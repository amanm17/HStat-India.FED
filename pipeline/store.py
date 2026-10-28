"""
Read side of the raw Comtrade store.

`pull_comtrade.py` writes one parquet per (frequency, scope, flow,
period-group, code-chunk). This module loads those files once and hands
downstream code plain Python structures keyed by (HS code, period).

Why not DataFrames: processing asks for one code in one period roughly
twenty thousand times per run, and every one of those lookups was a pandas
slice over an Arrow-backed frame. Grouping once into dictionaries turns
the whole inner loop into arithmetic over a few hundred tuples and takes a
multi-hour run down to a couple of minutes.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from common import RAW_STORE, WORLD_PARTNER

EXPECTED_COLUMNS = [
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

WORLD_CODES = {WORLD_PARTNER, "0.0", "0"}

# Regional groups Comtrade can return beside their own members: the European
# Union (97) and ASEAN (975). A row for one is a sum of rows already counted,
# so neither is ever read as a reporter or as a partner. (Other Asia, nes,
# code 490, is flagged a group in Comtrade's list but is one economy,
# Taiwan, and is counted.)
AGGREGATE_CODES = {"97", "975"}


def store_root(root: Path | None = None) -> Path:
    return Path(root) if root else RAW_STORE


def available(root: Path | None = None) -> dict[str, list[str]]:
    """What the store currently holds, as {frequency: [scope/flow, ...]}."""
    base = store_root(root)

    found: dict[str, list[str]] = {}

    if not base.exists():
        return found

    for freq_dir in sorted(base.iterdir()):
        if not freq_dir.is_dir():
            continue

        entries: list[str] = []

        for scope_dir in sorted(freq_dir.iterdir()):
            if not scope_dir.is_dir():
                continue

            for flow_dir in sorted(scope_dir.iterdir()):
                if flow_dir.is_dir() and any(flow_dir.glob("*.parquet")):
                    entries.append(f"{scope_dir.name}/{flow_dir.name}")

        if entries:
            found[freq_dir.name] = entries

    return found


def read_frame(
    freq: str,
    scope: str,
    flow: str,
    root: Path | None = None,
) -> pd.DataFrame:
    directory = store_root(root) / freq / scope / flow

    if not directory.exists():
        return pd.DataFrame(columns=EXPECTED_COLUMNS)

    frames = []

    for path in sorted(directory.glob("*.parquet")):
        frame = pd.read_parquet(path)

        if len(frame):
            frames.append(frame)

    if not frames:
        return pd.DataFrame(columns=EXPECTED_COLUMNS)

    combined = pd.concat(frames, ignore_index=True)

    for column in EXPECTED_COLUMNS:
        if column not in combined.columns:
            combined[column] = None

    # Parquet hands back Arrow-backed strings, which are slow to touch
    # element by element. Everything downstream reads these as Python
    # objects, so convert once here.
    for column in [
        "period",
        "reporterCode",
        "reporterDesc",
        "partnerCode",
        "partnerDesc",
        "cmdCode",
        "flowCode",
    ]:
        combined[column] = combined[column].astype("object")

    combined["primaryValue"] = pd.to_numeric(
        combined["primaryValue"],
        errors="coerce",
    ).astype("float64")

    missing_period = combined["period"].isna() | combined["period"].isin(
        ["", "nan", "<NA>", "None"]
    )

    if missing_period.any():
        combined.loc[missing_period, "period"] = combined.loc[
            missing_period, "refYear"
        ].astype(str)

    # Chunks overlap when a code list changes between runs; the same
    # analytical row must never be counted twice.
    keys = ["period", "reporterCode", "partnerCode", "cmdCode", "flowCode"]

    combined = combined.drop_duplicates(subset=keys, keep="last")

    return combined.reset_index(drop=True)


def _text(value) -> str:
    if value is None:
        return ""

    text = str(value).strip()

    return text[:-2] if text.endswith(".0") else text


class ReporterIndex:
    """
    Reporter-to-World rows grouped by (HS code, period).

    Each entry is {reporterCode: (reporterName, value)} — exactly one row
    per reporting economy, which is what a world total requires.
    """

    __slots__ = ("groups", "_periods")

    def __init__(self, frame: pd.DataFrame | None = None):
        self.groups: dict[tuple[str, str], dict[str, tuple[str, float]]] = {}

        self._periods: set[str] = set()

        if frame is None or frame.empty:
            return

        columns = [
            "cmdCode",
            "period",
            "reporterCode",
            "reporterDesc",
            "partnerCode",
            "primaryValue",
        ]

        for row in frame[columns].itertuples(index=False, name=None):
            code, period, reporter, name, partner, value = row

            if _text(partner) not in WORLD_CODES:
                continue

            if value is None or value != value or value < 0:
                continue

            key = (_text(code), _text(period))

            bucket = self.groups.get(key)

            if bucket is None:
                bucket = {}
                self.groups[key] = bucket
                self._periods.add(key[1])

            reporter = _text(reporter)

            if reporter in AGGREGATE_CODES:
                continue

            # First row wins: a duplicate here would double count.
            if reporter not in bucket:
                bucket[reporter] = (
                    _text(name) or reporter,
                    float(value),
                )

    def get(self, code: str, period: str) -> dict[str, tuple[str, float]]:
        return self.groups.get((str(code), str(period)), {})

    def periods(self) -> set[str]:
        return set(self._periods)

    def filers(self) -> dict[int, set[str]]:
        """
        Year -> every reporter that filed anything in this flow that year,
        across every code pulled. A reporter in here has answered for the
        year; estimation leaves it alone (estimate.fill, `filers`).
        """
        out: dict[int, set[str]] = {}
        for (_, period), bucket in self.groups.items():
            if not str(period).isdigit() or len(str(period)) != 4:
                continue
            out.setdefault(int(period), set()).update(bucket)
        return out

    def __len__(self) -> int:
        return len(self.groups)


class PartnerIndex:
    """
    One reporter's bilateral rows grouped by (HS code, period).

    Holds the World aggregate separately from the individual partners, so
    the two are never mixed into the same sum.
    """

    __slots__ = ("groups", "world", "_periods")

    def __init__(self, frame: pd.DataFrame | None = None, reporter: str = ""):
        self.groups: dict[tuple[str, str], list[tuple[str, str, float]]] = {}

        self.world: dict[tuple[str, str], float] = {}

        self._periods: set[str] = set()

        if frame is None or frame.empty:
            return

        columns = [
            "cmdCode",
            "period",
            "reporterCode",
            "partnerCode",
            "partnerDesc",
            "primaryValue",
        ]

        for row in frame[columns].itertuples(index=False, name=None):
            code, period, row_reporter, partner, name, value = row

            if reporter and _text(row_reporter) != reporter:
                continue

            if value is None or value != value or value < 0:
                continue

            key = (_text(code), _text(period))

            self._periods.add(key[1])

            partner = _text(partner)

            if partner in WORLD_CODES:
                self.world.setdefault(key, float(value))
                continue

            if partner in AGGREGATE_CODES:
                continue

            self.groups.setdefault(key, []).append(
                (partner, _text(name) or partner, float(value))
            )

    def partners(self, code: str, period: str) -> list[tuple[str, str, float]]:
        rows = self.groups.get((str(code), str(period)), [])

        return sorted(rows, key=lambda item: -item[2])

    def world_total(self, code: str, period: str):
        return self.world.get((str(code), str(period)))

    def periods(self) -> set[str]:
        return set(self._periods)

    def __len__(self) -> int:
        return len(self.groups) + len(self.world)


def reporter_index(
    freq: str,
    scope: str,
    flow: str,
    root: Path | None = None,
) -> ReporterIndex:
    return ReporterIndex(read_frame(freq, scope, flow, root))


def mirror_series(
    freq: str,
    target: str,
    flow: str,
    root: Path | None = None,
) -> dict[str, dict[int, dict[str, float]]]:
    """
    What every partner reported trading with `target`, from the mirror scope
    pulled for it (pull_comtrade, scope "mirror-<code>"): code -> year ->
    {partner: value}. Kept per partner so a growth rate can be taken over the
    partners that filed both years (estimate.mirror_ratio).
    """
    frame = read_frame(freq, f"mirror-{target}", flow, root)
    out: dict[str, dict[int, dict[str, float]]] = {}
    if frame is None or frame.empty:
        return out
    for code, period, reporter, partner, value in frame[
        ["cmdCode", "period", "reporterCode", "partnerCode", "primaryValue"]
    ].itertuples(index=False, name=None):
        if _text(partner) != str(target) or _text(reporter) == str(target):
            continue
        if value is None or value != value or value < 0:
            continue
        period = _text(period)
        if not period.isdigit() or len(period) != 4:
            continue
        out.setdefault(_text(code), {}).setdefault(int(period), {})[_text(reporter)] = float(value)
    return out


def partner_index(
    freq: str,
    scope: str,
    flow: str,
    reporter: str,
    root: Path | None = None,
) -> PartnerIndex:
    return PartnerIndex(read_frame(freq, scope, flow, root), reporter=reporter)
