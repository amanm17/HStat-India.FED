# References for the layer-3 check

HStat's figures come in three layers. A higher layer never overrides a lower one.

1. **Comtrade filings: the truth.** Nothing changes them.
2. **HStat's estimates** for what has not been filed (`pipeline/estimate.py`).
3. **A reference check.** A person reads an economy's reported totals in a reference source for the years HStat estimates. Every estimated year with a reference is realigned (tolerance 0 since 24 October 2026): the estimates are scaled by one factor for that economy, flow, year and, optionally, HS chapter or heading. Only the factor is stored, in `config/estimate_calibration.json`.

Reference files (`*.csv`) in this folder stay on the operator's machine: git ignores them, so reference figures are never published.

## Reading Trade Map by hand

1. List the HStat electronics codes:
   - all of them: `python3 pipeline/benchmark_estimates.py --codes 2025 > codes.txt`
   - one chapter: add `--group 84`
2. In Trade Map (www.trademap.org), create a custom product group from that list.
3. Select the economy as reporter and World as partner, yearly values, direct (reported) data.
4. For each flow, note the totals for every year HStat estimates, plus one year the economy has filed with Comtrade (the alignment check).
5. Enter them in a CSV here (format below), with your name and the date in `checked_by`.

Never extract Trade Map content with scripts, browser automation or its data interface. Its terms forbid that (MAT Terms and Conditions, section 12).

## Format (CSV)

| Column | Meaning |
|---|---|
| `reporter` | Comtrade/M49 code, for example `704` for Viet Nam |
| `flow` | `imports` or `exports` |
| `year` | Calendar year |
| `group` | Optional HS prefix: a chapter (`84`), a heading (`8471`) or a code. Blank means every HStat electronics code, minus any groups listed separately for the same economy, flow and year. |
| `value_usd` | Reported total in US dollars over that group's codes |
| `source` | Citation, for example `Trade Map, International Trade Centre, www.trademap.org (Viet Nam, direct data)` |
| `checked_by` | Who read the figure, and when. Required before a factor is recorded |

## Running it

```
python3 pipeline/benchmark_estimates.py data/benchmarks/<file>.csv          # report
python3 pipeline/benchmark_estimates.py data/benchmarks/<file>.csv --write  # record factors
```

Then rebuild the snapshot: Actions, Validated data refresh, depth `reprocess`.

**Chapter rows give a better product mix than one economy-wide factor.** In the Viet Nam check, computers (chapter 84) grew much faster than telecom (chapter 85). One economy-wide factor would raise both by the same amount.

## Terms

FED decided on 21 October 2026 to use Trade Map as a manually consulted reference. ITC's terms (sections 10, 12 and 14) reserve written permission for content that substantially supports a public dashboard. A permission request is open with itcreg@intracen.org. If ITC declines, remove the Trade Map-based entries from `config/estimate_calibration.json` and reprocess.
