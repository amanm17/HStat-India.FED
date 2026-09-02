#!/usr/bin/env bash
# Build a synthetic snapshot so the dashboard can be developed and reviewed
# without a Comtrade API key or a network connection. The numbers are
# fabricated; the shapes are real.
set -euo pipefail

CODES="${1:-0}"      # 0 = the whole 549-code universe
MONTHS="${2:-6}"

python scripts/make_fixtures.py --out data/raw/store-fixture --codes "$CODES" --months "$MONTHS" --start-year "${START:-1996}"
python pipeline/build_hs_library.py
python pipeline/process_snapshot.py \
  --fixture \
  --raw-store data/raw/store-fixture \
  --hs8-csv data/dgcis/india_hs8.fixture.csv \
  --fx-csv config/fx_inr_usd.fixture.csv \
  --out data/staging/fixture \
  --start-year "${START:-1996}" \
  --end-year "$(date -u +%Y)" \
  --months "$MONTHS"
python pipeline/validate_snapshot.py data/staging/fixture
python pipeline/rotate_snapshot.py --staging data/staging/fixture

echo
echo "Fixture snapshot promoted to public/data/snapshots/current."
echo "Run 'npm run dev' to view it. Do not commit a fixture snapshot."
