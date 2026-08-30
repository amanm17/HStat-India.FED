# HStat.India

A trade-intelligence dashboard for India's electronics sector, built on one
rule:

> The public dashboard reads only validated stored snapshots. It never queries
> UN Comtrade at page-load time, and it never publishes a figure that failed
> validation.

Snapshot schema **2.0.0**.

---

## What changed in 2.0

| | 1.x | 2.0 |
|---|---|---|
| HS coverage | 56 codes, hard-coded | **423 codes** from an editable CSV, plus 106 HS-4 and 20 HS-2 aggregates |
| Global figures | reported imports **and** reported exports, side by side | **one global trade figure**, net of re-imports, with the export side kept as a mirror check |
| Frequency | annual | annual **and** monthly, on the same coverage gate |
| Search | ranked list of HS codes | a plain-language **answer** first, the list second |
| Baskets | — | **HStack**: many codes read as one line item |
| India HS-8 | scripted DGCIS pull | a static, hand-editable CSV |
| HS vintages | mixed together in one list | **HS 2022 is the base**; retired codes become lineage, not products |
| Refresh | manual | monthly GitHub Action: pull → validate → promote → deploy |

---

## The sector definition is the source of truth

Everything downstream — what gets pulled, what search knows, what HStack can
add — comes from two CSV files. No part of the pipeline discovers HS codes
from an API.

```text
config/fed_sector_definition.csv    423 HS-6 codes and their metadata
config/hs_aliases.csv               the everyday words people actually type
```

Two more hand-maintained files sit alongside them and follow the same rule —
edit the file, re-run the refresh:

```text
config/hs_lineage.csv               where a current code's history sat before
config/fx_inr_usd.csv               rupees per dollar, one rate per period
```

`fed_sector_definition.csv` carries, per code: the official description, the
FED product name, Category, Segment, DGCIS segment, the
`in_fed_definition` flag (312 yes / 111 reference-only) and the study-inclusion
flags. Edit it, re-run the refresh, and the whole dashboard follows.

To fold in a new edition of the workbook:

```bash
python scripts/build_definition_csv.py \
  --workbook "FED Electronics Sector Definition.xlsx"
```

Hand-written `search_terms` already in the CSV are preserved.

`hs_aliases.csv` maps everyday vocabulary to codes. A row marked
`primary=yes` produces the confident answer card; `primary=no` only nudges
ranking.

**The organising rule** — and the reason HS-2 and HS-4 are first-class here
rather than a by-product of the six-digit list:

```text
a generic or plural term answers at HS-4    "batteries"           -> 8507
a specific product term answers at HS-6     "lithium ion battery" -> 850760
a whole-sector term answers at HS-2         "electronics"         -> 85
```

Ask about a category and you get the category; ask about a product and you get
the product. Coverage today:

| Level | Codes with an answer term |
|---|---|
| HS-6 | 416 / 423 |
| HS-4 | 96 / 106 |
| HS-2 | 20 / 20 |

Two rules fill this in without hand-writing 549 rows. A product label carried
by exactly one code is promoted to an answer term automatically — there is
nothing for it to be confused with. Labels shared by several codes (eight are
"Cables", ten are "Lamps") are disambiguated by hand in the CSV, and a
hand-written row always beats the automatic rule. Those curated terms also
become each code's display label, which is why the eight children of 8544 read
*Optical fibre cable*, *Wiring harness*, *Coaxial cable* rather than "Cables"
eight times.

After editing either CSV, check the vocabulary still behaves:

```bash
python pipeline/build_hs_library.py && npx tsx scripts/search-smoke.ts
```

Official HS-2 and HS-4 titles come from Comtrade's reference table and are
cached in `config/hs_titles.json`. Offline, a title derived from the member
descriptions is used instead — it is visibly weaker, and self-heals on the
first refresh that has network.

---

## HS 2022 is the base; older codes are lineage

The workbook mixes HS vintages. 851712 (all cellular phones) was split into
851713 and 851714 in HS 2022; 854140 was split four ways; 852580 was
subdivided. Left as-is, those retired codes would appear as products with
almost no trade sitting next to their own successors.

