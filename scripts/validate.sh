#!/usr/bin/env bash
set -euo pipefail
python pipeline/validate_snapshot.py public/data/snapshots/current
python pipeline/launch_sanity.py
