#!/usr/bin/env bash
set -euo pipefail

BACKUP=".checkpoints/full-deploy/b2"
CURRENT="public/data/snapshots/current"
HS2="data/staging/parents_hs2_2022_2025/2"
HS4="data/staging/parents_hs4_2022_2025/4"

mkdir -p "$BACKUP"

echo "======================================================================"
echo "BATCH B2 — LEVEL-AWARE HS-2 / HS-4 / HS-6 INTEGRATION"
echo "======================================================================"

echo
echo "1. BACKUP CURRENT FRONTEND + SEARCH STATE"

cp src/App.tsx "$BACKUP/App.tsx"
cp src/types.ts "$BACKUP/types.ts"
cp src/lib/data.ts "$BACKUP/data.ts"
cp public/data/hs-library.json "$BACKUP/hs-library.json"

if [[ -d "$CURRENT/parents" ]]; then
  rm -rf "$BACKUP/parents"
  cp -R "$CURRENT/parents" "$BACKUP/parents"
fi

restore() {
  echo
  echo "RESTORING B2 BACKUP..."

  cp "$BACKUP/App.tsx" src/App.tsx
  cp "$BACKUP/types.ts" src/types.ts
  cp "$BACKUP/data.ts" src/lib/data.ts
  cp "$BACKUP/hs-library.json" public/data/hs-library.json

  rm -rf "$CURRENT/parents"

  if [[ -d "$BACKUP/parents" ]]; then
    cp -R "$BACKUP/parents" "$CURRENT/parents"
  fi

  echo "Backup restored."
}

trap 'echo "B2 FAILED."; restore' ERR


echo
echo "2. VERIFY PARENT OBJECTS"

for code in 84 85
do
  test -f "$HS2/$code/category.json"
done

for code in 8471 8473 8507 8517 8528 8534 8541 8542
do
  test -f "$HS4/$code/category.json"
done

echo "PASS — 10 parent objects present."


echo
echo "3. INSTALL PARENT OBJECTS INTO CURRENT SNAPSHOT"

rm -rf "$CURRENT/parents"

mkdir -p \
  "$CURRENT/parents/2" \
  "$CURRENT/parents/4"

for code in 84 85
do
  cp \
    "$HS2/$code/category.json" \
    "$CURRENT/parents/2/$code.json"
done

for code in 8471 8473 8507 8517 8528 8534 8541 8542
do
  cp \
    "$HS4/$code/category.json" \
    "$CURRENT/parents/4/$code.json"
done

echo "PASS — parent files installed."


echo
echo "4. MARK HS-2 + HS-4 AS LOADED IN SEARCH"

python - <<'PY'
import json
from pathlib import Path

path = Path(
    "public/data/hs-library.json"
)

items = json.loads(
    path.read_text()
)

expected = {
    2: {"84", "85"},
    4: {
        "8471", "8473", "8507", "8517",
        "8528", "8534", "8541", "8542",
    },
}

for item in items:
    level = item.get("level")
    code = str(item.get("code", ""))

    if (
        level in expected
        and code in expected[level]
    ):
        item["loaded"] = True

path.write_text(
    json.dumps(
        items,
        indent=2,
        ensure_ascii=False,
    )
    + "\n"
)

for level, count in [
    (2, 2),
    (4, 8),
    (6, 56),
]:
    loaded = [
        x
        for x in items
        if (
            x.get("level") == level
            and x.get("loaded") is True
        )
    ]

    print(
        f"Loaded HS-{level}:",
        len(loaded)
    )

    if len(loaded) != count:
        raise SystemExit(
            f"Expected {count} loaded HS-{level}, "
            f"found {len(loaded)}"
        )

print(
    "PASS — search exposes all 66 real nodes."
)
PY


echo
echo "5. REWRITE TYPES WITH LEVEL-AWARE NODE CONTRACT"

cat > src/types.ts <<'TS'
export type EconomyRow = {
  rank?: number
  code: string
  name: string
  value: number
  share: number
}

export type PartnerSet = {
  rows: EconomyRow[]
  coverage: number | null
  hhi: number | null
  top3Share: number | null
}

export type HS8Row = {
  hs8: string
  description: string
  imports: number
  exports: number
  balance: number
}

export type Coverage = {
  status:
    | 'VALID'
    | 'CAUTION'
    | 'INVALID'
    | 'BASELINE'
    | 'HISTORICAL'
    | string
  [key: string]: unknown
}