`config/hs_lineage.csv` fixes that. A code listed there as a `predecessor`
gets **no product page** — HS 2022 is the base — but is still pulled, and is
still findable.

```text
code    predecessor  relation  predecessor_valid_to
851713  851712       split     2021
851714  851712       split     2021
```

What each relation does:

| relation | treatment |
|---|---|
| `identical` | renumbered, same scope — the predecessor's years are **spliced** on |
| `split` | one code became several — **never spliced** |
| `merge` | several became one — **never spliced** |
| `new` | no single predecessor — nothing to splice |

**Why a split is never spliced.** The old total covers every successor at
once. Dividing it between them requires a share nobody has published, and
inventing one would be indistinguishable from data. So:

- The **six-digit** page shows its own series starting when the code does,
  with the predecessor drawn beside it as a separate dashed line, plus a note
  saying what it was and why the two are not joined.
- The **HS-4 heading** is where the long series genuinely is continuous,
  because the split is internal to it — and because HStat pulls headings
  directly from Comtrade, that continuity needs no splicing at all. The
  product page links straight to it.
- Searching the old number says where the trade went and offers the
  successors, rather than an Open button leading to a page that does not
  exist.

`validate_snapshot.py` enforces both halves: a retired code must never gain a
product node, and a `split` or `merge` predecessor must never be marked
spliced.

Codes retired in the current definition: 851712, 854140, 852580, 847310,
851950. The build cross-checks every code against Comtrade's HS-2022
reference table when it runs with network, and reports anything else that has
gone stale.

---

## Global trade: one figure, and why

The dashboard used to show reported global imports next to reported global
exports. Those two measure the same trade from opposite ends and never agree,
which reads to a user as an error rather than as a property of mirror
statistics.

There is now one number:

```text
global trade = Σ over reporting economies of
               (imports from World − re-imports filed by that reporter)
```

- **Import basis, CIF.** Matches how import-substitution and PLI analysis is
  framed.
- **Re-imports removed.** Total imports as filed already include them
  (`M = FM + RM + MIP + MOP`), so goods that left a country and came back
  would otherwise be counted twice.
- **Honest about what could not be adjusted.** Not every reporter files `RM`
  separately. Each figure carries `adjustmentCoverage`: the share of the world
  total that came from reporters who did.
- **The export side is still computed**, net of re-exports, and published as a
  mirror gap. A positive gap is normal — CIF includes freight and insurance
  that FOB excludes.
- **Nothing is published for a period that failed coverage validation.** No
  headline, no rank, no share. The raw observations stay in the annual detail
  and in the workbook export.

India's bilateral partner rows stay gross: re-imports are not filed by partner.
That is stated in the data (`basis: "gross"`) and on the page.

### Reporter coverage

Comtrade is a rolling collection — a recent year holds whichever economies have
filed so far. Publishing that as "the world" understates it, and the shortfall
moves month to month, so a dashboard would appear to report a collapse in trade
when it is only reporting late paperwork.

Each period is judged against the one before it (`pipeline/coverage.py`):

- **VALID** — previous #1 reporter present, ≥9 of the previous top 10, ≥95% of
  previous top-20 value, reporter count ≥80%.
- **CAUTION** — ≥8 of the top 10, ≥90% of value, count ≥75%.
- **INVALID** — anything else.

Only VALID periods carry a headline. On top of that, India's own filing must
reconcile with India's row inside the all-reporters frame, or the period is
demoted.

---

## Running a refresh

```bash
cp .env.example .env          # add COMTRADE_API_KEY
./scripts/bootstrap.sh
./scripts/refresh-monthly.sh
```

That runs, in order: build the search index → validate the ITC(HS)-8 CSV →
pull Comtrade → process a staging snapshot → validate it → promote it over
`current`. **Every step fails closed.** If the pull is incomplete or QA finds a
failure, the live snapshot is untouched — a stale but validated dashboard beats
a fresh but wrong one.

### Subscription limits come first

Comtrade's limits differ by tier and the published figures do not agree with
each other. They live in `config/scope.json` under `api`, and the shipped
values are the **free tier**:

| tier | calls/day | records/call | rate |
|---|---|---|---|
| free (basic individual) | 500 | 100,000 | 1/sec |
| premium individual | 5,000 | 250,000 | 5/sec |

**Getting `maxRecordsPerCall` wrong is silent data loss, not a slow build** —
a response truncated at the cap looks exactly like a complete answer. So
measure it against the key in use before the first build. It costs three
calls:

```bash
python pipeline/pull_comtrade.py --probe
```

The probe sends progressively larger requests and reports the real ceiling,
then tells you what to put in `scope.json`. If it reports 500 records, the key
is only reaching the unauthenticated preview endpoint and this universe is not
viable on it — 549 codes would need tens of thousands of calls.

### Ask for the aggregate row only

Every request pins three parameters, set in `scope.json` under
`api.aggregates`:

```text
partner2Code  0     World — all second partners as one
customsCode   C00   TOTAL customs procedure
motCode       0     TOTAL modes of transport
```

Left unset, Comtrade returns the second-partner, customs-procedure and
mode-of-transport breakdowns **alongside** the aggregate. `filter_classic()`
in `common.py` drops them on the way in, so the stored totals have never been
wrong — but summing an unfiltered response would inflate a figure by whatever
factor the reporter happens to break its filings down by. More practically:
every one of those rows counted against the 100,000-record cap that the entire
call budget is built around, so they were quota spent on data that was
immediately discarded.

Two guards sit behind this. The pull reports how many rows the filter had to
drop — with the parameters pinned that should be zero, and a large number means
the request is not doing what it says. And `assert_unique()` refuses to store a
chunk holding two rows for one reporter/partner/commodity/flow/period, because
nothing downstream survives that: world totals are built by summing reporters,
and a duplicate would either inflate the total or silently replace the
aggregate with one slice of it.

**Do not change these off the aggregate.** The stored rows would stop being
additive, and every world total built from them would be meaningless.

The pull paces itself to `minSecondsBetweenCalls`, refuses to store any
response at or above 95% of the cap, and warns when a run needs more calls
than a day allows.

### Check the cost before spending quota

Always look at the plan before a first run:

```bash
python pipeline/pull_comtrade.py --dry-run
```

At current settings — free tier, 549 codes, 1996 to date, a 24-month rolling
India window — that reports:

```text
cold build          542 calls   -> two days at --max-calls 480
light run            36 calls
deep run             90 calls
annual only         426 calls   (--months 0)
```

Three things keep it that low:

- **Requests are sized by the rows they will return**, not by a fixed code
  count. A single-period request carries the whole universe; an eight-year one
  carries 68 codes. Override with `--chunk-size` if a response ever nears the
  250,000-record cap — at which point the pull **stops** rather than storing
  truncated data.
- **Revisable periods are grouped separately from settled ones.** The last 3
  years and last 3 months get a request each so a monthly run re-pulls only
  those; settled history is fetched once and served from
  `data/raw/store/` forever.
- **The India scope pulls only M and X.** Its bilateral breakdown is the only
  thing read from it — India's netted totals come from its row in the global
  frame, and re-imports are not filed by partner.

Deeper history is close to free in the steady state: extending the start year
from 2016 back to 1996 adds ~130 calls to the **first** build and nothing at
all to the monthly one, because settled years are never re-pulled. Frequency is
the recurring cost. `monthly.scopes` in `config/scope.json` (or
`--monthly-scopes`) controls it:

| monthly.scopes | first build | per month |
|---|---|---|
| omitted (`--months 0`) | 90 | **36** |
| `["india"]` | 152 | **48** |
| `["india","global"]` | 276 | **72** |

Dropping `global` from the monthly scopes is the cheapest real saving
available: most reporters file monthly data late, so those periods fail
coverage validation and publish nothing anyway.

`--mode full` forces a complete rebuild. `--max-calls N` caps a run and leaves
the rest for the next one; progress is saved even if a call fails partway, so a
large first build can be spread across days.

### Retries, and the call log

