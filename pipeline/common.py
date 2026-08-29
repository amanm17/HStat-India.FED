from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
import math
import os
import time

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PUBLIC = ROOT / "public" / "data"
RAW = DATA / "raw"
RAW_STORE = RAW / "store"
STAGING = DATA / "staging"
QA = DATA / "qa"
DGCIS_NORMALIZED = DATA / "dgcis" / "normalized"

REQUIRED_TRADE_COLUMNS = {
    "refYear",
    "reporterCode",
    "partnerCode",
    "cmdCode",
    "flowCode",
    "primaryValue",
}

# UN Comtrade flow codes.
#   X = DX + RX + XIP + XOP      total exports include re-exports
#   M = FM + RM + MIP + MOP      total imports include re-imports
# HStat nets RM out of M (and RX out of X for the mirror check) wherever a
# reporter files the sub-flow. Not every reporter does; coverage is recorded
# per HS/year so the dashboard can say how much of the total was adjustable.
FLOW_IMPORTS = "M"
FLOW_EXPORTS = "X"
FLOW_RE_IMPORTS = "RM"
FLOW_RE_EXPORTS = "RX"

WORLD_PARTNER = "0"
INDIA_REPORTER = "699"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path):
    return json.loads(path.read_text())


def write_json(path: Path, obj, compact: bool = False) -> None:
    """
    Human-facing files (manifest, qa, methodology) stay indented.

    Node files are written compact and without a per-file timestamp, so a
    refresh that does not change a product's numbers produces a
    byte-identical file. Git then stores nothing new for it, which is what
    keeps a monthly commit of 549 nodes from growing the repository without
    bound.
    """
    path.parent.mkdir(parents=True, exist_ok=True)

    if compact:
        text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(obj, indent=2, ensure_ascii=False)

    path.write_text(text)


def require_trade_frame(df, label: str):
    if df is None:
        raise RuntimeError(f"{label}: source returned no table")

    missing = REQUIRED_TRADE_COLUMNS - set(df.columns)

    if missing:
        raise RuntimeError(f"{label}: missing columns {sorted(missing)}")

    return df.copy()


def clean_code(value) -> str:
    if pd.isna(value):
        return ""

    text = str(value).strip()

    return text[:-2] if text.endswith(".0") else text


def filter_classic(df):
    """
    Keep one analytical row per reporter/partner/commodity/flow/period.

    Comtrade returns partner2, customs-procedure and mode-of-transport
    breakdowns alongside the aggregate row. Summing without this filter
    double counts.
    """
    z = df.copy()

    if "partner2Code" in z:
        z = z[z["partner2Code"].fillna(0).astype(str).isin(["0", "0.0"])]

    if "customsCode" in z:
        z = z[z["customsCode"].fillna("C00").astype(str).isin(["C00", "0"])]

    if "motCode" in z:
        z = z[z["motCode"].fillna(0).astype(str).isin(["0", "0.0"])]

    for column in ["cmdCode", "reporterCode", "partnerCode", "flowCode"]:
        if column in z:
            z[column] = z[column].map(clean_code)

    z["primaryValue"] = pd.to_numeric(z["primaryValue"], errors="coerce")
    z["refYear"] = pd.to_numeric(z["refYear"], errors="coerce").astype("Int64")

    if "period" in z:
        z["period"] = z["period"].map(clean_code)

    return z


def assert_unique(df, keys, label: str):
    duplicates = df[df.duplicated(keys, keep=False)]

    if not duplicates.empty:
        raise RuntimeError(
            f"{label}: duplicate analytical rows "
            f"{duplicates[keys].head(5).to_dict('records')}"
        )


def api_key() -> str:
    key = os.getenv("COMTRADE_API_KEY", "").strip()

    if not key:
        raise RuntimeError("COMTRADE_API_KEY is not set")

    return key


def round_usd(value):
    """Snapshots ship whole dollars. Sub-dollar precision is noise that
    costs real bytes across 400+ products."""
    if value is None:
        return None

    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None

    return int(round(float(value)))


def round_ratio(value, places: int = 6):
    if value is None:
        return None

    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None

    return round(float(value), places)


def chunked(items, size: int):
    items = list(items)

    if size <= 0:
        return [items]

    return [items[i: i + size] for i in range(0, len(items), size)]


def annual_periods(start_year: int, end_year: int) -> list[str]:
    return [str(year) for year in range(start_year, end_year + 1)]


def monthly_periods(end: datetime, months: int) -> list[str]:
    """The `months` most recent complete months, oldest first."""
    periods: list[str] = []

    year = end.year
    month = end.month

    for _ in range(months):
        month -= 1

        if month == 0:
            month = 12
            year -= 1

        periods.append(f"{year}{month:02d}")

    return list(reversed(periods))


ATTEMPTS = 3

# Where every failed attempt is written, one JSON object per line. Append-only
# and survives the run, so a pull that finally succeeded on its third attempt
# still leaves evidence that the source was struggling.
CALL_LOG = DATA / "logs" / "call-errors.jsonl"


def log_call_error(record: dict, path: Path | None = None) -> None:
    """Append one failed attempt to the call log. Never raises."""
    target = path or CALL_LOG

    try:
        target.parent.mkdir(parents=True, exist_ok=True)

        with target.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, sort_keys=True) + "\n")
    except Exception:  # noqa: BLE001 - logging must not break a run
        pass


def with_retry(
    call,
    *,
    label: str,
    attempts: int = ATTEMPTS,
    base_delay: float = 5.0,
    on_error=None,
):
    """
    Three attempts, then give up and say so.

    Comtrade returns transient 429s and 5xx under load, and a single failed
    call is usually nothing. But a refresh that silently dropped a flow would
    publish an understated global total, so a call that never succeeds has to
    stop the run rather than leave a hole.

    Every attempt that fails is written to the call log whether or not a later
    attempt succeeds. A chunk that needed three goes is not an error, but it is
    the thing you want to see in the log when the next run fails outright.
    """
    last: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            result = call()

            if attempt > 1:
                print(f"  {label}: succeeded on attempt {attempt}")

            return result
        except Exception as exc:  # noqa: BLE001 - re-raised below
            last = exc

            final = attempt == attempts

            delay = 0.0 if final else base_delay * (2 ** (attempt - 1))

            record = {
                "at": utc_now(),
                "label": label,
                "attempt": attempt,
                "attempts": attempts,
                "error": type(exc).__name__,
                "message": str(exc)[:500],
                "retryInSeconds": delay,
                "final": final,
            }

            log_call_error(record)

            if on_error is not None:
                on_error(record)

            if final:
                break

            print(
                f"  {label}: attempt {attempt} of {attempts} failed "
                f"({type(exc).__name__}: {exc}); retrying in {delay:.0f}s"
            )

            time.sleep(delay)

    raise RuntimeError(
        f"{label}: failed after {attempts} attempts. Last error was "
        f"{type(last).__name__}: {last}. Every attempt is in "
        f"{CALL_LOG.relative_to(ROOT) if CALL_LOG.is_relative_to(ROOT) else CALL_LOG}."
    ) from last