export type AnnualRecord = {
  india: {
    imports: number | null
    exports: number | null
    balance: number | null
    suppliers: PartnerSet
    destinations: PartnerSet
    hs8: HS8Row[]
  }

  global: {
    observedImports: number | null
    observedExports: number | null

    imports: number | null
    exports: number | null

    importRankIndia: number | null
    importShareIndia: number | null

    exportRankIndia: number | null
    exportShareIndia: number | null

    topImporters: EconomyRow[]
    topExporters: EconomyRow[]

    mirror?: {
      importExportRatio: number | null
      status: string | null
    }

    importCoverage: Coverage
    exportCoverage: Coverage
  }
}

export type Benchmark = {
  year: number
  status: 'VALID'
  value: number
  indiaRank: number | null
  indiaShare: number | null
  top10: EconomyRow[]
}

export type Product = {
  schemaVersion: string

  /*
   * Generic navigation identity.
   * These are always populated by loadHsNode().
   */
  level: 2 | 4 | 6
  code: string

  /*
   * Existing HS-6 compatibility field.
   * For parent nodes the loader supplies the displayed code
   * so the existing dashboard can operate until Batch C
   * removes legacy HS-6-only assumptions.
   */
  hs6: string

  parentCode?: string | null
  description: string
  classification: string
  refreshedAt: string

  years: number[]
  analyticalYears?: number[]
  latestIndiaYear: number | null

  benchmarks: {
    globalImports: Benchmark | null
    globalExports: Benchmark | null
  }

  annual: Record<string, AnnualRecord>

  /*
   * Source contracts differ slightly between the legacy
   * HS-6 snapshot and the new parent layer.
   */
  sources: unknown
}

export type SearchItem = {
  code: string
  level: 2 | 4 | 6
  description: string
  parent2?: string | null
  parent4?: string | null
  loaded: boolean
  tags: string[]
  searchText: string
}
TS


echo
echo "6. INSTALL LEVEL-AWARE DATA LOADER"

cat > src/lib/data.ts <<'TS'
import type {
  Product,
  SearchItem,
} from '../types'

const BASE = '/data/snapshots'

async function getJson<T>(
  url: string
): Promise<T> {
  const response =
    await fetch(
      url,
      {
        cache: 'no-cache',
      }
    )

  if (!response.ok) {
    throw new Error(
      `${response.status} ${url}`
    )
  }

  return response.json()
}

export async function loadManifest() {
  try {
    return {
      manifest:
        await getJson<any>(
          `${BASE}/current/manifest.json`
        ),
      snapshot:
        'current' as const,
    }
  } catch {
    return {
      manifest:
        await getJson<any>(
          `${BASE}/previous/manifest.json`
        ),
      snapshot:
        'previous' as const,
    }
  }
}

export async function loadCatalogue(
  snapshot: string
) {
  return getJson<any[]>(
    `${BASE}/${snapshot}/catalogue.json`
  )
}

export async function loadProduct(
  snapshot: string,
  hs6: string
): Promise<Product> {
  const raw =
    await getJson<any>(
      `${BASE}/${snapshot}/products/${hs6}.json`
    )

  return {
    ...raw,
    level: 6,
    code: raw.hs6 ?? hs6,
    hs6: raw.hs6 ?? hs6,
  } as Product
}

export async function loadHsNode(
  snapshot: string,
  code: string,
  level: 2 | 4 | 6
): Promise<Product> {
  if (level === 6) {
    return loadProduct(
      snapshot,
      code
    )
  }

  const raw =
    await getJson<any>(
      `${BASE}/${snapshot}/parents/${level}/${code}.json`
    )

  return {
    ...raw,

    level,
    code,

    /*
     * Temporary compatibility alias for existing
     * dashboard sections that still read product.hs6.
     * Batch C removes those visual HS-6 assumptions.
     */
    hs6: code,
  } as Product
}

export async function loadSearch():
  Promise<SearchItem[]> {
  try {
    return await getJson<SearchItem[]>(
      '/data/hs-library.json'
    )
  } catch {
    return []
  }
}
TS


echo
echo "7. PATCH APP IMPORT + openHs()"

python - <<'PY'
from pathlib import Path

path = Path(
    "src/App.tsx"
)

text = path.read_text()

needle = "  loadProduct,\n"

if needle not in text:
    raise SystemExit(
        "Could not find loadProduct in App import."
    )

