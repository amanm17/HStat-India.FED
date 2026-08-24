#!/usr/bin/env bash
set -euo pipefail

REMOTE="origin"
BRANCH="main"
CHECKPOINT=".checkpoints/live-to-github"
VERIFY="/tmp/hstat-fresh-clone"

echo "======================================================================"
echo "HSTAT.INDIA — PROMOTE EXACT LIVE SOURCE TO GITHUB"
echo "======================================================================"

mkdir -p "$CHECKPOINT"

echo
echo "1. CHECKPOINT CURRENT SOURCE"

tar \
  --exclude=.git \
  --exclude=.venv \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=data/raw \
  --exclude=data/staging \
  --exclude=.checkpoints \
  -czf "$CHECKPOINT/pre-promote-source.tar.gz" .

echo "PASS — source checkpoint created."


echo
echo "2. HARDEN .gitignore"

cat >> .gitignore <<'EOF'

# build/runtime artifacts
*.tsbuildinfo
dist/
node_modules/
.venv/
.wrangler/

# secrets
.env
.env.*
!.env.example
.dev.vars

# non-published/raw data
data/raw/
data/staging/

# local checkpoints/cache
.checkpoints/
__pycache__/
*.pyc
.DS_Store
EOF

sort -u .gitignore -o .gitignore


echo
echo "3. ENSURE ALL BUILD-RELEVANT FILES ARE TRACKED"

git add \
  .gitignore \
  .env.example \
  README.md \
  requirements.txt \
  package.json \
  package-lock.json \
  tsconfig*.json \
  vite.config.* \
  index.html \
  src \
  public \
  pipeline \
  config \
  scripts \
  .github

echo
echo "Staged summary:"
git status --short


echo
echo "4. VERIFY NO REQUIRED PUBLISHED DATA IS MISSING"

python - <<'PY'
import json
from pathlib import Path

search = json.loads(
    Path("public/data/hs-library.json").read_text()
)

root = Path("public/data/snapshots/current")

failures = []

counts = {2: 0, 4: 0, 6: 0}

for item in search:
    if item.get("loaded") is not True:
        continue

    level = int(item["level"])
    code = str(item["code"])

    counts[level] += 1

    if level == 6:
        p = root / "products" / f"{code}.json"
    else:
        p = root / "parents" / str(level) / f"{code}.json"

    if not p.exists():
        failures.append(str(p))

print("Loaded nodes:", counts)

if counts != {2: 2, 4: 8, 6: 56}:
    raise SystemExit(
        f"Navigation contract failed: {counts}"
    )

if failures:
    print("Missing published files:")
    for p in failures:
        print("FAIL:", p)
    raise SystemExit(2)

print("PASS — all 66 published analytical nodes present.")
PY


echo
echo "5. VERIFY LIVE SOURCE STILL BUILDS"

rm -rf dist
npm run build

python pipeline/launch_sanity.py


echo
echo "6. COMMIT EXACT CURRENT SOURCE"

if git diff --cached --quiet
then
  echo "No staged source differences."
else
  git commit \
    -m "Sync GitHub source to validated live HStat.India build"
fi


echo
echo "7. PUSH TO GITHUB"

git push "$REMOTE" "$BRANCH"


echo
echo "8. FRESH-CLONE REPRODUCIBILITY TEST"

rm -rf "$VERIFY"

git clone \
  "$(git remote get-url "$REMOTE")" \
  "$VERIFY"

cd "$VERIFY"

echo
echo "Fresh clone HEAD:"
git log -1 --oneline

echo
echo "Installing dependencies..."
npm ci

echo
echo "Building fresh clone..."
npm run build

echo
echo "Running launch sanity..."
python pipeline/launch_sanity.py


echo
echo "======================================================================"
echo "GITHUB NOW CONTAINS THE VALIDATED LIVE SOURCE"
echo "======================================================================"
