import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Download, Pin, PinOff, Plus } from 'lucide-react'

import { Safely } from './Safely'

import type {
  CatalogueEntry,
  CurrencyBlock,
  CurrencyMode,
  HsNode,
  PeriodRecord,
} from '../types'
import { loadHsNodes } from '../lib/data'
import { TILES, type Workspace } from '../lib/workspace'
import type { Methodology } from '../types'
import {
  concentrationLabel,
  delta,
  inr,
  monthLabel,
  monthShort,
  ordinal,
  pct,
  plural,
  usd,
  nameOf,
  fixed,
  places,
} from '../lib/format'
import { comtradeQueryUrl, datasetsFor } from '../lib/comtrade'
import { standing, sideCaption } from '../lib/standing'
import { usePageHelp } from '../lib/pagehelp'
import {
  flowPhrase,
  flowWord,
  flowsOf,
  formatPeriod,
  exportRows,
  EXPORT_NOTES,
  formatValue,
  last12,
  latestOf,
  loadDgcis,
  rollingChange,
  seriesFor,
  shareOfParent,
  totalSeries,
  unitLabel,
  type DgcisBasis,
  type DgcisFlow,
  type DgcisNode,
} from '../lib/dgcis'
import {
  convertibleCount,
  defaultFinancialYear,
  money,
  rateFor,
  rateNote,
} from '../lib/currency'
import { palette } from '../lib/palette'
import {
  downloadCsv,
  downloadJson,
  downloadXlsx,
} from '../lib/export'
import {
  DataTable,
  Disclosure,
  Empty,
  ExplainMetric,
  InsightPanel,
  MiniMetric,
  PanelHead,
  StatusPill,
  Estimated,
  MarkerLegend,
  SeriesTable,
  Tabs,
  Tile,
  ViewTabs,
  type ChartView,
} from './primitives'

type Horizon = '5Y' | '10Y' | 'ALL'

/* Which world-trade figure the card shows. Gross is the default: it is what
 * the source files say, and the adjustment is offered rather than assumed. */
export type TradeBasis = 'gross' | 'net'

/*
 * Pick the unit a value axis should be drawn in.
 *
 * The axis used to be fixed at USD billions with one decimal. For any product
 * where India trades under about $50m that renders every tick as "0.0" - true,
 * useless, and the case on a third of the pages. The unit is now chosen from
 * the series itself, so a $9.7m line is drawn in millions and reads properly.
 */
export function axisScale(
  values: (number | null | undefined)[],
  inr: boolean,
): { divisor: number; unit: string; decimals: number } {
  const peak = Math.max(
    0,
    ...values.filter((v): v is number => typeof v === 'number' && isFinite(v))
      .map(Math.abs),
  )

  const steps = inr
    ? [
        { at: 1e7, divisor: 1e7, unit: '\u20b9 crore' },
        { at: 1e5, divisor: 1e5, unit: '\u20b9 lakh' },
        { at: 0, divisor: 1, unit: '\u20b9' },
      ]
    : [
        { at: 1e9, divisor: 1e9, unit: 'USD bn' },
        { at: 1e6, divisor: 1e6, unit: 'USD mn' },
        { at: 1e3, divisor: 1e3, unit: 'USD k' },
        { at: 0, divisor: 1, unit: 'USD' },
      ]

  const step = steps.find(item => peak >= item.at) ?? steps[steps.length - 1]

  /* One decimal only while the scaled peak is small enough to need it. */
  const scaled = peak / step.divisor

  return {
    divisor: step.divisor,
    unit: step.unit,
    decimals: scaled === 0 ? 0 : scaled < 10 ? 1 : 0,
  }
}

/* Comtrade's reporter code for India; also its partner code on its own rows. */
const INDIA_REPORTER = '699'

/*
 * Only the last point of each series is labelled. A number on every point
 * turns a trend line into a table; a number on the last one tells you
 * where it ended up without any of that.
 */
