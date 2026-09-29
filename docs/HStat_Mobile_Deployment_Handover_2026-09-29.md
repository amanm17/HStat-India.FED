# HStat.India — deploying the mobile release

**For:** ChatGPT, taking this to production
**Written:** 29 September 2026
**Repo:** `HStat-India-FED-upload` — `~/Documents/Personal Project/` on Aman's Mac
**Live host:** Cloudflare Pages, building this repository on push to `main`

---

## 1. Where things stand

**One commit is finished, tested and unpushed.** The working tree is clean.
Nothing else stands between this work and production.

```
origin/main   3091f24   Fix wide-header alignment and enforce alignment QA  ← live now
main          bb2ad46   A phone is not a narrow laptop                      ← local HEAD
```

`bb2ad46` — 13 files, 2,240 insertions, 36 deletions. Four files are new.

**927 automated checks pass** against exactly this tree, re-run this morning
after a clean `tsc -b --force` and a fresh build. Not remembered: measured, on
the commit that will deploy. The breakdown is in §3.

---

## 2. The deploy

Cloudflare builds on push. There is no deploy command, and `wrangler deploy`
must not be run by hand.

```bash
cd ~/Documents/Personal\ Project/HStat-India-FED-upload

./scripts/validate.sh          # validate_snapshot + launch_sanity
npm run build                  # tsc -b && vite build — must be clean
git push origin main           # this is the deploy
```

`.github/workflows/qa.yml` then runs snapshot QA, launch sanity and the same
`npm run build` on the push. `deploy-cloudflare.yml` is a deliberate no-op.
`wrangler.jsonc` is already correct and must not be edited.

**This release is frontend-only.** No pipeline, no data, no config: the diff
is 12 source files plus one new QA suite. Nothing in `public/data`, nothing in
`pipeline/`, nothing in `config/`. If a data check fails on this push, it was
already failing before it.

---

## 3. Pre-flight: the suites

Thirteen suites, 927 checks. They need `playwright` and **three servers**.

```bash
npm run build

cp -r dist /tmp/bare    && rm -f  /tmp/bare/data/availability.json
cp -r dist /tmp/nodgcis && rm -rf /tmp/nodgcis/data/dgcis

node qa/suite/serve.mjs dist         4178 &
node qa/suite/serve.mjs /tmp/bare    4179 &
node qa/suite/serve.mjs /tmp/nodgcis 4184 &
```

| suite | checks | what it holds |
|---|---:|---|
| `check.mjs` | 27 | routing, panel, composition, deep links |
| `search.mjs` | 12 | tariff lines in search |
| `boundary.mjs` | 7 | a forced throw inside the panel |
| `absence.mjs` | 6 | panel or note, never both, never neither |
| `postdeploy.mjs` | 100 | two flows against ground truth, retired routes, the malformed-payload matrix |
| `p2check.mjs` | 21 | what a second page load refetches |
| `exportcheck.mjs` | 21 | CSV/workbook contents, the name caveat |
| `navcheck.mjs` | 37 | rail, palette, deep links, naming |
| `featurecheck.mjs` | 49 | help card, HS-8 report, the new routes |
| `align.mjs` | 84 | edges, list rhythm, row gaps, number columns |
| `visual.mjs` | 198 | 7 pages × 3 widths × 2 themes |
| **`mobile.mjs`** | **357** | **new — see §5** |
| `additive.mjs` | 8 | run against 4184, the doctored copy |

**Do not weaken any of these to make a push go through.**

### Running `mobile.mjs`

```bash
node qa/suite/mobile.mjs
```

It needs only the server on 4178. `playwright` is deliberately not in
`package.json` — these run before a deploy, not in CI, and adding it would
make every install download a browser it never opens. On a machine where
`npx playwright install` has run, it needs nothing else. In a container whose
preinstalled Chromium is older than the `playwright` on npm, pass the binary:

```bash
PW_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node qa/suite/mobile.mjs
```

---

## 4. What changed, and why

The starting problem: **below 900px the left rail hid itself and nothing
replaced it.** Tariff lines, availability, the query builder and the guide
became unreachable, leaving the front page as the only route to anything.
Everything else in this commit follows from auditing what a phone actually
got once that was noticed.

Three design decisions were Aman's, taken before any code was written: a
bottom tab bar over a hamburger drawer; cards that expand rather than tables
that scroll sideways; a bottom sheet with no dragging for the tile rail.

### What a phone gets now

**A bottom tab bar**, appearing at exactly the width the rail gives up, so
there is never a screen size with no way to navigate. Five destinations:
Home, Search, Lines, Coverage, and a More sheet holding the query builder,
the guide, pinned codes and recent history.

