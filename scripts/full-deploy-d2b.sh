#!/usr/bin/env bash
set -euo pipefail

REPO_OWNER="amanm17"
REPO_NAME="hstat-india"
CF_PROJECT="hstat-india"
BRANCH="main"

echo "======================================================================"
echo "HSTAT.INDIA — FINAL PRODUCTION DEPLOYMENT"
echo "======================================================================"

echo
echo "1. SAFETY CHECK"

test -f dist/index.html || {
  echo "FAIL — dist/index.html missing"
  exit 2
}

python pipeline/launch_sanity.py

echo
echo "PASS — release candidate still valid."


echo
echo "2. SECRET / LARGE-FILE GUARD"

cat > .gitignore <<'EOF'
.venv/
node_modules/
dist/

.env
.env.*
!.env.example

.DS_Store

data/raw/
data/staging/

.checkpoints/

*.log
__pycache__/
*.pyc
.pytest_cache/

.wrangler/
.dev.vars
EOF

python - <<'PY'
from pathlib import Path

bad = []

for path in Path(".").rglob("*"):
    if not path.is_file():
        continue

    if any(
        part in {
            ".git",
            ".venv",
            "node_modules",
            "dist",
            "data/raw",
            "data/staging",
        }
        for part in [
            str(path),
        ]
    ):
        continue

    try:
        size = path.stat().st_size
    except OSError:
        continue

    if size > 95 * 1024 * 1024:
        bad.append(
            f"{path} ({size/1024/1024:.1f} MB)"
        )

if bad:
    print("Large files:")
    for x in bad:
        print("FAIL:", x)
    raise SystemExit(2)

print("PASS — no >95 MB repository files detected.")
PY


echo
echo "3. INITIALIZE GIT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1
then
  git init
fi

git checkout -B "$BRANCH"

git config user.name \
  "$(gh api user --jq '.login')"

EMAIL="$(
  gh api user \
    --jq '.email // empty'
)"

if [[ -z "$EMAIL" ]]
then
  EMAIL="${REPO_OWNER}@users.noreply.github.com"
fi

git config user.email "$EMAIL"


echo
echo "4. STAGE RELEASE"

git add \
  .gitignore \
  package.json \
  package-lock.json \
  tsconfig*.json \
  vite.config.* \
  index.html \
  src \
  public \
  pipeline \
  config \
  scripts

echo
echo "STAGED FILES:"
git status --short

echo
echo "CHECKING FOR ACCIDENTAL API KEY..."

if git diff --cached --text | grep -E \
  'COMTRADE_API_KEY=[A-Za-z0-9_-]+' \
  >/dev/null
then
  echo "FAIL — possible API key detected in staged diff."
  exit 2
fi

echo "PASS — no obvious API key in staged diff."


echo
echo "5. CREATE RELEASE COMMIT"

git commit \
  -m "Release HStat.India v1"


echo
echo "6. CREATE / VERIFY GITHUB REPOSITORY"

if gh repo view \
  "$REPO_OWNER/$REPO_NAME" \
  >/dev/null 2>&1
then
  echo "GitHub repository already exists."

  EXISTING_URL="$(
    gh repo view \
      "$REPO_OWNER/$REPO_NAME" \
      --json url \
      --jq '.url'
  )"

  echo "Repository: $EXISTING_URL"

  if git remote get-url origin \
    >/dev/null 2>&1
  then
    git remote set-url \
      origin \
      "https://github.com/$REPO_OWNER/$REPO_NAME.git"
  else
    git remote add \
      origin \
      "https://github.com/$REPO_OWNER/$REPO_NAME.git"
  fi
else
  echo "Creating private GitHub repository..."

  gh repo create \
    "$REPO_OWNER/$REPO_NAME" \
    --private \
    --description \
    "HStat.India — MeitY-relevant HS trade analytics dashboard" \
    --source=. \
    --remote=origin
fi


echo
echo "7. PUSH RELEASE"

git push \
  -u origin \
  "$BRANCH"

COMMIT_HASH="$(
  git rev-parse HEAD
)"

echo
echo "Release commit:"
echo "$COMMIT_HASH"