function lastPointLabel(colour: string, total: number, rupees = false) {
  return function render(props: unknown) {
    const { x, y, value, index } = props as {
      x: number
      y: number
      value: number | null
      index: number
    }

    if (index !== total - 1 || value === null || !Number.isFinite(value)) {
      return null
    }

    return (
      <text
        x={x}
        y={y - 10}
        textAnchor="end"
        className="chart-point-label"
        fill={colour}
      >
        {rupees ? inr(value) : usd(value, 1)}
      </text>
    )
  }
}

/*
 * What a mirror gap of this size actually tells the reader.
 *
 * The gap exists because of how trade is valued, not because of an error:
 * imports are reported CIF and exports FOB, so the world's imports of a
 * product always exceed its exports. The number is only useful once someone
 * knows which band it falls in and what that implies about the tables below.
 */
export function mirrorReading(gap: number | null): string {
  if (gap === null) {
    return 'Not computable this year: one side has no reported total.'
  }

  if (gap < 0) {
    return (
      'The export side is larger, which is the wrong way round. Exporters are ' +
      'reporting more of this product than importers are - usually a sign that ' +
      'some large importing economies have not filed, so the import ranking is ' +
      'the incomplete one here.'
    )
  }

  if (gap <= 0.1) {
    return (
      'Close agreement. The two sides differ by about what freight and ' +
      'insurance alone would explain, so both league tables can be read at ' +
      'face value.'
    )
  }

  if (gap <= 0.25) {
    return (
      'Wide but ordinary. Bulky or low-value goods carry proportionally more ' +
      'freight, and a gap this size is normal for them. Nothing here argues ' +
      'against using the figure.'
    )
  }

  return (
    'Wider than freight and insurance explain on their own. One side is ' +
    'probably missing filings for this product. The import side shown above ' +
    'is the fuller of the two; treat the export ranking as incomplete rather ' +
    'than treating the product as mis-measured.'
  )
}

/*
 * How much of the re-import double count could actually be removed.
 *
 * Goods that left a country and came back sit inside its import total twice
 * unless the reporter files them separately and we subtract them. Not every
 * reporter does, so this says how much of the world total was cleanable -
 * and therefore in which direction the published figure can be wrong.
 */
export function adjustmentReading(coverage: number | null): string {
  if (coverage === null || coverage === 0) {
    return (
      'No reporter filed re-imports as a separate line this year, so none ' +
      'could be removed. The figure above is gross, and sits above the true ' +
      'total by however much of this trade was goods coming home.'
    )
  }

  if (coverage < 0.25) {
    return (
      'Only a small part of the world total came from reporters who file ' +
      're-imports separately, so most of the double count could not be ' +
      'removed. Read the figure above as an upper bound: the true total is at ' +
      'or below it, never above.'
    )
  }

  if (coverage < 0.6) {
    return (
      'Between a quarter and three-fifths of the world total was cleaned of ' +
      're-imports. The figure above is close to right and errs high.'
    )
  }

  return (
    'Most of the world total came from reporters who file re-imports ' +
    'separately, so the adjustment is substantially complete and the figure ' +
    'above needs no mental discount.'
  )
}

