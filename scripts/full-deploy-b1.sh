#!/usr/bin/env bash
set -euo pipefail

ROOT="$(pwd)"
CURRENT="public/data/snapshots/current"
CANDIDATE="data/staging/full_deploy_candidate"

HS4_ROOT="data/staging/parents_hs4_2022_2025/4"
HS2_ROOT="data/staging/parents_hs2_2022_2025/2"

REPORT="/tmp/hstat-b1-report.txt"

echo "======================================================================"
echo "BATCH B1 — UNIFIED HS-2 / HS-4 / HS-6 CANDIDATE"
echo "======================================================================"

echo
echo "1. Pre-flight checks"

test -d "$CURRENT" || {
  echo "FAIL — current snapshot missing"
  exit 2
}

for code in 84 85
do
  test -f "$HS2_ROOT/$code/category.json" || {
    echo "FAIL — HS-2 $code category missing"
    echo "Run Batch A2 successfully first."
    exit 2
  }
done

for code in 8471 8473 8507 8517 8528 8534 8541 8542
do
  test -f "$HS4_ROOT/$code/category.json" || {
    echo "FAIL — HS-4 $code category missing"
    exit 2
  }
done

echo "Parent files present."

echo
echo "2. Rechecking existing HS-6 production contract"

python pipeline/launch_sanity.py

echo
echo "3. Building isolated candidate snapshot"

rm -rf "$CANDIDATE"
mkdir -p "$CANDIDATE"

cp -R "$CURRENT"/. "$CANDIDATE"/

mkdir -p \
  "$CANDIDATE/parents/2" \
  "$CANDIDATE/parents/4"

for code in 84 85
do
  cp \
    "$HS2_ROOT/$code/category.json" \
    "$CANDIDATE/parents/2/$code.json"
done

for code in 8471 8473 8507 8517 8528 8534 8541 8542
do
  cp \
    "$HS4_ROOT/$code/category.json" \
    "$CANDIDATE/parents/4/$code.json"
done

echo "Candidate assembled."

echo
echo "4. Creating candidate search library"

python - <<'PY'
import json
from pathlib import Path

source = Path("public/data/hs-library.json")
candidate_root = Path("data/staging/full_deploy_candidate")

if not source.exists():
    raise SystemExit(
        "FAIL — public/data/hs-library.json missing"
    )

items = json.loads(source.read_text())

if not isinstance(items, list):
    raise SystemExit(
        "FAIL — hs-library.json is not a list"
    )

expected = {
    2: {"84", "85"},
    4: {
        "8471", "8473", "8507", "8517",
        "8528", "8534", "8541", "8542",
    },
}

seen = {
    2: set(),
    4: set(),
    6: set(),
}

for item in items:
    level = item.get("level")
    code = str(item.get("code", ""))

    if level in seen:
        seen[level].add(code)

    if (
        level in expected
        and code in expected[level]
    ):
        item["loaded"] = True

candidate_search = (
    candidate_root
    / "hs-library.json"
)

candidate_search.write_text(
    json.dumps(
        items,
        indent=2,
        ensure_ascii=False,
    )
    + "\n"
)

failures = []

for level, codes in expected.items():
    missing = codes - seen[level]

    if missing:
        failures.append(
            f"Search library missing HS-{level}: "
            f"{sorted(missing)}"
        )

loaded6 = sum(
    item.get("level") == 6
    and item.get("loaded") is True
    for item in items
)

loaded4 = sum(
    item.get("level") == 4
    and item.get("loaded") is True
    for item in items
)

loaded2 = sum(
    item.get("level") == 2
    and item.get("loaded") is True
    for item in items
)

print(
    "Candidate loaded HS-2:",
    loaded2
)

print(
    "Candidate loaded HS-4:",
    loaded4
)

print(
    "Candidate loaded HS-6:",
    loaded6
)

if loaded2 != 2:
    failures.append(
        f"Expected 2 loaded HS-2, found {loaded2}"
    )

if loaded4 != 8:
    failures.append(
        f"Expected 8 loaded HS-4, found {loaded4}"
    )

if loaded6 != 56:
    failures.append(
        f"Expected 56 loaded HS-6, found {loaded6}"
    )

if failures:
    for failure in failures:
        print("FAIL:", failure)

    raise SystemExit(2)

print(
    "PASS — candidate search library = "
    "2 HS-2 + 8 HS-4 + 56 HS-6."
)
PY

echo
echo "5. Running complete 66-node candidate audit"

python - <<'PY'
import json
from pathlib import Path

root = Path(
    "data/staging/full_deploy_candidate"
)

failures = []
warnings = []

# --------------------------------------------------
# HS-6
# --------------------------------------------------

products = sorted(
    (root / "products")
    .glob("*.json")
)

if len(products) != 56:
    failures.append(
        f"Expected 56 HS-6 files, found {len(products)}"
    )

hs6_codes = set()

for path in products:
    data = json.loads(
        path.read_text()
    )

    code = str(
        data.get("hs6", "")
    )

    if code != path.stem:
        failures.append(
            f"{path.name}: HS-6 identity mismatch"
        )

    hs6_codes.add(code)

# --------------------------------------------------
# Parents
# --------------------------------------------------

