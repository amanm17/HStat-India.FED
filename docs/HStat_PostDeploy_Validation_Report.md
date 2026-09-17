# HStat.India — post-deployment validation report

**DGCIS / HS-8, two flows, live on `main` at `feda03d`.**
Reviewed 2026-09-16. Every figure below was re-measured in this review; nothing
is carried over from the handover on trust.

---

## 1. Executive result

### PASS WITH WARNINGS

Everything the deployment claims is true. Both flows validate, both flow guards
agree, 97,740 published cells round-trip exactly, the build is deterministic,
and the Comtrade dashboard survives every way I could break the DGCIS layer.

**One genuine defect was found and fixed.** A single user-visible string still
described India's exports as imports — the exact class of failure this whole
branch exists to correct, surviving in the one place nobody re-read. It is
fixed on `fix/dgcis-tile-note` (`b6ea2f1`), not on `main`.

Nine further items are logged below as P2/P3. None blocks the deployment.

---

## 2. Repository state

| | |
|---|---|
| branch | `main` |
| HEAD | `feda03d` |
| vs `origin/main` | 0 ahead, 0 behind — identical |
| working tree | clean |
| `.env` tracked | no |
| `data/dgcis/raw/`, `incoming/` | gitignored (`.gitignore:38`, `:31`); only `incoming/.gitkeep` is tracked, deliberately |
| unexpected tracked files | none |

`data/dgcis/tia_capture.json` / `.txt` **do not exist** — the richer TIA
discovery script has still never been run.

---

## 3. Build

`npm run build` (tsc -b + vite) — **clean**, in a container with `npm ci` from
the committed lockfile.

| chunk | now | before imports flow | delta |
|---|---:|---:|---:|
| `index-*.js` | 158.97 kB | 156.53 kB | +2.44 kB |
| `index-*.css` | 66.89 kB | 62.79 kB | +4.10 kB |
| everything else | unchanged | | |

No material regression. The whole two-flow feature cost 6.5 kB uncompressed.

---

## 4. Comtrade QA — unchanged by any of this

`validate_snapshot.py` → `544 nodes | 418 HS-6 | 537 with a published global
trade figure | 0 failures | 8211 warnings`, exit 0.

`launch_sanity.py --build-only` → **Sanity checks passed**:

- schema 2.0.0, frontend and snapshot agree
- 411/411 active products with a published global trade figure
- 7 retired classifications carried as historical
- 418 distinct display names across 418 products
- 410/410 India values reconciled against published share
- snapshot refreshed 2026-09-14T09:31:13Z

**The 8,211 warnings are exactly two categories** — I instrumented the
validator to bucket them:

| count | category |
|---:|---|
| 6,255 | *only N% of the world total came from reporters that file re-imports separately* |
| 1,956 | *import/export mirror ratio N outside [N, N]* |

Both are the documented "surfaced, not blocking" class. There is no third
category hiding in the pile. Warnings ≠ failures, and failures are zero.

---

## 5. DGCIS exports

`validate_hs8.py --flow exports` → **PASS**, exit 0.

| | |
|---|---|
| raw rows / commodity rows | 544 / 543 |
| periods | 90, 2019-01 → 2026-06 |
| attached to products | 530 HS-8 across 251 of 418 products |
| predecessor-only | 13 HS-8 under 851712, 851950, 852580, 854140 |
| reconciliation | 180 checks, worst **0.001657%** (August-2021 USD mn), tolerance 0.01% |
| sha256 | `609fc2a9…`, matches `incoming/` and all four archived copies |

`flow_guard.py --flow exports` → **AGREES**, evidence exports,
**1,471 exports / 16 imports of 1,487** discriminating pairs.
Median ratio to Comtrade India exports **1.0000**, to imports **0.1153**.

---

## 6. DGCIS imports

`validate_hs8.py --flow imports` → **PASS**, exit 0.

| | |
|---|---|
| raw rows / commodity rows | 544 / 543 |
| periods | 90, 2019-01 → 2026-06 |
| attached to products | 530 HS-8 across 251 of 418 products |
| predecessor-only | 13, same headings |
| reconciliation | 180 checks, worst **0.000435%** (April-2020 USD mn), tolerance 0.01% |
| sha256 | `99f78185…`, matches `incoming/` and both archived copies |

