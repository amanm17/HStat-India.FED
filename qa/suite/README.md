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

## Post-deployment suites

Added after the first production deploy of both flows.

```
node qa/suite/postdeploy.mjs   # 98 — two-flow switching on HS-6 and HS-8 against
                               #      ground-truth values, search by code and word,
                               #      retired and predecessor routes, 375/768/1440,
                               #      and the malformed-payload matrix (missing or
                               #      corrupt index, missing or malformed parent,
                               #      previous shape, one flow absent, both absent)
node qa/suite/network.mjs      # what the browser actually fetches: the front page
                               # pulls no HS-6 payloads, a product page pulls one,
                               # flow switching pulls nothing, and a product with no
                               # DGCIS coverage never asks for a file that is not there
```

Two expectations in `postdeploy.mjs` encode findings rather than hopes, and
should not be "fixed" by loosening them:

- **A product word cannot reach a tariff line.** DGCIS ships eight coarse
  commodity groups and no HS-8 descriptions, so "smartphone" matches nothing
  in the DGCIS index. Inventing descriptions is not allowed. The assertion is
  that the Comtrade product answer still appears and no DGCIS group does.
- **The 375px HS-6 page overflows by 179px, and it is not this layer's doing.**
  Removing `public/data/dgcis` entirely leaves the same 179px: the cause is
  `.download-master`, `.stack-add` and `.pulldata`. The assertion is narrowed to
  what this layer owns - that the tariff table scrolls inside its own wrapper
  and contributes nothing to page overflow.

The 179px is now zero. The September visual pass gave `.download-master`,
`.stack-add` and `.pulldata` a wrap rule below 760px and put every wide table
in its own scrolling wrapper, so all six routes measure `scrollWidth ==
clientWidth` at 375px. The narrowed assertion still holds and should stay
narrow: it is about what this layer owns, not about the page total, which
`visual.mjs` now owns instead.

## Feature suites

Added with the September feature round: the left rail, the slash palette, the
help button, the tariff-line report, the front-page panels, `/availability`
and `/query`.

```
node qa/suite/p2check.mjs      # 21 — what a second page load refetches, and what
                               #      going back up the tree does not
node qa/suite/exportcheck.mjs  # 21 — CSV and workbook contents, the notes sheet,
                               #      and that a borrowed name never leaves
                               #      the app without its caveat
node qa/suite/navcheck.mjs     # 34 — rail, palette, deep links, the guide, and
                               #      the naming caveat wherever a name is borrowed
node qa/suite/featurecheck.mjs # 49 — the help button on every page, the HS-8
                               #      report capture, the front-page panels, and
                               #      the two new routes
```

## Visual suite

```
node qa/suite/visual.mjs       # 198 — 7 pages x 3 widths (375/768/1440) x 2 themes
```

It measures three things a screenshot review misses: elements that overlap
each other, overflow that cannot be scrolled to, and text clipped by its own
box. It found the slash palette's overlap (a three-child row was still using
the four-column grid), the tables that ran off 375px, and the buttons
`.head-actions` and `.panelhead` were cutting in half. Run it before any
deploy that touches `styles.css`.
