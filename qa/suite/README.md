# DGCIS HS-8 regression suite

Browser checks against a **built** dashboard. They exist because the
tariff-line layer is an addition, and an addition must never be able to
subtract: most of what is asserted here is that the Comtrade dashboard keeps
working when the DGCIS layer is missing, stale, corrupt, or throwing.

```
npm run build
node qa/suite/serve.mjs dist 4178 &
node qa/suite/check.mjs        # 27 — routing, panel, composition, deep links
node qa/suite/search.mjs       # 12 — tariff lines in search
node qa/suite/boundary.mjs     #  7 — a forced throw inside the panel
node qa/suite/absence.mjs      #  6 — panel or note, never both, never neither
```

`additive.mjs` runs against a doctored copy of `dist`, and takes a label:

```
cp -r dist /tmp/t && rm -rf /tmp/t/data/dgcis
node qa/suite/serve.mjs /tmp/t 4184 &
BASE=http://127.0.0.1:4184 node qa/suite/additive.mjs "no dgcis data"
```

Requires `playwright`. Not in package.json: these are run by a person before
a deploy, and adding it would make every CI install download a browser it
never opens.


## Alignment suite

```
node qa/suite/align.mjs        # 84 — 7 pages x 3 widths, four measures each
```

`visual.mjs` asks whether anything is broken. `align.mjs` asks whether
everything is square, which is a different question and the one that decides
whether a page looks assembled or designed. Four measures, 1px tolerance,
because 1px is a rounding difference and anything more was a decision:

- **edges** — siblings stacked in a column share a left edge
- **rhythm** — repeated rows in a list are the same distance apart, measured
  per grid column so a two-up list is not reported as ragged
- **rows** — items sitting side by side have equal gaps between them
- **columns** — `.num` cells in one table share a right edge

It found nothing on the pages as they stand, which is the point of having it:
the next change is the one it is for.

## The servers these suites expect

Three, because three states have to be true at once:

```
node qa/suite/serve.mjs dist          4178   # the real build
cp -r dist /tmp/bare && rm -f /tmp/bare/data/availability.json
node qa/suite/serve.mjs /tmp/bare     4179   # availability.json absent
cp -r dist /tmp/nodgcis && rm -rf /tmp/nodgcis/data/dgcis
node qa/suite/serve.mjs /tmp/nodgcis  4184   # the whole DGCIS layer absent
```

4179 exists so `featurecheck.mjs` can still assert the availability page's
empty state now that the real file is published. When the data arrives, the
test for its absence has to move to a copy without it - not be deleted.

## Screenshots for the guide

```
node qa/guide-shots.mjs        # 20 captures into public/img/guide
```

Both themes, from the real pages. **Not** `public/guide` — a folder there sits
at `/guide`, which is a route, and a static-asset host resolves the directory
before the SPA fallback, so the guide would 404 in production while looking
fine in dev. That happened once.

## The phone suite

```
node qa/suite/mobile.mjs       # 357 — 7 pages × 4 shapes × 2 themes, plus behaviour
```

`visual.mjs` and `align.mjs` ask whether the page is put together correctly.
This asks whether it can be used by a thumb, on a screen held vertically, by
somebody who cannot hover and cannot read a 9px caption.

Six measures across 360, 390, 414 and one landscape shape, in both themes:

- **targets** — every control at least 44px on both axes. A link inside a
  sentence is exempt on width only; WCAG exempts inline targets, and padding
  "2024" out would break the line it sits in.
- **type** — nothing under 11px. Eyebrows, status pills and tab labels are
  named exemptions: they are caps with wide tracking, and they are structure
  rather than content.
- **overflow** — the page never scrolls sideways.
- **overlap** — no two siblings in a row intersect.
- **reach** — the bar is fixed to the bottom, holds five destinations, and
  nothing covers it.
- **sheets** — search, more and workspace open, lock the page behind them, and
  close by button, backdrop and Escape.

### Why the landscape shape is not a formality

The first version of every rule here was keyed on `max-width: 640px`. A phone
rotated is 844px across and still a thumb, so every one of them switched
itself off the moment the device turned sideways — 34 failures in one pass,
none of which any amount of portrait testing would have found. Size and
legibility are now keyed on `(hover: none) and (pointer: coarse)` as well as
on width; layout stays keyed on width alone, because in landscape a table
fits and in portrait it does not.

### Running it

Needs only the main server on 4178. In this container the preinstalled
Chromium is older than the `playwright` on `npm`, so pass the binary:

```
PW_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node qa/suite/mobile.mjs
```

On a machine where `npx playwright install` has run, it needs no such thing.