Every request gets **three attempts** with exponential backoff. Comtrade
returns transient 429s and 5xx under load and a single failure is usually
nothing, but a refresh that silently dropped a flow would publish an
understated world total — so a call that never succeeds stops the run.

Every failed attempt is appended to `data/logs/call-errors.jsonl`, whether or
not a later attempt succeeded:

```json
{"at":"...","label":"A/global/M/1996-2005/03","attempt":2,"attempts":3,
 "error":"ConnectionError","message":"429 ...","retryInSeconds":10,"final":false}
```

A chunk that needed three goes is not an error, but it is exactly what you
want to see in the log when next month's run fails outright. The pull prints a
one-line summary of how many attempts failed and how many recovered, and the
workflow uploads the log alongside the QA report.

### Spreading a build over several days

A cold build is 542 calls against an allowance of 500 a day, so it has never
fitted in one run. It now finishes on its own rather than needing a manual
re-run:

| plan | days | per day | headroom for retries |
|---|---|---|---|
| 2 days | 2 | 480 | 20 calls |
| **3 days** | **3** | **200** | **300 calls** |

The second column is the point. At 480 a day, three attempts on a handful of
struggling calls can exhaust the allowance mid-run; at 200 it cannot.
`--dry-run` now works this out and prints the budget to use.

The workflow runs on the **5th, 6th and 7th**. The 5th does the scheduled work.
The 6th and 7th call `pull_comtrade.py --check`, which asks the store whether
anything is outstanding and **costs no API calls**, and stop immediately if
not.

**The steady state does not need any of this** — a light month is 36 calls and
the deepest quarter 90, roughly 7% and 18% of a single day. In an ordinary
month the 6th and 7th find nothing to do and the runs end in seconds. They
exist for the cold build and for the month where the source is throttling.

### The steady state

Annual data for a year three back barely moves. The current year and the last
few months move constantly. Refreshing both on the same cadence spends calls
on data that has not changed, so the schedule is split:

| run | cadence | flags | calls |
|---|---|---|---|
| light | 8 months a year | `--refresh-years 1 --refresh-months 3` | **36** |
| deep | quarterly (Jan/Apr/Jul/Oct) | `--refresh-years 3 --refresh-months 6` | **90** |
| full rebuild | on demand | `--mode full` | 542 |

```text
steady state      648 calls a year   (54 a month on average)
worst single day   90 calls          = 18% of the free daily allowance
```

`.github/workflows/monthly-refresh.yml` picks light or deep from the month
automatically, prints the call plan before spending anything, and carries a
hard `--max-calls` ceiling (default 150) so no run can overrun even if the
code list changes underneath it.

**The first build needs two days.** Run it manually with
`--max-calls 480`, twice:

```bash
./scripts/refresh-monthly.sh --mode full --max-calls 480   # day one
./scripts/refresh-monthly.sh --mode full --max-calls 480   # day two
```

A run that hits its budget with work still queued exits **3**: the staging
snapshot is built and validated, but `current` is deliberately left alone,
because a snapshot built from a short store would be missing whole periods
rather than visibly broken. The workflow treats exit 3 as a warning, skips the
commit, and finishes normally on the next run.

### Monthly data

Monthly is on (`config/scope.json` → `monthly.rollingMonths: 24`) and runs
through the same coverage gate as annual. Expect many months to show blank
global figures: most reporters file monthly data late, so those periods
genuinely fail validation. India's own monthly series is usually available much
earlier, and the trade-trajectory chart has an Annual / Monthly toggle.

Set `monthly.enabled: false`, or pass `--months 0`, to switch it off.

### India ITC(HS)-8

The canonical input is one static file:

```text
data/dgcis/india_hs8.csv
hs8,description,fy,flow,value_inr,value_usd,months_covered
84713010,Laptops including notebook and palmtop,2024-25,import,41200000000000,,12
```

`python pipeline/import_dgcis.py` validates it, and will normalise any
CSV/XLSX dropped into `data/dgcis/incoming/` into it first. A missing file is
normal — the dashboard reports tariff-line detail as unavailable rather than
inventing it.

Four things about this file are load-bearing.

