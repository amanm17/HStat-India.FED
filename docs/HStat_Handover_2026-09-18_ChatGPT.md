# HStat.India — handover for ChatGPT

**Written:** 18 September 2026
**Repo:** `HStat-India-FED-upload` (on Aman's Mac, `~/Documents/Personal Project/`)
**Live:** Cloudflare Workers Static Assets. Deploy = push to `main`. Nothing else.
**Supersedes:** `docs/HStat_Handover_2026-09-18.md` (earlier the same day, before the
feature round landed).

Read sections 1, 2 and 12 first. They are the ones that will cost you time if you
skip them.

---

## 1. Where things stand in one paragraph

The dashboard is a UN Comtrade electronics trade site for MeitY, with India's own
DGCIS eight-digit tariff-line data layered beside it — never merged into it. The
DGCIS layer is complete for both flows and 543 tariff lines under 255 headings,
monthly from 2019-01 to 2026-06. This round added a left navigation rail, a slash
command palette, a help button, a written guide, a tariff-line index, PDF reports
for tariff lines, two front-page panels, and two new pages (`/availability`,
`/query`). 483 automated checks pass. **Three commits are sitting locally, unpushed.
The site will not change until someone pushes.**

---

## 2. Git state — read before touching anything

```
origin/main   5698a3c   A tariff line is no longer titled with its bucket   ← what is live
main          (HEAD)    Three handover notes, ...                           ← local HEAD
```

Three commits ahead:

| commit | subject | what it is |
|---|---|---|
| `0afb766` | Places on the left, commands behind a slash, and a door to the tariff lines | nav rail, slash palette, `/tariff-lines`, `/guide`, naming rework in `build_frontend_hs8.py` + all 255 regenerated payloads |
| `c9d64e7` | A question mark in the corner, a report for a tariff line, and two pages about the source itself | help button, HS-8 PDF reports, front-page panels, `/availability`, `/query`, visual fixes, two new QA suites |
| *(HEAD)* | Three handover notes, so the next person does not rediscover the lock trap | `docs/` — including this file |

Working tree is clean.

**To ship:**

```bash
cd ~/Documents/Personal\ Project/HStat-India-FED-upload
npm run build          # must be clean
git push origin main   # this is the deploy
```

### 2.1 The git lock trap — this has bitten twice, both times expensively

When Claude works on this repo it does so through a Linux VM that mounts the
folder. **That mount cannot delete files.** Git creates `.git/index.lock`,
`.git/HEAD.lock`, `.git/refs/heads/main.lock` and `.git/objects/*/tmp_obj_*`
during normal operation and then unlinks them. On this mount the unlink fails,
the lock survives, and the *next* git command fails — or worse, half-succeeds.

What went wrong before, so it is not repeated:

1. A stale `.git/index.lock` made a `git checkout` fail. The failure was not
   noticed, the next `git merge` merged a branch into itself, and a push shipped
   the wrong commit.
2. A later sweep cleaned `.git/*.lock` but **not** `.git/refs/`. A stale
   `.git/refs/heads/main.lock` produced a half-applied fast-forward.

**Rules:**

- Sweep recursively, never just the top level:
  `find .git -name '*.lock'` — and on the Mac, `-delete` works fine.
- Only after confirming no live git process (`pgrep -fl git`).
- **After every write, verify the pointer actually moved** (`git log --oneline -1`)
  before pushing. Do not assume a command succeeded because it printed nothing.
- `.git/objects/*/tmp_obj_*` leftovers are harmless junk but accumulate. Clean
  them on the Mac with `git gc` when convenient.

### 2.2 Housekeeping the Mac needs

`_to_delete/` in the repo root now holds ~110 zero-byte stale lock files, a
superseded `HomeView.statfix.tsx`, and `hstat-sync-2026-09-18.tgz` (the transfer
bundle used to move this round's source into the repo). It is gitignored.
**Delete the whole folder** — nothing in it is needed.

---

## 3. The routes

Seven, all deep-linkable, all rendered client-side from a static build.

| path | page | notes |
|---|---|---|
| `/` | front page | tiles, saved reports panel, tariff-line panels |
| `/hs/<2\|4\|6 digits>` | product page | Comtrade world trade + DGCIS panel for India |
| `/hs/<8 digits>` | tariff line | DGCIS only. Titled by code — see §4 |
| `/tariff-lines` | index of all 543 lines | grouped by heading, largest first, filterable |
| `/guide` | written guide | what each number means and what it does not |
| `/availability` | what Comtrade holds | **empty until a command is run — see §7** |
| `/query` | Comtrade query builder | composes URLs and a snippet. No key — see §8 |

The left rail (`NavRail.tsx`) persists open/collapsed in `localStorage` under
`hstat.nav.open`. The slash palette lives in `SearchHub.tsx`; typing `/` opens it.
The help button (`HelpButton.tsx`) is the "i" bottom-right and carries a
page-specific topic on all seven pages — each with a **"Watch out"** naming a
misreading that has actually happened in review (crore read as million, calendar
year read as financial year, a partner-World total called world trade).

---

## 4. The naming rule — do not "improve" this without reading it

This was reworked twice and the second rework is the one that is right.

- **v0:** 543 tariff-line pages were titled from a vocabulary of seven DGCIS
  commodity groups. Hundreds of pages called "ELECTRONICS COMPONENTS".
- **v1:** substituted the parent heading's authored name. 7 titles became 255 —
  better, still wrong: 29 lines were all called "Electrical machines, other".
  The repetition moved; it did not go away.
- **v2 (current, correct):** a tariff line's name *is* its code. `85437099` is how
  customs files it, how a trader quotes it, and how MeitY will ask about it. It is
  unique by construction, which no borrowed word can be.

`title_for()` in `pipeline/dgcis/build_frontend_hs8.py` therefore returns a title
**only** when one genuinely names that line:

1. India's own eight-digit schedule, if `config/itc_hs8_names.csv` exists.
2. Otherwise nothing — the frontend leads with the code.

`headingName` is emitted separately and always, so a page can say "one of 29 lines
under HS 854370 — Electrical machines, other" without implying that phrase
identifies the line in front of you. `nameCaveat()` and `lineRef()` in
`src/lib/dgcis.ts` enforce that a borrowed name never leaves the app — including
in CSV and Excel exports — without its caveat. `qa/suite/exportcheck.mjs` asserts
this.

### How to upgrade every title at once

Get the ITC(HS) eight-digit schedule (DGFT publishes it; it refuses automated
download, so a human has to fetch it), write it to `config/itc_hs8_names.csv` with
columns `hs8,description,display_name`, and rebuild:

```bash
python3 pipeline/dgcis/build_frontend_hs8.py
```

Every line that has a real description gets one. Nothing else changes.
**Do not fabricate HS-8 descriptions to fill this file.**

---

## 5. The flow guard — the defining error of this project

DGCIS extracts arrive with no flow column. An entire dataset was once labelled
"imports" when it was exports. The figures looked completely plausible.

Fix, all three parts, all still in place:

- `--flow` is a **required** argument on `pipeline/dgcis/process_tia_hs8.py`.
  There is no default.
- `pipeline/dgcis/flow_guard.py` compares DGCIS annual HS-6 totals against
  Comtrade's India figures in log space. It needs 30 matched pairs, a 0.70 share
  and 1.5 separation to speak at all; it exits 0 when it agrees or abstains and
  **2 when it disagrees**. It runs *before* anything is written.
- Columns are named for their unit and flow: `value_inr_crore`,
  `value_usd_million`, plus a `flow` column. Outputs are per flow:
  `india_hs8_monthly_<flow>.csv`, `hs8_scope_<flow>.csv`, `manifest_<flow>.json`.

Evidence that settled it: 1,471 of 1,487 matched pairs favoured exports.

**There is no `--force-flow` bypass and none must be added.** If the guard
disagrees, the extract is mislabelled — fix the label, not the guard.

---

## 6. The monthly DGCIS refresh

The TIA portal is CAPTCHA-gated, so the extract is downloaded by hand. No CAPTCHA
bypass exists here and none should be built.

```bash
# 1. human downloads the monthly extract from trade-analytics.commerce.gov.in
#    into data/dgcis/raw/
# 2. per flow, guard runs first and will refuse a mislabelled file:
python3 pipeline/dgcis/process_tia_hs8.py --flow exports
python3 pipeline/dgcis/process_tia_hs8.py --flow imports
# 3. rebuild the payloads the site reads:
python3 pipeline/dgcis/build_frontend_hs8.py
# 4. verify, build, push:
python3 pipeline/dgcis/validate_hs8.py
npm run build && git push origin main
```

`build_frontend_hs8.py` has a `prune()` step that **fails the build** if it cannot
remove a stale payload. That is deliberate: a leftover file from a previous
vintage is a page showing last month's numbers under this month's date.

Current data ends **2026-06**. August's extract has not been pulled yet.

---

## 7. `/availability` — why it says "Not fetched yet"

The page mirrors what `comtradeplus.un.org/Visualization/DADashboard` shows, then
does the thing that page cannot: joins it to our own 418 products, so the question
becomes "which of our pages are thin, and why".

It reads `public/data/availability.json`. **That file does not exist yet.** The
page renders an honest empty state and prints the command:

```bash
python3 pipeline/comtrade/fetch_availability.py      # or --offline to reuse a prior fetch
```

The endpoint is `https://comtradeapi.un.org/public/v1/getDA/C/{A|M}/HS` — open, no
subscription key, the same tier the Pull Data links use.

Two things to know:

- **The browser does not fetch it.** Comtrade refuses cross-origin calls (that is
  what broke the first Pull Data download), and a dashboard that phones a third
  party on every page load inherits that party's uptime. So the pipeline fetches,
  the result is committed as a small file, and the page reads it like every other
  number here.
- **The script has never been run successfully.** Both sandboxes available during
  development were blocked by the outbound proxy (403). It needs to run from a
  machine with plain internet access — Aman's Mac will do.

There is a fixture of this page in a throwaway directory used for screenshots.
**It must never be committed to `public/`.** No synthetic production data.

---

## 8. `/query` — the deliberate absence of a key

The brief was "a page where the user puts their Comtrade key and the calling
function runs in the backend". That was built the other way, on purpose:

- There is no backend. This is a static site on Workers Static Assets. A key typed
  into it would either sit in the bundle or need a server that does not exist.
- Everything this dashboard answers is answerable on the keyless public tier.

So `/query` composes three things and hands them over: the Comtrade **page URL**
(opens their site, which is what users actually wanted — the earlier links
downloaded a strange file instead), the **keyless preview URL**
(`/public/v1/preview/...`), and a **`comtradeapicall` Python snippet** for someone
who does have a key and wants to run it locally.

The page states this reasoning in plain language. If a backend is ever added, this
is the page to revisit — not before.

Comtrade call conventions used throughout, keep them pinned:
`partner2Code=0`, `customsCode=C00`, `motCode=0`; flows `M`/`RM`/`X`/`RX`.

---

## 9. Filling the missing recent Comtrade data — settled, do not redo

A reviewer suggested proxying missing import data from partner-reported exports
("mirror data"). **This was tested against the live snapshot and rejected.** The
full working is in the project doc `claude/fresher-data-investigation-2026-09-18.md`.
Summary so nobody repeats the experiment:

- The export side is **emptier**, not fuller: 2024→2025 world imports fell 4%,
  world exports fell **26%**.
- The reason is one filer: **China is absent from 240 of our 418 products**, and
  China is the largest *exporter* of electronics.
- Even in healthy years it is wrong product by product. Back-test on 2023/2024:
  median error per product **12.5% / 14.3%**; only 22% / 17% of products predicted
  within 5%; worst product 166% / 705% out. Totals agree only because errors
  cancel across products, and no page shows a total across all 418.
- For 2026 there is nothing to mirror from — both sides are empty.

**What is viable instead:** national sources, beside the world figure, never
blended into it. China alone is **$700.6bn of the ~$837bn missing**; Taiwan
("Other Asia, nes") another $133.9bn; everyone else ~$3bn combined. That is the
same pattern the DGCIS layer already proves works for India.

**Cheapest honest step, no new data at all:** the snapshot already records who is
missing and what they were worth. Saying so on the affected pages — "China has not
yet filed; it was $700bn of this last year" — makes 2025 useful immediately. This
is frontend-only and is **not yet done**; `/availability` is the groundwork for it.

Whatever is added: never blend valuation bases, currencies, revision cycles or
classification vintages into one number. That is the same class of mistake as the
flow error — a figure that looks fine and quietly means something else.

---

## 10. What is verified, and how to re-verify it

483 automated checks pass against a fresh production build. They need `playwright`
(deliberately not in `package.json` — these run before a deploy, not in CI).

```bash
npm run build
node qa/suite/serve.mjs dist 4178 &

node qa/suite/check.mjs         #  27  routing, panel, composition, deep links
node qa/suite/search.mjs        #  12  tariff lines in search
node qa/suite/boundary.mjs      #   7  a forced throw inside the panel
node qa/suite/absence.mjs       #   6  panel or note, never both, never neither
node qa/suite/postdeploy.mjs    # 100  two-flow switching against ground truth,
                                #      retired/predecessor routes, malformed payloads
node qa/suite/p2check.mjs       #  21  what a second page load refetches
node qa/suite/exportcheck.mjs   #  21  CSV/workbook contents and the name caveat
node qa/suite/navcheck.mjs      #  34  rail, palette, deep links, guide
node qa/suite/featurecheck.mjs  #  49  help button, HS-8 report, panels, new routes
node qa/suite/visual.mjs        # 198  7 pages x 3 widths x 2 themes
```

Plus the additive suite, which runs against a **doctored** copy of `dist`:

```bash
cp -r dist /tmp/t && rm -rf /tmp/t/data/dgcis
node qa/suite/serve.mjs /tmp/t 4184 &
BASE=http://127.0.0.1:4184 node qa/suite/additive.mjs "no dgcis data"   # 8
```

### The additive guarantee

The DGCIS layer is an addition, and **an addition must never be able to subtract**.
Three mechanisms, all tested by breaking them seven different ways:

1. `usable()` in `src/lib/dgcis.ts` — a shape guard; a malformed payload is treated
   as absent, not rendered.
2. `Safely.tsx` — an error boundary around every DGCIS surface.
3. Fetches are gated on the index, so a heading with no coverage never requests a
   file that is not there.

`postdeploy.mjs` covers the malformed matrix: missing index, corrupt index, missing
parent, malformed parent, previous shape, one flow absent, both absent.

### The visual suite is new and worth keeping

`visual.mjs` measures three things a screenshot review misses: elements that
overlap, overflow that cannot be scrolled to, and text clipped by its own box. It
found the slash palette's overlap (a three-child row still laid out on the
four-column grid it no longer had children for), tables running off 375px, and
`.head-actions` / `.panelhead` buttons cutting in half. All fixed.

All seven routes now measure **zero horizontal overflow at 375, 768 and 1440** —
including the HS-6 page, which previously carried 179px of it. (The commit message
for `c9d64e7` says "six routes"; it is seven. `/availability` was measured in its
empty state.)

**Run `visual.mjs` before any deploy that touches `styles.css`.**

---

## 11. What is *not* verified

Be honest about these — they are the gaps a reader of this document should know:

| thing | state |
|---|---|
| `fetch_availability.py` against the live endpoint | **never run.** Blocked by proxy in both dev sandboxes. Offline path untested against real data. |
| `/availability` with real data | only its empty state and a local fixture have been seen |
| August 2026 DGCIS extract | not pulled; data ends 2026-06 |
| `config/itc_hs8_names.csv` | does not exist; all 543 lines currently title by code |
| Anything on the live site | last deploy is `5698a3c`. Everything above is local. |

---

## 12. Hard rules — these are not preferences

Carried from the user and from earlier documents. Several exist because something
already went wrong.

**Data integrity**

- No synthetic or placeholder production data. Ever. Fixtures live outside
  `public/` and are gitignored.
- Do not interpolate or invent missing FX data.
- Do not fabricate HS-8 descriptions.
- Do not numerically merge Comtrade and DGCIS figures.
- Do not call a DGCIS partner-World total "world trade".
- INR crore and USD million are both filed by DGCIS. Never convert between them.
- Indian financial year (April–March) is not Comtrade's calendar year. Every block
  says which it is on.
- A non-zero residual under an obsolete Comtrade legacy code is **not**
  automatically a valid continuous global series.

**Process**

- Do not weaken QA to make data publish. Do not bypass QA hooks.
- Preserve the current CAUTION publication logic.
- No `--force`, no `--no-verify`, no destructive git shortcuts.
- Do not reset `main` or discard validated data-refresh commits.
- Do not change `wrangler.jsonc`, the `package.json` build script, or the GitHub
  deployment workflow unless clearly necessary.
- Do not run `wrangler deploy` by hand. Push is the deploy.
- Do not run `npm audit fix --force`.
- Do not inspect, print, `cat`, commit or otherwise expose `.env`.
- Do not commit unrelated local artifacts, docs or secrets.
- No CAPTCHA bypass.
- Do not expand FED scope without explicit approval.

---

## 13. What to do next, in order

1. **Push.** `npm run build && git push origin main`. Three commits of finished,
   tested work are doing nothing until this happens.
2. **Run `fetch_availability.py`** on a machine with open internet, commit
   `public/data/availability.json`, push. `/availability` becomes real.
3. **Delete `_to_delete/`** from the repo folder.
4. **Pull the August DGCIS extract** and run the §6 refresh.
5. **Get the ITC(HS) 8-digit schedule** from DGFT into
   `config/itc_hs8_names.csv` and rebuild. This is the single biggest quality
   improvement still available — it turns 543 code-titled pages into named ones.
6. **Show who has not filed** on affected product pages (§9, "cheapest honest
   step"). Frontend only, no new data, makes 2025 usable.

---

## 14. Orientation for someone new to the code

```
src/
  App.tsx                 routing, snapshot loading, workspace state
  components/
    NavRail.tsx           left rail
    SearchHub.tsx         search + slash command palette
    HelpButton.tsx        the "i", one HelpTopic per page
    Hs8View.tsx           tariff-line page (tile ids drive PDF capture)
    TariffLines.tsx       /tariff-lines
    Guide.tsx             /guide
    Availability.tsx      /availability
    QueryBuilder.tsx      /query
    HomeTariffLines.tsx   front-page panels
    Safely.tsx            error boundary
  lib/
    dgcis.ts              DGCIS loading, shape guard, name caveats, exports
    availability.ts       availability.json types + loader
    comtrade.ts           flow types, URL composition
    workspace.ts          pins, history, saved reports (levels 2/4/6/8)
pipeline/
  dgcis/                  flow_guard, process_tia_hs8, build_frontend_hs8, validate_hs8
  comtrade/               fetch_availability.py
qa/suite/                 11 suites + serve.mjs; README.md documents each
public/data/dgcis/        manifest.json, hs8-index.json, hs6/<code>.json (255 files)
```

Data shape: `public/data/dgcis/manifest.json` carries every line with `hs8`, `hs6`,
`title` (often empty by design), `nameSource`, `headingName`, and per-flow latest
period and trailing-12-month values. Current build: **255 headings, 543 lines,
both flows, 2019-01 → 2026-06.**
