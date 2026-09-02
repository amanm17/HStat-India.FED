# Running HStat.India

The dashboard is live at **https://hstat-india.aman17-dps.workers.dev**.

Cloudflare builds this repository on every push to `main` and serves the
result. Nothing in this repository deploys anything itself, and nothing here
should start: the deployment works, and the way to keep it working is to leave
it alone.

Two things reach the site, by two different routes.

| | how it gets there | who runs it |
|---|---|---|
| **Code** — frontend, pipeline, config | push to `main`, Cloudflare rebuilds | `./scripts/ship.sh` |
| **Data** — the published snapshot | the refresh workflow validates, promotes, commits and pushes | GitHub Actions |

---

## Shipping code

```bash
./scripts/ship.sh "what changed"
```

It validates the committed snapshot, runs the launch gate, builds exactly what
Cloudflare will build, and only then commits and pushes. If any of that fails,
nothing is pushed.

---

## Rebuilding the data

**Actions → Validated data refresh → Run workflow**

| depth | calls | when |
|---|---|---|
| `reprocess` | **0** | after any change to processing, the validation window or the exchange-rate table. Rebuilds the snapshot from the raw store already in the cache. |
| `light` | ~90 | the ordinary monthly refresh. Re-pulls the revisable years and months. |
| `deep` | ~200 | quarterly. |
| `full` | ~590 | a cold rebuild of 1996 onwards. Pass `max_calls 200` and let the 6th and 7th finish it. |
| `probe` | 3 | measures what the key can actually do. Only needed if the key changes. |

The workflow validates before it promotes. A refresh that fails QA leaves the
live snapshot exactly where it is, so a bad run cannot take the site down.

It also runs itself on the 5th, 6th and 7th of each month. The 6th and 7th ask
the store whether anything is outstanding, which costs nothing, and stop in
seconds when it is not.

### Why the store matters

The raw Comtrade store is what makes a monthly refresh cost 90 calls instead of
590 — settled periods are fetched once and served from the cache forever.
GitHub deletes a cache that has not been read for 7 days, and the refresh
schedule leaves a 28-day gap, so **Keep the raw store warm** reads and rewrites
it every Monday. It costs nothing and it is the difference between a cheap
steady state and a cold rebuild every month.

---

## The gates

All fail-closed.

**QA on every push.** `.github/workflows/qa.yml` runs `validate_snapshot`,
`launch_sanity` and the real build on every push and pull request. It does not
deploy; it just refuses to let a broken commit sit on `main` unnoticed.

**The frontend and the snapshot must agree.** `launch_sanity.py` reads
`const SCHEMA` out of `src/App.tsx` and compares it with the snapshot's
`schemaVersion`, so the two cannot drift apart.

**Fabricated data cannot ship.** `./scripts/dev-fixture.sh` builds a synthetic
snapshot for offline work, and a fixture looks exactly like the real thing —
that is what makes it useful. It is stamped `"fixture": true` and
`launch_sanity.py` refuses anything carrying the mark.

**A partial pull never promotes.** If the call budget runs out mid-build, the
store is consistent but short. The run builds and validates a staging snapshot
and leaves `current` untouched.

**A period is either reported or it is not.** `validate_snapshot.py` counts,
for every year, how many nodes actually received reporter rows. A year present
for a handful of nodes and absent for the rest is not a quiet year, it is a
pull that failed silently, and it fails QA. This is the check that would have
caught the August 2026 build.

---

## Working offline

```bash
npm install
./scripts/dev-fixture.sh     # synthetic store, real pipeline, real QA gate
npm run dev
```

**The numbers are fabricated; the shapes are real.** Every node is built by the
real processing code and passed through the real quality gate. It covers the
full 1996–present span, so a change that only shows up in the long history can
be seen here. It cannot be deployed even by accident.

---

## Still outstanding

- **Tariff lines.** No DGCIS ITC(HS)-8 export has been supplied, so HS-8 detail
  is absent and the interface says so in one line rather than offering a
  control that does nothing. Format in `data/dgcis/india_hs8.csv.example`.
- **CY 2026 exchange rate.** Deliberately missing: the year is not over, so no
  period average exists. That period shows dollars and says why.
- **ASI and PLFS.** Declared in `config/datasets/`, no ingest written, and
  `config/concordances/hs6-nic5.csv` has no rows — so nothing renders for them
  yet, by design.