expected = {
    2: ["84", "85"],
    4: [
        "8471", "8473", "8507", "8517",
        "8528", "8534", "8541", "8542",
    ],
}

parents = {}

for level, codes in expected.items():
    parents[level] = {}

    for code in codes:
        path = (
            root
            / "parents"
            / str(level)
            / f"{code}.json"
        )

        if not path.exists():
            failures.append(
                f"HS-{level} {code}: missing"
            )
            continue

        data = json.loads(
            path.read_text()
        )

        parents[level][code] = data

        if data.get("level") != level:
            failures.append(
                f"HS-{level} {code}: level mismatch"
            )

        if str(data.get("code")) != code:
            failures.append(
                f"HS-{level} {code}: code mismatch"
            )

        years = data.get(
            "years",
            []
        )

        if years != [
            2022,
            2023,
            2024,
            2025,
        ]:
            warnings.append(
                f"HS-{level} {code}: years={years}"
            )

        if data.get(
            "latestIndiaYear"
        ) != 2025:
            warnings.append(
                f"HS-{level} {code}: "
                f"latestIndiaYear="
                f"{data.get('latestIndiaYear')}"
            )

        benchmarks = data.get(
            "benchmarks",
            {}
        )

        for name in [
            "globalImports",
            "globalExports",
        ]:
            benchmark = (
                benchmarks.get(name)
            )

            if not benchmark:
                failures.append(
                    f"HS-{level} {code}: "
                    f"{name} benchmark missing"
                )
                continue

            if benchmark.get(
                "status"
            ) != "VALID":
                failures.append(
                    f"HS-{level} {code}: "
                    f"{name} benchmark not VALID"
                )

# --------------------------------------------------
# Hierarchy
# --------------------------------------------------

for code in expected[4]:
    parent2 = code[:2]

    if parent2 not in parents[2]:
        failures.append(
            f"HS-4 {code}: "
            f"HS-2 parent {parent2} missing"
        )

for code in hs6_codes:
    parent4 = code[:4]

    if parent4 not in parents[4]:
        failures.append(
            f"HS-6 {code}: "
            f"HS-4 parent {parent4} missing"
        )

# --------------------------------------------------
# Search
# --------------------------------------------------

search = json.loads(
    (root / "hs-library.json")
    .read_text()
)

for level, expected_count in [
    (2, 2),
    (4, 8),
    (6, 56),
]:
    loaded = [
        x
        for x in search
        if (
            x.get("level") == level
            and x.get("loaded") is True
        )
    ]

    if len(loaded) != expected_count:
        failures.append(
            f"Search HS-{level}: "
            f"expected {expected_count}, "
            f"found {len(loaded)}"
        )

print("=" * 78)
print("HStat.India unified candidate QA")
print("=" * 78)

print(
    "HS-2:",
    len(parents.get(2, {})),
)

print(
    "HS-4:",
    len(parents.get(4, {})),
)

print(
    "HS-6:",
    len(products),
)

print(
    "Total navigable nodes:",
    (
        len(parents.get(2, {}))
        + len(parents.get(4, {}))
        + len(products)
    ),
)

print()
print(
    "Failures:",
    len(failures)
)

print(
    "Warnings:",
    len(warnings)
)

for item in failures:
    print(
        "FAIL:",
        item
    )

for item in warnings:
    print(
        "WARN:",
        item
    )

if failures:
    raise SystemExit(2)

print()
print(
    "PASS — unified 66-node candidate "
    "is internally consistent."
)
PY

echo
echo "6. Writing candidate QA marker"

python - <<'PY'
import json
from pathlib import Path
from datetime import datetime, timezone

path = Path(
    "data/staging/full_deploy_candidate/"
    "parent_integration_qa.json"
)

path.write_text(
    json.dumps(
        {
            "checkedAt":
                datetime.now(
                    timezone.utc
                ).isoformat(),

            "hs2": 2,
            "hs4": 8,
            "hs6": 56,
            "totalNavigableNodes": 66,
            "failures": [],
            "warnings": [],
        },
        indent=2,
    )
    + "\n"
)

print(
    "Wrote:",
    path
)
PY

echo
echo "7. Capturing exact frontend contracts"

{
  echo "======================================================================"
  echo "HSTAT B1 FRONTEND CONTRACT REPORT"
  echo "======================================================================"

  echo
  echo "### src/lib/data.ts"
  sed -n '1,260p' src/lib/data.ts

  echo
  echo "### src/types.ts"
  sed -n '1,300p' src/types.ts

  echo
  echo "### App openHs / search region"
  grep -n -A100 -B30 \
    "async function openHs" \
    src/App.tsx || true

  echo
  echo "### Search constants"
  grep -n -A80 -B10 \
    "const QUICK_HS" \
    src/App.tsx || true

  echo
  echo "### Search library samples"

  python - <<'PY2'
import json
from pathlib import Path

items = json.loads(
    Path(
        "public/data/hs-library.json"
    ).read_text()
)

for level in [2, 4, 6]:
    print()
    print("LEVEL", level)

    sample = [
        x
        for x in items
        if x.get("level") == level
    ][:3]

    for item in sample:
        print(item)
PY2

} > "$REPORT"

echo
echo "Frontend contract report:"
echo "$REPORT"

echo
echo "======================================================================"
echo "BATCH B1 COMPLETE"
echo "======================================================================"
