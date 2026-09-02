# HStat.India — handover for a terminal assistant

Paste everything below this line into ChatGPT as the opening message.

---

You are helping me run and update a repository from my terminal. I run macOS
with zsh. I will paste your commands verbatim, so give me copy-pasteable
blocks, one logical step per block, no interactive prompts, and no commands
that need me to edit a file by hand unless you give me the full replacement
content.

## The project

**HStat.India** — a trade-statistics dashboard built for MeitY. It reads UN
Comtrade data for a defined universe of 549 HS codes (418 HS-6 products, 106
HS-4 and 20 HS-2 parents) and publishes global trade, India's position, and
partner breakdowns.

- Repo folder: `/Users/amanmishra/Documents/Personal Project/HStat-India-FED-upload`
- Remote: `https://github.com/amanm17/HStat-India.FED.git`
- Branch: `main`
- Live site: **https://hstat-india.aman17-dps.workers.dev**

## How deployment works — do not change this

Cloudflare builds this repository itself on every push to `main` and serves the
result. It runs `npm run build` (which is `tsc -b && vite build`) and publishes
`dist/`. Nothing in the repo deploys anything; there is no deploy command for
me to run.

**Constraints that follow from that — treat these as hard rules:**

- Do not modify `package.json`'s `build` script. Cloudflare runs it.
- Do not modify `wrangler.jsonc`, and do not suggest `wrangler deploy`.
- Do not add, remove or rename anything in `.github/workflows/` except as
  described below.
- `.github/workflows/deploy-cloudflare.yml` is a deliberate no-op stub. Leave
  it alone.
- Never read, print, echo, cat or commit `.env`. It holds a Comtrade API key.
  It is gitignored and must stay that way. The GitHub Actions secret is called
  `COMTRADE_API_KEY` and is already set.

## Environment facts

- Python: the repo carries its own virtualenv at `.venv` (Python 3.13, created
  from Anaconda) with `pandas`, `pyarrow`, `openpyxl`, `comtradeapicall`,
  `requests` and `python-dotenv` installed.
  **The venv was created under a different folder path, so `source
  .venv/bin/activate` sets a stale `VIRTUAL_ENV`. Call `.venv/bin/python`
  directly instead.** The system `python3` is Anaconda base and does not
  reliably have these packages.

  `.venv/bin/python` is a symlink into `/opt/anaconda3`. If Anaconda has been
  moved or removed the symlink dangles and the venv is unusable. `ship.sh`
  checks for this and tells me to rebuild it with:

  ```
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
  ```
- Node 22 / npm 10, and `node_modules/` is already installed.
- Requirements file: `requirements.txt`.

## Known gotcha — stale git lock

I sometimes work on this repo through the Claude desktop bridge, which can
leave an **empty** `.git/index.lock` behind. Git then refuses to write the
index, with an error that does not explain why. If any git command fails with
a lock or index error, the fix is:

```
rm -f .git/index.lock
```

There is one there right now. Clear it before the first git command.

## Current state of the working tree

`HEAD` is `4834cf9 "Merge HStat 2.0"`. Nothing below is committed yet.

- **18 modified files** — pipeline, frontend, config, docs
- **21 deletions** — dead files (old `.pre-*` backups, one-off test scripts,
  `full-deploy-*.sh`, and `vite.config.js`, which Vite was resolving in
  preference to `vite.config.ts`). They have already been moved to
  `_to_delete/dead-files/`, which is gitignored, so `git add -A` will record
  them as deletions. That is intended.
- **2 untracked** — `scripts/ship.sh` and `docs/workflows-to-install/`

### What changed and why

Three defects were found and fixed in the pipeline:

1. **2024 and 2025 were missing for 92% of the code universe.** A single-period
   Comtrade request was sized at 250 HS codes — about 1.8 KB of `cmdCode` —
   and Comtrade rejects over-long URLs by returning *no rows rather than an
   error*. The pull stored that as "this period has nothing". Fixed with
   `MAX_CODES_PER_REQUEST = 50` in `pipeline/pull_comtrade.py`, plus grouping
   revisable years into one request. Cold build goes 542 → 590 calls; the
   monthly steady state is 88 calls.
2. **Nothing detected it.** `pipeline/validate_snapshot.py` now counts, per
   year, how many nodes actually received reporter rows, and fails QA when a
   year is present for under half the universe.
3. **26 years of global trade were being withheld, not missing.** One config
   value gated both "may this year be published" and "does it carry partner
   tables". Split into `validationStartYear` (1997) and `analysisStartYear`
   (2022) in `config/scope.json`.

Plus: a fully sourced exchange-rate table (`config/fx_inr_usd.csv`, 48 rates,
cited per row — World Bank/IMF for calendar years, FRED/Federal Reserve for
months, Economic Survey for financial years), and a set of interface changes
(search moved into the header, tabbed chart/table panels, a
largest-importers/largest-exporters section, HStack no longer double-counting
nested HS codes, HS-8 controls hidden until data exists).