`flow_guard.py --flow imports` → **AGREES**, evidence imports,
**1,465 imports / 39 exports of 1,504** pairs.
Median ratio to Comtrade India imports **0.9998**, to exports **7.6979**.

### The guard still refuses, both ways

I re-ran the negative cases rather than assuming:

```
exports file declared --flow imports  ->  exit 2
imports file declared --flow exports  ->  exit 2
```

No `--force-flow` or equivalent bypass exists anywhere in `flow_guard.py` or
`process_tia_hs8.py`.

---

## 7. Cross-flow consistency

13 structural checks, all pass:

- row counts equal (48,870 each)
- HS-8 key-set parity — 543 vs 543, symmetric difference **0**
- identical month axis — 90 periods, 2019-01 → 2026-06
- `flow` column correct in each file
- no duplicate `(hs8, country, year, month, flow)` in either
- `hs6 == hs8[:6]` everywhere
- a parent HS-6 payload exists for every HS-8
- partner is `World` only, both flows

**Not aliased.** 10,774 of 48,870 USD cells are identical between the flows,
but only **165 of those are non-zero** — the rest are months where both flows
filed 0.000. Two copied files would have matched everywhere.

### Economic sanity — 12/12 within 0.5×–2× of Comtrade, and far tighter than that

USD million, both flows, against HStat's own Comtrade India series:

| HS6 | product | yr | DGCIS X | CT X | DGCIS M | CT M |
|---|---|---|---:|---:|---:|---:|
| 851713 | Smartphones | 2024 | 20,441 | 20,139 | 510 | 502 |
| 851713 | Smartphones | 2025 | 30,133 | 30,134 | 651 | 651 |
| 854231 | Processor chips | 2024 | 165 | 163 | 14,739 | 14,490 |
| 854231 | Processor chips | 2025 | 148 | 148 | 16,575 | 16,576 |
| 847130 | Laptops | 2024 | 325 | 320 | 5,863 | 5,773 |
| 847130 | Laptops | 2025 | 724 | 724 | 6,258 | 6,258 |
| 850760 | Li-ion batteries | 2024 | 93 | 92 | 2,846 | 2,796 |
| 850760 | Li-ion batteries | 2025 | 59 | 59 | 4,083 | 4,084 |
| 851762 | Network equipment | 2024 | 919 | 906 | 3,390 | 3,312 |
| 851762 | Network equipment | 2025 | 1,455 | 1,455 | 3,831 | 3,836 |
| 852412 | Bare OLED modules | 2024 | 2 | 2 | 1,805 | 1,780 |
| 852412 | Bare OLED modules | 2025 | 3 | 3 | 2,317 | 2,317 |

2025 is essentially identity on both flows. 2024 DGCIS runs **consistently a
little above** Comtrade (510 vs 502, 14,739 vs 14,490, 5,863 vs 5,773) — a
uniform upward difference of 1–2%, which reads as DGCIS revisions landing after
the Comtrade snapshot was pulled, not as an error. Worth knowing; not a defect.

---

## 8. Frontend payload QA

All 20 assertions pass:

manifest flows `[exports, imports]` · 543 unique HS-8 · 255 HS-6 payloads ·
251 product-backed · 4 predecessor-only · every index HS-8 resolves to a parent
file and exists inside it · no orphan parent · no duplicate HS-8 · periods
sorted with no duplicates · `latestPeriod ≤ max period` everywhere · all values
numeric or null · no NaN/Infinity · exports and imports arrays are distinct
objects (0 of 543 aliased) · both flows reach 2026-06 · reporter India ·
partner World · source string exact.

### Round-trip — the strongest single check here

Every processed row independently re-derived and compared against the published
payload, per flow:

| flow | processed rows | cells checked | value mismatches | missing rows | period-length | HS-8→parent |
|---|---:|---:|---:|---:|---:|---:|
| exports | 48,870 | 48,870 | **0** | **0** | **0** | **0** |
| imports | 48,870 | 48,870 | **0** | **0** | **0** | **0** |

**97,740 cells, zero discrepancies.**

### One honest correction to the checklist

