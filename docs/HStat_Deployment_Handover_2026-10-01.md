# HStat.India — deployment handover

**For:** ChatGPT (or whoever takes the next turn)
**Written:** 2026-10-01
**Repo:** `HStat-India-FED-upload` → `origin` = `https://github.com/amanm17/HStat-India.FED.git`
**Branch:** `main`. **Deploy = push to `main`.** Cloudflare Pages builds from it. There is no other deploy path.

---

## 1. Where things stand right now

Working tree clean. Two commits sit on `main` locally and have **not** been pushed:

```
6a27686  A deployment note for the interface fixes
9ef08fe  Three icons that meant three things, a plus outside its own box, and a stat nobody could quote
```

`9ef08fe` is the last functional change. It did three things the user asked for:

1. The workspace icon and the HStack icon were the same glyph; three distinct icons now mean three distinct things.
2. The HS-code chips below the search box carried a `+` button whose glyph sat ~10px outside its own box. `.search-results-large button` was leaking a three-column grid template; `place-items: center` does not clear a template. Fixed with an explicit `grid-template-columns: 1fr` on `.search-result-add`.
3. The "418 lines / $5tn" stat box is gone — the user could not quote either number with confidence, so it should not have been on the page.

`6a27686` is documentation only.

Everything before those two is already live.

### Published data as it stands

| | |
|---|---|
| DGCIS manifest built | `2026-09-21T07:01:28Z` |
| DGCIS period range | `2019-01 → 2026-06` (90 periods) |
| HS-8 lines | 543 |
| Products covered | 251 |
| Flows | `exports`, `imports` |
| Flow guard, exports | `DECIDED` — 1487 pairs, 1471 wins exports, median ratio 1.0 |
| Flow guard, imports | `DECIDED` — 1504 pairs, 1465 wins imports, median ratio 0.9998 |
| Comtrade snapshot | built `2026-09-14`; Comtrade released on `2026-09-18`, so a refresh is **due** |

---

## 2. The shortest correct path to deployment

If you change nothing, this is the whole job:

```bash
git status                 # expect: clean, 2 ahead of origin/main
npm run build              # must pass; tsc -b runs first
git push origin main
```

Cloudflare Pages picks it up. Then run the post-deploy check in §5.

Do **not** run `wrangler deploy` by hand. Do **not** touch `wrangler.jsonc`, the `build` script in `package.json`, or the GitHub workflow.

---

## 3. Updating the DGCIS HS-8 data

**This is the piece the user specifically asked to have written down.** The published DGCIS data ends at `2026-06`. The August/September extract has not been pulled. Here is how.

### 3.1 Why a human is in the middle

The DGCIS source is the Trade Intelligence & Analytics portal:

```
https://trade-analytics.commerce.gov.in/public/de?pg=de
```

It is CAPTCHA-gated. **That gate is not worked around.** No solver, no token replay, no headless impersonation. The browser opens visibly, a person drives the query and the CAPTCHA, and the script does the careful work on either side. If you cannot sit at a browser, you cannot refresh DGCIS — stop and hand it back, do not improvise.

### 3.2 Two flows, two downloads

India's exports at the tariff line and India's imports at the tariff line are **separate portal queries**, and the extract file does not record which one it is. So each download is taken under a flow you name, saved under a filename that says so, and checked against Comtrade before it is allowed through. That check is the flow guard, and it is the one place where a human assertion becomes data.

### 3.3 The one command

```bash
cd <repo>
pip install playwright && playwright install chromium   # once, only on the machine doing this
python3 pipeline/dgcis/refresh_dgcis.py
```

`playwright` is **deliberately not** in `requirements.txt` or `package.json`. Do not add it. These scripts are run by a person at a browser, never by CI.

It runs both flows by default. Useful flags:

```
--flow exports        just the one (repeatable)
--skip-download       use whatever is already in data/dgcis/incoming/
--no-diff             skip the month-on-month report
```

### 3.4 What to set in the browser window, each flow

The script opens the portal and prints these. Get them right:

| Field | Value |
|---|---|
| Trade flow | **Export** for `--flow exports`, **Import** for `--flow imports` — this one matters most |
| HS level | HS8 |
| Country / partner | World (All) |
| Measure | Value |
| Period basis | Calendar Year |
| Period | the full range you want, **ending with the newest available month** |

Solve the CAPTCHA, submit, wait for the results table to be on screen, press ENTER in the terminal, then click the portal's download button. The script catches the download, saves it to `data/dgcis/incoming/DGCIS_DATA_<flow>.csv`, and archives a stamped copy under `data/dgcis/raw/`.

If the download is not caught automatically, move the file from your Downloads folder to that `incoming/` path yourself and re-run with `--skip-download`.

### 3.5 What runs automatically after each download

Per flow, in order, each one must succeed or the run stops and nothing published is touched:

```
pipeline/dgcis/validate_hs8.py    --flow <flow>
pipeline/dgcis/process_tia_hs8.py --flow <flow>
```

then once, after every flow is in:

```
pipeline/dgcis/build_frontend_hs8.py
```

The build is deliberately last and single, so a two-flow refresh can never leave the published files holding one new flow and one old one.

**`validate_hs8.py`** gates provenance and completeness, not statistical coverage — the failure modes of a hand-downloaded file are the wrong month, a partial export, the same file twice, a portal change that silently drops rows. Its strongest check is free from the source: DGCIS publishes its own TOTAL row, so every commodity row is summed against it. Tolerance is **0.01%** — far tighter than rounding (worst observed on a good extract: 0.0017%) and far looser than a dropped line. `PASS` proceeds, `WARNING` is surfaced and proceeds, `FAIL` stops the run.

**`process_tia_hs8.py`** writes `data/dgcis/processed/india_hs8_monthly_<flow>.csv`, `hs8_scope_<flow>.csv` and `manifest_<flow>.json`, and runs the flow guard. `--flow` is required; there is no default, on purpose.

**`build_frontend_hs8.py`** writes `public/data/dgcis/`. Its `prune()` **fails the build** if a stale payload cannot be removed — that is intentional, do not soften it.

### 3.6 Reading the diff report

At the end the script prints what moved. Two lines deserve a stop, not a scroll-past:

- **`latest month … UNCHANGED since the last build`** — almost always means the portal query was run on the wrong period. A silent no-op is how a missed month goes unnoticed for a month.
- **`MISSING : <codes>`** — a line the portal stopped returning. Either a schedule change or a narrower query than last month. Find out which before publishing.

### 3.7 Then

```bash
npm run build && npm run preview     # look at it
git add -A && git commit && git push origin main
```

---

## 4. Updating the Comtrade data

Separate pipeline, separate cadence, no CAPTCHA:

```bash
scripts/refresh-monthly.sh           # → python pipeline/refresh_monthly.py
```

It sources `.env` and `.venv` if present. A refresh is currently due (snapshot `2026-09-14`, Comtrade released `2026-09-18`).

Never numerically merge Comtrade and DGCIS figures. They are two sources with two definitions and they are presented side by side, never added.

---

## 5. QA before and after the push

Browser checks run against a **built** dashboard and require `playwright` (again: not in `package.json`, do not add it).

```bash
npm run build
node qa/suite/serve.mjs dist 4178 &

node qa/suite/check.mjs        #  27  routing, panel, composition, deep links
node qa/suite/search.mjs       #  12  tariff lines in search
node qa/suite/boundary.mjs     #   7  a forced throw inside the panel
node qa/suite/absence.mjs      #   6  panel or note, never both, never neither
node qa/suite/align.mjs        # 105  7 pages × 3 widths, five measures
node qa/suite/mobile.mjs       # 358  7 pages × 4 shapes × 2 themes, plus behaviour
node qa/suite/featurecheck.mjs
node qa/suite/navcheck.mjs
node qa/suite/visual.mjs
```

Two more servers are needed for the absence suites, because three states must be true at once:

```bash
cp -r dist /tmp/bare    && rm -f  /tmp/bare/data/availability.json
node qa/suite/serve.mjs /tmp/bare    4179

cp -r dist /tmp/nodgcis && rm -rf /tmp/nodgcis/data/dgcis
node qa/suite/serve.mjs /tmp/nodgcis 4184
BASE=http://127.0.0.1:4184 node qa/suite/additive.mjs "no dgcis data"
```

4179 exists so `featurecheck.mjs` can still assert the availability page's empty state now that the real file is published. When data arrives, the test for its absence **moves to a copy without it** — it is not deleted.

After the push, against the live URL:

```bash
node qa/suite/postdeploy.mjs
```

In a container where the preinstalled Chromium is older than the npm `playwright`, pass the binary:

```bash
PW_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node qa/suite/mobile.mjs
```

Guide screenshots, if the guide changed:

```bash
node qa/guide-shots.mjs        # 20 captures → public/img/guide
```

**Not** `public/guide/` — a folder there sits at `/guide`, which is a route, and a static-asset host resolves the directory before the SPA fallback. The guide 404'd in production while looking fine in dev. That happened once; do not undo the move.

---

## 6. Traps that have already cost a day each

- **`.git/index.lock` cannot be unlinked through the device bridge.** `warning: unable to unlink … index.lock: Operation not permitted` appears on normal git operations here and is usually harmless. Only clear a lock after confirming no live git process holds it, and never with a force flag.
- **Compare PNGs by pixel, never by hash.** PNG encoding is non-deterministic; all 20 guide shots "change" every run by hash. Once, 18 genuinely-different captures were restored as "encoder noise". Use `ImageChops.difference`.
- **Hash-check trees at the point of writing, not only at the point of reading.** A file copied wholesale carries the version it was copied at. A user commit was once reverted this way and had to be reconstructed from the diff.
- **`minmax(460px, 1fr)` with `auto-fit` still lays a 460px track in a 375px container.** Use `minmax(min(460px, 100%), 1fr)`.
- **Mobile rules keyed on width alone switch off in landscape.** A rotated phone is 844px and still a thumb. Size and legibility key on `(hover: none) and (pointer: coarse)`; layout keys on width. See `src/lib/viewport.ts`.
- **`useSlashToSearch` must be wired after `goHome` is defined** in `App.tsx` — dependency arrays evaluate at render, and naming a later `const` throws before paint.

---

## 7. Constraints — these are the user's words, keep them

- Do not use synthetic or placeholder production data.
- Do not weaken QA simply to make data publish. Do not bypass QA hooks.
- Do not interpolate or invent missing FX data.
- Do not fabricate HS-8 descriptions. 516 of 543 lines are named from the user's ITC(HS) mapping; 27 abstain (25 retired codes last filed 2021–23, plus `85079020` and `85291093`, live but absent from the mapping). An unnamed code shows as its code. Nothing is invented.
- Do not change `wrangler.jsonc`, the `build` script in `package.json`, or the GitHub deployment workflow unless clearly necessary.
- Do not manually run `wrangler deploy`.
- Do not reset `main` or discard validated data-refresh commits.
- Do not use `--force`, `--no-verify`, or `--force-flow`.
- Do not inspect, print, `cat`, commit or otherwise expose `.env`.
- Do not commit unrelated local artifacts, docs or secrets.
- Preserve the current successful CAUTION publication logic.
- Treat Comtrade legacy-nomenclature rows carefully: a non-zero residual under an obsolete code is not automatically a valid continuous global series.
- Do not numerically merge Comtrade and DGCIS. Do not call DGCIS partner "World" *world trade*.
- Do not run `npm audit fix --force`.
- Do not expand FED scope without explicit approval.
- No CAPTCHA bypass was attempted and none should be implemented.
- Do not add `playwright` to `package.json`.

---

## 8. Outstanding, in order

1. **Push the two unpushed commits** — this deploys the icon, `+` button and stat-box fixes.
2. **Pull the August/September DGCIS extract** per §3. Data currently ends `2026-06`.
3. **Run the monthly Comtrade refresh** per §4. Snapshot is `2026-09-14`; Comtrade released `2026-09-18`.
4. Re-run the QA suites in §5 after each of 2 and 3, and `postdeploy.mjs` after each push.
