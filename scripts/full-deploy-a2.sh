#!/usr/bin/env bash
set -euo pipefail

echo "======================================================================"
echo "BATCH A2 — HS-2 ACQUISITION + VALIDATION + PROCESSING"
echo "======================================================================"

RAW2="data/raw/parents_hs2_2022_2025"
OUT2="data/staging/parents_hs2_2022_2025"

rm -rf "$RAW2" "$OUT2"

mkdir -p "$RAW2/2" "$OUT2/2"

for code in 84 85
do
  echo
  echo "----------------------------------------------------------------------"
  echo "DIRECT COMTRADE PULL · HS-2 $code"
  echo "----------------------------------------------------------------------"

  python pipeline/pull_parent_test.py \
    --code "$code" \
    --level 2 \
    --start-year 2022 \
    --end-year 2025 \
    --out "$RAW2/2/$code"

  echo
  echo "RAW QA · HS-2 $code"

  python pipeline/validate_parent_raw.py \
    --raw-dir "$RAW2/2/$code" \
    --code "$code" \
    --level 2 \
    --start-year 2022 \
    --end-year 2025

  echo
  echo "PROCESS · HS-2 $code"

  python pipeline/process_parent_snapshot.py \
    --raw-dir "$RAW2/2/$code" \
    --code "$code" \
    --level 2 \
    --analysis-start-year 2022 \
    --out "$OUT2/2/$code"

  echo
  echo "ANALYTICAL QA · HS-2 $code"

  python pipeline/validate_parent_snapshot.py \
    --dir "$OUT2/2/$code" \
    --code "$code" \
    --level 2
done

echo
echo "======================================================================"
echo "HS-2 COMPLETE"
echo "======================================================================"
