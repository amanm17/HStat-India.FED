#!/usr/bin/env bash
set -euo pipefail

REPORT="/tmp/hstat-c0-report.txt"

{
  echo "======================================================================"
  echo "HSTAT.INDIA — FRONTEND FINISHING CONTRACT"
  echo "======================================================================"

  echo
  echo "### PRODUCT / HEADER REGION"
  grep -n -A100 -B20 \
    'className="product-head"' \
    src/App.tsx || true

  echo
  echo "### YEAR STATE + YEAR CONTROLS"
  grep -n -E \
    'setYear|const \[year|years\.|analyticalYears|1Y|5Y|10Y|All|range|horizon' \
    src/App.tsx || true

  echo
  echo "### SELECTED YEAR / BENCHMARK SECTIONS"
  grep -n -E \
    'SELECTED|BENCHMARK|GLOBAL POSITION|observedImports|observedExports|globalImports|globalExports|importRankIndia|exportRankIndia' \
    src/App.tsx || true

  echo
  echo "### INDIA / TARIFF REFERENCES"
  grep -n -E \
    'indiaDetail|IndiaTariffLines|INDIA TARIFF|hs8|tariff' \
    src/App.tsx || true

  echo
  echo "### SEARCH JSX"
  sed -n '620,800p' src/App.tsx

  echo
  echo "### MAIN ANALYTICS JSX"
  sed -n '800,1160p' src/App.tsx

  echo
  echo "### INDIA LOWER JSX"
  sed -n '1160,1380p' src/App.tsx

  echo
  echo "### TARIFF COMPONENT"
  sed -n '1680,1795p' src/App.tsx

  echo
  echo "### CSS — HEADER / SEARCH / PRODUCT"
  grep -n -A40 -B5 \
    -E '^\.topbar|^\.search-hub|^\.search-primary|^\.quick-access|^\.smart-suggestions|^\.product-head|data-india' \
    src/*.css || true

  echo
  echo "### CSS — KPI / GRID / INDIA / TARIFF"
  grep -n -A30 -B5 \
    -E 'kpi|metric|benchmark|india|tariff|hs8|grid|panel|card' \
    src/*.css || true

  echo
  echo "### VITE CONFIG"
  cat vite.config.* 2>/dev/null || true

} > "$REPORT"

echo "Wrote:"
echo "$REPORT"

echo
echo "======================================================================"
echo "C0 COMPLETE"
echo "======================================================================"