function GlobalTradeCard({
  node,
  methodology,
  year,
  basis,
  onBasis,
  onYear,
}: {
  node: HsNode
  methodology: Methodology | null
  year: number
  basis: TradeBasis
  onBasis: (basis: TradeBasis) => void
  onYear: (year: number) => void
}) {
  /*
   * This card used to show a fixed benchmark year - the most recent one that
   * passed validation - while the rest of the page followed the reader's year
   * selector. On most products those were different years, and the two sat on
   * one screen looking like one year's data. It now follows the selection, and
   * where the selected year is withheld it says so and offers the last year
   * that was not.
   */
  const selected = node.annual[String(year)]?.global ?? null

  /* India's own trade for the same year, so the card can say where India
   * stands as a buyer and as a seller rather than only as a buyer. */
  const indiaYear = node.annual[String(year)]?.india ?? null

  /*
   * A retired code has no benchmark at all - latest_benchmark() only looks at
   * years inside the detail window, and every one of those failed coverage
   * because the code was already out of the nomenclature. Falling back to the
   * end of its real series is the only honest thing to offer.
   */
  const retired = node.lineage?.retired ?? null

  const fallbackYear =
    node.globalTrade?.year ?? retired?.lastPublished?.year ?? null

  const observed = selected?.observed ?? null

  const value =
    selected && selected.trade !== null
      ? basis === 'gross'
        ? observed?.grossImports ?? selected.trade
        : selected.trade
      : null

  if (value === null) {
    /*
     * Two different silences that used to read the same.
     *
     * A live code with a withheld year is a coverage problem: the economies
     * that reported last year did not all report this one.
     *
     * A retired code after its last valid year is not a problem at all. The
     * classification stopped existing. What remains in Comtrade is a handful
     * of reporters still filing under a dead number - 15 of the 168 that
     * filed HS 851770 in 2021 were still doing so in 2024 - and summing those
     * would not be a world total, it would be a rounding error dressed as one.
     */
    const afterRetirement =
      retired !== null &&
      retired.validTo !== null &&
      year > retired.validTo

    const reason = afterRetirement
      ? `HS ${node.code} was withdrawn from the Harmonized System in the HS ` +
        `${retired!.revision} revision and was last valid in ${retired!.validTo}. ` +
        `A few economies still file under the old number, but far too few to ` +
        `form a world total, so none is shown for ${year}.`
      : selected?.tradeStatus === 'CAUTION'
        ? 'Reporter coverage for this year is borderline, so the world total is held back.'
        : selected
          ? 'This year does not hold enough of the economies that reported the year before, so no world total, rank or share is shown for it.'
          : 'No data for this year.'

    return (
      <section className="release-section global-trade-card">
        <div className="release-section-head">
          <div>
            <div className="eyebrow">GLOBAL TRADE · {year}</div>
            <h2>
              {afterRetirement
                ? `Retired classification · last valid ${retired!.validTo}`
                : `Not published for ${year}`}
            </h2>
          </div>

          {selected && (
            <StatusPill
              status={afterRetirement ? 'HISTORICAL' : selected.tradeStatus}
              label={
                afterRetirement ? 'retired' : selected.tradeStatus.toLowerCase()
              }
            />
          )}
        </div>

        <Empty reason>
          {reason} The reported observations behind it are still in the annual
          detail and the workbook export.
        </Empty>

        {fallbackYear !== null && fallbackYear !== year && (
          <p className="global-trade-fallback">
            {afterRetirement ? 'This series ends in ' : 'The most recent year that did pass is '}
            <button
              type="button"
              className="linklike"
              onClick={() => onYear(fallbackYear)}
            >
              {fallbackYear}
            </button>
            {afterRetirement && retired?.lastPublished
              ? `, at ${usd(retired.lastPublished.value)}.`
              : '.'}
          </p>
        )}
      </section>
    )
  }

  const benchmark = {
    year,
    value,
    indiaRank: selected!.indiaRank,
    indiaShare: selected!.indiaShare,
    position: standing({ india: indiaYear, global: selected }),
    adjustmentCoverage: observed?.adjustmentCoverage ?? null,
    mirror: selected!.mirror,
    topEconomies: selected!.topEconomies ?? [],
  }

  const mirrorGap = benchmark.mirror?.gap ?? null

  /*
   * Published, but still filling in.
   *
   * The coverage gate asks whether this year still holds the economies that
   * mattered last year, on the import side, and that is the right test for
   * whether a figure may publish. It is not a test of whether the year is
   * finished. A recent year can clear it with a third of its reporters
   * missing and still be presented as if it were settled, which is how a
   * doubling that is really half a year's filings reads as a doubling in
   * trade. So where the evidence exists it is shown next to the figure, and
   * the figure itself is left exactly as filed.
   */
  const provisional = selected?.provisional ?? null

  /* The concrete amount taken out, for the year the headline is on. */
  const removed = observed?.reImportsRemoved ?? null

  return (
    <section className="release-section global-trade-card">
      <div className="release-section-head">
        <div>
          <div className="eyebrow">GLOBAL TRADE · {benchmark.year}</div>

          <h2>
            {basis === 'gross'
              ? 'World imports, as reported'
              : 'World imports, net of re-imports'}
          </h2>
        </div>

        <StatusPill
          status={selected!.tradeStatus}
          label={
            selected!.tradeStatus === 'CAUTION'
              ? 'Coverage borderline'
              : 'Coverage validated'
          }
        />
      </div>

      {provisional && provisional.length > 0 && (
        <div className="provisional-note">
          <div className="provisional-head">
            <span className="provisional-badge">STILL FILLING IN</span>
            <span>
              {benchmark.year} is published as filed, but is not yet comparable
              with {benchmark.year - 1}.
            </span>
          </div>

          <ul>
            {provisional.map(reason => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="global-trade-hero">
        <div className="hero-figure">
          <span>Global trade</span>

          <strong>
            {usd(benchmark.value)}
            <Estimated
              share={selected?.estimation?.imports.estimatedShare}
              reporters={selected?.estimation?.imports.estimatedReporters}
            />
          </strong>

          <small>
            {basis === 'gross'
              ? "All reporting economies' imports from the world, as filed"
              : "All reporting economies' imports from the world, less re-imports"}
          </small>

          {selected!.tradeStatus === 'CAUTION' && (
            <p className="hero-caution">
              Reporter coverage for {benchmark.year} is borderline: the figure
              is shown, and is more likely to be understated than overstated.
            </p>
          )}

          <div
            className="basis-switch"
            role="group"
            aria-label="Re-import treatment"
          >
            {(['gross', 'net'] as const).map(option => (
              <button
                key={option}
                type="button"
                className={basis === option ? 'active' : ''}
                aria-pressed={basis === option}
                title={
                  option === 'gross'
                    ? 'Imports from the world exactly as each economy filed them'
                    : 'The same total with each reporter\u2019s re-imports subtracted, where it files them separately'
                }
                onClick={() => onBasis(option)}
              >
                {option === 'gross' ? 'As reported' : 'Net of re-imports'}
              </button>
            ))}
          </div>
        </div>

        {/*
          * Both sides, each named.
          *
          * The headline figure on this card is world imports, so the rank
          * beside it was always an import rank - but it was labelled "India
          * rank", full stop, and a reader had no way to know. For a product
          * India manufactures and sells, that single number is the opposite
          * of the story: 47th as a buyer, 1st as a seller. Showing one and
          * hiding the other is how the page came to look wrong when the data
          * was right.
          */}
        <div className="hero-side">
          <MiniMetric
            label="India: import ranking"
            value={ordinal(benchmark.position.imports.rank)}
            detail={`of all importers · ${pct(benchmark.position.imports.share, 1)} of world imports`}
          />

          <MiniMetric
            label="India: export ranking"
            value={
              benchmark.position.exports.rank !== null
                ? ordinal(benchmark.position.exports.rank)
                : benchmark.position.exports.unplaced
                  ? 'Top 10+'
                  : '—'
            }
            detail={
              benchmark.position.exports.rank !== null
                ? `of all exporters · ${pct(benchmark.position.exports.share, 1)} of world exports`
                : benchmark.position.exports.unplaced
                  ? `outside the top ten · ${pct(benchmark.position.exports.share, 1)} of world exports`
                  : 'not published for this year'
            }
          />

        </div>
      </div>

      <MarkerLegend
        estimated={Boolean(
          (selected?.estimation?.imports.estimatedShare ?? 0) > 0,
        )}
      />

      <Disclosure summary="How this figure is calculated">
        <p className="method-formula">
          global trade = Σ over reporting economies of (imports from World −
          re-imports filed by that reporter)
        </p>

        <ul>
          {(methodology?.globalTrade.notes ?? []).map(note => (
            <li key={note}>{note}</li>
          ))}
        </ul>

        {/*
          * The two diagnostics live here rather than beside the headline.
          * They are how the figure was arrived at, not what it says, and on
          * the front of the card they read as two more results - which is
          * exactly the confusion they caused.
          */}
        <div className="method-diagnostics">
          <ExplainMetric
            label="Mirror gap"
            value={mirrorGap === null ? '—' : delta(mirrorGap)}
            detail="import side vs export side"
            verdict={mirrorReading(mirrorGap)}
          >
            <p>
              Every economy reports what it buys including freight and
              insurance, and what it sells without them. The same shipment is
              therefore worth more on the import side than on the export side,
              and the world's imports of a product always exceed the world's
              exports of it. This is that wedge, measured against the export
              side.
            </p>

            <p className="explain-use">
              A gap is expected. What is worth acting on is a gap far outside
              the ordinary range, which points at missing filings on one side
              rather than at a problem with the product.
            </p>
          </ExplainMetric>

          <ExplainMetric
            label="Re-import adjustment"
            value={pct(benchmark.adjustmentCoverage, 0)}
            detail="of the total could be adjusted"
            verdict={adjustmentReading(benchmark.adjustmentCoverage)}
          >
            <p>
              Goods that leave a country and come back are re-imports, and a
              country's import total already contains them. Summed across the
              world they are counted twice. HStat subtracts them — but only
              from reporters who file them as a separate line, which not every
              reporter does. This is the share of the world total those
              reporters account for
              {removed ? `, and ${usd(removed)} was removed on that basis` : ''}
              .
            </p>

            <p className="explain-use">
              The adjustment can only ever pull the figure down, so this number
              tells you which direction any remaining error runs in: always
              down, never up.
            </p>
          </ExplainMetric>
        </div>

        <p className="method-caveat">
          {benchmark.adjustmentCoverage !== null &&
          benchmark.adjustmentCoverage < 0.5 ? (
            <>
              For {benchmark.year}, reporters covering{' '}
              {pct(benchmark.adjustmentCoverage, 0)} of world imports filed
              re-imports as a separate flow. The rest are counted as filed, so
              the true figure is at or slightly below the one shown.
            </>
          ) : (
            <>
              For {benchmark.year}, reporters covering{' '}
              {pct(benchmark.adjustmentCoverage, 0)} of world imports filed
              re-imports separately.
            </>
          )}
        </p>
      </Disclosure>
    </section>
  )
}

/*
 * HS 2022 is the base, so a code that was split in 2022 simply has no
 * six-digit history. The old code's total belongs to all of its successors
 * jointly and cannot be divided between them without inventing a share, so
 * it is shown alongside the series and never added to it — and the reader is
 * pointed at the heading, where the split is internal and the long series is
 * genuinely continuous.
 */
/*
 * Source data — the four UN Comtrade queries behind this page.
 *
 * Imports against re-imports, the world against India. The published figure
 * is world imports minus world re-imports and India's position comes from the
 * other two, so all four are listed separately: a reader checking the
 * arithmetic needs both sides of the subtraction, not one merged link.
 *
 * Each link opens Comtrade's own query page with the selection already made.
 * Two earlier attempts are worth recording so they are not repeated: fetching
 * Comtrade from this page to build a CSV is refused outright (no CORS
 * headers, so the browser discards the response), and linking to the public
 * API returned the right rows but as JSON, which the browser saved as an
 * extensionless file named "HS" that nothing opens.
 */
export function PullData({
  node,
  year,
  onOpen,
}: {
  node: HsNode
  year: number
  onOpen?: (code: string, level: 2 | 4 | 6) => void
}) {
  const [open, setOpen] = useState(false)

  const retired = node.lineage?.retired ?? null

  /*
   * A retired code must not offer a year it did not exist in. Comtrade will
   * answer - a few economies keep filing under dead numbers for years - and
   * the answer would look like data rather than the residue it is.
   */
  const years = useMemo(() => {
    const all = [...node.years].map(Number).sort((a, b) => b - a)

    return retired?.validTo != null
      ? all.filter(item => item <= retired.validTo!)
      : all
  }, [node.years, retired])

  const [picked, setPicked] = useState<number>(
    () => (retired?.validTo != null ? Math.min(year, retired.validTo) : year),
  )

  useEffect(() => {
    setPicked(
      retired?.validTo != null ? Math.min(year, retired.validTo) : year,
    )
  }, [year, retired])

  const datasets = useMemo(
    () => datasetsFor(node.code, picked),
    [node.code, picked],
  )

  if (node.level !== 6) return null

  return (
    <div className="pulldata">
      <button
        type="button"
        className="stack-add"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        title="Source rows from UN Comtrade"
      >
        <Download size={15} />
        Source data
      </button>

      {open && (
        <div className="pulldata-panel">
          <div className="pulldata-head">
            <span className="eyebrow">SOURCE DATA · UN COMTRADE</span>

            <button className="linklike" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <div className="pulldata-top">
            <p className="pulldata-lede">
              The four requests behind HS {node.code}. No key, no account.
            </p>

            <div className="pulldata-year">
              <label htmlFor="pull-year">Year</label>

              <select
                id="pull-year"
                value={picked}
                onChange={event => setPicked(Number(event.target.value))}
              >
                {years.map(item => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {retired && (
            <p className="pulldata-warn">
              HS {node.code} left the Harmonized System in the HS{' '}
              {retired.revision} revision and years after {retired.validTo} are
              not offered: a few economies keep filing under the old number and
              those rows are residue, not a world total.
              {retired.successors.length > 0 && (
                <>
                  {' '}
                  Current data sits under{' '}
                  {retired.successors.map((item, index) => (
                    <span key={item.code}>
                      {index > 0 && ', '}
                      {item.published && onOpen ? (
                        <button
                          type="button"
                          className="linklike"
                          onClick={() => onOpen(item.code, 6)}
                        >
                          HS {item.code}
                        </button>
                      ) : (
                        `HS ${item.code}`
                      )}
                    </span>
                  ))}
                  .
                </>
              )}
            </p>
          )}

          {/* One grid, so every row is the same shape whatever the note
              says. The old panel let each row lay itself out and they came
              out differently. */}
          <ul className="pulldata-list">
            {datasets.map(item => (
              <li key={item.id}>
                <span className="pulldata-name">{item.label}</span>

                <span className="pulldata-note">{item.note}</span>

                <a
                  href={comtradeQueryUrl(item.query)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open
                </a>
              </li>
            ))}
          </ul>

          <p className="pulldata-foot">
            Each opens UN Comtrade with the selection already made — commodity,
            year, flow, reporter and World as the partner — where the result
            can be read and downloaded.
          </p>
        </div>
      )}
    </div>
  )
}


export function LineageNote({
  node,
  onOpen,
  carriedInTrend = false,
}: {
  node: HsNode
  onOpen?: (code: string, level: 2 | 4 | 6) => void
  /* The product page's trend table already carries the predecessor's
   * years (marked **); the history section then points there rather than
   * printing the same figures a second time. */
  carriedInTrend?: boolean
}) {
  const lineage = node.lineage

  const retired = lineage?.retired ?? null

  if (!lineage || (!lineage.predecessors.length && !retired)) return null

  const withCode = lineage.predecessors.filter(item => item.code)

  /*
   * The old code's own numbers were already being computed and written into
   * the node - and then ignored by this panel, which showed only the prose
   * note and a link to the heading. They are the whole point of keeping a
   * retired code in the pull, so they are now on the page.
   */
  const series = lineage.series ?? {}

  const siblings = (lineage.family ?? []).filter(
    item => item !== node.code && !(item in series),
  )

  return (
    <div className="lineage-note">
      <div className="lineage-head">
        <span className="eyebrow">CLASSIFICATION HISTORY</span>

        {lineage.seriesStartsAt && (
          <span className="lineage-start">
            Six-digit series starts {lineage.seriesStartsAt}
          </span>
        )}
      </div>

      {retired && (
        <div className="lineage-retired">
          <div className="lineage-retired-head">
            <span className="lineage-retired-badge">
              RETIRED IN HS {retired.revision}
            </span>

            {retired.validTo !== null && (
              <span className="lineage-start">
                Last valid year {retired.validTo}
              </span>
            )}
          </div>

          <p className="lineage-line">{retired.note}</p>

          {retired.lastPublished && (
            <p className="lineage-line">
              The series ends at {retired.lastPublished.year}, when world trade
              under this code was {usd(retired.lastPublished.value)}. Later
              years carry residual filings only and are withheld.
            </p>
          )}

          {retired.successors.length > 0 && (
            <div className="lineage-family">
              <span className="lineage-family-label">
                {retired.successors.length === 1
                  ? 'Replaced by'
                  : 'Replaced by'}
              </span>

              <div className="lineage-actions">
                {retired.successors.map(item =>
                  item.published && onOpen ? (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => onOpen(item.code, 6)}
                    >
                      HS {item.code}
                    </button>
                  ) : (
                    <span key={item.code} className="lineage-code-flat">
                      HS {item.code}
                    </span>
                  ),
                )}
              </div>

              <p className="lineage-caveat">
                {retired.successors.every(item => item.published)
                  ? retired.comparable
                    ? 'These successors together cover exactly what this code covered, so their combined total is comparable with the series above. They are still never added to it: the two sit on opposite sides of the revision and are shown apart.'
                    : retired.continuity === 'partial'
                      ? 'These successors also take in trade that was reported elsewhere before the revision, so their total is broader than this code was and the two series are not comparable.'
                      : 'The WCO correlation tables do not state an exact mapping for this code, so nothing is claimed about how the successors compare with the series above.'
                  : 'This dashboard does not currently cover ' +
                    retired.successors
                      .filter(item => !item.published)
                      .map(item => `HS ${item.code}`)
                      .join(', ') +
                    ', so the successor series is not available here. The HS-4 heading below still runs across the revision.'}
              </p>
            </div>
          )}
        </div>
      )}

      {lineage.predecessors.map(item => (
        <p key={item.code || item.relation} className="lineage-line">
          {item.code && (
            <span className="lineage-code">HS {item.code}</span>
          )}
          {item.note}
        </p>
      ))}

      {Object.entries(series).map(([code, rows]) => {
        const years = Object.keys(rows).sort()

        if (!years.length) return null

        const shown = years.slice(-6)

        if (carriedInTrend) {
          return (
            <p key={code} className="lineage-caveat">
              HS {code}&rsquo;s own filings for {years[0]}&ndash;{years[years.length - 1]} are in
              the trend table above, marked <b className="carried-mark">**</b>: the old code&rsquo;s
              whole value, never apportioned and never added to this one.
            </p>
          )
        }

        return (
          <div key={code} className="lineage-series">
            <div className="lineage-series-head">
              <strong>HS {code}</strong> as it was reported, {years[0]}&ndash;
              {years[years.length - 1]}
            </div>

            <div className="lineage-table-wrap">
              <table className="lineage-table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th className="num">World trade</th>
                    <th className="num">India imports</th>
                    <th className="num">India exports</th>
                  </tr>
                </thead>

                <tbody>
                  {shown.map(item => (
                    <tr key={item}>
                      <td>{item}</td>
                      <td className="num">{usd(rows[item].globalTrade)}</td>
                      <td className="num">{usd(rows[item].indiaImports)}</td>
                      <td className="num">{usd(rows[item].indiaExports)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="lineage-caveat">
              These are the old code&rsquo;s own filings. They are shown beside
              this series and never added to it, because a split cannot be
              divided between its successors without inventing a share.
              {years.length > shown.length &&
                ` ${years.length} years in total are in the workbook export.`}
            </p>
          </div>
        )
      })}

      {siblings.length > 0 && onOpen && (
        <div className="lineage-family">
          <span className="lineage-family-label">
            Also came out of this split
          </span>

          <div className="lineage-actions">
            {siblings.map(item => (
              <button
                key={item}
                onClick={() =>
                  onOpen(item, item.length === 2 ? 2 : item.length === 4 ? 4 : 6)
                }
              >
                HS {item}
              </button>
            ))}
          </div>

          {lineage.familyNote && (
            <p className="lineage-caveat">{lineage.familyNote}</p>
          )}
        </div>
      )}

      {(lineage.continuousAt || withCode.length > 0) && (
        <div className="lineage-actions">
          {lineage.continuousAt && onOpen && (
            <button
              onClick={() => onOpen(lineage.continuousAt as string, 4)}
            >
              Open HS-4 {lineage.continuousAt} for the continuous series
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function buildPerspective(node: HsNode, year: number): string[] {
  const current = node.annual[String(year)]

  const prior = node.annual[String(year - 1)]

  if (!current) return []

  const rows: string[] = []

  const exports = current.india.exports
  const imports = current.india.imports

  if (exports != null && prior?.india.exports) {
    rows.push(
      `India exports changed ${delta(
        exports / prior.india.exports - 1,
      )} from ${year - 1}.`,
    )
  }

  if (imports != null && prior?.india.imports) {
    rows.push(
      `India imports changed ${delta(
        imports / prior.india.imports - 1,
      )} from ${year - 1}.`,
    )
  }

  if (current.india.balance != null) {
    rows.push(
      current.india.balance < 0
        ? `India runs a ${usd(Math.abs(current.india.balance))} trade deficit in ${year}.`
        : `India runs a ${usd(current.india.balance)} trade surplus in ${year}.`,
    )
  }

  if (node.globalTrade) {
    rows.push(
      `Global trade in ${node.globalTrade.year} was ${usd(
        node.globalTrade.value,
      )}, with India ${ordinal(node.globalTrade.indiaRank)} at ${pct(
        node.globalTrade.indiaShare,
      )}.`,
    )
  }

  return rows.slice(0, 4)
}

export function buildDependency(node: HsNode, year: number): string[] {
  const current = node.annual[String(year)]

  const suppliers = current?.india.suppliers

  if (!suppliers) return []

  const rows: string[] = []

  const largest = suppliers.rows[0]

  if (largest) {
    rows.push(
      `${largest.name} is the largest source at ${pct(
        largest.share,
      )} of India's imports.`,
    )
  }

  if (suppliers.top3Share != null) {
    rows.push(
      `The top three suppliers account for ${pct(
        suppliers.top3Share,
      )} of India's imports.`,
    )
  }

  if (suppliers.hhi != null) {
    rows.push(
      `Supplier HHI is ${fixed(suppliers.hhi, places(3))} (${concentrationLabel(
        suppliers.hhi,
      ).toLowerCase()} concentration).`,
    )
  }

  if (suppliers.coverage != null) {
    rows.push(
      `Partner rows reconcile to ${pct(
        suppliers.coverage,
      )} of India's reported world imports.`,
    )
  }

  return rows.slice(0, 4)
}

/*
 * How much of the official heading the sector definition actually tracks.
 *
 * The heading figure stays the published number - it is Comtrade's own
 * aggregate and covers every six-digit line. This panel supplies the other
 * half of the picture, so a heading total is not silently read as a sector
 * total. Heading 8501 holds seventeen six-digit lines; if the definition
 * tracks one of them, that belongs on the page.
 */
export function buildCoverage(node: HsNode, year: number): string[] {
  const share = node.definitionShare

  if (!share) return []

  const entry = share.years?.[String(year)]

  const rows: string[] = []

  if (share.officialLines) {
    rows.push(
      `The classification puts ${share.officialLines} six-digit lines in ` +
        `HS-${node.level} ${node.code}. The FED definition tracks ` +
        `${share.definedLines} of them` +
        (share.lineShare !== null
          ? `, ${pct(share.lineShare, 0)} by count.`
          : '.'),
    )
  }

  if (entry?.globalShare != null) {
    rows.push(
      `Those lines come to ${usd(entry.definedGlobalTrade)} of the heading's ` +
        `${usd(entry.headingGlobalTrade)} in global trade for ${year} — ` +
        `${pct(entry.globalShare)} of it.` +
        (entry.membersWithTrade < entry.members
          ? ` ${entry.members - entry.membersWithTrade} of ${entry.members} ` +
            'tracked lines had no published figure that year, so read this ' +
            'as a lower bound.'
          : ''),
    )

    /* A subset cannot exceed the set. Saying so is more useful than
     * printing an impossible percentage without comment. */
    if (entry.globalShare > 1.02) {
      rows.push(
        'That share is above 100%, which cannot be right — the tracked lines ' +
          'are inside this heading. It means the heading and its members were ' +
          'built from different data, and the snapshot carries a QA warning ' +
          'saying so.',
      )
    }
  }

  if (entry?.indiaImportShare != null) {
    rows.push(
      `On India's own imports they are ${usd(entry.definedIndiaImports)} of ` +
        `${usd(entry.headingIndiaImports)}, or ${pct(entry.indiaImportShare)}.`,
    )
  }

  if (!rows.length && entry) {
    rows.push(
      `No published heading figure for ${year}, so the tracked share cannot ` +
        'be computed for that year.',
    )
  }

  return rows
}