**Search is a tab, not a box.** In the header on a phone it was 78px wide and
truncated its own placeholder to "Search, or" — which is not a search box, it
is a rumour of one. It now gets the screen.

**Tables become cards below 640px.** Four columns in 338px gives each about
85, in which "Switching and routing, other" becomes "Switching and rout…";
and scrolling that sideways inside a page that scrolls vertically makes the
two gestures fight. A card shows the identifier and the one figure worth
scanning; tapping it reveals what the other columns held. Opening the row's
own page is a **separate, labelled button** — "show me more here" and "take
me there" must not be the same gesture with different outcomes. Applied to
the tariff index, the sibling table on a tariff line, and both coverage
tables.

**The workspace rail becomes a sheet.** Its handle moved off the right edge —
out of a thumb's reach on a 6-inch screen, and sitting on top of the page's
own text at 390px — into the title bar beside the other controls that act on
that page. Drag-to-reorder became up and down buttons, because the gesture
that picks up a tile is the gesture that scrolls the page, and the browser
has to guess.

**44px on every control, 11px on every piece of text.** 62 controls on one
product page were under 44px; tile grips were 22×22; the tariff index had 178
targets under 36px. All zero now.

### The new files

| file | what it is |
|---|---|
| `src/lib/viewport.ts` | the breakpoint hooks, and what each one decides |
| `src/components/TabBar.tsx` | the bottom bar and the More sheet |
| `src/components/Sheet.tsx` | the sheet primitive — scroll lock, focus trap, four ways out |
| `src/components/Rows.tsx` | a table's content as expandable cards |
| `qa/suite/mobile.mjs` | the phone suite |

### The breakpoints, and what each decides

- **900px** — the rail no longer fits, so the tab bar takes over. Also where
  the workspace becomes a sheet.
- **640px** — a column too narrow to be a table. Cards, two-up metric grids,
  condensed hero.
- **`(hover: none) and (pointer: coarse)`** — a finger. Decides target size,
  the type floor, and whether a drag handle can exist at all.

---

## 5. The mistake worth recording

**Every rule was first keyed on `max-width: 640px`.**

A phone rotated is 844px across and still a thumb. So all of them switched
themselves off the moment the device turned sideways: 34 failures in the
first landscape pass, and not one of them findable in portrait, at any width,
by any amount of looking.

Size and legibility now key on the pointer being coarse, as well as on width.
Layout still keys on width alone, because in landscape a table fits and in
portrait it does not. The landscape shape in `mobile.mjs` exists for exactly
this reason and must not be dropped as redundant — it is the only check in
the file that was ever load-bearing.

**If you add a mobile rule, ask which of the two it is.** Legibility and
target size follow the finger. Layout follows the width.

---

## 6. What `mobile.mjs` measures

Six measures across 360, 390, 414 and one landscape shape (844×390), in both
themes, over all seven pages — plus a behaviour pass at 390.

- **targets** — every control at least 44px on both axes. A link inside a
  sentence is exempt on width only: WCAG exempts inline targets, and padding
  "2024" out would break the line it sits in.
- **type** — nothing under 11px. Eyebrows, status pills and tab labels are
  **named** exemptions at 10–10.5px: caps with wide tracking, and structure
  rather than content. They are named in the suite, not forgiven silently.
- **overflow** — the page never scrolls sideways.
- **overlap** — no two siblings in a row intersect.
- **reach** — the bar is fixed to the bottom, holds five destinations, and
  nothing covers it.
- **sheets** — search, more and workspace open, lock the page behind them,
  and close by button, backdrop and Escape.

---

## 7. Desktop is untouched — and here is why you can believe that

This was the explicit constraint: adapt to the phone **without compromising**
the laptop. Three structural guarantees, not three good intentions:

1. **The tab bar is not rendered above 900px.** It is behind a `matchMedia`
   hook, not a CSS `display: none`, so its focus trap, scroll lock and key
   listeners do not exist in a desktop tree at all.
2. **`Rows` is not in the desktop tree either.** Each table renders
   `phone ? <Rows/> : <table>`; the real `<table>` is untouched.
3. **Every new CSS rule is inside a media query.** `src/styles.css` grew by
   959 lines and none of them apply at a desktop width with a fine pointer.

Verified rather than asserted: the 570 pre-existing checks — including all
198 visual and all 84 alignment — pass unchanged on this commit.

---

## 8. Hard rules

Carried forward. Several exist because something already went wrong.

**Data**