echo
echo "8. CREATE CLOUDFLARE PAGES PROJECT"

if npx wrangler pages project list \
  2>/dev/null \
  | grep -q \
  "| $CF_PROJECT "
then
  echo "Cloudflare project already exists."
else
  echo "Creating Cloudflare Pages project..."

  npx wrangler pages project create \
    "$CF_PROJECT" \
    --production-branch "$BRANCH"
fi


echo
echo "9. DEPLOY DIST TO CLOUDFLARE"

DEPLOY_LOG="/tmp/hstat-cloudflare-deploy.log"

npx wrangler pages deploy \
  dist \
  --project-name "$CF_PROJECT" \
  --branch "$BRANCH" \
  --commit-hash "$COMMIT_HASH" \
  --commit-message "HStat.India v1" \
  2>&1 \
  | tee "$DEPLOY_LOG"


echo
echo "10. PRODUCTION URL"

PROD_URL="https://${CF_PROJECT}.pages.dev"

echo "$PROD_URL"


echo
echo "11. WAIT FOR PRODUCTION"

READY=0

for i in {1..30}
do
  if curl -fsS \
    "$PROD_URL/" \
    >/dev/null 2>&1
  then
    READY=1
    break
  fi

  sleep 2
done

if [[ "$READY" != "1" ]]
then
  echo "FAIL — production site did not become reachable."
  exit 2
fi

echo "PASS — production HTML reachable."


echo
echo "12. LIVE DATA SMOKE TEST"

check_json() {
  LABEL="$1"
  URL="$2"

  printf "%-28s" "$LABEL"

  curl -fsS "$URL" \
    | python -m json.tool \
    >/dev/null

  echo "PASS"
}

check_json \
  "Search library" \
  "$PROD_URL/data/hs-library.json"

check_json \
  "HS-2 84" \
  "$PROD_URL/data/snapshots/current/parents/2/84.json"

check_json \
  "HS-4 8542" \
  "$PROD_URL/data/snapshots/current/parents/4/8542.json"

check_json \
  "HS-6 847130" \
  "$PROD_URL/data/snapshots/current/products/847130.json"


echo
echo "13. LIVE SEMANTIC CHECK"

python - "$PROD_URL" <<'PY'
import json
import sys
from urllib.request import urlopen

base = sys.argv[1]

tests = [
    (
        2,
        "84",
        f"{base}/data/snapshots/current/parents/2/84.json",
    ),
    (
        4,
        "8542",
        f"{base}/data/snapshots/current/parents/4/8542.json",
    ),
    (
        6,
        "847130",
        f"{base}/data/snapshots/current/products/847130.json",
    ),
]

failures = []

for level, code, url in tests:
    with urlopen(url) as r:
        d = json.load(r)

    actual = (
        str(d.get("hs6"))
        if level == 6
        else str(d.get("code"))
    )

    if actual != code:
        failures.append(
            f"HS-{level} {code}: identity mismatch"
        )

    if "2025" not in d.get(
        "annual",
        {}
    ):
        failures.append(
            f"HS-{level} {code}: 2025 missing"
        )

    for flow in [
        "globalImports",
        "globalExports",
    ]:
        b = (
            d.get("benchmarks", {})
            .get(flow)
        )

        if (
            not b
            or b.get("status")
            != "VALID"
        ):
            failures.append(
                f"HS-{level} {code}: "
                f"{flow} benchmark invalid"
            )

    print(
        f"PASS — HS-{level} {code}"
    )

if failures:
    for x in failures:
        print("FAIL:", x)

    raise SystemExit(2)

print(
    "PASS — live analytical contracts valid."
)
PY


echo
echo "14. RELEASE SUMMARY"

echo "GitHub:"
echo "https://github.com/$REPO_OWNER/$REPO_NAME"

echo
echo "Cloudflare:"
echo "$PROD_URL"

echo
echo "Commit:"
echo "$COMMIT_HASH"

echo
echo "======================================================================"
echo "FULL HSTAT.INDIA V1 DEPLOYMENT PASS"
echo "======================================================================"
