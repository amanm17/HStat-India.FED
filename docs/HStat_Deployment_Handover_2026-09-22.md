# HStat.India — deployment handover

**For:** ChatGPT, taking this to production
**Written:** 22 September 2026
**Repo:** `HStat-India-FED-upload` — `~/Documents/Personal Project/` on Aman's Mac
**Live host:** Cloudflare Pages, building this repository on push to `main`

---

## 1. Where things stand

Four commits are finished, tested and **unpushed**. The working tree is clean.
Nothing else stands between the current code and production.

```
origin/main   17368b1   Ignore local Comtrade cache          ← what is live now
main          a897e29   Four files of copy the last commit…  ← local HEAD
```

**570 automated checks pass** against exactly this tree, verified this morning
after rebuilding from a clean `tsc -b --force`. The breakdown is in §3.

---

## 2. The deploy

Cloudflare builds on push. There is no deploy command, and `wrangler deploy`
must not be run by hand.

```bash
cd ~/Documents/Personal\ Project/HStat-India-FED-upload

# 1. the gates GitHub Actions will run anyway, run first so a failure is local
./scripts/validate.sh          # validate_snapshot + launch_sanity
npm run build                  # tsc -b && vite build — must be clean

# 2. optional but recommended before a release this size — see §3
#    (needs playwright, which is deliberately not in package.json)

# 3. ship
git push origin main
```

`.github/workflows/qa.yml` then runs snapshot QA, launch sanity and the same
`npm run build` on the push. `deploy-cloudflare.yml` is a deliberate no-op —
deployment is Cloudflare Pages watching the repository, not that workflow.

`wrangler.jsonc` is already correct and must not be edited:

```jsonc
{ "assets": { "directory": "./dist", "not_found_handling": "single-page-application" } }
```

---

## 3. Pre-flight: the browser suites

Twelve suites, 570 checks. They need `playwright` and **three servers**,
because three states of the data have to be true at once.

```bash
npm run build

cp -r dist /tmp/bare    && rm -f  /tmp/bare/data/availability.json
cp -r dist /tmp/nodgcis && rm -rf /tmp/nodgcis/data/dgcis

node qa/suite/serve.mjs dist         4178 &   # the real build
node qa/suite/serve.mjs /tmp/bare    4179 &   # availability.json absent
node qa/suite/serve.mjs /tmp/nodgcis 4184 &   # the whole DGCIS layer absent

node qa/suite/check.mjs        #  27  routing, panel, composition, deep links
node qa/suite/search.mjs       #  12  tariff lines in search
node qa/suite/boundary.mjs     #   7  a forced throw inside the panel
node qa/suite/absence.mjs      #   6  panel or note, never both, never neither
node qa/suite/postdeploy.mjs   # 100  two flows against ground truth, retired
                               #      routes, the malformed-payload matrix
node qa/suite/p2check.mjs      #  21  what a second page load refetches
node qa/suite/exportcheck.mjs  #  21  CSV/workbook contents, the name caveat
node qa/suite/navcheck.mjs     #  37  rail, palette, deep links, naming
node qa/suite/featurecheck.mjs #  49  help card, HS-8 report, the new routes
node qa/suite/align.mjs        #  84  edges, rhythm, row gaps, number columns
node qa/suite/visual.mjs       # 198  7 pages × 3 widths × 2 themes

BASE=http://127.0.0.1:4184 node qa/suite/additive.mjs "no dgcis data"   # 8
```

**Do not weaken any of these to make a push go through.** Two in particular
encode findings rather than hopes:

- `postdeploy.mjs` asserts the DGCIS layer contributes **zero** horizontal
  overflow at 375px. It caught a regression in this very release (see §5).
- `navcheck.mjs` asserts `85079020` still titles by its code. That is a line
  India's schedule has no name for, and the whole naming rule exists for it.

---

## 4. What the four commits contain

| commit | subject | substance |
|---|---|---|
| `beac9b9` | 543 tariff lines stop being called by their heading | `config/itc_hs8_names.csv` + all 255 regenerated payloads |
| `12f2da6` | A guide with chapters, a help card that can see the page… | the feature round: 20 source files, `public/img/guide/` |
| `b3cdff5` | Recapture the guide's pictures after the fixes they were taken before | 6 screenshots |
| `a897e29` | Four files of copy the last commit described but did not carry | the gap found this morning (§5) |

