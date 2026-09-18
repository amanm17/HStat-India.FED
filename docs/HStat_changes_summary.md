# HStat.India — what changed, and what was checked

As at 18 September 2026. Live = `origin/main` `75b914c`.

## Changed or fixed

| # | Change | Live? | Validity checked |
|---|---|---|---|
| 1 | **DGCIS data was exports, published as imports.** Flow corrected throughout. | ✅ live | ✅ **Yes.** 1,471 of 1,487 HS-6/year pairs match exports; median ratio to exports 1.00, to imports 0.12. Smartphones 2025: 30,133 vs Comtrade exports 30,134. |
| 2 | **Flow guard** — `--flow` now required, checked against Comtrade before anything is written. | ✅ live | ✅ **Yes.** Both flows AGREE. Negative-tested: declaring the wrong flow exits 2 and writes nothing. No bypass exists. |
| 3 | **India imports added** as a second flow. | ✅ live | ✅ **Yes.** Guard AGREES (1,465/39 of 1,504), median ratio to Comtrade imports 0.9998. |
| 4 | **Tile list still said "imports"** on the DGCIS panel. | ✅ live | ✅ **Yes.** Old string gone from the bundle, new one present, 158 browser checks re-run. |
| 5 | **Search couldn't reach tariff lines by product word.** "smartphone" now finds 85171300 through its heading. | ✅ live | ✅ **Yes.** 21 checks; asserts it says *how* it got there and never claims DGCIS filed that word. |
| 6 | **Drilling HS-6 → HS-8 re-downloaded the parent file.** Now memoised. | ✅ live | ✅ **Yes.** Network trace: 0 extra requests on drill-down and on the walk back up. |
| 7 | **543 tariff-line pages shared 7 titles** (165 said "ELECTRONICS INSTRUMENTS"). Now 255 titles. | ⏳ **not pushed** (`5698a3c`) | ⚠️ **Partly.** 146 browser checks pass and it builds clean — but in a container, **not on your Mac**, and never seen live. |

## New

| # | Addition | Live? | Validity checked |
|---|---|---|---|
| 8 | **HS-8 as a real level** — every tariff line has a page at `/hs/<8 digits>`, linked both ways with its HS-6. | ✅ live | ✅ **Yes.** 100 checks incl. flow switching against ground-truth values, retired routes, 3 viewports. |
| 9 | **Composition column** on the HS-6 panel — 851762 reads as one line carrying 98.5%. | ✅ live | ✅ **Yes.** Covered by the 27-check suite. |
| 10 | **Tariff lines in search**, in their own group labelled "not world trade". | ✅ live | ✅ **Yes.** 12 checks. |
| 11 | **DGCIS in file exports** — `India HS-8 · DGCIS` sheet + a CSV button on the panel. | ✅ live | ✅ **Yes.** 21 checks that *download* the files and read them back. |
| 12 | **`refresh_dgcis.py`** — one command, pauses for the CAPTCHA, then validates → processes → builds → reports what moved. | ✅ live | ✅ **Yes**, end-to-end with `--skip-download`. Never yet run against genuinely new months. |
| 13 | **QA suites** — 202 browser checks in `qa/suite/`. | ✅ live | ✅ Self-verifying. |
| 14 | **Failure isolation** — the Comtrade dashboard survives DGCIS being missing, stale, corrupt or throwing. | ✅ live | ✅ **Yes.** Broken 7 ways deliberately, incl. a forced mid-render throw. |

## Investigated, nothing built

| # | Question | Answer | Checked |
|---|---|---|---|
| 15 | Use partner-reported **exports** to fill missing imports? | **No.** Export side is 26% emptier in 2025, not fuller; median error 12–14% per product even in a healthy year. | ✅ Back-tested on 418 products × 2 years. |
| 16 | Use each country's **own national data**? | **Yes, viable.** China alone is $700bn of the $837bn gap. Not built. | ✅ Gap quantified; China's last filing confirmed as 2024. |
| 17 | Mirror Comtrade's availability dashboard? | **Feasible** — public keyless API. Not built. | ✅ API verified working. |
| 18 | Comtrade **monthly** data? | Runs to **2026-06**. 9 of the top 15 traders file it; China, Korea, Taiwan, Vietnam, Singapore don't — so it can't make a world total. | ✅ Verified at source. |

## Not started

HS-8 report generation · homepage rework · help button + navigation guide ·
slash-command search · left navigation rail · availability page · Comtrade query
page (design agreed, awaiting your choice on whether a key is handled at all).

## Needs you

1. **Push `feat/hs8-naming`** — run `find .git -name '*.lock' -delete` first.
2. **August refresh** — data still ends 2026-06; July *and* August are out.
3. **ITC(HS) 8-digit schedule** — one download; the TIA commodity picker is the better source.

## Honest gaps

- Item 7 has not been built on your Mac or seen in production.
- The 255 titles are the *interim* — siblings still share a name until the real schedule lands.
- `refresh_dgcis.py` has never processed genuinely new months.
- The "null means missing" rule is correct in code but untested — DGCIS writes `0.000`, never blanks.
- Three npm vulnerabilities remain, all in the report/export path, none reachable by an outsider.
