# HStat.India — handover, 18 September 2026

```
repo     https://github.com/amanm17/HStat-India.FED.git
local    /Users/amanmishra/Documents/Personal Project/HStat-India-FED-upload
live     https://hstat-india.aman17-dps.workers.dev
deploy   Cloudflare builds every push to main. Never run wrangler deploy.

origin/main        75b914c   <- this is what is live
feat/hs8-naming    5698a3c   <- 1 commit, ready, NOT pushed
working tree       clean
```

**One commit is finished and waiting to ship. Everything else on the list is
unstarted.** Read §2 before touching git — a lock-file trap has already silently
swallowed one deploy in this project.

---

## 1. What this dashboard is, in one screen

Two data sources that must never be mixed, and the whole architecture exists to
keep them apart.

| | UN Comtrade | DGCIS / TIA |
|---|---|---|
| what | the world's trade in an HS-6 line | India's own trade at its 8-digit tariff line |
| reporter | every economy that files | India only |
| partner | World | World (means "India with everywhere", **not** world trade) |
| period | calendar years, annual | calendar months |
| currently | to 2025 (patchy), 2026 empty | **to 2026-06, both flows** |

Rules that are not negotiable, and have each been learned the hard way:

- **Never add a DGCIS figure to a Comtrade figure.** Different reporter,
  different partner concept, different period basis.
- **Never describe DGCIS partner "World" as world trade.**
- **Never convert between INR crore and USD million.** DGCIS files both; neither
  can be derived from the other, and neither yields an exchange rate.
- **Never invent an HS-8 description.** DGCIS supplies none. See §5.
- **A year that cannot be trusted is left blank, not estimated.**

### The mistake that shaped the codebase

The DGCIS extract has no flow column. An earlier version of the pipeline wrote
`"flow": "imports"` as a literal, and the data was **exports**. It propagated
through six layers unchallenged for a fortnight because every internal check
passed — the reconciliation against the portal's own TOTAL row proves
transcription and is structurally incapable of detecting a mislabelled
dimension.

That is why `pipeline/dgcis/flow_guard.py` exists, why `--flow` is required with
no default, and why the value columns are called `value_*` and not `import_*`.
**Do not add a `--force-flow` escape hatch.** It would restore precisely the
failure the guard exists to prevent.

---

## 2. Deploying — read this first

### The lock-file trap

Claude works through a desktop bridge that can *create* files in `.git/` but
cannot *remove* them. Stale `.git/**/*.lock` files are therefore routine, and
git's error message does not explain why.

This has already cost one deploy. `git checkout main` failed on
`.git/index.lock`, so the merge that followed merged a branch into itself
("Already up to date"), and the push shipped the wrong commit. A second attempt
failed on `.git/refs/heads/main.lock`, leaving a **half-applied fast-forward** —
index and working tree moved, branch pointer did not.

**Before any git operation:**

```bash
find .git -name '*.lock' -delete
```

Recursively. `rm -f .git/index.lock` alone is not enough — the one that bit
second was under `refs/`.

**After a merge, verify the pointer actually moved** before pushing:

```bash
git log --oneline -1          # must be the commit you expect
git rev-parse --short main origin/main
```

### Shipping the pending commit

```bash
cd ~/"Documents/Personal Project/HStat-India-FED-upload"
find .git -name '*.lock' -delete
git checkout main
git merge --ff-only feat/hs8-naming
npm run build                 # NOT yet run on the Mac for this commit
git push origin main
```

Expect `75b914c..5698a3c`. Bundle should land near **162 kB JS / 67 kB CSS**.

`./scripts/ship.sh "message"` also works and does check → build → commit → push,
but it pushes the *current branch*, so check out `main` first. It clears empty
`index.lock` files itself (lines 100–104) but nothing under `refs/`.

### Do not

- run `wrangler deploy` — Cloudflare builds from the repo
- reset or force-push `main`; never use `--force` or `--no-verify`
- change `wrangler.jsonc`, `package.json`'s build script, or the workflows
- run `npm install` inside the Linux bridge VM — it would replace the Mac's
  darwin binaries and break local builds
- run `npm audit fix --force` (see §8)
- commit anything from `data/dgcis/incoming/` or `data/dgcis/raw/` (both
  gitignored) or `_to_delete/`
- inspect, print or commit `.env`
- attempt any CAPTCHA bypass on the TIA portal

