# Benchmarks for estimated economies

Files here hold an economy's own reported trade, used to check HStat's estimates for the years it has not yet filed with Comtrade.

```
python3 pipeline/benchmark_estimates.py data/benchmarks/<file>.csv          # report
python3 pipeline/benchmark_estimates.py data/benchmarks/<file>.csv --write  # record calibrations
```

## Format (CSV)

| Column | Meaning |
|---|---|
| `reporter` | Comtrade/M49 code, for example `704` for Viet Nam |
| `flow` | `imports` or `exports` |
| `year` | Calendar year |
| `value_usd` | Reported value in US dollars |
| `hs6` | Optional. Blank means the whole electronics scope that year |
| `source` | The citation, as it should appear |

- **Include a filed year.** Give at least one year that the economy has already filed with Comtrade. That row checks alignment. If the benchmark and Comtrade differ by more than 2% in a filed year, the benchmark measures something different, and no calibration is proposed from it.
- **Tolerance.** Rows outside the tolerance in `config/estimate_calibration.json` (10%) get a proposed factor.
- **Review before writing.** Read the proposals before running `--write`, then rebuild the snapshot with depth `reprocess`.

## Sources

- **Use the economy's own published statistics:** its customs or statistics office.
- **ITC Trade Map:** use it only after ITC has given written permission for use in HStat (MAT Terms and Conditions, sections 10, 12 and 14). Send permission requests to itcreg@intracen.org. Until then, Trade Map is a manual reference for a person's review, and its figures do not go in this folder.
- **Never scrape:** do not fill these files by scraping or by automated extraction from any website.
