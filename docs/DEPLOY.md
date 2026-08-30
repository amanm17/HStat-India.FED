# Getting HStat 2.0 live

The code is finished and builds. **The data is not there yet** — no 2.0 pull
has ever run, because Comtrade is unreachable from the machines this was built
on. That is the only thing standing between here and a live 2.0 dashboard.

The way through is that **GitHub Actions runners have internet**. The first
real pull does not need to happen on anyone's laptop.

---

## Where things stand

| | state |
|---|---|
| 2.0 code | complete, `tsc -b` and `vite build` pass, 36/36 search assertions |
| Published snapshot in the repo | **schema 1.0.0** — the old 56-product build, still what the live site serves |
| Raw store for 2.0 | empty. `data/raw/store/index.json` does not exist |
| Old 1.x raw data | present, but 56 products, 2022–2025, and **no re-import or re-export flows** — it cannot produce the netted headline 2.0 publishes |
| Comtrade API key | needs to be in GitHub secrets as `COMTRADE_API_KEY` |

The 2.0 frontend reads schema `2.0.0` and refuses a 1.x snapshot. That refusal
is deliberate and it is also your safety net — see *Why this cannot break the
live site* below.

---

## The sequence

Do it on a branch. The point is that code and data reach `main` **together**,
so the live site never sits on a mismatch.

### 1. Put the key in GitHub

Repository → Settings → Secrets and variables → Actions → New repository secret

```
COMTRADE_API_KEY   <your key>
```

`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are already there if the
current site deploys from this repo.

### 2. Clear the stale git locks first

Working through the desktop bridge left empty lock files in `.git/` that it
could rename but not delete. Git will refuse to write the index while
`index.lock` exists, so clear them before anything else:

```bash
cd "/Users/amanmishra/Documents/Personal Project/HStat-India-FED-upload"
rm -f .git/index.lock .git/index.lock.stale-remove-me \
      .git/stale-index-lock-1 .git/STALE-LOCK-DELETE-ME-*
git status          # should now run clean
```

Also worth emptying, once you have looked at it: `_to_delete/` holds the
transfer archives used to move work onto this machine, and nothing references
them.

### 3. Push the 2.0 code to a branch

```bash
git checkout -b release/2.0
git add -A
git commit -m "HStat 2.0: global trade netting, HS-8 tariff lines, currency, dataset registry"
git push -u origin release/2.0
```

Nothing deploys from a branch. The deploy workflow only fires on `main`.

### 4. Merge the workflow file to main first

GitHub only shows the **Run workflow** button for a workflow that exists on the
default branch. So `main` needs `.github/workflows/monthly-refresh.yml` before
you can dispatch it against your branch. Either merge that one file to `main`,
or merge the branch's workflows directory only:

```bash
git checkout main
git checkout release/2.0 -- .github/workflows/
git commit -m "Add the refresh workflow"
git push
```

This is safe on its own: adding a workflow file changes nothing until it runs,
and the deploy workflow will still refuse to ship (see the gates below).

### 5. Probe the key — three calls

Actions → **Validated data refresh** → Run workflow
→ branch `release/2.0`, depth **`probe`**

This costs three calls and answers the one question that decides whether any
of this is viable: does the key reach the data API, or only the 500-record
preview endpoint?

- **Reports ~100,000 records** → good, carry on.
- **Reports 500** → the key is only reaching the unauthenticated preview. 549
  codes would need tens of thousands of calls. Stop here and sort the key out;
  nothing below will work.

Whatever ceiling it reports, put it in `config/scope.json` under
`api.maxRecordsPerCall`. Getting this wrong is silent data loss, not a slow
build — a response truncated at the cap looks exactly like a complete answer.

### 6. Run the cold build — three days

Do the **full 1996 history now**, in one go. A shorter first build looks
tempting — 2015 onward is 296 calls and fits in a single day — but the history
is what the whole lineage design rests on, and going back later is not free:
period groups are aligned to fixed decade buckets, so extending 2015 to 1996
reuses 65% of what you already paid for and re-fetches the boundary decade.
Building from 1996 once costs 542 calls; building from 2015 and backfilling
costs about 614. Build it once.

Actions → **Validated data refresh** → Run workflow
→ branch `release/2.0`, depth **`full`**, max_calls **`200`**

542 calls against an allowance of 500 a day, so it does not fit in one run and
was never meant to. At 200 a day it takes three days and leaves 300 calls of
headroom for retries — which matters, because each call gets three attempts.

You do not need to babysit it. The workflow is scheduled on the **5th, 6th and
7th**; the later days ask the store whether anything is outstanding, which
costs no API calls, and stop in seconds when it is not. If your first dispatch
is not near those dates, just dispatch it again the next day — each run resumes
exactly where the last one stopped, because the raw store is cached.

A run that hits its budget with work left exits **3**, marks the job neutral
rather than failed, and deliberately does **not** promote. Watch for:

```
::warning:: Call budget reached; snapshot not promoted.
```

That is the expected message on days one and two.

### 7. Merge to main

When a run finishes without that warning, the branch has a real, validated 2.0
snapshot committed to it. Now:

```bash
git checkout main
git merge release/2.0
git push
```

The deploy workflow fires, `launch_sanity.py` passes, and the 2.0 dashboard
goes live with real data.

---

## Why this cannot break the live site

Three gates, and they are all fail-closed.

**The deploy refuses a snapshot the frontend cannot read.**
`launch_sanity.py` reads `const SCHEMA` out of `src/App.tsx` and compares it
with the snapshot's `schemaVersion`. If you push 2.0 code while the committed
snapshot is still 1.0.0, the deploy **fails at the sanity step and ships
nothing** — Cloudflare keeps serving the current build. It reads the constant
from the frontend rather than repeating it, so the two cannot drift apart.

**The deploy refuses fabricated data.** `./scripts/dev-fixture.sh` builds a
synthetic snapshot for offline development, and a fixture snapshot looks
exactly like a real one — that is what makes it useful. So it is stamped
`"fixture": true` in the manifest, from both an explicit flag and the store
path it was built from, and `launch_sanity.py` refuses to deploy anything
carrying the mark.

**A partial pull never promotes.** If the call budget runs out mid-build the
store is consistent but short, and a snapshot built from a short store is
missing whole periods rather than visibly broken. `refresh_monthly.py` builds
and validates it, then leaves `current` untouched.

If you ever need to undo a bad snapshot locally:

```bash
git checkout public/data/snapshots
```

---

## Running it locally right now

Without a Comtrade key you can still see and demo the whole dashboard:

```bash
npm install
./scripts/dev-fixture.sh     # synthetic store, real pipeline, real QA gate
npm run dev
```

**The numbers are fabricated; the shapes are real.** Every HS-6, HS-4 and HS-2
node is built by the real processing code and passed through the real quality
gate. It is the right thing to demo the interface with and the wrong thing to
quote a figure from — and it cannot be deployed even by accident.

---

## What is still missing after this

Getting the pull to run makes the dashboard live. These are separate and none
of them block it:

- **Exchange rates.** `config/fx_inr_usd.csv` ships with only the six
  financial-year rates verified in the FED workbook. Until more are added the
  rupee toggle shows dollars for most periods and says the rate is missing.
  `python pipeline/fx.py --report` lists exactly what to fill in.
- **Tariff lines.** No DGCIS export has been supplied, so the HS-8 toggle stays
  disabled. Format in `data/dgcis/india_hs8.csv.example`.
- **ASI and PLFS.** Declared in `config/datasets/`, no ingest written, and
  `config/concordances/hs6-nic5.csv` has no rows — so nothing renders for them
  yet, by design.
