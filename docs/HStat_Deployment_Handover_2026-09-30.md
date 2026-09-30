# HStat.India — deploying the interface fixes

**For:** ChatGPT, taking this to production
**Written:** 30 September 2026
**Repo:** `HStat-India-FED-upload` — `~/Documents/Personal Project/` on Aman's Mac
**Live host:** Cloudflare Pages, building this repository on push to `main`

---

## 1. Where things stand

**One commit is finished, tested and unpushed.** Working tree clean.

```
origin/main   7f5c39d   Put back the two fixes the last commit stood on top of   ← live now
main          9ef08fe   Three icons that meant three things, a plus outside…     ← local HEAD
```

`9ef08fe` — 26 files, 86 insertions, 80 deletions. Six are source or test;
the other twenty are the guide's screenshots (§5).

**965 automated checks pass** against exactly this tree, re-run this morning
after a clean `tsc -b --force` and a fresh build. The container they ran in
hashes identical to the committed tree, source and images both — so those
numbers describe the code that will deploy, not a remembered figure.

The mobile release and the slash shortcut are **already live**; this sits on
top of them. For their detail see `docs/HStat_Mobile_Deployment_Handover_2026-09-29.md`.

---

## 2. The deploy

```bash
cd ~/Documents/Personal\ Project/HStat-India-FED-upload

./scripts/validate.sh          # validate_snapshot + launch_sanity
npm run build                  # tsc -b && vite build — must be clean
git push origin main           # this is the deploy
```

Cloudflare builds on push. There is no deploy command; `wrangler deploy` must
not be run by hand and `wrangler.jsonc` must not be edited.

**It is a clean fast-forward.** `origin/main` has nothing this branch lacks —
no pull, no merge, no conflict.

**Frontend only.** Nothing in `pipeline/`, `config/` or `public/data`. Both
data gates were run this morning on this tree and pass: snapshot QA reports
0 failures, launch sanity passes (410/410 India values reconciled). If a data
check fails on this push, it was failing before it.

---

## 3. What changed

Three things a reader reported, each traced to a cause rather than nudged
until it looked right.

### 3.1 Three icons that meant three things

`Layers` was doing three jobs: tariff lines in the left rail, the workspace
in the title bar, and HStack beside it. Two of those sat next to each other
on a product page as identical buttons, which is how it was noticed.

One icon, one meaning now:

| concept | icon | why |
|---|---|---|
| tariff lines | `Layers` | stacked lines under a heading |
| workspace | `LayoutGrid` | arranging panels is what it does |
| HStack | `Sigma` | it sums several codes into one total |

The rest of the set was checked at the same time. `Database`, `Terminal`,
`BookOpen`, `Plus`, `Pin`, `Download`, `ArrowUpRight` and `Clock` all appear
more than once — each because it means **the same thing** in both places,
which is the opposite problem and is correct. Do not "fix" those.

### 3.2 A plus outside its own box

Worth understanding, because the mechanism recurs.

`.search-results-large button` gives every button in the result list the
row's own three-column grid — 48px, 72px, the rest — because that is what a
result row is. The add button is not a row. `place-items: center` did not
save it: the template leaked through, the icon was laid into the first 48px
column and centred **there**, which put it 10.0px right of the button's
middle and 2px past its own border.

Fixed by resetting the template explicitly. **Setting `display: grid` again
does not clear grid properties** — that is the trap.

`align.mjs` gains the general form of the check: an icon alone in a button
sits in the middle of it, within a pixel. Nothing overlapped, nothing
overflowed the page, and every existing measure passed; it simply looked
broken, and that was the gap in the suite.

### 3.3 A stat nobody could quote

The front page's two-figure box is gone. "418 product lines" is already the
first thing the lede says, and "$5tn global imports tracked" needed a
footnote to be honest — each product counted in its own latest validated
year, so an order of magnitude rather than a figure anyone could cite. A
headline that cannot be quoted without its own disclaimer is not a headline.

The footnote and the dead CSS went with it, and so did the search hub's 30px
bottom margin: that was spacing to the box, and without the box it left a
band of empty card under the example chips that read as a missing element.

---

## 4. Pre-flight

Thirteen suites, 965 checks, three servers.

```bash
npm run build

cp -r dist /tmp/bare    && rm -f  /tmp/bare/data/availability.json
cp -r dist /tmp/nodgcis && rm -rf /tmp/nodgcis/data/dgcis

node qa/suite/serve.mjs dist         4178 &
node qa/suite/serve.mjs /tmp/bare    4179 &
node qa/suite/serve.mjs /tmp/nodgcis 4184 &
```

| suite | checks | | suite | checks |
|---|---:|---|---|---:|
| `check.mjs` | 27 | | `navcheck.mjs` | 53 |
| `search.mjs` | 12 | | `featurecheck.mjs` | 49 |
| `boundary.mjs` | 7 | | `align.mjs` | **105** |
| `absence.mjs` | 6 | | `visual.mjs` | 198 |
| `postdeploy.mjs` | 100 | | `mobile.mjs` | 358 |
| `p2check.mjs` | 21 | | `additive.mjs` (4184) | 8 |
| `exportcheck.mjs` | 21 | | | |