### What a user will notice

**Tariff lines have real names.** 516 of 543 now carry a name from India's own
eight-digit schedule, built from the DGCIS QE/PC-to-ITC(HS) mapping for
2025-26. HS 854370's twenty-nine lines were all titled "Electrical machines,
other"; they are now metal detectors, mine detectors, digital reverberators,
video matting machines and twenty-five others. No name repeats inside a
heading. The 27 unmatched keep their code as their identity — 25 of them
stopped being filed against in 2021-23 and are codes the schedule has since
dropped, and two (`85079020`, `85291093`) are live but simply absent from the
mapping. **Nothing was invented for any of them, and nothing should be.**

**The help button knows what is on the page.** It used to be written from the
route, so it could only repeat the heading back. A page now publishes its own
code, figures and panel list through `src/lib/pagehelp.tsx`; the card merges
that over the route's prose. On a tariff line it shows the latest month, the
last twelve, the share of its heading and its rank among siblings; on a
product, the world figure, how many economies filed, and how many of last
year's top ten have not.

**The front page's "top-ten buyer" panel** sorted by rank and printed "1st" six
times — India leads seven of these lines, so rank could not separate the six on
screen. It sorts by share now, rank reads as a phrase in the caption, and the
count is stated once in the panel head.

**A ten-chapter guide** at `/guide`, with a contents list and twenty captures
of the real pages in both themes. Its counts are read from the same files the
dashboard reads, so they cannot silently go stale.

**Search left the left rail.** It is in the header on every page and on the
slash key everywhere; a third door was one too many.

---

## 5. Five things that will bite, in order of cost

### 5.1 The git lock trap — this has caused a wrong deploy twice

When Claude works on this repo it does so through a Linux VM mounting the
folder, and **that mount cannot unlink files**. Git creates `.git/index.lock`,
`.git/HEAD.lock`, `.git/refs/heads/main.lock` and `.git/objects/*/tmp_obj_*`
and then removes them; here the removal fails and the lock survives, so the
*next* git command fails — or half-succeeds, which is worse.

What went wrong before:

1. A stale `.git/index.lock` made a `git checkout` fail. The failure went
   unnoticed, the next `git merge` merged a branch into itself, and a push
   shipped the wrong commit.
2. A later sweep cleaned `.git/*.lock` but not `.git/refs/`. A stale
   `.git/refs/heads/main.lock` produced a half-applied fast-forward.

**On the Mac this does not happen** — deletes work there normally. It only
affects work done through the bridge. If you see it:

```bash
pgrep -fl git                     # confirm nothing is running first
find .git -name '*.lock' -delete  # recursive, not just the top level
git log --oneline -1              # verify the pointer actually moved
```

### 5.2 An asset folder must never shadow a route

The guide's screenshots were first written to `public/guide/`. That put a
directory at `/guide`, **which is a route**, and a static-asset host resolves
the directory before falling back to `index.html`. The guide page 404'd.

They live at `public/img/guide/` now. The route namespace to stay out of is
`/`, `/hs/*`, `/tariff-lines`, `/guide`, `/availability`, `/query`.

### 5.3 The guide's screenshots go stale silently

They are captures of the real pages. A CSS change moves the page and leaves
the picture behind, looking perfectly fine. This already happened once inside
this release and needed commit `b3cdff5`.

**After any change to `src/styles.css`:**

```bash
npm run build && node qa/suite/serve.mjs dist 4178 &
node qa/guide-shots.mjs      # 20 captures, both themes, into public/img/guide
```

### 5.4 `minmax()` in an `auto-fit` grid overflows narrow viewports

Widening the front page's two panels to `minmax(460px, 1fr)` made the page
scroll sideways at 375px — `auto-fit` still lays down a 460px track in a 375px
container. The fix is `minmax(min(460px, 100%), 1fr)`, and `postdeploy.mjs`
caught it within one run. Any new grid with a min above ~320px needs the
`min()`.