---

## 3. The one unpushed commit — `5698a3c`

**Problem:** 543 tariff-line pages shared **7 titles**. 165 were called
"ELECTRONICS INSTRUMENTS", 97 "ELECTRONICS COMPONENTS". DGCIS files eight coarse
commodity groups and no per-line descriptions, so every HS-8 page was titled
with its bucket.

**Fix:** a stated order of preference, resolved once in
`build_frontend_hs8.py` rather than in three components:

1. **India's own 8-digit schedule** — `config/itc_hs8_names.csv`, columns
   `hs8,description,display_name`. **The file does not exist yet.** It is
   optional by design; the loader returns `{}` when absent.
2. **The heading's authored name** — from `config/fed_sector_definition.csv`
   `display_name`. This is what ships today.
3. **The DGCIS group** — the old behaviour, now last resort.

Each line carries `title`, `nameSource` (`schedule` | `heading` | `group`) and
`headingName` in both `hs6/<code>.json` and `hs8-index.json`. The frontend reads
`title` everywhere — page heading, search results, sibling table — so they
cannot disagree.

**Result: 7 titles → 255, for 543 lines.** All `nameSource: heading`.

The remaining sharing is real — eight lines genuinely sit under "Network
switches and routers" — so the page shows the code prominently, says *"one of 8
lines under HS 851762"*, and carries a footnote: *"named after its heading —
India's eight-digit schedule is not in this build"*. `nameCaveat()` in
`src/lib/dgcis.ts` returns `null` for `nameSource: 'schedule'`, so the footnote
removes itself the day the schedule lands.

**To upgrade:** drop the CSV into `config/`, run
`python3 pipeline/dgcis/build_frontend_hs8.py`, commit. No code change.

---

## 4. Two investigations — conclusions, so they are not redone

### 4a. "Use partner-reported exports as a proxy for missing imports" — REJECTED

Tested three ways against HStat's own snapshot. It fails all three.

| | 2024 | 2025 |
|---|---:|---:|
| world imports held | $4,854bn | $4,649bn (−4%) |
| world exports held | $4,612bn | **$3,419bn (−26%)** |

- **The export side is emptier, not fuller.** Swapping to it means a bigger hole.
- **Why:** the same countries file both sides (97 vs 95 in 2025, ratio ~0.98
  every year). The problem is *which* one is missing — **China, absent from 240
  of 418 products** — and China is the largest electronics *exporter*, so one
  missing filer tears a far bigger hole in exports than imports.
- **Even in a healthy year it is wrong per product.** Back-tested 2023 and 2024
  using the stable 5.5% CIF/FOB wedge: **median error 12–14%**, only 17–22% of
  products within 5%, 90th percentile 43–48%, worst 705%. Aggregates agree only
  because errors cancel across 418 products; individual pages — all anyone reads
  — do not.
- **2026 has nothing on either side** to mirror from.

### 4b. "Use each country's own national statistics" — VIABLE, not built

This is what the DGCIS layer already does for India. The gap is concentrated:

| missing reporter | products affected | prior-year value |
|---|---:|---:|
| **China** | 240 | **$700.6bn** |
| Taiwan ("Other Asia, nes") | 65 | $133.9bn |
| everyone else combined | — | ~$3bn |

China is 84% of the missing $837bn. Confirmed at source via Comtrade's public
availability API: **China's last annual filing is 2024**, released June 2025.
There is no 2025 Chinese data waiting to arrive.

**Do not blend national figures into the world total.** Mixed valuation rules,
currencies and revision cycles produce a number that looks fine and quietly
means something else. Put them *beside* it, labelled, as DGCIS sits beside
Comtrade.

**Free win, no new data:** the snapshot already records who is missing and what
they were worth (`annual[year].global.coverage.missingPriorTop10`). Nothing
shows it. Putting *"China has not filed 2025 — it was $700bn of this last
year"* on affected pages makes those figures honest immediately. Frontend only.

### 4c. Comtrade monthly data exists and is much fresher

Verified via `https://comtradeapi.un.org/public/v1/getDA/C/M/HS` (public, **no
key needed**). Monthly runs to **2026-06**, released August 2026.

Of the 15 largest electronics traders, **9 file monthly through June 2026**:
USA, Germany, Netherlands, Japan, Mexico, Malaysia, UK, India, Hong Kong.
**Absent: China, Korea, Taiwan, Vietnam, Singapore.**

