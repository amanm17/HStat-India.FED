from __future__ import annotations
from pathlib import Path
import json, os
from datetime import datetime, timezone
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PUBLIC = ROOT / "public" / "data"
RAW = DATA / "raw"
STAGING = DATA / "staging"
QA = DATA / "qa"
DGCIS_NORMALIZED = DATA / "dgcis" / "normalized"
REQUIRED_TRADE_COLUMNS = {"refYear","reporterCode","partnerCode","cmdCode","flowCode","primaryValue"}

def utc_now(): return datetime.now(timezone.utc).isoformat()
def load_json(path: Path): return json.loads(path.read_text())
def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False))
def require_trade_frame(df, label):
    if df is None: raise RuntimeError(f"{label}: source returned no table")
    missing = REQUIRED_TRADE_COLUMNS - set(df.columns)
    if missing: raise RuntimeError(f"{label}: missing columns {sorted(missing)}")
    return df.copy()
def clean_code(value):
    if pd.isna(value): return ""
    s=str(value).strip()
    return s[:-2] if s.endswith('.0') else s
def filter_classic(df):
    z=df.copy()
    if "partner2Code" in z: z=z[z["partner2Code"].fillna(0).astype(str).isin(["0","0.0"])]
    if "customsCode" in z: z=z[z["customsCode"].fillna("C00").astype(str).isin(["C00","0"])]
    if "motCode" in z: z=z[z["motCode"].fillna(0).astype(str).isin(["0","0.0"])]
    for c in ["cmdCode","reporterCode","partnerCode"]: z[c]=z[c].map(clean_code)
    z["primaryValue"]=pd.to_numeric(z["primaryValue"], errors="coerce")
    z["refYear"]=pd.to_numeric(z["refYear"], errors="coerce").astype("Int64")
    return z
def assert_unique(df, keys, label):
    dup=df[df.duplicated(keys, keep=False)]
    if not dup.empty: raise RuntimeError(f"{label}: duplicate analytical rows {dup[keys].head(5).to_dict('records')}")
def api_key():
    key=os.getenv("COMTRADE_API_KEY","").strip()
    if not key: raise RuntimeError("COMTRADE_API_KEY is not set")
    return key