### 5.5 A bundle assembled by hand will miss files

The last commit before this one described copy edits to fourteen files and
carried ten. `featurecheck.mjs` was left asserting a heading that was not in
the committed source, so `HEAD` held a test that could not pass against a
build of `HEAD`.

It was found by hashing the whole working tree against the container the code
was authored in, not by reading the diff. **Do that before any release:**

```bash
find src qa/suite -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \
  -o -name '*.mjs' -o -name '*.md' \) | sort | xargs md5sum | md5sum
```

---

## 6. Data: what is current, and how to refresh it

| layer | currency | refreshed by |
|---|---|---|
| Comtrade snapshot | built 2026-09-14 | `scripts/refresh-monthly.sh` / the monthly workflow |
| DGCIS tariff lines | monthly to **2026-06** | §6.1, by hand through a CAPTCHA |
| Comtrade availability | fetched **2026-09-18** | §6.2 |
| ITC(HS) names | mapping for **2025-26** | §6.3 |

**The availability page says a refresh is due.** Comtrade released data on
2026-09-18, after the snapshot was built on 09-14, and nine of the forty
missing filers have filed since. Running the monthly refresh before or soon
after this deploy would land it on fresher numbers.

### 6.1 The monthly DGCIS refresh

The TIA portal is CAPTCHA-gated, so the extract is downloaded by hand. **No
CAPTCHA bypass exists here and none should be built.**

```bash
# 1. download the monthly extract into data/dgcis/raw/
# 2. per flow — the guard runs first and refuses a mislabelled file
python3 pipeline/dgcis/process_tia_hs8.py --flow exports
python3 pipeline/dgcis/process_tia_hs8.py --flow imports
# 3. rebuild what the site reads
python3 pipeline/dgcis/build_frontend_hs8.py
# 4. verify, build, push
python3 pipeline/dgcis/validate_hs8.py
npm run build && git push origin main
```

`build_frontend_hs8.py` **fails the build** if it cannot remove a stale
payload. That is deliberate: a leftover file from a previous vintage is a page
showing last month's numbers under this month's date.

### 6.2 Availability

```bash
python3 pipeline/comtrade/fetch_availability.py     # --offline reuses a prior fetch
git add public/data/availability.json
```

Public `getDA` endpoint, no subscription key. The browser does not fetch it:
Comtrade refuses cross-origin calls, and a page that phones a third party on
every load inherits its downtime.

### 6.3 Tariff-line names

Drop a newer mapping into `config/itc_hs8_names.csv` (`hs8,description,
display_name`) and rebuild with `build_frontend_hs8.py`. `nameSource` in
`hs8-index.json` reports `schedule` or `none` per line, so coverage is
checkable at a glance. **Do not fabricate descriptions to fill it.**

---

## 7. The flow guard — the defining error of this project

DGCIS extracts arrive with no flow column. An entire dataset was once labelled
"imports" when it was exports, and the figures looked completely plausible.

- `--flow` is **required** on `process_tia_hs8.py`. There is no default.
- `pipeline/dgcis/flow_guard.py` compares DGCIS annual HS-6 totals against
  Comtrade's India figures in log space. It needs 30 matched pairs, a 0.70
  share and 1.5 separation to speak at all; exit 0 when it agrees or abstains,
  **exit 2 when it disagrees**. It runs before anything is written.
- Columns are named for unit and flow: `value_inr_crore`, `value_usd_million`,
  plus a `flow` column.

Evidence that settled it: 1,471 of 1,487 matched pairs favoured exports.
**There is no `--force-flow` bypass and none must be added.** If the guard
disagrees, the extract is mislabelled — fix the label, not the guard.

---

## 8. Hard rules

Several exist because something already went wrong.

**Data**

- No synthetic or placeholder production data, ever. Fixtures live outside
  `public/` and are gitignored.
- Do not interpolate or invent missing FX data.
- Do not fabricate HS-8 descriptions.
- Do not numerically merge Comtrade and DGCIS figures.
- Do not call a DGCIS partner-World total "world trade".
- INR crore and USD million are both filed by DGCIS. Never convert between
  them; neither can derive an exchange rate from the other.
