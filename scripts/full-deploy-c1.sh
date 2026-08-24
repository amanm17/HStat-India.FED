#!/usr/bin/env bash
set -euo pipefail

BACKUP=".checkpoints/full-deploy/c1"
mkdir -p "$BACKUP"

echo "======================================================================"
echo "BATCH C1 — FRONTEND FINISHING + RELEASE UI"
echo "======================================================================"

CSS_FILE=""

for f in src/*.css
do
  if grep -q '\.search-hub' "$f"; then
    CSS_FILE="$f"
    break
  fi
done

if [[ -z "$CSS_FILE" ]]; then
  echo "FAIL — could not identify primary CSS file"
  exit 2
fi

echo "CSS: $CSS_FILE"

cp src/App.tsx "$BACKUP/App.tsx"
cp "$CSS_FILE" "$BACKUP/app.css"
cp vite.config.ts "$BACKUP/vite.config.ts"

if [[ -f vite.config.js ]]; then
  cp vite.config.js "$BACKUP/vite.config.js"
fi

restore() {
  echo
  echo "C1 FAILED — restoring frontend..."

  cp "$BACKUP/App.tsx" src/App.tsx
  cp "$BACKUP/app.css" "$CSS_FILE"
  cp "$BACKUP/vite.config.ts" vite.config.ts

  if [[ -f "$BACKUP/vite.config.js" ]]; then
    cp "$BACKUP/vite.config.js" vite.config.js
  fi

  echo "Frontend restored."
}

trap restore ERR


echo
echo "1. PATCH APPLICATION PRESENTATION"

cat > /tmp/hstat-c1-patch.py <<'PY'
from pathlib import Path
import re

path = Path("src/App.tsx")
text = path.read_text()


# ============================================================
# 1. Correct remaining legacy HS identity in product header
# ============================================================

text = text.replace(
    """HS {product.hs6}""",
    """HS-{product.level} {product.code}""",
)


# ============================================================
# 2. Historical horizon state
# ============================================================

if "historyHorizon" not in text:
    pattern = re.compile(
        r"""(const\s+\[indiaDetail,\s*setIndiaDetail\]\s*=\s*
             useState\([^)]*\))""",
        re.VERBOSE | re.DOTALL,
    )

    m = pattern.search(text)

    if not m:
        raise SystemExit(
            "Could not locate indiaDetail state."
        )

    insertion = """

  const [
    historyHorizon,
    setHistoryHorizon,
  ] = useState<
    '1Y' | '5Y' | '10Y' | 'ALL'
  >('5Y')
"""

    text = (
        text[:m.end()]
        + insertion
        + text[m.end():]
    )


# ============================================================
# 3. History data derived directly from current product
# ============================================================

if "const historyRows =" not in text:
    marker = """
  const perspective =
"""

    pos = text.find(marker)

    if pos == -1:
        raise SystemExit(
            "Could not locate perspective block."
        )

    history = """
  const historyRows =
    product.years
      .slice()
      .sort(
        (a, b) => a - b
      )
      .filter(y => {
        if (
          historyHorizon === 'ALL'
        ) {
          return true
        }

        const latest =
          Math.max(
            ...product.years
          )

        const yearsBack =
          historyHorizon === '1Y'
            ? 1
            : historyHorizon === '5Y'
              ? 5
              : 10

        return (
          y >
          latest - yearsBack
        )
      })
      .map(y => {
        const row =
          product.annual[
            String(y)
          ]

        return {
          year: y,
          imports:
            row?.india.imports
            ?? null,
          exports:
            row?.india.exports
            ?? null,
        }
      })


"""

    text = (
        text[:pos]
        + history
        + text[pos:]
    )


# ============================================================
# 4. Selected-year + validated benchmark sections
# ============================================================

marker = """
        <section className="primary-metrics">
"""

pos = text.find(marker)

if pos == -1:
    raise SystemExit(
        "Could not locate primary metrics section."
    )

if "selected-year-summary" not in text:
    summary = """
        <section
          className="release-section selected-year-summary"
        >
          <div className="release-section-head">
            <div>
              <div className="eyebrow">
                SELECTED YEAR · {year}
              </div>

              <h2>
                Reported trade position
              </h2>
            </div>

            <div className="coverage-pair">
              <span
                data-status={
                  annual.global
                    .importCoverage.status
                }
              >
                Imports · {
                  annual.global
                    .importCoverage.status
                }
              </span>

              <span
                data-status={
                  annual.global
                    .exportCoverage.status
                }
              >
                Exports · {
                  annual.global
                    .exportCoverage.status
                }
              </span>
            </div>
          </div>

          <div className="release-metric-grid">
            <article className="release-metric">
              <span>
                Reported global imports
              </span>
              <strong>
                {usd(
                  annual.global
                    .observedImports
                )}
              </strong>
              <small>
                UN Comtrade · {year}
              </small>
            </article>

            <article className="release-metric">
              <span>
                Reported global exports
              </span>
              <strong>
                {usd(
                  annual.global
                    .observedExports
                )}
              </strong>
              <small>
                UN Comtrade · {year}
              </small>
            </article>

            <article className="release-metric">
              <span>
                India imports
              </span>
              <strong>
                {usd(
                  annual.india.imports
                )}
              </strong>
              <small>
                Reporter · India
              </small>
            </article>

            <article className="release-metric">
              <span>
                India exports
              </span>
              <strong>
                {usd(
                  annual.india.exports
                )}
              </strong>
              <small>
                Reporter · India
              </small>
            </article>

            <article className="release-metric">
              <span>
                India trade balance
              </span>
              <strong>
                {usd(
                  annual.india.balance
                )}
              </strong>
              <small>
                Exports − imports
              </small>
            </article>
          </div>

          {
            (
              annual.global
                .importCoverage.status
                !== 'VALID'
              ||
              annual.global
                .exportCoverage.status
                !== 'VALID'
            ) && (
              <div className="coverage-note">
                Selected-year global figures are
                reported observations. Rank and share
                are shown separately only from a
                validated benchmark year.
              </div>
            )
          }
        </section>


        <section
          className="release-section validated-position"
        >
          <div className="release-section-head">
            <div>
              <div className="eyebrow">
                VALIDATED GLOBAL POSITION
              </div>

              <h2>
                India rank and share
              </h2>
            </div>
          </div>

          <div className="benchmark-grid">
            <article className="benchmark-card">
              <div className="benchmark-title">
                Import benchmark
              </div>

              <strong>
                {
                  globalImportBenchmark
                    ?.year ?? '—'
                }
              </strong>

              <div className="benchmark-stat">
                <span>India rank</span>
                <b>
                  {
                    globalImportBenchmark
                      ?.indiaRank
                    ?? '—'
                  }
                </b>
              </div>

              <div className="benchmark-stat">
                <span>India share</span>
                <b>
                  {
                    globalImportBenchmark
                      ?.indiaShare
                      != null
                      ? pct(
                          globalImportBenchmark
                            .indiaShare
                        )
                      : '—'
                  }
                </b>
              </div>

              <small>
                VALID benchmark only
              </small>
            </article>

            <article className="benchmark-card">
              <div className="benchmark-title">
                Export benchmark
              </div>

              <strong>
                {
                  globalExportBenchmark
                    ?.year ?? '—'
                }
              </strong>

              <div className="benchmark-stat">
                <span>India rank</span>
                <b>
                  {
                    globalExportBenchmark
                      ?.indiaRank
                    ?? '—'
                  }
                </b>
              </div>

              <div className="benchmark-stat">
                <span>India share</span>
                <b>
                  {
                    globalExportBenchmark
                      ?.indiaShare
                      != null
                      ? pct(
                          globalExportBenchmark
                            .indiaShare
                        )
                      : '—'
                  }
                </b>
              </div>

              <small>
                VALID benchmark only
              </small>
            </article>
          </div>
        </section>


"""

    text = (
        text[:pos]
        + summary
        + text[pos:]
    )

# Existing mixed-year primary metrics become legacy only.
text = text.replace(
    '<section className="primary-metrics">',
    '<section className="primary-metrics legacy-primary-metrics">',
    1,
)


# ============================================================
# 5. Parent-category disclosure
# ============================================================

if "parent-category-context" not in text:
    marker = """
        {indiaDetail && (
"""

    pos = text.find(
        marker,
        text.find(
            'className="product-head"'
        ),
    )

    if pos == -1:
        raise SystemExit(
            "Could not locate upper IND tariff block."
        )

    parent_note = """
        {
          product.level < 6 && (
            <div className="parent-category-context">
              <strong>
                Parent-category context
              </strong>

              <span>
                HS-{product.level} {product.code}
                is an official Comtrade aggregate.
                Values are pulled directly at this
                HS level and are not constructed by
                summing HStat's selected child products.
              </span>
            </div>
          )
        }


"""

    text = (
        text[:pos]
        + parent_note
        + text[pos:]
    )


# ============================================================
# 6. IND tariff behaviour
#
# IND ON  -> tariff block near top.
# IND OFF -> tariff block later in the page.
# Parents -> no HS-8 tariff-line claim.
# ============================================================

upper_old = """        {indiaDetail && (
          <div className="ind-priority">
            <IndiaTariffLines
              product={product}
              year={year}
            />
          </div>
        )}"""

upper_new = """        {
          indiaDetail
          && product.level === 6
          && (
            <div className="ind-priority">
              <IndiaTariffLines
                product={product}
                year={year}
              />
            </div>
          )
        }"""

if upper_old not in text:
    raise SystemExit(
        "Could not locate exact upper tariff block."
    )

text = text.replace(
    upper_old,
    upper_new,
    1,
)


# Find second India-detail block and insert normal tariff view
# immediately before it.

needle = "        {indiaDetail && ("

positions = []
start = 0

while True:
    i = text.find(
        needle,
        start,
    )

    if i == -1:
        break

    positions.append(i)
    start = i + len(needle)

if len(positions) < 1:
    raise SystemExit(
        "Could not locate lower India detail block."
    )

# Upper block no longer matches exact needle after replacement,
# therefore the remaining occurrence is the lower detail block.
lower_pos = positions[-1]

if "tariff-standard-position" not in text:
    default_tariff = """
        {
          !indiaDetail
          && product.level === 6
          && (
            <div className="tariff-standard-position">
              <IndiaTariffLines
                product={product}
                year={year}
              />
            </div>
          )
        }


"""

    text = (
        text[:lower_pos]
        + default_tariff
        + text[lower_pos:]
    )


# ============================================================
# 7. Historical horizon controls + chart data
# ============================================================

area_matches = list(
    re.finditer(
        r"<AreaChart\b",
        text,
    )
)

if not area_matches:
    raise SystemExit(
        "No AreaChart found."
    )

area_pos = area_matches[0].start()

# Replace data prop within the first AreaChart opening tag.
tag_end = text.find(
    ">",
    area_pos,
)

area_open = text[
    area_pos:
    tag_end + 1
]

new_area_open, count = re.subn(
    r"data=\{[^}]+\}",
    "data={historyRows}",
    area_open,
    count=1,
)

if count == 0:
    raise SystemExit(
        "First AreaChart has no replaceable data prop."
    )

text = (
    text[:area_pos]
    + new_area_open
    + text[tag_end + 1:]
)


# Add controls to the chart-shell immediately enclosing AreaChart.

area_pos = text.find(
    "<AreaChart"
)

shell_pos = text.rfind(
    '<div className="chart-shell">',
    0,
    area_pos,
)

if shell_pos == -1:
    raise SystemExit(
        "Could not locate history chart shell."
    )

shell_end = text.find(
    ">",
    shell_pos,
) + 1

if "history-range-controls" not in text:
    controls = """
              <div className="history-range-controls">
                {
                  (
                    [
                      '1Y',
                      '5Y',
                      '10Y',
                      'ALL',
                    ] as const
                  ).map(range => (
                    <button
                      key={range}
                      className={
                        historyHorizon
                          === range
                          ? 'active'
                          : ''
                      }
                      onClick={() =>
                        setHistoryHorizon(
                          range
                        )
                      }
                    >
                      {
                        range === 'ALL'
                          ? 'All'
                          : range
                      }
                    </button>
                  ))
                }
              </div>
"""

    text = (
        text[:shell_end]
        + controls
        + text[shell_end:]
    )


path.write_text(text)

print(
    "PASS — App presentation patched."
)
PY

python /tmp/hstat-c1-patch.py
rm -f /tmp/hstat-c1-patch.py


echo
echo "2. ADD RELEASE CSS"

cat >> "$CSS_FILE" <<'CSS'

/* =========================================================
   HSTAT FULL DEPLOY · RELEASE FINISH
   ========================================================= */