Assertion 15, "null stays null", **passed vacuously**: there are **no nulls at
all** in either flow. DGCIS writes `0.000` for a month with no trade rather than
leaving it blank — 53,654 true zeros, 0 nulls. The null contract is correctly
implemented in code (`build_frontend_hs8.py` writes `null`, the chart draws a
gap with `connectNulls={false}`), but **no real data currently exercises it**.
The round-trip is what actually proves values are preserved, zeros included.

---

## 9. Browser QA — 158 checks

| suite | result |
|---|---|
| `check.mjs` | 27/27 |
| `search.mjs` | 12/12 |
| `boundary.mjs` | 7/7 |
| `absence.mjs` | 6/6 |
| `additive.mjs`, DGCIS removed | 8/8 |
| **`postdeploy.mjs`** (new) | **98/98** |

All re-run after the one-line fix; no regression.

`chromium.launch()` with no executable path anywhere in `qa/suite/` — confirmed
by grep. The portability fix holds.

---

## 10. Two-flow UI — verified against ground truth, not against the handover

Ground truth read from the payload first: `851713` / `85171300`, June 2026 —
exports **2,976.996** USD mn / **28,272.383** INR cr, imports **9.765** USD mn /
**92.740** INR cr.

**HS-6 `/hs/851713`:** panel renders · two flow buttons · `Exports` selected
with `aria-pressed="true"` · heading *"What India ships under this heading"* ·
2,977 shown · switch to imports → heading *"What India brings in under this
heading"*, value 9.8, footer reads *"partner World, imports"* · currency switch
still works while on imports (92.7 INR cr) · switching back restores the export
content exactly · no page errors.

**HS-8 `/hs/85171300`:** two flow buttons · chart heading *"Exports, month by
month"* → *"Imports, month by month"* · headline 12-month metric changes · lede
switches to *"India's imports from the world"* · calendar-year table re-renders
· switching back restores the original export headline value · no page errors.

The handover noted its ad-hoc script printed 18 PASS lines under a hard-coded
`13/13` summary. That was a reporting typo, as stated; `postdeploy.mjs` counts
honestly.

**Retired and predecessor routes:** `/hs/85171211` (under predecessor 851712)
renders, says *lineage predecessor*, shows **no** Comtrade card it cannot fill,
offers both flows, and does not link to a product page that does not exist.
Retired HS-6 `851770` and `850740` both render, keep their DGCIS history, and
are not presented as current.

---

## 11. Additive behaviour and failure isolation

Seven ways of breaking the DGCIS layer, by intercepting the fetch rather than
doctoring copies of `dist`. In every case the Comtrade page stayed whole, nothing
was thrown to the window, and no stale wrong-flow wording appeared:

| scenario | result |
|---|---|
| `hs8-index.json` missing (404) | page whole |
| `hs8-index.json` corrupt | page whole |
| parent HS-6 JSON missing | page whole |
| parent HS-6 JSON malformed | page whole |
| previous payload shape (`children` + `flow: "imports"`) | page whole, panel hides — the old wording cannot resurface |
| one flow absent | panel renders, **and no flow switch with a single option** |
| both flows absent | panel hides rather than rendering empty |
| entire `data/dgcis/` removed | 8/8, absence note shown instead of the panel |
| forced throw mid-render | boundary catches it, product page intact |

`prune()` re-tested by planting a stale `hs6/999999.json`: the build **refused**
rather than shipping it. (On this Linux bridge `unlink` is blocked, so the
fail-safe branch fired — which is the branch that matters.)

---

## 12. Live production

`https://hstat-india.aman17-dps.workers.dev`

- `/data/dgcis/manifest.json` → flows `[exports, imports]`, 2019-01 → 2026-06,
  90 periods, 543 HS-8, 251/418, reporter India, partner World, **both flow
  verdicts present and DECIDED** with the same pair counts and median ratios as
  local (1,487 / 1.0 / 0.1153 and 1,504 / 0.9998 / 7.6979).
- `/data/dgcis/hs6/851713.json` → `hs6` 851713, `flows` = exports + imports,
  both `latestPeriod` 2026-06, lines `[85171300]`, reporter India, partner World,
  source string exact, **no top-level `flow` key and no `children` key** — the
  live payload is the current shape, not a stale one.

Live matches local exactly. The handover's note stands: Cloudflare rejects
default `urllib`'s client signature with 403 while browser-like clients get 200.
That is request filtering, not an outage.