- The Indian financial year (April–March) is not Comtrade's calendar year.
- A non-zero residual under an obsolete Comtrade legacy code is **not**
  automatically a valid continuous global series.

**Process**

- Do not weaken QA to make data publish. Do not bypass QA hooks.
- Preserve the current CAUTION publication logic.
- No `--force`, no `--no-verify`, no destructive git shortcuts.
- Do not reset `main` or discard validated data-refresh commits.
- Do not change `wrangler.jsonc`, the `package.json` build script, or the
  deployment workflow unless clearly necessary.
- Never run `wrangler deploy` by hand. Push is the deploy.
- Do not run `npm audit fix --force`.
- Do not inspect, print, `cat`, commit or expose `.env`.
- No CAPTCHA bypass.
- Do not expand FED scope without explicit approval.

---

## 9. After the push

Cloudflare builds and publishes within a few minutes. Check, in this order:

1. **`/guide` loads.** This is the route that the asset-folder collision would
   break, and it is the one thing that behaved differently in dev than it would
   in production. Confirm the screenshots render, in both themes.
2. **A tariff line shows a name.** Open `/hs/85176290` — it should read
   "Switching and routing, other", with the code beside it, not as the title.
3. **`/hs/85079020` shows the code as its title**, with the caveat explaining
   why. That is the abstention path working.
4. **The front page's share panel** shows varying percentages and varying
   ranks, not six "1st"s.
5. **`/availability` renders real data** — it should say a refresh is due.
6. **375px.** Open the front page narrow and confirm no sideways scroll.

`scripts/audit-live-vs-repo.sh` compares what is live against the repository
if anything looks off.

---

## 10. Still open

| item | state |
|---|---|
| Push these four commits | **the only thing between this work and production** |
| Monthly refresh | due — Comtrade released after the snapshot was built |
| August/September DGCIS extract | not pulled; tariff data ends 2026-06 |
| 27 unnamed tariff lines | 25 are retired codes; 2 are live and absent from the mapping |
| "Who has not filed" on product pages | recommended, not built — frontend only, no new data (see `claude/fresher-data-investigation-2026-09-18.md`) |
| Mirror data from partner exports | **tested and rejected**; do not revisit without reading that doc |

---

## 11. Orientation

```
src/
  App.tsx                 routing, snapshot loading, workspace state
  components/
    NavRail.tsx           left rail (no search — by design)
    SearchHub.tsx         search + slash command palette
    HelpButton.tsx        the "i"; renders what lib/pagehelp publishes
    Hs8View.tsx           tariff-line page
    TariffLines.tsx       /tariff-lines
    Guide.tsx             /guide — ten chapters, live counts
    Availability.tsx      /availability
    QueryBuilder.tsx      /query — deliberately takes no key
    HomeTariffLines.tsx   front-page panels
    Safely.tsx            error boundary around every DGCIS surface
  lib/
    pagehelp.tsx          how a page tells the help card what it is showing
    dgcis.ts              DGCIS loading, shape guard, name caveats, exports
    availability.ts       availability.json types + loader
    workspace.ts          pins, history, saved reports (levels 2/4/6/8)
pipeline/
  dgcis/                  flow_guard, process_tia_hs8, build_frontend_hs8
  comtrade/               fetch_availability.py
qa/
  suite/                  12 suites + serve.mjs; README.md documents each
  guide-shots.mjs         regenerates the guide's screenshots
config/itc_hs8_names.csv  516 authored names + their verbatim source text
public/img/guide/         20 captures — NOT public/guide (see §5.2)
```

**The additive guarantee.** The DGCIS layer is an addition, and an addition
must never be able to subtract. Three mechanisms, all tested by breaking them:
`usable()` in `dgcis.ts` treats a malformed payload as absent rather than
rendering it; `Safely.tsx` wraps every DGCIS surface; fetches are gated on the
index so a heading with no coverage never requests a file that is not there.
`additive.mjs` and the malformed-payload matrix in `postdeploy.mjs` are what
keep that true.

Current data: **255 headings, 543 tariff lines, 516 named, both flows,
2019-01 → 2026-06.**