`align.mjs` moved 84 → 105 in this commit: the icon-centring measure above,
across seven pages and three widths.

`playwright` is deliberately **not** in `package.json` — these run before a
deploy, not in CI, and adding it would make every install download a browser
it never opens. In a container whose preinstalled Chromium is older than the
`playwright` on npm, pass `PW_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

**Do not weaken any suite to make a push go through.**

---

## 5. The guide's screenshots, and a method worth keeping

All twenty were recaptured in this commit, and all twenty genuinely changed.

**Compare them by pixel, never by hash.** PNG encoding is not deterministic:
a byte comparison reports every capture as changed on every run, which makes
it useless for deciding what to ship. Doing it properly — `ImageChops.difference`
and a bounding box — showed the committed set was a mix of two capture eras
at different scales. They are now on one.

An earlier commit got this wrong in the other direction: the diffs were
assumed to be encoder noise, eighteen captures were restored rather than
shipped, and the guide illustrated a UI that had moved on. Both mistakes come
from the same missing step.

**After any change to `src/styles.css`:**

```bash
npm run build && node qa/suite/serve.mjs dist 4178 &
node qa/guide-shots.mjs      # 20 captures, both themes, into public/img/guide
```

They live at `public/img/guide`, **not** `public/guide` — a folder there
would sit at `/guide`, which is a route, and a static-asset host resolves the
directory before falling back to `index.html`. That 404'd once.

---

## 6. After the push

Cloudflare publishes within a few minutes. Six things, in order:

1. **Open a product page.** The workspace button (grid) and HStack (Σ) sit
   side by side in the title bar and are now plainly different.
2. **Search anything.** The `+` beside each result is centred in its box.
3. **The front page** has no stat box, and no empty band under the example
   chips where it used to be.
4. **Press `/`** from anywhere — the search box takes the cursor. Press it
   again, inside the box, for commands.
5. **On a real phone**, not a narrowed window: bottom bar, cards on
   `/tariff-lines`, and rotate it — the pointer-based rules only fire on a
   genuine touch device.
6. **`/guide` loads** and its screenshots render in both themes.

`scripts/audit-live-vs-repo.sh` compares live against the repository if
anything looks off.

---

## 7. Hard rules

The full list is in `docs/HStat_Deployment_Handover_2026-09-22.md` §8. The
ones that bear on a frontend change:

- Do not weaken QA to make a push go through. Do not bypass QA hooks.
- No `--force`, no `--no-verify`, no destructive git shortcuts.
- Do not reset `main` or discard validated data-refresh commits.
- Do not change `wrangler.jsonc`, the `package.json` build script, or the
  deployment workflow unless clearly necessary.
- Never run `wrangler deploy` by hand. Push is the deploy.
- Do not add `playwright` to `package.json`.
- Do not run `npm audit fix --force`.
- Do not inspect, print, `cat`, commit or expose `.env`.

And the data rules, which nothing here touches but which the next change
might: no synthetic production data, no invented FX, no fabricated HS-8
descriptions, no merging Comtrade with DGCIS, never convert INR crore to USD
million, and there is no `--force-flow` bypass on the DGCIS flow guard.

### The git lock trap

When work is done on this repo through the Claude desktop bridge, the mount
cannot unlink files, so git's own lock files survive and the *next* command
fails or half-succeeds. This shipped a wrong commit twice. On the Mac it does
not happen. If you see it: `pgrep -fl git`, then
`find .git -name '*.lock' -delete` — recursive, not just the top level — then
verify the pointer moved before pushing.

### One more, learned twice in two days

A file copied wholesale carries the version it was copied at. Hashing the
trees at the *start* of a task is not enough; someone can commit while the
work is in flight. **Re-check at the point of writing**, not only at the
point of reading. That is how `b72ffad` came to be reverted and restored, and
the check that catches it is:

```bash
find src qa/suite -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \
  -o -name '*.mjs' -o -name '*.md' \) | sort | xargs md5sum | md5sum
```

---

## 8. Still open

| item | state |
|---|---|
| **Push this commit** | the only thing between this work and production |
| Monthly refresh | due — Comtrade released 2026-09-18, after the snapshot was built on 09-14 |
| August/September DGCIS extract | not pulled; tariff data ends 2026-06 |
| 27 unnamed tariff lines | 25 are retired codes; 2 are live and absent from the mapping |
| The guide on a phone | ~8,800px tall. Reads fine and the contents list jumps around it; collapsing chapters by default is the fix if it feels long in use |
| "Who has not filed" on product pages | recommended, not built (`claude/fresher-data-investigation-2026-09-18.md`) |
| Mirror data from partner exports | **tested and rejected**; do not revisit without reading that doc |

Current data: **255 headings, 543 tariff lines, 516 named, both flows,
2019-01 → 2026-06.**
