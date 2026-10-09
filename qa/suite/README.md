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


## The estimation marker

```
node qa/suite/estimated.mjs    # 7 — the asterisk, and what it says
```

Needs only the main server on 4178; it builds and serves its own doctored
copy of `dist` on 4193 and removes it afterwards.

Since 7 October a published figure may contain values no country filed. That
is defensible only while the two kinds of number are told apart on sight, so
this asserts the mark appears exactly when the data says something was
estimated, says how much and across how many reporters, and - the half that is
easy to forget - does **not** appear on a year that was entirely filed.

It doctors a copy rather than waiting for real estimated data because the
live snapshot carries no estimation block until the first reprocess, and a
check that cannot run until then is a check nobody runs.

The mark is typographic, never coloured. Colour on this dashboard says which
series a line belongs to; a second meaning laid over the first makes both
unreadable, so the suite asserts the mark is an asterisk.

## Since the Phase 2/3 refresh (October 2026)

```
node qa/suite/serve.mjs /tmp/dist-p2 4190 &   # dist + a fixture snapshot that has
                                              # scope.json and detail/ files
node qa/suite/exportcheck.mjs  # 164 — workbooks (HS-2/4/6/8, home), CSV, PDF/PNG
node qa/suite/contrast.mjs     # every visible text element, both themes, 4.5:1
BASE=http://127.0.0.1:4190 node qa/suite/contrast.mjs
```

`/tmp/dist-p2` is `dist` with `data/snapshots/current` replaced by a fixture
snapshot built with the current pipeline (`scripts/dev-fixture.sh`, or
`process_snapshot.py --fixture ... --out <dir>`). A real snapshot gains
`scope.json` and `detail/` only at its next reprocess, and "every row, not the
top 5" can only be asserted against one that has them.

`exportcheck.mjs` reads workbooks with `fflate` (a dependency already); the
`xlsx` package left the project with the in-house workbook writer.

Selectors moved with the refresh: the tariff-line box is
`#section-dgcis .dgcis`, its lines are `.rf-tariff-tile`, sections are
`.rf-section`, the download control is `.download-master` opening
`.rf-download-menu`, and the HS-8 page shows both flows at once (no flow
switch). The 375px HS-6 overflow that `postdeploy.mjs` used to excuse is
fixed, so the excuse is gone.

## Overlap audit and the secret look (October 2026, second pass)

```
node qa/suite/overlap.mjs          # 3,068 — 15 pages × 7 shapes × 2 themes,
                                   # at rest and with everything opened
LOOK=aman node qa/suite/overlap.mjs
node qa/suite/easteregg.mjs        # 36 — the ~AM1708 switch, end to end
node qa/suite/decimals.mjs         # 21 — the Decimals switch: exact rounding, every page, persists
LOOK=aman node --import ./qa/suite/look-env.mjs qa/suite/mobile.mjs   # any suite, secret look
```

`overlap.mjs` measures what a reader notices first: text on text (line boxes
from Range rects, clipped to what is actually drawn), text cut off by a
clipping ancestor, text spilling out of its tile/cell/button, intersecting
flex/grid siblings, sideways overflow, fixed/sticky chrome covering text as
the page is scrolled a viewport at a time, and section order against the
section tabs. Popovers over the page count only if they are see-through.

`look-env.mjs` wraps playwright's chromium so every context starts with
`localStorage['hstat-look'] = 'aman'` when `LOOK=aman`; it also passes
`PW_CHROME` as the executable. Suites run unchanged otherwise.