- No synthetic or placeholder production data, ever.
- Do not interpolate or invent missing FX data.
- Do not fabricate HS-8 descriptions.
- Do not numerically merge Comtrade and DGCIS figures.
- Do not call a DGCIS partner-World total "world trade".
- INR crore and USD million are both filed by DGCIS. Never convert between
  them.
- The Indian financial year (April–March) is not Comtrade's calendar year.
- A non-zero residual under an obsolete Comtrade legacy code is **not**
  automatically a valid continuous global series.
- There is no `--force-flow` bypass on the DGCIS flow guard, and none must be
  added.

**Process**

- Do not weaken QA to make a push go through. Do not bypass QA hooks.
- No `--force`, no `--no-verify`, no destructive git shortcuts.
- Do not reset `main` or discard validated data-refresh commits.
- Do not change `wrangler.jsonc`, the `package.json` build script, or the
  deployment workflow unless clearly necessary.
- Never run `wrangler deploy` by hand. Push is the deploy.
- Do not run `npm audit fix --force`.
- Do not add `playwright` to `package.json`.
- Do not inspect, print, `cat`, commit or expose `.env`.
- No CAPTCHA bypass.

**The git lock trap** — when work is done on this repo through the Claude
desktop bridge, the mount cannot unlink files, so git's own lock files
survive and the *next* command fails or half-succeeds. This shipped a wrong
commit twice. On the Mac it does not happen. If you see it:
`pgrep -fl git`, then `find .git -name '*.lock' -delete` (recursive, not just
the top level), then verify the pointer moved before pushing.

---

## 9. After the push

Cloudflare builds and publishes within a few minutes. Check on an actual
phone, not a narrowed browser window — the pointer rules only fire on a real
touch device:

1. **The bottom bar is there**, and all five tabs go somewhere.
2. **Rotate the phone.** This is the one that was broken and is the reason
   §5 exists. Everything should stay legible and hittable at 844×390.
3. **Open `/tariff-lines`.** Cards, not a table. Tap one — it expands. Tap
   "Open 85171300" — it navigates.
4. **Open a product page and tap the layers button** in the title bar. The
   workspace comes up as a sheet with up/down buttons and no drag handles.
5. **Search tab** — full screen, finds "smartphone".
6. **A laptop still looks exactly as it did.** Left rail, header search,
   five-across metric cards, the rail handle on the right edge.

`scripts/audit-live-vs-repo.sh` compares live against the repository if
anything looks off.

---

## 10. Still open

| item | state |
|---|---|
| **Push this commit** | the only thing between this work and production |
| Monthly refresh | due — Comtrade released 2026-09-18, after the snapshot was built on 09-14 |
| August/September DGCIS extract | not pulled; tariff data ends 2026-06 |
| 27 unnamed tariff lines | 25 are retired codes; 2 are live and absent from the mapping |
| The guide on a phone | 8,851px tall — ten chapters with twenty screenshots. It reads fine and the contents list jumps around it, but collapsing chapters by default is the fix if it feels long in use |
| "Who has not filed" on product pages | recommended, not built (see `claude/fresher-data-investigation-2026-09-18.md`) |
| Mirror data from partner exports | **tested and rejected**; do not revisit without reading that doc |

---

## 11. Orientation

```
src/
  App.tsx                 routing, snapshot loading, workspace state, the bar
  lib/
    viewport.ts           NEW — usePhone / useNoRail / useTouch
    pagehelp.tsx          how a page tells the help card what it is showing
    dgcis.ts              DGCIS loading, shape guard, name caveats, exports
  components/
    TabBar.tsx            NEW — bottom bar and the More sheet
    Sheet.tsx             NEW — the sheet primitive
    Rows.tsx              NEW — a table's content as cards
    NavRail.tsx           the desktop left rail, hidden below 900
    Sidebar.tsx           the workspace: an aside on a desktop, a sheet below 900
    SearchHub.tsx         search + slash palette
    Hs8View.tsx           tariff-line page
    TariffLines.tsx       /tariff-lines
    Guide.tsx             /guide
    Availability.tsx      /availability
    QueryBuilder.tsx      /query — deliberately takes no key
qa/
  suite/                  13 suites + serve.mjs; README.md documents each
  guide-shots.mjs         regenerates the guide's screenshots after a CSS change
```

**The additive guarantee still holds.** The DGCIS layer is an addition and an
addition must never be able to subtract: `usable()` treats a malformed payload
as absent, `Safely.tsx` wraps every DGCIS surface, and fetches are gated on
the index. `additive.mjs` and the malformed-payload matrix in `postdeploy.mjs`
are what keep that true — and both still pass on this commit.

Current data: **255 headings, 543 tariff lines, 516 named, both flows,
2019-01 → 2026-06.**
