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