**The period column is `fy`, and a bare year is refused.** DGCIS publishes
April–March and Comtrade publishes January–December. "2024" in a DGCIS export
might mean FY 2023-24 or FY 2024-25, and choosing one silently would move a
year of trade by up to twelve months. Write `2024-25`, or `FY25`, or
`FY 2024-25` — all normalise to `2024-25`. A file still carrying a `year`
column is rejected with an explanation rather than guessed at.

**Financial years never enter the calendar-year series.** Tariff lines live in
their own `tariffLines` block on each node, not inside `annual`. The QA gate
fails a snapshot that puts them in `annual`, because a right number under the
wrong period label is invisible on the page.

**Either currency, and whichever was filed is what gets shown.** Set
`value_inr` or `value_usd`, or both. The one you set is stored exactly as
filed; the other is derived with that financial year's rate and marked as
derived. Nothing is round-tripped, so the figure on the page is the figure
DGCIS printed.

**A part year must say so.** Set `months_covered` below 12 and the period is
labelled incomplete, is not chosen as the default view, and is skipped by the
reconciliation check — comparing nine months against a full calendar year
tells you nothing. Left blank, a financial year counts as complete once it has
actually ended. Rows within one financial year must all cover the same months,
or the total is a mixture of two periods and the importer refuses it.

### Rupees and dollars

Every stored value is in US dollars, because that is how both sources are
denominated. The rupee view is a conversion, and the rates behind it are a
hand-maintained file:

```text
config/fx_inr_usd.csv
period,basis,inr_per_usd,status,source,note
2023-24,FY,82.790,verified,Economic Survey Statistical Appendix Table 5.4 …
```

Each period converts at **its own** average rate. A single fixed rate across
thirty years would turn an exchange-rate movement into an apparent trade
movement, which is the most misleading thing a trade dashboard can do. So
calendar years use calendar-year rates, financial years use financial-year
rates, and months use monthly rates.

The convention follows what FED already uses in
`sources/Sectoral_Debt_INR_to_USD.xlsx`: RBI annual average reference rate,
financial years from the Economic Survey Statistical Appendix Table 5.4.
Calendar-year rates are the mean of that year's RBI monthly averages and must
be cited as such — the Economic Survey does not publish one.

**It fails closed.** A period with no rate is not converted: the page shows
dollars and says the rate is missing. No interpolation, no nearest-year
fallback, no carry-forward. A rate with no `source` is refused at load time.

```bash
python pipeline/fx.py --report      # which periods the snapshot cannot convert
python pipeline/fx.py --template    # append blank rows for those periods
```

The file ships with only the six financial-year rates already verified in the
FED workbook. Everything else is deliberately absent rather than guessed, so
the first `--report` will list a lot. Fill in the periods you actually present.

The rupee toggle applies to India's own figures and the tariff-line detail
only. Global trade, economy rankings and partner tables stay in dollars: an
RBI reference rate is the right way to read an Indian customs filing and the
wrong way to read anyone else's.

### Seeing an old HS code beside the new ones

HS 2022 split `851712` into `851713` smartphones and `851714` others. The
dashboard refuses to join those series, because dividing the old total between
the two successors needs a share nobody has published.

Summing the **family** is a different operation and an honest one. Before the
revision only the old code carries data; after it, only the new ones. They
never overlap, so the union needs no share at all.

So every node carries `lineage.family` — itself, what it came from, and its
siblings — and HStack does the rest. Add `851713` and the stack offers to add
`851714`; the retired `851712` has no page, but its years travel with the
successor and land in the combined series automatically. The result is one
continuous line from 1996 to now, built by addition rather than assumption,
with a note saying which codes reported in which year.

A break in that line is a year that failed coverage validation, not a fall in
trade, and the panel says so.

### Why HS-4 and HS-2 are pulled, not summed

It is tempting to derive the headings from the 418 six-digit codes and save the
calls. The reference table says why not: of the 106 headings in scope only
**30 are fully covered** by the definition, and overall it holds **418 of the
805** official six-digit lines in those headings. Heading 8501 would show 1 of
its 17 lines under the heading's own name.

