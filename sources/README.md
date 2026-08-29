# sources

The input documents the configuration is derived from. Nothing here is read by
the pipeline at run time — these are provenance, so a figure in `config/` can be
traced back to the workbook a person actually edited.

| File | Feeds | Notes |
| --- | --- | --- |
| `FED Electronics Sector Definition.xlsx` | `config/fed_sector_definition.csv` | The scope of the dashboard. Regenerate the CSV with `python scripts/build_definition_csv.py` after editing; it preserves the hand-written `search_terms` column. |
| `Capital_Goods_HS_Codes.xlsx` | not yet wired in | Sector mapping, capital goods, parts & accessories, plus **Removed HS Codes** and **Old HS Codes** sheets — the latter two overlap what `config/hs_lineage.csv` records by hand. Worth reconciling before the next lineage edit. |
| `Sectoral_Debt_INR_to_USD.xlsx` | `config/fx_inr_usd.csv` | From other FED work, kept here because it documents the house currency convention: **RBI annual average reference rate, by financial year**, sourced from the Economic Survey Statistical Appendix Table 5.4. Its Table 2 gives verified anchors for FY14, FY16, FY18, FY20, FY22 and FY24. |

## Why these live in the repo

They were previously in `~/Downloads`, where nothing else in the project could
see them and where a reader had no way to tell which workbook a config file came
from. The earlier copies were moved to `~/Downloads/_to_delete/hstat/`; the
copies here were checksum-verified against them.