.legacy-primary-metrics {
  display: none;
}

.release-section {
  margin: 0 0 18px;
  padding: 18px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
}

.release-section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 14px;
}

.release-section-head h2 {
  margin: 4px 0 0;
  font-size: 19px;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

.release-metric-grid {
  display: grid;
  grid-template-columns:
    repeat(5, minmax(0, 1fr));
  gap: 9px;
}

.release-metric {
  min-width: 0;
  padding: 13px;
  background: var(--panel-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.release-metric > span {
  display: block;
  min-height: 28px;
  color: var(--muted);
  font-size: 10px;
  font-weight: 650;
  line-height: 1.35;
}

.release-metric strong {
  display: block;
  margin-top: 5px;
  color: var(--text);
  font-size: clamp(17px, 1.5vw, 23px);
  line-height: 1.1;
  letter-spacing: -0.03em;
  white-space: nowrap;
}

.release-metric small,
.benchmark-card small {
  display: block;
  margin-top: 6px;
  color: var(--faint);
  font-size: 9px;
}

.coverage-pair {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.coverage-pair span {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-soft);
  color: var(--muted);
  font-size: 9px;
  font-weight: 750;
}

.coverage-pair span[data-status="VALID"] {
  color: var(--green);
  border-color: rgba(47, 143, 107, .32);
}

.coverage-pair span[data-status="CAUTION"] {
  color: #8a661d;
}

.coverage-pair span[data-status="INVALID"] {
  color: #a64747;
}

.coverage-note {
  margin-top: 10px;
  padding: 8px 10px;
  background: var(--panel-soft);
  border-left: 3px solid var(--border-strong);
  color: var(--muted);
  font-size: 10px;
  line-height: 1.45;
}

.benchmark-grid {
  display: grid;
  grid-template-columns:
    repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.benchmark-card {
  padding: 14px;
  background: var(--panel-soft);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.benchmark-title {
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
}

.benchmark-card > strong {
  display: block;
  margin: 5px 0 10px;
  color: var(--green);
  font-size: 24px;
  line-height: 1;
}

.benchmark-stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  padding: 6px 0;
  border-top: 1px solid var(--border);
  font-size: 11px;
}

.benchmark-stat span {
  color: var(--muted);
}

.benchmark-stat b {
  color: var(--text);
}

.parent-category-context {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: -2px 0 16px;
  padding: 9px 12px;
  background: var(--panel-soft);
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.4;
}

.parent-category-context strong {
  flex: 0 0 auto;
  color: var(--green);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: .06em;
}

.tariff-standard-position {
  margin: 18px 0;
}

.history-range-controls {
  position: absolute;
  z-index: 4;
  top: 7px;
  left: 8px;
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 7px;
}

.chart-shell {
  position: relative;
}

.history-range-controls button {
  min-width: 34px;
  padding: 4px 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font-size: 9px;
  font-weight: 700;
  cursor: pointer;
}

.history-range-controls button.active {
  background: var(--navy);
  color: white;
}

/* Search remains page-level rather than header-level. */

.search-hub {
  max-width: 1180px;
  margin-top: 6px;
  margin-bottom: 30px;
  padding-top: 24px;
}

.search-primary {
  min-height: 72px;
  border-radius: 15px;
}

.quick-access,
.smart-suggestions {
  justify-content: flex-start;
  padding-left: 4px;
}

.quick-access {
  margin-top: 12px;
}

.smart-suggestions {
  margin-top: 6px;
}

/* Header should contain identity + page controls only. */

.topbar {
  grid-template-columns: 1fr auto;
  min-height: 64px;
  height: auto;
}

/* IND state */
:root[data-india="active"] body {
  background:
    linear-gradient(
      180deg,
      rgba(47, 143, 107, .035),
      transparent 320px
    ),
    var(--bg);
}

.ind-priority {
  margin-bottom: 18px;
}

@media (max-width: 1100px) {
  .release-metric-grid {
    grid-template-columns:
      repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .release-section {
    padding: 13px;
  }

  .release-section-head {
    flex-direction: column;
    gap: 8px;
  }

  .coverage-pair {
    justify-content: flex-start;
  }

  .release-metric-grid,
  .benchmark-grid {
    grid-template-columns: 1fr;
  }

  .release-metric > span {
    min-height: 0;
  }

  .parent-category-context {
    align-items: flex-start;
    flex-direction: column;
  }

  .search-hub {
    padding-top: 12px;
  }
}

CSS


echo
echo "3. CONFIGURE VITE CHUNK SPLITTING"

cat > vite.config.ts <<'TS'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
  ],

  build: {
    sourcemap: false,

    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.indexOf(
              'node_modules'
            ) === -1
          ) {
            return
          }

          if (
            id.indexOf(
              '/recharts/'
            ) !== -1
            || id.indexOf(
              '/d3-'
            ) !== -1
          ) {
            return 'charts'
          }

          if (
            id.indexOf(
              '/xlsx/'
            ) !== -1
          ) {
            return 'xlsx'
          }

          if (
            id.indexOf(
              '/react/'
            ) !== -1
            || id.indexOf(
              '/react-dom/'
            ) !== -1
          ) {
            return 'react'
          }

          if (
            id.indexOf(
              '/lucide-react/'
            ) !== -1
          ) {
            return 'icons'
          }
        },
      },
    },
  },
})
TS