It would also destroy the continuous long series. Headings are continuous
across the 2022 revision precisely because they are pulled whole, so the
851712 → 851713/851714 split is internal to 8517 and needs no reconstruction.
A derived heading inherits every split.

The saving would be roughly 124 calls on a cold build and 8 a month after
that, against a 500-a-day allowance.

What each parent page carries instead is a **definition-coverage** panel: how
many of the heading's official six-digit lines the definition tracks, and what
share of the heading's trade and of India's imports those lines come to. The
official figure stays official; the slice is stated rather than inferred.

```bash
python scripts/build_official_children.py   # regenerates the denominators
```

---

## Developing without an API key

```bash
./scripts/dev-fixture.sh        # whole 549-code universe, 6 months
npm run dev
```

This fabricates a raw store with the right shapes — reporter-to-World rows for
every flow, India reconciling across both frames, re-import sub-flows filed by
only some reporters — then runs the real processing, validation and promotion
over it. **The numbers are fake. Never commit a fixture snapshot.**

Restore real data with a normal refresh, or `git checkout public/data/snapshots`.

---

## Layout

```text
config/
  fed_sector_definition.csv   the HS master list — edit this
  hs_aliases.csv              search vocabulary — edit this
  hs_lineage.csv              classification history — edit this
  fx_inr_usd.csv              rupee/dollar rates by period — edit this
  datasets/                   one manifest per registered dataset
  concordances/               how one key space maps to another
  scope.json                  years, monthly window, global-trade method,
                              currency and period rules
  hs6_universe.txt            generated; a readable diff of the pull universe
  parent_universe.json        generated
  hs_official_children.json   generated; official six-digit lines per heading
  reference/                  saved Comtrade reference tables, for offline use

sources/                      the workbooks the config is derived from

pipeline/
  definition.py               loads the CSVs; everything else reads this
  pull_comtrade.py            batched, checkpointed, resumable pull
  store.py                    read side of the raw store
  globaltrade.py              the netting and ranking engine
  coverage.py                 the publish / withhold decision
  process_snapshot.py         raw store -> staging snapshot
  validate_snapshot.py        the QA gate
  rotate_snapshot.py          promotes staging over current
  build_hs_library.py         builds the search index
  datasets.py                 the dataset registry and concordances
  fx.py                       the rupee/dollar rate table
  import_dgcis.py             validates the static ITC(HS)-8 CSV
  launch_sanity.py            pre-deploy check on what is about to ship
  refresh_monthly.py          the whole thing, in order

src/
  lib/search.ts               answer-first search
  lib/hstack.ts               basket aggregation
  lib/globaltrade -> see pipeline; the frontend only reads
  components/                 SearchHub, ProductView, HStackPanel

public/data/snapshots/
  current/  previous/         only two are ever kept
```

`pipeline/*_parent_*.py`, `pull_test_*.py` and `benchmark_test_*.py` are from
the 1.x build-out. `process_snapshot.py` now produces the HS-2 and HS-4 nodes
in the same pass, so they are no longer part of any workflow.

---

## Snapshot shape

```jsonc
{
  "schemaVersion": "2.0.0",
  "level": 6, "code": "847130",
  "product": "Laptops", "category": "Computer Hardware",
  "inFedDefinition": true,

  "globalTrade": {              // the headline: latest VALID year
    "year": 2024, "value": 165689685762,
    "basis": "imports", "netReImports": true,
    "indiaRank": 6, "indiaShare": 0.0348,
    "adjustmentCoverage": 0.62,
    "mirror": { "ratio": 1.05, "gap": 0.05, "status": "OK" },
    "topEconomies": [ /* 25 */ ]
  },

  "annual":  { "2024": { "india": {...}, "global": {...} } },
  "monthly": { "202406": { "india": {...}, "global": {...} } }
}
```

Node files are written compact and carry **no per-file timestamp** — only the
manifest does. A refresh that does not change a product's numbers produces a
byte-identical file, so git stores nothing new for it. That is what keeps a
monthly commit of 549 nodes from growing the repository without bound.

---

## Automation