if "  loadHsNode,\n" not in text:
    text = text.replace(
        needle,
        needle + "  loadHsNode,\n",
        1,
    )

start = text.find(
    "  async function openHs("
)

if start == -1:
    raise SystemExit(
        "Could not locate openHs()."
    )

brace = text.find(
    "{",
    start,
)

if brace == -1:
    raise SystemExit(
        "Could not locate openHs opening brace."
    )

depth = 0
end = None

for i in range(
    brace,
    len(text),
):
    char = text[i]

    if char == "{":
        depth += 1

    elif char == "}":
        depth -= 1

        if depth == 0:
            end = i + 1
            break

if end is None:
    raise SystemExit(
        "Could not determine end of openHs()."
    )

replacement = '''  async function openHs(
    code: string
  ) {
    const clean =
      code.trim()

    const exact =
      searchLib.find(
        item =>
          item.loaded
          && item.code === clean
          && (
            item.level === 2
            || item.level === 4
            || item.level === 6
          )
      )

    if (!exact) {
      console.warn(
        `No loaded HStat node found for ${clean}`
      )
      return
    }

    try {
      const next =
        await loadHsNode(
          snapshot,
          exact.code,
          exact.level
        )

      setProduct(next)

      setYear(
        next.latestIndiaYear
        ?? Math.max(
          ...next.years
        )
      )

      saveRecentSearch(
        exact.code
      )

      setRecentSearches(
        readRecentSearches()
      )

      setQuery('')
    } catch (error) {
      console.error(
        `Failed to load HS-${exact.level} ${exact.code}`,
        error
      )
    }
  }'''

text = (
    text[:start]
    + replacement
    + text[end:]
)

path.write_text(
    text
)

print(
    "PASS — openHs() now loads exact HS-2/4/6 nodes."
)
PY


echo
echo "8. PATCH PRODUCT HEADER TO SHOW REAL HS LEVEL"

python - <<'PY'
from pathlib import Path

path = Path(
    "src/App.tsx"
)

text = path.read_text()

old = '''GLOBAL → INDIA ·
              HS-{product.hs6}'''

new = '''GLOBAL → INDIA ·
              HS-{product.level} · {product.code}'''

if old not in text:
    print(
        "WARN — exact product-header pattern "
        "not found; leaving header unchanged."
    )
else:
    text = text.replace(
        old,
        new,
        1,
    )

    path.write_text(
        text
    )

    print(
        "PASS — product header uses real HS level."
    )
PY


echo
echo "9. TYPESCRIPT"

npx tsc -b


echo
echo "10. PRODUCTION BUILD"

npm run build


echo
echo "11. STATIC DATA CONTRACT AUDIT"

python - <<'PY'
import json
from pathlib import Path

current = Path(
    "public/data/snapshots/current"
)

search = json.loads(
    Path(
        "public/data/hs-library.json"
    ).read_text()
)

failures = []

counts = {}

for level, expected in [
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

    counts[level] = len(loaded)

    if len(loaded) != expected:
        failures.append(
            f"HS-{level}: expected "
            f"{expected} loaded, "
            f"found {len(loaded)}"
        )

for item in search:
    if not item.get("loaded"):
        continue

    code = str(
        item["code"]
    )

    level = item["level"]

    if level == 6:
        path = (
            current
            / "products"
            / f"{code}.json"
        )
    else:
        path = (
            current
            / "parents"
            / str(level)
            / f"{code}.json"
        )

    if not path.exists():
        failures.append(
            f"Loaded search node has no file: "
            f"HS-{level} {code}"
        )

print("=" * 78)
print("HStat.India level-aware integration QA")
print("=" * 78)

print(
    "Loaded HS-2:",
    counts.get(2)
)

print(
    "Loaded HS-4:",
    counts.get(4)
)

print(
    "Loaded HS-6:",
    counts.get(6)
)

print(
    "Total:",
    sum(counts.values())
)

print()
print(
    "Failures:",
    len(failures)
)

for failure in failures:
    print(
        "FAIL:",
        failure
    )

if failures:
    raise SystemExit(2)

print()
print(
    "PASS — every loaded search node "
    "maps to a real analytical JSON object."
)
PY


echo
echo "12. RECHECK HS-6 CONTRACT"

python pipeline/launch_sanity.py


trap - ERR

echo
echo "======================================================================"
echo "BATCH B2 COMPLETE"
echo "======================================================================"