# Keep JS config aligned because both files currently exist.
cat > vite.config.js <<'JS'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
  ],

  build: {
    sourcemap: false,

    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.indexOf('node_modules') === -1) {
            return
          }

          if (
            id.indexOf('/recharts/') !== -1
            || id.indexOf('/d3-') !== -1
          ) {
            return 'charts'
          }

          if (id.indexOf('/xlsx/') !== -1) {
            return 'xlsx'
          }

          if (
            id.indexOf('/react/') !== -1
            || id.indexOf('/react-dom/') !== -1
          ) {
            return 'react'
          }

          if (
            id.indexOf('/lucide-react/') !== -1
          ) {
            return 'icons'
          }
        },
      },
    },
  },
})
JS


echo
echo "4. TYPESCRIPT"

npx tsc -b


echo
echo "5. PRODUCTION BUILD"

rm -rf dist
npm run build


echo
echo "6. UI CONTRACT AUDIT"

python - <<'PY'
from pathlib import Path
import json

app = Path(
    "src/App.tsx"
).read_text()

checks = {
    "selected-year":
        "selected-year-summary"
        in app,

    "validated-position":
        "validated-position"
        in app,

    "reported-imports":
        "Reported global imports"
        in app,

    "reported-exports":
        "Reported global exports"
        in app,

    "history-controls":
        "history-range-controls"
        in app,

    "level-aware-header":
        "HS-{product.level} · {product.code}"
        in app,

    "parent-context":
        "parent-category-context"
        in app,

    "level-aware-loader":
        "loadHsNode"
        in app,

    "ind-priority":
        "product.level === 6"
        in app
        and "ind-priority"
        in app,
}

