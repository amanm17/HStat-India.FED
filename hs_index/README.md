# HS index

The single source of truth for which HS codes HStat.India covers and how they
are named, grouped and found. The pipeline reads these files directly; nothing
discovers codes from an API, and there is no Excel step.

| File | What it holds |
|---|---|
| `codes.csv` | Every HS-6 code in scope, with its tags: official description, display name, product family, category, segment, DGCIS segment, FED-definition flag, source flags, search terms, the intake batch that added it, and its stream (see "Streams"). |
| `parents.csv` | Every HS-2 chapter and HS-4 heading above those codes, with its short name. |
| `aliases.csv` | Everyday search vocabulary (code, terms, primary yes/no, note). |
| `lineage.csv` | HS revision history: codes split or merged in 2022, retired codes and their successors. A predecessor named here is pulled for history and its figures are carried into the successor's page, marked `**`. |
| `batches.json` | Every intake, oldest first, with the codes it added and whether their first data pull has finished. The pull groups codes by batch, so adding codes never invalidates earlier downloads. |
| `vocabulary.json` | The only values allowed for category, segment, DGCIS segment and stream. |
| `hs8_scope.json` | Which India tariff lines (HS-8, from DGCIS) are kept (see "Tariff lines"). |
| `naming_review.csv` | Reviewer verdicts for display names that use words outside the official HS text (see "Naming rules"). |
| `incoming/` | Drop new codes here. `incoming/rejected/` holds uploads that could not pass, each with a report. |
| `batches/<id>/` | One folder per upload: the original file, `review.csv` (every code, what was given, what was drafted) and `report.md`. |

Derived from these, and rewritten by the intake (never edit by hand):
`config/hs6_universe.txt`, `config/parent_universe.json`,
`config/hs_titles.json`, `config/hs_official_children.json`,
`src/lib/hsnames.generated.ts`.

## Adding codes

1. Put a CSV, Excel or text file in `hs_index/incoming/`. One HS code per row,
   in a column called `HS code`, `hs6` or `code`. Any column named like a
   `codes.csv` column (`display_name`, `category`, `segment`,
   `in_fed_definition`, `search_terms` ...) is taken as that tag; anything
   left out is drafted.
2. Push it (the **HS intake** workflow runs), or run locally:

   ```
   python pipeline/hs_intake.py            # check only
   python pipeline/hs_intake.py --apply    # check and merge what passes
   ```

3. Read `hs_index/batches/<id>/report.md`. A merged batch is pulled by the
   nightly backfill (about 01:07 IST), validated, and goes live once the
   snapshot passes every check; the batch is then marked pulled. To pull it
   now instead, add a line to `hs_index/pull_now.txt`, commit and push.

Scope only grows: a code already in scope is skipped, never changed, and
nothing is removed by an upload.

To choose the names yourself, put `display_name` (and any other tag) in the
upload, add `naming_review.csv` verdicts for names that use words outside
the official text, and add rows to `parents.csv` for new chapters and
headings; the intake then uses them instead of drafting. A code created in
2022 whose heading lost several codes needs its `lineage.csv` row first.
`python pipeline/hs_intake.py` (no `--apply`) checks an upload and leaves it
in place.

### What the intake checks

- **Format.** Digits only. Excel's lost leading zero is restored (`30490` →
  `030490`); an HS-8 is read as its HS-6.
- **Expansion.** An HS-2 or HS-4 brings in every HS 2022 six-digit code under
  it.
- **Real codes.** Every code must be in the HS 2022 table
  (`config/reference/comtrade_hs_reference_h6.json`). Comtrade's
  all-editions list (`comtrade_hs_reference.json`) also holds codes from
  older editions, so the intake will not merge anything until the edition
  table is present. A retired HS 2017 code is refused with a pointer to
  upload its successors instead (its history comes with them).
- **Lineage.** A code that HS 2017 did not have was created in 2022. One
  retired code in the same heading is drafted as its predecessor (a split);
  none is drafted as "new"; several stop the batch until
  `lineage.csv` names the right one. This needs
  `config/reference/comtrade_hs_reference_h5.json`, which
  `scripts/fetch_hs_references.py` saves (the workflow runs it).
