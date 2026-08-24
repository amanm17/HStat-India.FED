#!/usr/bin/env bash
set -euo pipefail

echo "======================================================================"
echo "BATCH A1 — HS-4 VALIDATION + PROCESSING"
echo "======================================================================"

HS4_CODES="8471 8473 8507 8517 8528 8534 8541 8542"

RAW4="data/raw/parents_hs4_2022_2025"
OUT4="data/staging/parents_hs4_2022_2025"

echo
echo "Checking required scripts..."

for f in \
  pipeline/validate_parent_raw.py \
  pipeline/process_parent_snapshot.py \
  pipeline/validate_parent_snapshot.py
do
  if [[ ! -f "$f" ]]; then
    echo "FAIL — missing: $f"
    exit 2
  fi
done

echo "Scripts present."

echo
echo "Checking raw HS-4 files..."

for code in $HS4_CODES
do
  dir="$RAW4/4/$code"

  for name in \
    india_imports \
    india_exports \
    global_imports \
    global_exports
  do
    if [[ ! -f "$dir/$name.parquet" ]]; then
      echo "FAIL — missing raw file:"
      echo "$dir/$name.parquet"
      exit 2
    fi
  done

  echo "RAW OK: HS-4 $code"
done

echo
echo "Running raw QA..."

for code in $HS4_CODES
do
  echo
  echo "----------------------------------------------------------------------"
  echo "RAW QA HS-4 $code"
  echo "----------------------------------------------------------------------"

  python pipeline/validate_parent_raw.py \
    --raw-dir "$RAW4/4/$code" \
    --code "$code" \
    --level 4 \
    --start-year 2022 \
    --end-year 2025
done

echo
echo "All HS-4 raw datasets passed."

rm -rf "$OUT4"
mkdir -p "$OUT4/4"

echo
echo "Processing and validating HS-4 analytical objects..."

for code in $HS4_CODES
do
  echo
  echo "----------------------------------------------------------------------"
  echo "PROCESS HS-4 $code"
  echo "----------------------------------------------------------------------"

  python pipeline/process_parent_snapshot.py \
    --raw-dir "$RAW4/4/$code" \
    --code "$code" \
    --level 4 \
    --analysis-start-year 2022 \
    --out "$OUT4/4/$code"

  python pipeline/validate_parent_snapshot.py \
    --dir "$OUT4/4/$code" \
    --code "$code" \
    --level 4
done

echo
echo "======================================================================"
echo "HS-4 COMPLETE"
echo "======================================================================"