failures = [
    name
    for name, passed
    in checks.items()
    if not passed
]

print("=" * 78)
print("HStat.India release UI audit")
print("=" * 78)

for name, passed in checks.items():
    print(
        f"{name:<24}",
        "PASS"
        if passed
        else "FAIL"
    )

print()
print(
    "Failures:",
    len(failures)
)

if failures:
    raise SystemExit(
        "UI audit failed: "
        + ", ".join(
            failures
        )
    )


search = json.loads(
    Path(
        "public/data/hs-library.json"
    ).read_text()
)

counts = {
    level: sum(
        x.get("level") == level
        and x.get("loaded") is True
        for x in search
    )
    for level in [
        2,
        4,
        6,
    ]
}

print()
print(
    "Loaded navigation:",
    counts
)

if counts != {
    2: 2,
    4: 8,
    6: 56,
}:
    raise SystemExit(
        "66-node navigation contract failed"
    )

print(
    "PASS — frontend release contract."
)
PY


echo
echo "7. BACKEND REGRESSION"

python pipeline/launch_sanity.py


echo
echo "8. BUILD ASSET REPORT"

python - <<'PY'
from pathlib import Path

assets = Path(
    "dist/assets"
)

js = sorted(
    assets.glob("*.js"),
    key=lambda p: p.stat().st_size,
    reverse=True,
)

print("=" * 72)
print("Production JavaScript chunks")
print("=" * 72)

for path in js:
    print(
        f"{path.name:<45}"
        f"{path.stat().st_size / 1024:>9.1f} KB"
    )

print()
print(
    "Chunks:",
    len(js)
)

if js:
    print(
        "Largest:",
        round(
            js[0].stat().st_size
            / 1024,
            1,
        ),
        "KB",
    )
PY


trap - ERR

echo
echo "======================================================================"
echo "BATCH C1 COMPLETE"
echo "======================================================================"