## What I need you to help me do, in order

### Step 1 — install three workflow files

`docs/workflows-to-install/` contains three files that could not be written
automatically because GitHub workflow files are protected. They must be moved
into `.github/workflows/`:

- `qa.yml` — new. Runs the QA gates and the build on every push and PR.
- `keep-store-warm.yml` — new. Weekly cache touch (see below).
- `monthly-refresh.yml` — **replaces** the existing file of the same name. It
  adds a `reprocess` depth option.

After moving them, `docs/workflows-to-install/` should be removed.

### Step 2 — ship the code

```
./scripts/ship.sh "HStat 2.1"
```

This script validates the snapshot, runs the launch gate, runs the real build,
then commits and pushes. It picks `.venv/bin/python` automatically. Expect it
to print QA failures for 2024 and 2025 and continue anyway — that is
deliberate and explained below.

If the script fails, tell me what the failure means before suggesting a
workaround. Do not suggest `--force`, `--no-verify`, or bypassing a gate.

### Step 3 — rebuild the data

This is done in the GitHub web UI, not the terminal:

**Actions → Validated data refresh → Run workflow → depth: `reprocess`**

`reprocess` costs **zero API calls**. It rebuilds the published snapshot from
the raw Comtrade data already held in the Actions cache, which is what applies
the validation-window change and the new exchange rates. It validates before
it promotes, then commits and pushes the new snapshot itself, and Cloudflare
rebuilds the site from that push.

If `reprocess` reports that the raw store is empty, the Actions cache has been
evicted and a `full` rebuild is needed instead: depth `full`, `max_calls` 200,
which takes three days of scheduled runs.

## Two things that will look wrong and are not

- **`./scripts/ship.sh` reports QA failures for 2024 and 2025 and pushes
  anyway.** The committed snapshot really does have that hole — it is the bug
  described above, and it is fixed by rebuilding the data, which needs the new
  code pushed first. So the build gate blocks a push and the data gate only
  reports. Promotion is gated separately: the refresh workflow never publishes
  a snapshot that fails QA.
- **The new QA workflow will show red on `main` until Step 3 finishes.** It is
  reporting the same real data fault. It turns green after the reprocess.

## How to verify it worked

After Step 3 completes, these should hold:

```
curl -s https://hstat-india.aman17-dps.workers.dev/data/snapshots/current/manifest.json | python3 -m json.tool | head -40
```

- `currency.coverage.convertible` should be **42** of 43 periods (only
  `CY 2026` missing, because the year is not over)
- `validationStartYear` should be `1997`
- opening any product on the site: the **Global market** tab should show a long
  series rather than two points, and picking a year like 2015 should show a
  global figure instead of "withheld"

## Repo layout, for orientation

```
pipeline/          Python. pull_comtrade.py -> process_snapshot.py ->
                   validate_snapshot.py -> rotate_snapshot.py.
                   refresh_monthly.py orchestrates all of it.
                   launch_sanity.py is the pre-deploy gate.
config/            scope.json is the master config. fx_inr_usd.csv is the
                   exchange-rate table. hs6_universe.txt is the code list.
src/               React 19 + Vite 7 + Recharts 3, TypeScript.
public/data/       The published snapshot. Committed.
data/raw/          The raw Comtrade store. Gitignored; lives in the Actions
                   cache between runs.
scripts/           ship.sh, dev-fixture.sh, validate.sh, build.sh.
docs/              DEPLOY.md is the operations doc. Read it if unsure.
```

## Working offline

`./scripts/dev-fixture.sh` builds a synthetic snapshot with the real pipeline
and the real QA gate, covering 1996–present, so the dashboard can be run
without a Comtrade key. The numbers are fabricated and the snapshot is stamped
`"fixture": true`; `launch_sanity.py` refuses to ship anything carrying that
mark. **Never commit a fixture snapshot.** `git checkout public/data/snapshots`
restores the real one.

## Still outstanding, not blocking

- No DGCIS ITC(HS)-8 export has been supplied, so HS-8 detail is absent and the
  interface says so in one line rather than offering a dead control. Format in
  `data/dgcis/india_hs8.csv.example`.
- `config/concordances/hs6-nic5.csv` has no rows, so the ASI and PLFS panels
  render nothing. That mapping has to be written by hand.
- There is a second, broken Cloudflare **Pages** project at
  `hstat-india.pages.dev` pointed at the same repo with no build command
  configured. It serves the repo root and renders a blank page. It should be
  deleted in the Cloudflare dashboard. It is not the live site.

Start by confirming you have understood the deployment constraint, then give
me Step 1.
