#!/usr/bin/env bash
set -euo pipefail

PORT=4173
LOG="/tmp/hstat-preview.log"

echo "======================================================================"
echo "BATCH D1 — HSTAT.INDIA RELEASE-CANDIDATE GATE"
echo "======================================================================"

echo
echo "1. FINAL PYTHON SYNTAX"

python -m py_compile pipeline/*.py

echo "PASS — Python syntax."


echo
echo "2. FINAL DATA CONTRACT"

python pipeline/launch_sanity.py


echo
echo "3. COMPLETE 66-NODE FILE AUDIT"

python - <<'PY'
import json
from pathlib import Path

root = Path(
    "public/data/snapshots/current"
)

search_path = Path(
    "public/data/hs-library.json"
)

failures = []

search = json.loads(
    search_path.read_text()
)

expected = {
    2: 2,
    4: 8,
    6: 56,
}

for level, target in expected.items():
    rows = [
        x
        for x in search
        if (
            x.get("level") == level
            and x.get("loaded") is True
        )
    ]

    print(
        f"Loaded HS-{level}:",
        len(rows),
    )

    if len(rows) != target:
        failures.append(
            f"HS-{level}: expected "
            f"{target}, found {len(rows)}"
        )

    for item in rows:
        code = str(
            item["code"]
        )

        if level == 6:
            path = (
                root
                / "products"
                / f"{code}.json"
            )
        else:
            path = (
                root
                / "parents"
                / str(level)
                / f"{code}.json"
            )

        if not path.exists():
            failures.append(
                f"Missing HS-{level} "
                f"{code}: {path}"
            )
            continue

        try:
            data = json.loads(
                path.read_text()
            )
        except Exception as exc:
            failures.append(
                f"Invalid JSON HS-{level} "
                f"{code}: {exc}"
            )
            continue

        if level == 6:
            actual = str(
                data.get("hs6")
            )
        else:
            actual = str(
                data.get("code")
            )

        if actual != code:
            failures.append(
                f"Identity mismatch "
                f"HS-{level} {code}"
            )

print()
print(
    "Total expected nodes:",
    sum(expected.values())
)

print(
    "Failures:",
    len(failures)
)

for item in failures:
    print(
        "FAIL:",
        item
    )

if failures:
    raise SystemExit(2)

print(
    "PASS — all 66 navigable "
    "analytical objects exist."
)
PY


echo
echo "4. TYPESCRIPT + CLEAN PRODUCTION BUILD"

rm -rf dist

npx tsc -b
npm run build


echo
echo "5. START LOCAL PRODUCTION SERVER"

rm -f "$LOG"

npm run preview -- \
  --host 127.0.0.1 \
  --port "$PORT" \
  > "$LOG" 2>&1 &

PREVIEW_PID=$!

cleanup() {
  kill "$PREVIEW_PID" \
    2>/dev/null || true
}

trap cleanup EXIT

echo "Preview PID: $PREVIEW_PID"

echo
echo "Waiting for server..."

for i in {1..20}
do
  if curl -fsS \
    "http://127.0.0.1:$PORT/" \
    >/dev/null 2>&1
  then
    break
  fi

  sleep 0.5
done

curl -fsS \
  "http://127.0.0.1:$PORT/" \
  >/dev/null

echo "PASS — production HTML served."


echo
echo "6. HTTP DATA SMOKE TEST"

check_json() {
  LABEL="$1"
  URL="$2"

  printf "%-28s" "$LABEL"

  curl -fsS \
    "$URL" \
    | python -m json.tool \
    >/dev/null

  echo "PASS"
}

check_json \
  "Search library" \
  "http://127.0.0.1:$PORT/data/hs-library.json"

check_json \
  "HS-2 84" \
  "http://127.0.0.1:$PORT/data/snapshots/current/parents/2/84.json"

check_json \
  "HS-2 85" \
  "http://127.0.0.1:$PORT/data/snapshots/current/parents/2/85.json"

check_json \
  "HS-4 8471" \
  "http://127.0.0.1:$PORT/data/snapshots/current/parents/4/8471.json"

check_json \
  "HS-4 8542" \
  "http://127.0.0.1:$PORT/data/snapshots/current/parents/4/8542.json"

check_json \
  "HS-6 847130" \
  "http://127.0.0.1:$PORT/data/snapshots/current/products/847130.json"

check_json \
  "HS-6 854231" \
  "http://127.0.0.1:$PORT/data/snapshots/current/products/854231.json"


echo
echo "7. VERIFY DATA SEMANTICS OVER HTTP"

python - <<'PY'
import json
from urllib.request import urlopen

BASE = (
    "http://127.0.0.1:4173"
    "/data/snapshots/current"
)

tests = [
    (
        2,
        "84",
        f"{BASE}/parents/2/84.json",
    ),
    (
        4,
        "8542",
        f"{BASE}/parents/4/8542.json",
    ),
    (
        6,
        "847130",
        f"{BASE}/products/847130.json",
    ),
]

failures = []

for level, code, url in tests:
    with urlopen(url) as response:
        d = json.load(response)

    if level == 6:
        actual = str(
            d.get("hs6")
        )
    else:
        actual = str(
            d.get("code")
        )

    if actual != code:
        failures.append(
            f"HS-{level} {code}: "
            "identity mismatch"
        )

    years = d.get(
        "years",
        []
    )

    if 2025 not in years:
        failures.append(
            f"HS-{level} {code}: "
            "2025 absent"
        )

    annual = d.get(
        "annual",
        {}
    )

    if "2025" not in annual:
        failures.append(
            f"HS-{level} {code}: "
            "annual 2025 absent"
        )

    benchmarks = d.get(
        "benchmarks",
        {}
    )

    for flow in [
        "globalImports",
        "globalExports",
    ]:
        b = benchmarks.get(
            flow
        )

        if not b:
            failures.append(
                f"HS-{level} {code}: "
                f"{flow} missing"
            )
            continue

        if b.get(
            "status"
        ) != "VALID":
            failures.append(
                f"HS-{level} {code}: "
                f"{flow} not VALID"
            )

    print(
        f"PASS — HS-{level} {code}"
    )

if failures:
    print()

    for f in failures:
        print(
            "FAIL:",
            f
        )

    raise SystemExit(2)

print()
print(
    "PASS — HTTP-served analytical "
    "contracts are valid."
)
PY


echo
echo "8. BUILD ASSET CHECK"

python - <<'PY'
from pathlib import Path

files = sorted(
    Path("dist/assets")
    .glob("*.js"),
    key=lambda x:
        x.stat().st_size,
    reverse=True,
)

for f in files:
    print(
        f"{f.name:<44}"
        f"{f.stat().st_size / 1024:>9.1f} KB"
    )

if not files:
    raise SystemExit(
        "No production JS assets found"
    )

largest = (
    files[0].stat().st_size
    / 1024
)

print()
print(
    "Largest JS chunk:",
    round(largest, 1),
    "KB"
)

if largest > 500:
    raise SystemExit(
        "Largest production chunk "
        "still exceeds 500 KB"
    )

print(
    "PASS — production bundle split."
)
PY


echo
echo "9. DEPLOYMENT ENVIRONMENT"

echo
echo "--- Git repository ---"

if git rev-parse \
  --is-inside-work-tree \
  >/dev/null 2>&1
then
  echo "Git: YES"
  echo "Branch: $(git branch --show-current)"
  echo "Remote:"
  git remote -v || true

  echo
  echo "Working tree:"
  git status --short
else
  echo "Git: NO"
fi

echo
echo "--- Package scripts ---"

node -e '
const p=require("./package.json");
console.log(p.scripts || {});
'

echo
echo "--- Cloudflare-related files ---"

find . \
  -maxdepth 2 \
  \( \
    -name "wrangler.toml" \
    -o -name "wrangler.json" \
    -o -name "wrangler.jsonc" \
    -o -name "_headers" \
    -o -name "_redirects" \
  \) \
  -print \
  2>/dev/null || true


echo
echo "======================================================================"
echo "BATCH D1 PASS — RELEASE CANDIDATE READY"
echo "======================================================================"