So monthly **cannot** produce a world total — those five are too big. It *can*
support a clearly-labelled "where 2026 is heading, among countries that report
monthly" panel. Directional, never called world trade.

**Both sandboxes are blocked from `comtradeapi.un.org` (proxy 403).** Any fetch
must run in the user's own terminal, where the pipeline already calls Comtrade.

---

## 5. Outstanding work, in the order Aman chose

All six are **unstarted**. Aman selected all of them.

1. **HS-8 report generation.** Tariff-line pages should be capturable into
   PDF/PNG reports the way product pages are. The report machinery
   (`src/lib/report.ts`, `Sidebar.tsx`) captures tiles from a live product page
   and is currently mounted only when `onProduct` is true in `App.tsx`.
2. **Homepage rework.** HS-8 tiles on the front page, plus filling the empty
   left and right columns with recently-moved tariff lines and the reader's
   saved reports. `src/components/HomeView.tsx`.
3. **Help button + navigation guide.** Bottom-right "i" that explains the
   current page and opens a written guide to the whole dashboard. The guide
   itself still has to be written.
4. **Slash-command search.** Normal typing searches codes and products; `/`
   opens actions — jump to a page, build a report, switch flow or currency,
   open the availability page. `src/components/SearchHub.tsx`.
5. **Left quick-navigation rail.** Agreed division: **left = places** (home,
   sections, recent, pinned, tariff lines, availability, guide); **right rail
   stays as tools** (tile arrangement, report builder). Do not merge them.
6. **Comtrade availability page.** Agreed shape: pipeline fetches the public
   `getDA` endpoint into a small JSON, page renders it **joined to our 418
   products** — which of ours each gap affects, plus a "new data has arrived, a
   refresh is due" signal. Aman chose pipeline-refreshed over a Worker proxy.

### Also raised, awaiting a decision

**A Comtrade query page.** Aman asked for a page where a user enters their own
API key and queries run "in the backend". HStat has **no backend** — static
assets on Cloudflare — and the browser cannot call Comtrade directly (CORS;
proven when the Pull Data download returned an unopenable `HS` file). Two
options were put to him and he has not answered:

- **A — query builder, no key.** Compose the call with good UI (commodity
  pickable *by product name* from our 418, which Comtrade's own form cannot do),
  then hand over the Comtrade Plus results URL, the keyless preview URL, and a
  ready-to-run `comtradeapicall` snippet. No backend, no credential handling.
- **B — live execution via a Cloudflare Worker.** Real backend. The key transits
  our Worker on every query, so it must be pass-through only, never logged,
  never stored, never in a URL; the public endpoint becomes an open Comtrade
  proxy needing rate limiting; and it changes `wrangler.jsonc`.

Recommendation on file: build A now, decide B separately.

---

## 6. Things only Aman can do

1. **The August refresh.** Both DGCIS flows still end **2026-06**; July and
   August are published (ministry released August on 16 September).
   ```bash
   .venv/bin/python pipeline/dgcis/refresh_dgcis.py
   ```
   Opens the portal, waits for the CAPTCHA, then validates → processes → builds
   and reports what moved. Export first, then Import. Expect **two** new months;
   the diff says plainly if only one arrived.
2. **The ITC(HS) 8-digit schedule.** DGFT returns 403 to automated fetching and
   both sandboxes are walled off from it. Needs chapters **83, 84, 85, 90, 91**.
   Better alternative: the TIA Data Extraction commodity picker lists HS-8 codes
   *with* DGCIS's own descriptions — grabbing that during the refresh visit
   yields exactly the vocabulary our codes were filed under.
3. **Pushing.** The bridge VM has no GitHub credentials; they live in the Mac
   keychain. Claude can commit but never push.

---

## 7. How to verify anything

```bash
# data
python3 pipeline/dgcis/validate_hs8.py --flow exports    # and imports
python3 pipeline/dgcis/flow_guard.py  --flow exports     # and imports
python3 pipeline/validate_snapshot.py public/data/snapshots/current
python3 pipeline/launch_sanity.py --build-only

# frontend
npm run build
node qa/suite/serve.mjs dist 4178 &
node qa/suite/check.mjs        # 27 — routing, panel, composition, deep links
node qa/suite/search.mjs       # 12 — tariff lines in search
node qa/suite/boundary.mjs     #  7 — forced throw inside the panel
node qa/suite/absence.mjs      #  6 — panel or note, never both, never neither
node qa/suite/postdeploy.mjs   # 100 — flow switching, retired routes, 3 viewports,
                               #       and 7 ways of breaking the payload
node qa/suite/p2check.mjs      # 21 — search-by-product, no-refetch
node qa/suite/exportcheck.mjs  # 21 — downloads the CSV and workbook, reads them back

# additive suite needs a doctored copy
cp -r dist /tmp/t && rm -rf /tmp/t/data/dgcis
node qa/suite/serve.mjs /tmp/t 4184 &
BASE=http://127.0.0.1:4184 node qa/suite/additive.mjs "no dgcis data"   # 8
```

Playwright is deliberately **not** in `package.json` — these are run by a person
before a deploy, and CI would install a browser it never opens. Install with
`npm install --no-save playwright && npx playwright install chromium`. The
scripts use bare `chromium.launch()`; **do not reintroduce OS-specific
executable paths.**

**Two expectations in `postdeploy.mjs` encode findings, not hopes. Do not
"fix" them by loosening:**

- The 375px HS-6 page overflows by 179px and **it is not the DGCIS layer's
  doing** — remove `public/data/dgcis` entirely and it is the same 179px. The
  causes are `.download-master`, `.stack-add` and `.pulldata`, all pre-existing.
  The assertion is narrowed to what this layer owns.
- A product word reaches a tariff line **only through its heading**. DGCIS has
  no product vocabulary and inventing one is not allowed.

---

## 8. Known issues, none blocking

| | severity | note |
|---|---|---|
| `jspdf` critical + `dompurify` moderate | P2 | one semver-major bump to jspdf 4.2.1 fixes both. Reachable only through `reportToPdf`, fed by strings from our own origin. Bump on a branch, then regenerate a PDF **and** a PNG report by hand — there is no test coverage for report generation. |
| `xlsx` high, no npm fix | P2 | SheetJS no longer publishes to npm. Prototype pollution and ReDoS are both in *parsing* untrusted workbooks; HStat only ever writes. Document, or move to `cdn.sheetjs.com`. |
| 375px HS-6 horizontal overflow | P2 | pre-existing, see §7. |
| `data/dgcis/raw/` accumulates identical archives | P2 | 7 files, 2 distinct SHAs — a new timestamped copy is written on every run even when the bytes already exist. Gitignored, so repo-safe. |
| HS-2 arm of the scope rule is dormant | P2 | 530 of 543 lines matched at HS-6, 13 at HS-4 (all retired predecessors), **zero via HS-2**. Harmless today; on a wider extract it would admit whole chapters. Move the rule into config before widening scope. |
| DGCIS absent from JSON/CSV/XLSX exports | fixed | shipped in `75b914c` — there is now an `India HS-8 · DGCIS` sheet and a CSV button on the panel. |
| the null path is untested | P3 | DGCIS writes `0.000`, never blanks — 53,654 true zeros, 0 nulls. The contract is implemented correctly but no real data exercises it. |

---

## 9. Orientation for whoever picks this up

- **The two sources are never mixed, and the code is written to make mixing
  hard.** Separate files, loaders, panels, search groups and visual surfaces. If
  a change would let one be read as the other, it is the wrong change.
- **Where a fact came from matters as much as the fact.** This branch exists
  because one unsourced word — "imports" — propagated through six layers. Prefer
  a check against an outside measurement over a check for internal consistency.
- **The frontend must never be able to subtract.** Every DGCIS surface is
  null-safe, shape-checked (`usable()` in `src/lib/dgcis.ts`) and wrapped in an
  error boundary (`src/components/Safely.tsx`). 202 browser checks exist to
  break it. Keep that property.
- **Read the module docstrings.** `flow_guard.py`, `process_tia_hs8.py`,
  `build_frontend_hs8.py` and `src/lib/dgcis.ts` each open with why they are the
  shape they are, including the mistakes that shaped them.

Fuller background lives in the project docs:
`claude/postdeploy-validation-2026-09-16.md`,
`claude/dgcis-flow-error-and-hs8-level.md`,
`claude/fresher-data-investigation-2026-09-18.md`.
