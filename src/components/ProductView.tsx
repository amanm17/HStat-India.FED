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

import type {
  CatalogueEntry,
  CurrencyBlock,
  CurrencyMode,
  HsNode,
  PeriodRecord,
} from '../types'
import { loadHsNodes } from '../lib/data'
import type { Workspace } from '../lib/workspace'
import type { Methodology } from '../types'
import {
  concentrationLabel,
  delta,
  inr,
  monthLabel,
  monthShort,
  ordinal,
  pct,
  usd,
} from '../lib/format'
import {
  convertibleCount,
  defaultFinancialYear,
  money,
  rateFor,
  rateNote,
} from '../lib/currency'
import { palette } from '../lib/palette'
import {
  downloadChart,
  downloadCsv,
  downloadJson,
  downloadXlsx,
} from '../lib/export'
import { TileDeck } from './TileDeck'
import {
  DataTable,
  Disclosure,
  Empty,
  ExplainMetric,
  InsightPanel,
  MiniMetric,
  PanelHead,
  StatusPill,
  Tabs,
  Tile,
} from './primitives'

type Horizon = '5Y' | '10Y' | 'ALL'

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
function mirrorReading(gap: number | null): string {
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
function adjustmentReading(coverage: number | null): string {
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
}: {
  node: HsNode
  methodology: Methodology | null
}) {
  const benchmark = node.globalTrade

  if (!benchmark) {
    return (
      <section className="release-section global-trade-card">
        <div className="release-section-head">
          <div>
            <div className="eyebrow">GLOBAL TRADE</div>
            <h2>Not published for this code</h2>
          </div>
        </div>

        <Empty>
          No year in the analysis window passed reporter-coverage validation,
          so no global figure, rank or share is shown. The underlying reported
          observations are still in the annual detail and the workbook export.
        </Empty>
      </section>
    )
  }

  const mirrorGap = benchmark.mirror?.gap ?? null

  /* The concrete amount taken out, for the year the headline is on. */
  const removed =
    node.annual[String(benchmark.year)]?.global.observed.reImportsRemoved ??
    null

  return (
    <section className="release-section global-trade-card">
      <div className="release-section-head">
        <div>
          <div className="eyebrow">GLOBAL TRADE · {benchmark.year}</div>

          <h2>One figure, adjusted for re-imports</h2>
        </div>

        <StatusPill status="VALID" label="Coverage validated" />
      </div>

      <div className="global-trade-hero">
        <div className="hero-figure">
          <span>Global trade</span>

          <strong>{usd(benchmark.value)}</strong>

          <small>
            All reporting economies' imports from the world, less re-imports
          </small>
        </div>

        <div className="hero-side">
          <MiniMetric
            label="India rank"
            value={ordinal(benchmark.indiaRank)}
            detail={`of ${benchmark.topEconomies.length ? 'all reporters' : '—'}`}
          />

          <MiniMetric
            label="India share"
            value={pct(benchmark.indiaShare)}
            detail="of global trade"
          />

        </div>
      </div>

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
function LineageNote({
  node,
  onOpen,
}: {
  node: HsNode
  onOpen?: (code: string, level: 2 | 4 | 6) => void
}) {
  const lineage = node.lineage

  if (!lineage || !lineage.predecessors.length) return null

  const withCode = lineage.predecessors.filter(item => item.code)

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

      {lineage.predecessors.map(item => (
        <p key={item.code || item.relation} className="lineage-line">
          {item.code && (
            <span className="lineage-code">HS {item.code}</span>
          )}
          {item.note}
        </p>
      ))}

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

function buildPerspective(node: HsNode, year: number): string[] {
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

function buildDependency(node: HsNode, year: number): string[] {
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
      `Supplier HHI is ${suppliers.hhi.toFixed(3)} (${concentrationLabel(
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
function buildCoverage(node: HsNode, year: number): string[] {
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

export function ProductView({
  node,
  year,
  onYearChange,
  methodology,
  dark,
  onAddToStack,
  inBasket,
  onOpen,
  showHs8 = false,
  currency = 'USD',
  currencyBlock,
  snapshot = 'current',
  catalogue = [],
  hiddenTiles = [],
  onUnpinTile,
  pinned = false,
  onTogglePin,
  workspace,
  onReorder,
  onArrange,
  onAuto,
  onYearLead,
}: {
  node: HsNode
  year: number
  onYearChange: (year: number) => void
  methodology: Methodology | null
  dark: boolean
  onAddToStack: () => void
  inBasket: boolean
  onOpen?: (code: string, level: 2 | 4 | 6) => void
  showHs8?: boolean
  currency?: CurrencyMode
  currencyBlock?: CurrencyBlock
  snapshot?: string
  catalogue?: CatalogueEntry[]
  hiddenTiles?: string[]
  onUnpinTile?: (id: string) => void
  pinned?: boolean
  onTogglePin?: () => void
  workspace: Workspace
  onReorder: (dragged: string, before: string | null) => void
  onArrange: (groups: string[][]) => void
  onAuto: () => void
  onYearLead: () => void
}) {
  const off = useCallback(
    (id: string) => hiddenTiles.includes(id),
    [hiddenTiles],
  )

  /*
   * The deck shuffle.
   *
   * The global-trade headline sits above India's position until the reader
   * changes the year. Changing the year is a statement that the year is what
   * they came for, so the two cards trade places and the selected year takes
   * the top slot. The swap is animated because two cards silently exchanging
   * position reads as a glitch; a half-second shuffle reads as an answer to
   * what was just asked.
   */
  const [seenYear, setSeenYear] = useState(year)

  useEffect(() => {
    if (year === seenYear) return

    setSeenYear(year)
    onYearLead()
  }, [year, seenYear, onYearLead])

  const [horizon, setHorizon] = useState<Horizon>('10Y')

  /*
   * What sits inside a heading.
   *
   * An HS-4 page shows the six-digit lines the sector definition tracks
   * inside it; an HS-2 page shows the headings, because 85 alone contains
   * 242 six-digit lines and a list that long is a directory, not a
   * breakdown. Either way the figures come from the child nodes themselves,
   * so a share here is the child's own published number over the heading's
   * own published number - nothing is apportioned.
   */
  const childCodes = useMemo<{ code: string; level: 2 | 4 | 6 }[]>(() => {
    if (node.level === 4) {
      return (node.members ?? []).map(code => ({ code, level: 6 as const }))
    }

    if (node.level === 2) {
      return catalogue
        .filter(
          entry => entry.level === 4 && entry.code.startsWith(node.code),
        )
        .map(entry => ({ code: entry.code, level: 4 as const }))
    }

    return []
  }, [node, catalogue])

  const [children, setChildren] = useState<HsNode[]>([])

  useEffect(() => {
    if (!childCodes.length || childCodes.length > 40) {
      setChildren([])
      return
    }

    let cancelled = false

    loadHsNodes(snapshot, childCodes)
      .then(loaded => {
        if (!cancelled) setChildren(loaded)
      })
      .catch(() => {
        if (!cancelled) setChildren([])
      })

    return () => {
      cancelled = true
    }
  }, [childCodes, snapshot])

  const [frequency, setFrequency] = useState<'annual' | 'monthly'>('annual')

  /* One panel, two series: India's own trade, or the market it sits in. */
  const [series, setSeries] = useState<'india' | 'market'>('india')

  /* Same rows, two readings. The chart is the default; the table is the one
   * people copy figures out of. */
  const [sourceView, setSourceView] = useState<'chart' | 'table'>('chart')
  const [marketView, setMarketView] = useState<'chart' | 'table'>('chart')

  const colours = palette(dark)

  const annual: PeriodRecord | undefined = node.annual[String(year)]

  const hasMonthly = node.months.length > 0

  /* ---------------------------------------------------------------
   * Tariff lines
   *
   * These are Indian financial years and everything above is Comtrade
   * calendar years, so they get their own period control rather than
   * borrowing the year picker. Pairing them would be the single easiest
   * way to publish an April-March figure under a January-December label.
   * ------------------------------------------------------------- */

  const tariffYears = useMemo(
    () => Object.keys(node.tariffLines?.financialYears ?? {}).sort(),
    [node],
  )

  const isComplete = useCallback(
    (fy: string) =>
      node.tariffLines?.financialYears?.[fy]?.meta.complete !== false,
    [node],
  )

  const [chosenFy, setChosenFy] = useState<string | null>(null)

  const defaultFy = useMemo(
    () => defaultFinancialYear(tariffYears, year, isComplete),
    [tariffYears, year, isComplete],
  )

  const activeFy =
    chosenFy && tariffYears.includes(chosenFy) ? chosenFy : defaultFy

  const tariff = activeFy
    ? node.tariffLines?.financialYears?.[activeFy] ?? null
    : null

  /* A figure that belongs to the selected calendar year. */
  const cy = useCallback(
    (value: number | null | undefined) =>
      money(value, currency, currencyBlock, String(year), { basis: 'CY' }),
    [currency, currencyBlock, year],
  )

  const cyNote = rateNote(currency, currencyBlock, String(year), 'CY')

  const trend = useMemo(() => {
    if (frequency === 'monthly') {
      return node.months.map(period => ({
        period,
        basis: 'MONTH' as const,
        label: monthShort(period),
        full: monthLabel(period),
        imports: node.monthly[period]?.india.imports ?? null,
        exports: node.monthly[period]?.india.exports ?? null,
      }))
    }

    const years = [...node.years].sort((a, b) => a - b)

    const latest = Math.max(...years)

    const back = horizon === 'ALL' ? Infinity : horizon === '5Y' ? 5 : 10

    return years
      .filter(item => item > latest - back)
      .map(item => ({
        period: String(item),
        basis: 'CY' as const,
        label: String(item),
        full: String(item),
        imports: node.annual[String(item)]?.india.imports ?? null,
        exports: node.annual[String(item)]?.india.exports ?? null,
      }))
  }, [node, horizon, frequency])

  /*
   * The chart in rupees, or not at all.
   *
   * Each point converts at its own period's rate, so the series is only
   * drawn in rupees when every visible point has one. A line with some
   * points in rupees and some in dollars is not a series, it is two series
   * on one axis - and the reader has no way to tell which is which. When a
   * rate is missing anywhere in the window the whole chart stays in dollars
   * and says so.
   */
  const chart = useMemo(() => {
    const rates = trend.map(point =>
      rateFor(currencyBlock, point.period, point.basis),
    )

    /*
     * Only the points that actually draw something need a rate. A window
     * ending in the current year always carries an empty trailing period -
     * the year is not over, so no average rate exists for it - and letting
     * that one blank block the whole chart would mean the rupee view never
     * worked in the year you are standing in.
     */
    const drawn = trend
      .map((point, index) => ({ point, rate: rates[index] }))
      .filter(item => item.point.imports !== null || item.point.exports !== null)

    const convertible =
      currency === 'INR' &&
      drawn.length > 0 &&
      drawn.every(item => item.rate !== null)

    if (!convertible) {
      return {
        data: trend,
        inr: false,
        unit: 'USD bn',
        divisor: 1e9,
        missing:
          currency === 'INR'
            ? drawn
                .filter(item => !item.rate)
                .map(item => item.point.full)
                .slice(0, 3)
            : [],
      }
    }

    return {
      data: trend.map((point, index) => ({
        ...point,
        imports:
          point.imports === null ? null : point.imports * rates[index]!.rate,
        exports:
          point.exports === null ? null : point.exports * rates[index]!.rate,
      })),
      inr: true,
      unit: '₹ crore',
      divisor: 1e7,
      missing: [] as (string | null)[],
    }
  }, [trend, currency, currencyBlock])

  const unitNote = chart.unit

  /* Nothing in the snapshot can be converted at all - a different problem
   * from one missing year, and worth saying once rather than per figure. */
  const noRates =
    currency === 'INR' &&
    convertibleCount(
      currencyBlock,
      node.years.map(item => ({ period: String(item), basis: 'CY' as const })),
    ) === 0

  const predecessorCode = node.lineage?.predecessors.find(
    item => item.code,
  )?.code

  /*
   * The long series is drawn as two lines that never touch: the current
   * code, and the code it replaced. Joining them would assert an
   * apportionment nobody has made.
   */
  const globalTrend = useMemo(() => {
    const series = predecessorCode
      ? node.lineage?.series?.[predecessorCode] ?? {}
      : {}

    const years = new Set<number>(node.analyticalYears)

    for (const year of Object.keys(series)) years.add(Number(year))

    return [...years]
      .sort((a, b) => a - b)
      .map(item => ({
        label: String(item),
        trade: node.annual[String(item)]?.global.trade ?? null,
        predecessor: series[String(item)]?.globalTrade ?? null,
      }))
  }, [node, predecessorCode])

  /*
   * India appears in India's own supplier list because Comtrade files goods
   * returning to their country of origin as a partner row against that same
   * country. It is a real row and it belongs in the download, but on a chart
   * headed "import sources" a bar labelled India reads as an error, so it is
   * named for what it is.
   */
  const supplierRows = (annual?.india.suppliers?.rows ?? []).map(row =>
    row.code === INDIA_REPORTER
      ? { ...row, name: 'India (re-imports)' }
      : row,
  )

  const destinationRows = (annual?.india.destinations?.rows ?? []).map(row =>
    row.code === INDIA_REPORTER
      ? { ...row, name: 'India (re-exports)' }
      : row,
  )

  /*
   * The rows of the breakdown, on the selected year. A child with no figure
   * for that year keeps its row and shows a dash: dropping it would silently
   * change what the shares are shares of.
   */
  const breakdown = useMemo(() => {
    const period = String(year)

    const heading = node.annual[period]

    const headingTrade = heading?.global.trade ?? null
    const headingImports = heading?.india.imports ?? null

    const rows = children.map(child => {
      const record = child.annual[period]

      const trade = record?.global.trade ?? null
      const imports = record?.india.imports ?? null

      return {
        code: child.code,
        level: child.level,
        label: child.product || child.description,
        trade,
        imports,
        tradeShare:
          trade !== null && headingTrade ? trade / headingTrade : null,
        importShare:
          imports !== null && headingImports
            ? imports / headingImports
            : null,
      }
    })

    rows.sort((a, b) => (b.trade ?? -1) - (a.trade ?? -1))

    const trackedTrade = rows.reduce((sum, row) => sum + (row.trade ?? 0), 0)

    const trackedImports = rows.reduce(
      (sum, row) => sum + (row.imports ?? 0),
      0,
    )

    return {
      rows,
      headingTrade,
      headingImports,
      trackedTrade,
      trackedImports,
      /* The part of the heading the definition does not track. Negative
       * would mean the parts exceed the whole, which is a data question,
       * not a number to print. */
      restTrade:
        headingTrade !== null && headingTrade - trackedTrade > 0
          ? headingTrade - trackedTrade
          : null,
      restImports:
        headingImports !== null && headingImports - trackedImports > 0
          ? headingImports - trackedImports
          : null,
      overrun: headingTrade !== null && trackedTrade > headingTrade,
    }
  }, [children, node, year])

  const suppliers = supplierRows
    .slice(0, 10)
    .map(row => ({ ...row, sharePct: row.share * 100 }))

  const destinations = destinationRows
    .slice(0, 10)
    .map(row => ({ ...row, sharePct: row.share * 100 }))


  if (!annual) {
    return <Empty>No data for {year}.</Empty>
  }

  const current = annual

  /*
   * The workbook.
   *
   * Column headings are written out with their units because that is what a
   * reader opening this a month later has to go on, and because the export
   * layer keys its number formats off them. Every sheet carries the period
   * it belongs to, and the coverage status travels with the figure so a
   * blank year is readable as withheld rather than as zero.
   */
  const exportMeta = {
    title: `${node.product || node.description} — HS-${node.level} ${node.code}`,
    code: node.code,
    level: node.level,
    description: node.description,
    currency: currency === 'INR' ? 'Indian rupees where a rate exists, otherwise US dollars' : 'US dollars',
    snapshot: node.sources ? undefined : undefined,
    notes: [
      'Global trade is every reporting economy\'s imports from the world, less re-imports where the reporter files them separately. Valued CIF.',
      'Import-side and export-side totals measure the same trade from opposite ends and are not comparable line for line: imports include freight and insurance, exports do not.',
      'A blank global figure is a year whose reporter coverage was not sufficient to publish. It is withheld, not zero.',
      'Comtrade figures are calendar years. Any ITC(HS)-8 sheet is Indian financial years and must not be compared row for row with them.',
    ],
  }

  function exportWorkbook() {
    const annualRows = [...node.years]
      .sort((a, b) => b - a)
      .map(item => {
        const record = node.annual[String(item)]

        return {
          'Calendar year': item,
          'Global trade (USD)': record.global.trade,
          'Coverage status': record.global.coverage?.status ?? null,
          'India rank': record.global.indiaRank,
          'India share of global trade': record.global.indiaShare,
          'India imports (USD)': record.india.imports,
          'India exports (USD)': record.india.exports,
          'India trade balance (USD)': record.india.balance,
          'Reporting economies': record.global.observed.reporters,
          'Gross world imports (USD)': record.global.observed.grossImports,
          'Re-imports removed (USD)': record.global.observed.reImportsRemoved,
          'Gross world exports (USD)': record.global.observed.grossExports,
          'Re-exports removed (USD)': record.global.observed.reExportsRemoved,
          'Re-import adjustment share': record.global.observed.adjustmentCoverage,
          'Mirror gap': record.global.mirror?.gap ?? null,
        }
      })

    const monthlyRows = [...node.months]
      .sort()
      .reverse()
      .map(period => ({
        Month: monthLabel(period),
        'India imports (USD)': node.monthly[period]?.india.imports ?? null,
        'India exports (USD)': node.monthly[period]?.india.exports ?? null,
        'India trade balance (USD)': node.monthly[period]?.india.balance ?? null,
      }))

    const economyRows = (node.globalTrade?.topEconomies ?? []).map(row => ({
      Rank: row.rank,
      Economy: row.name,
      'Comtrade code': row.code,
      'Imports (USD)': row.value,
      'Share of world imports': row.share,
    }))

    const exporterRows = (node.globalTrade?.topExporters ?? []).map(row => ({
      Rank: row.rank,
      Economy: row.name,
      'Comtrade code': row.code,
      'Exports (USD)': row.value,
      'Share of world exports': row.share,
    }))

    const partnerRows = (rows: typeof supplierRows, direction: string) =>
      rows.map((row, index) => ({
        Rank: index + 1,
        Partner: row.name,
        'Comtrade code': row.code,
        [`${direction} (USD)`]: row.value,
        [`Share of India ${direction.toLowerCase()}`]: row.share,
      }))

    const insideRows = breakdown.rows.map(row => ({
      'HS code': row.code,
      Level: `HS-${row.level}`,
      Product: row.label,
      'Global trade (USD)': row.trade,
      'Share of heading': row.tradeShare,
      'India imports (USD)': row.imports,
      'Share of heading imports': row.importShare,
    }))

    downloadXlsx(
      `HStat-${node.code}`,
      {
        Annual: annualRows,
        Monthly: monthlyRows,
        [`Largest importers ${node.globalTrade?.year ?? ''}`.trim()]: economyRows,
        [`Largest exporters ${node.globalTrade?.year ?? ''}`.trim()]: exporterRows,
        [`India sources ${year}`]: partnerRows(supplierRows, 'Imports'),
        [`India destinations ${year}`]: partnerRows(destinationRows, 'Exports'),
        'Inside this heading': insideRows,

        /* Financial years, so the sheet carries its own period column and
         * cannot be mistaken for the calendar-year sheets beside it. */
        'India ITC(HS)-8': tariffYears.flatMap(fy => {
          const block = node.tariffLines?.financialYears?.[fy]

          return (block?.rows ?? []).map(row => ({
            'Financial year': fy,
            'Months covered': block?.meta.monthsCovered ?? null,
            'ITC(HS)-8': row.hs8,
            Description: row.description,
            'Imports (USD)': row.imports,
            'Exports (USD)': row.exports,
            'Balance (USD)': row.balance,
            'Imports (₹)': row.importsInr,
            'Exports (₹)': row.exportsInr,
            'Filed in': row.native.toUpperCase(),
            'Rate (₹ per USD)': block?.meta.rate ?? null,
          }))
        }),
      },
      {
        ...exportMeta,
        period: `Annual ${Math.min(...node.years)}–${Math.max(...node.years)}; partner detail for ${year}`,
        rate: cyNote ?? undefined,
      },
    )
  }

  const meta = tariff?.meta
  const showInr = currency === 'INR'

  const tariffRows = (tariff?.rows ?? []).map(row => ({
    'ITC(HS)-8': row.hs8,
    Description: row.description,
    Imports: showInr ? inr(row.importsInr) : usd(row.imports),
    Exports: showInr ? inr(row.exportsInr) : usd(row.exports),
    Balance: showInr ? inr(row.balanceInr) : usd(row.balance),
    Source: row.native === 'inr' ? 'Filed in ₹' : 'Filed in $',
  }))

  /*
   * With no DGCIS file loaded there is nothing to disclose, and a full panel
   * wrapped around an empty box is the same defunct bubble as a disabled
   * toggle. It shrinks to one line that says what is missing and where it
   * comes from, at the foot of the page, for whoever goes looking.
   */
  const tariffPanel = tariffYears.length === 0 ? (
    <p className="tariff-absent">
      India ITC(HS)-8 tariff-line detail is not in this snapshot. It is
      supplied from a static DGCIS / TradeStat export, in Indian financial
      years; the six-digit figures above are Comtrade calendar years.
    </p>
  ) : (
    <article
      className={
        showHs8 ? 'panel hs8-panel tariff-focus' : 'panel hs8-panel'
      }
    >
      <PanelHead
        eyebrow="INDIA TARIFF LINES · ITC(HS)-8"
        title={
          activeFy
            ? `Beneath HS ${node.code} · FY ${activeFy}`
            : `Beneath HS ${node.code}`
        }
        note={
          tariffYears.length
            ? undefined
            : 'Supplied from a static DGCIS / TradeStat CSV; none loaded yet.'
        }
      />

      {tariffYears.length > 0 && (
        <div className="tariff-context">
          <div className="tariff-periods">
            <label htmlFor="fy-select">Financial year</label>

            <select
              id="fy-select"
              value={activeFy ?? ''}
              onChange={event => setChosenFy(event.target.value)}
            >
              {tariffYears.map(item => (
                <option key={item} value={item}>
                  FY {item}
                  {isComplete(item) ? '' : ' · part year'}
                </option>
              ))}
            </select>
          </div>

          <strong>
            April–March · not the same period as the {year} figures above
          </strong>
        </div>
      )}

      {meta && (
        <div className="tariff-flags">
          {meta.complete === false && (
            <span className="flag warn">
              Part year · {meta.monthsCovered} of 12 months
            </span>
          )}

          {showInr && meta.rate === null && !meta.native.includes('inr') && (
            <span className="flag warn">
              No FY {meta.fy} rate · shown in US dollars
            </span>
          )}

          {showInr && meta.rate !== null && (
            <span className="flag">
              ₹{meta.rate.toFixed(2)}/$ · FY {meta.fy} average
            </span>
          )}

          {meta.reconciliation?.status === 'out-of-band' && (
            <span className="flag warn">
              Total is far from the Comtrade six-digit figure · check units
            </span>
          )}

          <span className="flag">
            {meta.lines} line{meta.lines === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {tariff ? (
        <>
          <DataTable
            rows={tariffRows}
            name={`HS-${node.code}-India-HS8-FY${activeFy}`}
          />

          <p className="tariff-total">
            FY {activeFy} total ·{' '}
            <strong>
              {showInr
                ? inr(meta?.totalImportsInr)
                : usd(meta?.totalImports)}
            </strong>{' '}
            imports,{' '}
            <strong>
              {showInr
                ? inr(meta?.totalExportsInr)
                : usd(meta?.totalExports)}
            </strong>{' '}
            exports. Source: DGCIS / TradeStat, filed in{' '}
            {meta?.native.map(item => item.toUpperCase()).join(' and ')}.
          </p>
        </>
      ) : (
        <Empty>
          No ITC(HS)-8 detail in the current snapshot for {node.code}.
        </Empty>
      )}
    </article>
  )

  return (
    <>
      {/*
        * What this code is, said once.
        *
        * This used to be a name over a run of four dot-separated facts, most
        * of which repeated each other: the code appeared twice, the
        * classification is the same on every page, and the freshness date
        * belongs with the data rather than with the product's identity. What
        * a reader needs here is the code, the name, and the official
        * definition in language they can check a product against.
        */}
      {noRates && (
        <div className="rate-banner">
          <strong>Rupee view unavailable in this snapshot.</strong> No exchange
          rate is published for any period it covers, so every figure stays in
          US dollars. Rates are part of the snapshot, not the page — they
          arrive when the data is next rebuilt.
        </div>
      )}

      <TileDeck
        workspace={workspace}
        onReorder={onReorder}
        onArrange={onArrange}
        onAuto={onAuto}
      >
      <Tile id="identity" label="Product">
      <section className="product-head">
        <div className="product-copy">
          <div className="product-idline">
            <span className="code-chip">
              HS-{node.level} {node.code}
            </span>

            {node.category && <span className="id-cat">{node.category}</span>}

            {!node.inFedDefinition && (
              <span className="id-flag">Reference only</span>
            )}
          </div>

          <h1>{node.product || node.description}</h1>

          {node.product && node.product !== node.description && (
            <p className="product-official">{node.description}</p>
          )}

          <div className="product-meta">
            {node.classification}
            {node.segment ? ` · ${node.segment}` : ''}
            {node.latestIndiaMonth
              ? ` · India reported through ${monthLabel(node.latestIndiaMonth)}`
              : ''}
          </div>
        </div>

        <div className="head-actions">
          <div className="yearpicker">
            <label htmlFor="year-select">Calendar year</label>

            <select
              id="year-select"
              value={year}
              onChange={event => onYearChange(Number(event.target.value))}
            >
              {[...node.years].reverse().map(item => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <button
            className="stack-add"
            onClick={onAddToStack}
            disabled={inBasket}
          >
            <Plus size={15} />
            {inBasket ? 'In HStack' : 'Add to HStack'}
          </button>

          {onTogglePin && (
            <button
              className={pinned ? 'stack-add pinned' : 'stack-add'}
              onClick={onTogglePin}
              title={
                pinned
                  ? 'Remove from the quick-view rail'
                  : 'Pin to the quick-view rail'
              }
            >
              {pinned ? <PinOff size={15} /> : <Pin size={15} />}
              {pinned ? 'Pinned' : 'Pin'}
            </button>
          )}

          <button className="download-master" onClick={exportWorkbook}>
            <Download size={15} />
            XLSX
          </button>
        </div>
      </section>

      {node.level < 6 && (
        <div className="parent-category-context">
          <strong>Parent-category context</strong>

          <span>
            HS-{node.level} {node.code} is an official Comtrade aggregate.
            Values are pulled directly at this HS level and are not built by
            summing HStat's selected child products. To combine specific
            products, use HStack.
          </span>
        </div>
      )}
      </Tile>

      {node.level < 6 && breakdown.rows.length > 0 && !off('whats-inside') && (
        <Tile id="whats-inside" label="What's inside" onUnpin={onUnpinTile}>
        <section className="release-section breakdown">
          <div className="release-section-head">
            <div>
              <div className="eyebrow">
                INSIDE HS-{node.level} {node.code} · {year}
              </div>

              <h2>
                {node.level === 2
                  ? 'The headings within this chapter'
                  : 'The six-digit lines within this heading'}
              </h2>
            </div>
          </div>

          <p className="panel-note">
            {node.level === 2
              ? 'Headings HStat tracks inside this chapter, each with its own published figure and its share of the chapter.'
              : 'Six-digit lines the sector definition tracks inside this heading, each with its own published figure and its share of the heading.'}{' '}
            Shares are each line's own number over the heading's own number;
            nothing is divided up or estimated.
          </p>

          <div className="tablewrap">
            <table className="contribution">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col" className="num">Global trade</th>
                  <th scope="col" className="num">India imports</th>
                </tr>
              </thead>

              <tbody>
                {breakdown.rows.map(row => (
                  <tr key={row.code}>
                    <th scope="row">
                      <button
                        className="hstack-line-open"
                        onClick={() => onOpen?.(row.code, row.level)}
                      >
                        <span className="result-level">HS-{row.level}</span>
                        <strong>{row.code}</strong>
                        <span className="hstack-line-label">{row.label}</span>
                      </button>
                    </th>

                    <td className="num">
                      <span className="cell-value">{usd(row.trade)}</span>
                      <span className="cell-share">
                        {row.tradeShare === null ? '—' : pct(row.tradeShare)}
                      </span>
                    </td>

                    <td className="num">
                      <span className="cell-value">{cy(row.imports).text}</span>
                      <span className="cell-share">
                        {row.importShare === null ? '—' : pct(row.importShare)}
                      </span>
                    </td>
                  </tr>
                ))}

                {(breakdown.restTrade !== null ||
                  breakdown.restImports !== null) && (
                  <tr data-excluded="yes">
                    <th scope="row">
                      <span className="hstack-line-label">
                        Everything else in HS-{node.level} {node.code}
                      </span>

                      <span className="contribution-note">
                        Lines outside the FED sector definition. Present in the
                        heading's own total, not tracked as products.
                      </span>
                    </th>

                    <td className="num">
                      <span className="cell-value">
                        {usd(breakdown.restTrade)}
                      </span>
                      <span className="cell-share">
                        {breakdown.restTrade !== null && breakdown.headingTrade
                          ? pct(breakdown.restTrade / breakdown.headingTrade)
                          : '—'}
                      </span>
                    </td>

                    <td className="num">
                      <span className="cell-value">
                        {cy(breakdown.restImports).text}
                      </span>
                      <span className="cell-share">
                        {breakdown.restImports !== null &&
                        breakdown.headingImports
                          ? pct(
                              breakdown.restImports / breakdown.headingImports,
                            )
                          : '—'}
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>

              <tfoot>
                <tr>
                  <th scope="row">
                    HS-{node.level} {node.code} total
                  </th>

                  <td className="num">
                    <span className="cell-value">
                      {usd(breakdown.headingTrade)}
                    </span>
                  </td>

                  <td className="num">
                    <span className="cell-value">
                      {cy(breakdown.headingImports).text}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {breakdown.overrun && (
            <div className="coverage-note">
              The tracked lines add up to more than the heading's own figure
              for {year}. A subset cannot exceed its heading, so one of the two
              is wrong for this year — treat the shares above as unreliable
              until that is resolved.
            </div>
          )}
        </section>
        </Tile>
      )}

      {/* Only codes with a predecessor have a history to show. An empty tile
        * is a stray unpin button on the page and a blank half of a slide in
        * Glance View, so it is not rendered at all. */}
      {!off('lineage') && !!node.lineage?.predecessors?.length && (
        <Tile id="lineage" label="Code history" onUnpin={onUnpinTile}>
          <LineageNote node={node} onOpen={onOpen} />
        </Tile>
      )}

      {!off('global') && (
        <Tile
          id="global"
          label="World market"
          onUnpin={onUnpinTile}
        >
          <GlobalTradeCard node={node} methodology={methodology} />
        </Tile>
      )}

      {!off('year') && (
        <Tile
          id="year"
          label="India this year"
        >
      <section className="release-section selected-year-summary">
        <div className="release-section-head">
          <div>
            <div className="eyebrow">CALENDAR YEAR · {year}</div>

            <h2>India's position</h2>
          </div>

          <StatusPill status={annual.global.coverage?.status ?? 'UNKNOWN'} />
        </div>

        {cyNote && <p className="rate-note">{cyNote}</p>}

        {showHs8 && meta && (
          <p className="ind-priority">
            {meta.lines} ITC(HS)-8 line{meta.lines === 1 ? '' : 's'} sit
            beneath this code in FY {meta.fy}
            {meta.complete === false
              ? `, covering ${meta.monthsCovered} of 12 months`
              : ''}
            . Those are April–March; the figures above are January–December.
            The two are shown side by side, never added together.
          </p>
        )}

        <div className="release-metric-grid">
          <article className="release-metric">
            <span>India imports</span>
            <strong>{cy(annual.india.imports).text}</strong>
            <small>Reporter · India · CY {year}</small>
          </article>

          <article className="release-metric">
            <span>India exports</span>
            <strong>{cy(annual.india.exports).text}</strong>
            <small>Reporter · India · CY {year}</small>
          </article>

          <article className="release-metric">
            <span>Trade balance</span>
            <strong>{cy(annual.india.balance).text}</strong>
            <small>Exports − imports</small>
          </article>

          <article className="release-metric">
            <span>Global trade · {year}</span>
            <strong>{usd(annual.global.trade)}</strong>
            <small>
              {annual.global.trade === null
                ? `Withheld · coverage ${annual.global.coverage?.status?.toLowerCase()}`
                : 'Net of re-imports'}
            </small>
          </article>

          <article className="release-metric">
            <span>India share · {year}</span>
            <strong>{pct(annual.global.indiaShare)}</strong>
            <small>
              {annual.global.indiaRank
                ? `Rank ${ordinal(annual.global.indiaRank)}`
                : 'Published only for validated years'}
            </small>
          </article>
        </div>

        {annual.global.coverage?.status !== 'VALID' && (
          <div className="coverage-note">
            {annual.global.coverage?.status === 'HISTORICAL' ? (
              <>
                {year} is before the first year coverage is assessed for, so no
                global figure is published for it. Nothing failed — the
                reported observations for {year} are in the annual detail and
                the workbook export.
              </>
            ) : annual.global.coverage?.status === 'BASELINE' ? (
              <>
                {year} is the first year in the series. Coverage is judged by
                comparing a year with the one before it, and there is no year
                before this one, so no global figure is published for it.
              </>
            ) : (
              <>
                {year} did not hold enough of the economies that reported in{' '}
                {year - 1} for a world total to be trustworthy
                {annual.global.coverage?.reason
                  ? ` (${annual.global.coverage.reason})`
                  : ''}
                , so no global figure, rank or share is shown for it.
              </>
            )}{' '}
            The headline card uses{' '}
            {node.globalTrade?.year ?? 'the latest validated year'}.
          </div>
        )}
      </section>
        </Tile>
      )}

      {!off('signals') && (
        <Tile id="signals" label="Signals" onUnpin={onUnpinTile}>
      <section className="insight-grid">
        <InsightPanel
          eyebrow="PERSPECTIVE"
          title="What stands out"
          rows={buildPerspective(node, year)}
        />

        <InsightPanel
          eyebrow="DEPENDENCY"
          title="Sourcing concentration"
          rows={buildDependency(node, year)}
        />
      </section>
        </Tile>
      )}

      {node.definitionShare && !off('coverage') && (
        <Tile id="coverage" label="Coverage" onUnpin={onUnpinTile}>
        <section className="insight-grid single">
          <InsightPanel
            eyebrow="DEFINITION COVERAGE"
            title={`How much of HS-${node.level} ${node.code} the sector definition tracks`}
            rows={buildCoverage(node, year)}
            note={node.definitionShare.basis}
          />
        </section>
        </Tile>
      )}

      {/*
        * One panel, two series.
        *
        * India's trade and the market it sits in were two panels side by side
        * showing two lines each. They answer the same question at different
        * scales and a reader wants one at a time, so they share a panel and
        * the tab decides which. It also gives each chart the full width,
        * which is what a thirty-year series needs.
        */}
      {!off('trends') && (
        <Tile id="trends" label="Trends" onUnpin={onUnpinTile}>
      <section className="panel-stack">
        <article
          className="panel chart-panel wide"
          id={series === 'india' ? 'trade-trend' : 'global-trend'}
        >
          <PanelHead
            eyebrow="TRADE OVER TIME"
            title={
              series === 'india'
                ? 'India imports and exports'
                : 'Global trade, net of re-imports'
            }
            note={
              series === 'india'
                ? chart.missing.length
                  ? `Shown in US dollars: no rupee rate for ${chart.missing.join(', ')}${chart.missing.length >= 3 ? ' and others' : ''}, and a series cannot mix currencies.`
                  : frequency === 'monthly'
                    ? 'Monthly filings. Recent months are incomplete until every reporter files.'
                    : undefined
                : predecessorCode
                  ? `The dashed line is HS ${predecessorCode}, the code this replaced. It is shown alongside, never added: its total covers every successor and cannot be divided between them.`
                  : 'A year is drawn only where its reporter coverage was assessed and passed. Gaps are years that did not pass, never estimates.'
            }
            actions={
              <Tabs
                label="Which series to chart"
                active={series}
                onChange={id => setSeries(id as 'india' | 'market')}
                tabs={[
                  { id: 'india', label: 'India trade' },
                  { id: 'market', label: 'Global market' },
                ]}
              />
            }
            onPng={() =>
              downloadChart(
                series === 'india' ? 'trade-trend' : 'global-trend',
                `HS-${node.code}-${series === 'india' ? 'India-trade' : 'global-trade'}`,
                'png',
              )
            }
            onCsv={() =>
              series === 'india'
                ? downloadCsv(
                    `HS-${node.code}-India-trade`,
                    trend.map(point => ({
                      Period: point.full,
                      'India imports (USD)': point.imports,
                      'India exports (USD)': point.exports,
                    })),
                    { ...exportMeta, period: frequency === 'monthly' ? 'Monthly' : 'Annual' },
                  )
                : downloadCsv(
                    `HS-${node.code}-global-trade`,
                    globalTrend.map(point => ({
                      'Calendar year': Number(point.label),
                      'Global trade (USD)': point.trade,
                      ...(predecessorCode
                        ? { [`HS ${predecessorCode} (USD)`]: point.predecessor }
                        : {}),
                    })),
                    { ...exportMeta, period: 'Annual, validated years only' },
                  )
            }
          />

          <div className="chart-shell tall">
            {series === 'india' ? (
              <>
                <div className="chart-controls">
                  {hasMonthly && (
                    <div className="control-group">
                      {(['annual', 'monthly'] as const).map(option => (
                        <button
                          key={option}
                          className={frequency === option ? 'active' : ''}
                          onClick={() => setFrequency(option)}
                        >
                          {option === 'annual' ? 'Annual' : 'Monthly'}
                        </button>
                      ))}
                    </div>
                  )}

                  {frequency === 'annual' && (
                    <div className="control-group">
                      {(['5Y', '10Y', 'ALL'] as const).map(option => (
                        <button
                          key={option}
                          className={horizon === option ? 'active' : ''}
                          onClick={() => setHorizon(option)}
                        >
                          {option === 'ALL' ? 'All' : option}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chart.data}
                    margin={{ top: 24, right: 28, bottom: 12, left: 10 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke={colours.grid}
                    />

                    <XAxis
                      dataKey="label"
                      tickMargin={8}
                      axisLine={false}
                      tickLine={false}
                      stroke={colours.axis}
                      minTickGap={12}
                    />

                    <YAxis
                      width={58}
                      tickFormatter={value =>
                        `${(Number(value) / chart.divisor).toFixed(
                          chart.inr ? 0 : 1,
                        )}`
                      }
                      axisLine={false}
                      tickLine={false}
                      stroke={colours.axis}
                    />

                    <Tooltip
                      formatter={(value: unknown) =>
                        chart.inr ? inr(Number(value)) : usd(Number(value))
                      }
                      labelFormatter={(_, payload) =>
                        payload?.[0]?.payload?.full ?? ''
                      }
                      contentStyle={{
                        background: colours.surface,
                        border: `1px solid ${colours.grid}`,
                        borderRadius: 8,
                      }}
                    />

                    <Legend verticalAlign="top" align="right" height={34} />

                    <Area
                      type="monotone"
                      dataKey="imports"
                      name="India imports"
                      stroke={colours.imports}
                      fill={colours.imports}
                      fillOpacity={0.08}
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: colours.imports }}
                      activeDot={{
                        r: 4.5,
                        stroke: colours.surface,
                        strokeWidth: 2,
                      }}
                      label={lastPointLabel(
                        colours.imports,
                        chart.data.length,
                        chart.inr,
                      )}
                      connectNulls
                    />

                    <Area
                      type="monotone"
                      dataKey="exports"
                      name="India exports"
                      stroke={colours.exports}
                      fill={colours.exports}
                      fillOpacity={0.06}
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: colours.exports }}
                      activeDot={{
                        r: 4.5,
                        stroke: colours.surface,
                        strokeWidth: 2,
                      }}
                      label={lastPointLabel(
                        colours.exports,
                        chart.data.length,
                        chart.inr,
                      )}
                      connectNulls
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={globalTrend}
                  margin={{ top: 24, right: 28, bottom: 12, left: 10 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={colours.grid}
                  />

                  <XAxis
                    dataKey="label"
                    tickMargin={8}
                    axisLine={false}
                    tickLine={false}
                    stroke={colours.axis}
                    minTickGap={14}
                  />

                  <YAxis
                    width={58}
                    tickFormatter={value =>
                      `${(Number(value) / 1e9).toFixed(0)}`
                    }
                    axisLine={false}
                    tickLine={false}
                    stroke={colours.axis}
                  />

                  <Tooltip
                    formatter={(value: unknown) => usd(Number(value))}
                    contentStyle={{
                      background: colours.surface,
                      border: `1px solid ${colours.grid}`,
                      borderRadius: 8,
                    }}
                  />

                  {predecessorCode && (
                    <Legend verticalAlign="top" align="right" height={34} />
                  )}

                  {predecessorCode && (
                    <Line
                      type="monotone"
                      dataKey="predecessor"
                      name={`HS ${predecessorCode} (before HS 2022)`}
                      stroke={colours.primary}
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={{
                        r: 2.5,
                        fill: colours.surface,
                        stroke: colours.primary,
                      }}
                      activeDot={{ r: 4.5 }}
                      connectNulls={false}
                    />
                  )}

                  <Line
                    type="monotone"
                    dataKey="trade"
                    name={predecessorCode ? `HS ${node.code}` : 'Global trade'}
                    stroke={colours.primary}
                    strokeWidth={2}
                    dot={{ r: 2.5, fill: colours.primary }}
                    activeDot={{
                      r: 5,
                      stroke: colours.surface,
                      strokeWidth: 2,
                    }}
                    label={lastPointLabel(colours.primary, globalTrend.length)}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}

            <div className="axis-note">{unitNote}</div>
          </div>
        </article>
      </section>
        </Tile>
      )}

      {/*
        * Who buys the most of this product, and who sells the most of it.
        *
        * These are two different totals and must never be merged into one
        * league table: the buying side is measured with freight and insurance
        * in it, the selling side without. Each economy's share is taken
        * against its own side's total, and each table says which side and
        * which year it is on.
        */}
      {!off('importers') && (
        <Tile id="importers" label="Who buys" onUnpin={onUnpinTile}>
      <section className="chart-grid leaders single">
        <article className="panel">
          <PanelHead
            eyebrow={`LARGEST IMPORTERS · ${node.globalTrade?.year ?? '—'}`}
            title="Who buys the most of this product"
            note={
              node.globalTrade
                ? `Share of ${usd(node.globalTrade.value)} of world imports, net of re-imports. Valued CIF.`
                : 'No year has a validated world total, so no ranking is published.'
            }
          />

          <DataTable
            rows={node.globalTrade?.topEconomies ?? []}
            name={`HS-${node.code}-largest-importers`}
          />
        </article>

      </section>
        </Tile>
      )}

      {!off('exporters') && (
        <Tile id="exporters" label="Who sells" onUnpin={onUnpinTile}>
      <section className="chart-grid leaders single">
        <article className="panel">
          <PanelHead
            eyebrow={`LARGEST EXPORTERS · ${node.globalTrade?.year ?? '—'}`}
            title="Who sells the most of this product"
            note={
              node.globalTrade?.netExports
                ? `Share of ${usd(node.globalTrade.netExports)} of world exports, net of re-exports. Valued FOB, so this total is not the same as the import total beside it.`
                : 'The export side is not published for this code and year.'
            }
          />

          <DataTable
            rows={node.globalTrade?.topExporters ?? []}
            name={`HS-${node.code}-largest-exporters`}
          />
        </article>
      </section>
        </Tile>
      )}

      {/*
        * Import sources and export markets, each as one panel the reader
        * flips between a chart and the rows behind it. Two panels showing the
        * same numbers twice is not two findings.
        */}
      {!off('partners') && (
        <Tile id="partners" label="Trade partners" onUnpin={onUnpinTile}>
      <section className="chart-grid">
        <article className="panel chart-panel" id="supplier-chart">
          <PanelHead
            eyebrow={`INDIA'S IMPORT SOURCES · ${year}`}
            title="Where India buys this from"
            actions={
              <Tabs
                label="Import sources view"
                active={sourceView}
                onChange={id => setSourceView(id as 'chart' | 'table')}
                tabs={[
                  { id: 'chart', label: 'Chart' },
                  { id: 'table', label: 'Table' },
                ]}
              />
            }
            onPng={
              sourceView === 'chart'
                ? () =>
                    downloadChart(
                      'supplier-chart',
                      `HS-${node.code}-suppliers`,
                      'png',
                    )
                : undefined
            }
            onCsv={() =>
              downloadCsv(
                `HS-${node.code}-import-sources-${year}`,
                supplierRows.map((row, index) => ({
                  Rank: index + 1,
                  Partner: row.name,
                  'Comtrade code': row.code,
                  'Imports (USD)': row.value,
                  'Share of India imports': row.share,
                })),
                { ...exportMeta, period: `CY ${year}` },
              )
            }
          />

          {sourceView === 'chart' ? (
            <div className="chart-shell">
              {suppliers.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={suppliers}
                    layout="vertical"
                    margin={{ top: 8, right: 18, bottom: 10, left: 12 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke={colours.grid}
                    />

                    <XAxis
                      type="number"
                      domain={[0, (max: number) => Math.ceil(max / 5) * 5]}
                      allowDecimals={false}
                      tickFormatter={value => `${Math.round(Number(value))}%`}
                      axisLine={false}
                      tickLine={false}
                      stroke={colours.axis}
                    />

                    <YAxis
                      type="category"
                      dataKey="name"
                      width={132}
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      stroke={colours.axis}
                    />

                    <Tooltip
                      formatter={(value: unknown) =>
                        `${Number(value).toFixed(1)}%`
                      }
                      contentStyle={{
                        background: colours.surface,
                        border: `1px solid ${colours.grid}`,
                        borderRadius: 8,
                      }}
                      cursor={{ fillOpacity: 0.06 }}
                    />

                    <Bar
                      dataKey="sharePct"
                      name="Share of India imports"
                      fill={colours.imports}
                      radius={[0, 4, 4, 0]}
                      maxBarSize={22}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty>No bilateral partner detail for {year}.</Empty>
              )}
            </div>
          ) : (
            <DataTable
              rows={supplierRows}
              name={`HS-${node.code}-suppliers-${year}`}
            />
          )}
        </article>

        <article className="panel chart-panel" id="destination-chart">
          <PanelHead
            eyebrow={`INDIA'S EXPORT MARKETS · ${year}`}
            title="Where India sells this"
            actions={
              <Tabs
                label="Export markets view"
                active={marketView}
                onChange={id => setMarketView(id as 'chart' | 'table')}
                tabs={[
                  { id: 'chart', label: 'Chart' },
                  { id: 'table', label: 'Table' },
                ]}
              />
            }
            onPng={
              marketView === 'chart'
                ? () =>
                    downloadChart(
                      'destination-chart',
                      `HS-${node.code}-destinations`,
                      'png',
                    )
                : undefined
            }
            onCsv={() =>
              downloadCsv(
                `HS-${node.code}-export-markets-${year}`,
                destinationRows.map((row, index) => ({
                  Rank: index + 1,
                  Partner: row.name,
                  'Comtrade code': row.code,
                  'Exports (USD)': row.value,
                  'Share of India exports': row.share,
                })),
                { ...exportMeta, period: `CY ${year}` },
              )
            }
          />

          {marketView === 'chart' ? (
            <div className="chart-shell">
              {destinations.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={destinations}
                    layout="vertical"
                    margin={{ top: 8, right: 18, bottom: 10, left: 12 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke={colours.grid}
                    />

                    <XAxis
                      type="number"
                      domain={[0, (max: number) => Math.ceil(max / 5) * 5]}
                      allowDecimals={false}
                      tickFormatter={value => `${Math.round(Number(value))}%`}
                      axisLine={false}
                      tickLine={false}
                      stroke={colours.axis}
                    />

                    <YAxis
                      type="category"
                      dataKey="name"
                      width={132}
                      tick={{ fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      stroke={colours.axis}
                    />

                    <Tooltip
                      formatter={(value: unknown) =>
                        `${Number(value).toFixed(1)}%`
                      }
                      contentStyle={{
                        background: colours.surface,
                        border: `1px solid ${colours.grid}`,
                        borderRadius: 8,
                      }}
                      cursor={{ fillOpacity: 0.06 }}
                    />

                    <Bar
                      dataKey="sharePct"
                      name="Share of India exports"
                      fill={colours.exports}
                      radius={[0, 4, 4, 0]}
                      maxBarSize={22}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty>No bilateral partner detail for {year}.</Empty>
              )}
            </div>
          ) : (
            <DataTable
              rows={destinationRows}
              name={`HS-${node.code}-destinations-${year}`}
            />
          )}
        </article>
      </section>
        </Tile>
      )}

      {!off('tariff') && (
        <Tile id="tariff" label="Tariff lines" onUnpin={onUnpinTile}>
          {tariffPanel}
        </Tile>
      )}

      </TileDeck>

      <footer className="footerbar">
        <div>
          UN Comtrade · HS-6 global comparison · calendar years
          {tariff ? ' · DGCIS / TradeStat HS-8, financial years' : ''}
        </div>

        <div className="actions">
          <button
            onClick={() =>
              downloadJson(`HStat-${node.code}-${year}`, annual, {
                ...exportMeta,
                period: `CY ${year}`,
              })
            }
          >
            JSON
          </button>

          <button
            onClick={() =>
              downloadCsv(
                `HStat-${node.code}-annual`,
                [...node.years]
                  .sort((a, b) => b - a)
                  .map(item => ({
                    'Calendar year': item,
                    'Global trade (USD)': node.annual[String(item)].global.trade,
                    'Coverage status':
                      node.annual[String(item)].global.coverage?.status ?? null,
                    'India imports (USD)':
                      node.annual[String(item)].india.imports,
                    'India exports (USD)':
                      node.annual[String(item)].india.exports,
                    'India share of global trade':
                      node.annual[String(item)].global.indiaShare,
                  })),
                {
                  ...exportMeta,
                  period: `Annual ${Math.min(...node.years)}–${Math.max(...node.years)}`,
                },
              )
            }
          >
            CSV
          </button>

          <button onClick={exportWorkbook}>XLSX</button>
        </div>
      </footer>
    </>
  )
}