### Network behaviour

| | |
|---|---|
| front page | **0** HS-6 payloads fetched |
| product page | exactly **1** HS-6 payload + **1** `hs8-index.json` |
| flow switch (imports and back) | **0** additional requests |
| product with no DGCIS coverage | **0** HS-6 requests — the index gate works, no 404 spam |
| duplicate requests | **0** |
| HS-6 → HS-8 navigation | **1 re-fetch of the parent payload it already has** ← see P2 |

Sizes: `hs8-index.json` **171 KB**, largest HS-6 **60.1 KB**, total
`public/data/dgcis` **1,649 KB**. Matches the handover's expectations exactly.

---

## 13. Terminology and source semantics

I swept every DGCIS code path for flow words and world/global wording.

**Clean:** the HS-6 panel heading, lede and footer are all driven by the current
flow (`flowPhrase`, `flowWord`, `{flow}` interpolated into *"partner World,
{flow}"*). The HS-8 page's chart heading, lede and colour all follow the flow.
`aria-label="Flow"` with `aria-pressed` on both surfaces. Every occurrence of
*"world trade"* / *"global"* is either a code comment, the explicit disclaimer
*"Not world trade: there is no eight-digit world figure"*, or inside the
Comtrade card under the eyebrow **"THE HEADING THIS SITS UNDER · UN COMTRADE"**,
where *"World trade 2025"* and *"of world imports"* describe Comtrade figures
correctly.

**One defect — and it is the original defect, surviving in one place.**

`src/lib/workspace.ts:58`

```ts
{ id: 'dgcis', label: 'India HS8 detail',
  note: "India's own monthly tariff-line imports, from DGCIS" },
```

`Sidebar.tsx:157` renders `tile.note` as `<em>`, so this **is** user-visible: in
the rail where the reader manages tiles, the DGCIS panel was still described as
*imports* — above a panel that defaults to exports and now carries both.

Fixed on `fix/dgcis-tile-note` (`b6ea2f1`). A static registry cannot know which
flow the reader has selected, so it now names none:

```ts
note: "India's own tariff lines, monthly, from DGCIS"
```

Verified: the old string no longer exists in the built bundle, the new one does,
and all 158 browser checks still pass.

### Scope rule — audited, no leakage

Of 543 tariff lines: **530 matched at HS-6** (the strict level) and **13 matched
only at HS-4** — every one of those 13 is a descendant of a retired HS 2022
predecessor (851712, 851950, 852580, 854140), which is exactly what should
happen. **The HS-2 arm of the rule has never admitted anything.** No leakage
today; the latent risk on a wider extract is real and logged as P2.

---

## 14. Security / dependencies

`npm audit` → 1 critical, 1 high, 1 moderate. **No fixes applied.**

| package | severity | path | runtime/dev | relevance to HStat | fixed in | breaking? | recommendation |
|---|---|---|---|---|---|---|---|
| `jspdf` | **critical** | direct | runtime (report PDF) | ReDoS / DoS / path traversal. Reachable only through `reportToPdf`, fed by strings the app fetched from its own origin. No untrusted input path exists. | 4.2.1 | **yes**, semver-major | bump on a branch, then regenerate a PDF report and a PNG capture before merging |
| `dompurify` | moderate | transitive via `jspdf` | runtime | XSS in sanitisation. Same reachability; resolved by the same bump. | ≤3.4.12 → via jspdf 4.2.1 | with the above | fixed by the jspdf bump |
| `xlsx` | **high** | direct | runtime (XLSX export) | Prototype pollution + ReDoS, both in **parsing** untrusted workbooks. HStat only ever **writes** workbooks and never reads one. | **no npm fix** | n/a | SheetJS no longer publishes to npm; a real fix means installing from `cdn.sheetjs.com`. Document and schedule; do not force |

Do not run `npm audit fix --force` — it would take the jspdf major silently and
could break report generation, which has no test coverage.

---

## 15. Remaining risks

### P0 — blocker
None.

### P1 — should fix
1. **Tile note said "imports" for exports** — *found and fixed*, `b6ea2f1`, on a
   branch, not yet on `main`. Until merged, the live site still shows it.

### P2 — worth fixing
2. **A product word cannot reach a tariff line.** DGCIS ships eight coarse
   commodity groups (`TELECOM INSTRUMENTS`, `CONSUMER ELECTRONICS`, …) and no
   HS-8 descriptions, so "smartphone" returns the Comtrade product and no DGCIS
   group. Inventing descriptions is forbidden, but there is a non-fabricating
   fix: match the query against the **parent HS-6's authored display name and
   aliases**, which HStat already curates, and offer that heading's tariff lines.
3. **HS-6 → HS-8 re-fetches the parent payload** it fetched seconds earlier — up
   to 60 KB per drill-down. `loadDgcis` uses `cache: 'no-cache'`; a per-session
   memo keyed by HS-6, like `loadDgcisIndex` already has, would remove it.
4. **DGCIS is absent from the JSON / CSV / XLSX exports.** They are entirely
   Comtrade-derived; a reader downloading a workbook gets no tariff-line data and
   no hint that a tariff-line layer exists. (PDF/PNG reports *can* include the
   DGCIS tile, as a captured image carrying its own flow labelling — safe, but
   a picture, not data.)
5. **375px HS-6 pages overflow horizontally by 179px.** **Not this layer's
   doing** — with `public/data/dgcis` removed entirely the overflow is the same
   179px. Culprits are `.download-master`, `.stack-add` and `.pulldata`. The
   DGCIS table scrolls correctly inside its own wrapper and contributes nothing.
6. **The HS-2 arm of the scope rule is dormant but latent.** It has admitted
   nothing so far; on a broad portal extract it would admit whole chapters.
   Move the rule into editable config before widening scope.
7. **`jspdf` critical + `dompurify` moderate**, one major bump fixes both.
8. **`xlsx` high with no npm fix** — needs a source change, not an audit fix.
9. **`data/dgcis/raw/` accumulates identical archives** — 7 files, only 2
   distinct SHAs, because `process_tia_hs8.py` writes a new timestamped copy on
   every run even when the bytes already exist. Gitignored, so repo-safe; it just
   grows on disk. Skip the write when a matching SHA is already archived.

### P3 — future
10. **The null path is untested by real data.** DGCIS writes `0.000`, never
    blanks. Correctly implemented, never exercised — a future extract with real
    gaps will be the first test.
11. **The monthly refresh is probably due.** Both flows end **2026-06**; today is
    **2026-09-16**, a ~2.5-month lag. DGCIS ordinarily publishes well inside
    that, so July and possibly August are likely available. I did not check the
    portal — it is CAPTCHA-gated and bypassing it is out of bounds. Verify by
    running the refresh. **No later months were synthesised.**
12. **TIA discovery never run** — no `tia_capture.json` / `.txt`. It is the route
    to understanding the partner and quantity dimensions without guessing.
13. **Broader MeitY scope, partner-country HS-8, quantity** — all still open, all
    untouched by this review, as instructed.

---

## 16. Recommended next actions

1. **Merge `fix/dgcis-tile-note`.** One string plus two new QA suites; zero risk;
   removes the last surviving instance of the original error.
   ```
   git checkout main && git merge --ff-only fix/dgcis-tile-note
   ./scripts/ship.sh "Tile note: name no flow, since the panel names the one it shows"
   ```
2. **Run the monthly refresh** for both flows and see whether 2026-07 (and
   2026-08) are available. `refresh_dgcis.py` will report plainly if the latest
   month has not advanced.
3. **Take the `jspdf` 4.2.1 bump on a branch**, regenerate a PDF and a PNG
   report by hand, then merge. That clears the critical and the moderate.
4. **Decide on `xlsx`**: accept and document, or move to the SheetJS CDN source.
5. **Then, and only then, widen scope** — with the matching rule in editable
   config first, because the HS-2 arm becomes live the moment the extract does.

---

## Closing note on method

The handover's final principle is right, and this review is a second data point
for it. Everything numeric passed: reconciliation to 0.0004%, round-trip across
97,740 cells with zero mismatches, both guards agreeing decisively.

The one real defect was a sentence.

It was not in the data, the pipeline, or the payload. It was in a static
registry nobody re-read, rendered into a sidebar, saying *imports* about
exports — the same failure as the original, at one hundredth the scale, and
invisible to every numeric check in the system. Worth remembering when deciding
where the next round of scrutiny goes.