- **`.github/workflows/monthly-refresh.yml`** — 03:17 UTC on the 5th, or on
  demand with mode / months / call-budget inputs. Caches the raw store between
  runs, uploads the QA report whether it passed or failed, and commits only
  when the data actually changed.
- **`.github/workflows/deploy-cloudflare.yml`** — on push to `main`. Runs
  `launch_sanity.py` before building, so nothing ships with a catalogue that
  has drifted from the sector definition or with no headline figure at all.

Cloudflare Pages: framework preset Vite, build `npm run build`, output `dist`.
The site is static; the Comtrade key is never needed at build or serve time.

---

## Adding another dataset

HStat started as one dashboard over one source. It is now a shell that several
sources plug into, which is what makes ASI, PLFS and anything after them
additions rather than rewrites.

Three files decide everything:

```text
config/datasets/<id>.json        what the dataset is and what it is keyed by
config/concordances/<a>-<b>.csv  how one key space maps to another
data/raw/<id>/                   its own Parquet, its own shape
```

### A dataset declares its key space

```json
{
  "id": "asi",
  "keys": { "industry": "nic5", "region": "state", "period": "FY" },
  "periodBasis": "FY",
  "surface": { "route": "/industry", "panels": [ ... ] },
  "status": "declared"
}
```

Nothing is inferred from column names or file layout. Comtrade is keyed by
product, partner and calendar year; ASI and PLFS by industry, region and
financial year. The registry refuses an unknown key space, an unknown period
basis, or a manifest whose `id` does not match its filename — a typo becomes an
error rather than a dataset that silently never joins.

`status` separates *we have agreed the shape* from *we have the data*. A
`declared` dataset renders nothing but a stub, so a manifest can land months
before the ingest without putting an empty page in front of anyone.

### Two datasets meet only where someone wrote the bridge

A product code and an industry code describe different things — a good versus
an activity — and no amount of string matching bridges them. That bridge is a
file:

```text
config/concordances/hs6-nic5.csv
from_key,from_code,to_key,to_code,weight,basis,source,note
product,851713,industry,26301,,dominant,FED review,Smartphones sit under NIC 26301
```

- **No row, no join.** A panel whose concordance is missing or empty stays
  hidden, and `python pipeline/datasets.py` reports exactly why.
- **`source` is required.** A concordance is a judgement and someone owns it.
- **`weight` is optional, and its absence means something.** A blank weight
  links the codes but forbids apportioning any value across the link. Asserting
  that a product relates to an industry is cheap; asserting what share of it
  does is not. Weights that do not sum to 1 are reported, never auto-corrected.

### Where a dataset appears

Both, if it earns it. A dataset registers its own `route`, and can also
contribute `panels` into pages it does not own — matched on key, via a
concordance where the key spaces differ. That panel contract is what makes
datasets actually combine rather than sit in separate tabs.

```bash
python pipeline/datasets.py     # what is registered, what can render, what is blocked
```

The registry travels with the snapshot under `manifest.registry`, so the
frontend knows what exists without a second fetch.

### Storage

Bulk data is **Parquet**; the small hand-edited config files stay CSV. At the
scale the tariff-line file is heading for — roughly 12,000 ITC(HS)-8 lines, two
flows, ten years — that is 240,000 rows:

| format | size | write | read |
|---|---|---|---|
| CSV | 16.1 MB | 0.62s | 0.42s |
| Parquet | 3.2 MB | 0.22s | 0.26s |

Five times smaller and typed, so a code column cannot lose its leading zero on
a round trip. `import_dgcis.py` validates the CSV and writes the Parquet beside
it; the pipeline reads the Parquet when it exists and the CSV when it does not,
so a file small enough to hand-maintain still works with no Parquet at all.

---

## Data principles

- Global comparisons use **HS 2022 / H6** at 6 digits.
- India national detail uses **ITC(HS) 8-digit** from a static DGCIS /
  TradeStat CSV.
- Global totals, ranks and shares are not displayed for a period that failed
  coverage validation.
- Missing data stays missing. No placeholder or synthetic trade values.
- Every figure records its basis, its adjustment coverage and its QA status.
