#!/usr/bin/env bash
set -euo pipefail
if [ -f '.env' ]; then set -a; source .env; set +a; fi
if [ -d '.venv' ]; then source .venv/bin/activate; fi
python pipeline/refresh_monthly.py "$@"
