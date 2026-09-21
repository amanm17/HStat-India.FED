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