- **Tags.** A display name given in the upload is used if it is unique and
  at most four words (the launch check refuses longer ones). Otherwise one is
  drafted from the official HS wording only, so it cannot be narrower than
  the code: a list in the official text ("table, floor, wall ... fans") is
  never cut to one item. When no such name fits in four words the code gets
  a placeholder ("Instruments and apparatus 902789"), listed in the report
  and flagged by the index check until someone names it; the data pull is
  not held up. Category, segment and DGCIS segment are drafted from the
  codes already in the same heading, then chapter; a code with neither stops
  the batch. Search terms are drafted only where no other code already
  answers to them. New chapters and headings get a short name from their
  official title.
- **The whole index.** With the batch merged, `pipeline/hs_index_check.py`
  must not find a single new error. Otherwise nothing is merged.

## Streams: keeping electronics figures electronics

Coverage grows beyond electronics, so every code says which figures it counts
toward (`stream` in `codes.csv`, values in `vocabulary.json`):

| stream | what | in electronics figures? |
|---|---|---|
| `electronics` | The FED electronics sector definition (every baseline code). | Yes: front-page totals, shares of electronics, rankings, segments, the DGCIS panel, report and workbook scope. |
| `electronics-inputs` | Materials, consumables, tooling and machinery used to make electronics (the SPECS batch). | No. Own pages, own totals (`scope-electronics-inputs.json`), front-page "Beyond electronics". |
| `other` | Wider trade coverage with no electronics role claimed. | No. Own pages, own totals (`scope-other.json`). |

- An upload without a `stream` column gets `other`, and without
  `in_fed_definition` gets `no`: expanding coverage never moves an
  electronics figure or the FED definition by itself.
- Moving a code into `electronics` is a deliberate edit of `codes.csv`
  (the intake notes it in the batch report). It changes the electronics
  totals from the next snapshot on, for every year.
- A tariff line takes its HS-6's stream; a line whose HS-6 is not in the
  index is `other`.
- The snapshot writes `scope.json` from electronics lines only;
  `validate_snapshot.py` fails a stream file that carries another stream's
  line.

## Naming rules

- Every display name and every short name is unique; a display name is at
  most four words.
- A search term (codes.csv `search_terms`, or a primary alias) belongs to one
  HS-6 code only.
- A name describes the **whole** HS-6 code, never a narrower product inside
  it ("Commercial washing machines" for a household-type code is wrong;
  "Server processing units" for all processing units is wrong).

The second rule cannot be checked by a program alone. `hs_index_check.py`
finds every name that uses a word the official text (of the code or its
heading) does not, and each one needs a row in `naming_review.csv`:
`code, display_name, verdict, note`, with verdict `ok` when the wording is a
fair name for the whole code. The verdict is tied to the exact name: rename
the code and it must be reviewed again.

Run `python pipeline/hs_index_check.py` after any hand edit. CI runs it on
every push.

## Tariff lines (HS-8)

India's own eight-digit lines come from the DGCIS portal, by hand (it is
CAPTCHA-gated). `hs8_scope.json` says which are kept:

- `chapters` (the default): every HS-8 under an HS-2 chapter this index
  covers. Adding codes in a new chapter widens it with no other edit.
- `list`: only the chapters named in the file.
- `all`: every HS-8 the download holds.

Every line in scope is kept, whether or not it traces back to an HStat HS-6
(until October 2026 only lines under an HStat code were kept). Each page says
how its HS-6 relates to HStat: `product` (links up to the product page),
`predecessor` (a retired code kept for lineage) or `standalone` (HStat does not
carry the heading; the line is a page of its own, named by its code, with the
official HS-6 wording as context and no Comtrade card).

Monthly: `python3 pipeline/dgcis/refresh_dgcis.py --scope` prints what to
select in the portal. Download exports and imports, put both in
`data/dgcis/inbox/` and push; the **DGCIS HS-8 refresh** workflow joins split
downloads, validates, checks each flow against Comtrade, rebuilds
`public/data/dgcis` and commits it. It refuses a download with over 10% fewer
lines than the site publishes (re-run by hand with `allow_shrink` if a
narrower scope is intended). A scheduled reminder arrives on the 2nd of each
month. When a product page goes live, the monthly data refresh relabels the
lines under it (`pipeline/dgcis/relabel_published.py`).
