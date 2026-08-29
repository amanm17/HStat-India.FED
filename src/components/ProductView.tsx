import { useCallback, useMemo, useState } from 'react'
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
import { Download, Plus } from 'lucide-react'

import type {
  CurrencyBlock,
  CurrencyMode,
  HsNode,
  PeriodRecord,
} from '../types'
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
  defaultFinancialYear,
  money,
  rateNote,
} from '../lib/currency'
import { palette } from '../lib/palette'
import {
  downloadChart,
  downloadCsv,
  downloadJson,
  downloadXlsx,
} from '../lib/export'
import {
  DataTable,
  Disclosure,
  Empty,
  InsightPanel,
  MiniMetric,
  PanelHead,
  StatusPill,
} from './primitives'

type Horizon = '5Y' | '10Y' | 'ALL'

/*
 * Only the last point of each series is labelled. A number on every point
 * turns a trend line into a table; a number on the last one tells you
 * where it ended up without any of that.
 */
function lastPointLabel(colour: string, total: number) {
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
        {usd(value, 1)}
      </text>
    )
  }
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

          <MiniMetric
            label="Mirror gap"
            value={mirrorGap === null ? '—' : delta(mirrorGap)}
            detail="import side vs export side"
          />

          <MiniMetric
            label="Re-import adjustment"
            value={pct(benchmark.adjustmentCoverage, 0)}
            detail="of the total could be adjusted"
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
}) {
  const [horizon, setHorizon] = useState<Horizon>('10Y')

  const [frequency, setFrequency] = useState<'annual' | 'monthly'>('annual')

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
        label: String(item),
        full: String(item),
        imports: node.annual[String(item)]?.india.imports ?? null,
        exports: node.annual[String(item)]?.india.exports ?? null,
      }))
  }, [node, horizon, frequency])

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

  const suppliers = (annual?.india.suppliers?.rows ?? [])
    .slice(0, 10)
    .map(row => ({ ...row, sharePct: row.share * 100 }))


  if (!annual) {
    return <Empty>No data for {year}.</Empty>
  }

  const current = annual

  function exportWorkbook() {
    const annualRows = node.years.map(item => {
      const record = node.annual[String(item)]

      return {
        year: item,
        globalTrade: record.global.trade,
        globalTradeStatus: record.global.coverage?.status,
        grossGlobalImports: record.global.observed.grossImports,
        reImportsRemoved: record.global.observed.reImportsRemoved,
        netGlobalImports: record.global.observed.netImports,
        grossGlobalExports: record.global.observed.grossExports,
        reExportsRemoved: record.global.observed.reExportsRemoved,
        netGlobalExports: record.global.observed.netExports,
        mirrorGap: record.global.mirror?.gap ?? null,
        reImportAdjustmentCoverage:
          record.global.observed.adjustmentCoverage,
        indiaRank: record.global.indiaRank,
        indiaShare: record.global.indiaShare,
        indiaImports: record.india.imports,
        indiaExports: record.india.exports,
        indiaBalance: record.india.balance,
      }
    })

    const monthlyRows = node.months.map(period => ({
      period: monthLabel(period),
      globalTrade: node.monthly[period]?.global.trade ?? null,
      globalTradeStatus: node.monthly[period]?.global.coverage?.status ?? null,
      indiaImports: node.monthly[period]?.india.imports ?? null,
      indiaExports: node.monthly[period]?.india.exports ?? null,
      indiaBalance: node.monthly[period]?.india.balance ?? null,
    }))

    downloadXlsx(`HStat-${node.code}`, {
      Annual: annualRows,
      Monthly: monthlyRows,
      TopEconomies: node.globalTrade?.topEconomies ?? [],
      Suppliers: current.india.suppliers?.rows ?? [],
      Destinations: current.india.destinations?.rows ?? [],

      /* Financial years, so the sheet carries its own period column and
       * cannot be mistaken for the calendar-year sheets beside it. */
      IndiaHS8: tariffYears.flatMap(fy => {
        const block = node.tariffLines?.financialYears?.[fy]

        return (block?.rows ?? []).map(row => ({
          financialYear: fy,
          monthsCovered: block?.meta.monthsCovered ?? null,
          hs8: row.hs8,
          description: row.description,
          importsUsd: row.imports,
          exportsUsd: row.exports,
          balanceUsd: row.balance,
          importsInr: row.importsInr,
          exportsInr: row.exportsInr,
          filedIn: row.native.toUpperCase(),
          rateInrPerUsd: block?.meta.rate ?? null,
        }))
      }),
    })
  }

  /* ---------------------------------------------------------------
   * The tariff-line panel.
   *
   * Built once and placed in one of two positions: promoted directly under
   * India's position when HS-8 mode is on, or left at the foot of the page
   * when it is off. Same panel either way, so the two modes cannot drift.
   * ------------------------------------------------------------- */

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

  const tariffPanel = (
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
      <section className="product-head">
        <div className="product-copy">
          <div className="eyebrow">
            {node.category || 'HStat'} · HS-{node.level} · {node.code}
            {!node.inFedDefinition && ' · reference only'}
          </div>

          <h1>{node.product || node.description}</h1>

          <div className="subline">
            <span>
              HS-{node.level} {node.code}
            </span>

            <span>•</span>

            <span>{node.classification}</span>

            {node.segment && (
              <>
                <span>•</span>
                <span>{node.segment}</span>
              </>
            )}

            {node.latestIndiaMonth && (
              <>
                <span>•</span>
                <span>India through {monthLabel(node.latestIndiaMonth)}</span>
              </>
            )}
          </div>

          {node.product && node.product !== node.description && (
            <p className="product-official">{node.description}</p>
          )}
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

      <LineageNote node={node} onOpen={onOpen} />

      <GlobalTradeCard node={node} methodology={methodology} />

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
            {year} did not pass reporter-coverage validation
            {annual.global.coverage?.reason
              ? ` (${annual.global.coverage.reason})`
              : ''}
            , so no global figure, rank or share is shown for it. The headline
            above uses {node.globalTrade?.year ?? 'the latest validated year'}.
          </div>
        )}
      </section>

      {showHs8 && tariffPanel}

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

      {node.definitionShare && (
        <section className="insight-grid single">
          <InsightPanel
            eyebrow="DEFINITION COVERAGE"
            title={`How much of HS-${node.level} ${node.code} the sector definition tracks`}
            rows={buildCoverage(node, year)}
            note={node.definitionShare.basis}
          />
        </section>
      )}

      <section className="chart-grid">
        <article className="panel chart-panel" id="trade-trend">
          <PanelHead
            eyebrow="TRADE TRAJECTORY"
            title="India imports and exports"
            note={
              frequency === 'monthly'
                ? 'Monthly filings. Recent months are incomplete until every reporter files.'
                : undefined
            }
            onPng={() =>
              downloadChart('trade-trend', `HS-${node.code}-India-trade`, 'png')
            }
            onSvg={() =>
              downloadChart('trade-trend', `HS-${node.code}-India-trade`, 'svg')
            }
          />

          <div className="chart-shell">
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
                data={trend}
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
                  tickFormatter={value => `${(Number(value) / 1e9).toFixed(1)}`}
                  axisLine={false}
                  tickLine={false}
                  stroke={colours.axis}
                />

                <Tooltip
                  formatter={(value: unknown) => usd(Number(value))}
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
                  activeDot={{ r: 4.5, stroke: colours.surface, strokeWidth: 2 }}
                  label={lastPointLabel(colours.imports, trend.length)}
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
                  activeDot={{ r: 4.5, stroke: colours.surface, strokeWidth: 2 }}
                  label={lastPointLabel(colours.exports, trend.length)}
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>

            <div className="axis-note">USD bn</div>
          </div>
        </article>

        <article className="panel chart-panel" id="global-trend">
          <PanelHead
            eyebrow="MARKET SIZE"
            title="Global trade, net of re-imports"
            note={
              predecessorCode
                ? `The dashed line is HS ${predecessorCode}, the code this replaced. It is shown alongside, never added: its total covers every successor and cannot be divided between them.`
                : 'Years that failed coverage validation are left blank rather than estimated.'
            }
            onPng={() =>
              downloadChart('global-trend', `HS-${node.code}-global-trade`, 'png')
            }
            onCsv={() =>
              downloadCsv(`HS-${node.code}-global-trade`, globalTrend)
            }
          />

          <div className="chart-shell">
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
                />

                <YAxis
                  width={58}
                  tickFormatter={value => `${(Number(value) / 1e9).toFixed(0)}`}
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
                    dot={{ r: 2.5, fill: colours.surface, stroke: colours.primary }}
                    activeDot={{ r: 4.5 }}
                    connectNulls={false}
                  />
                )}

                <Line
                  type="monotone"
                  dataKey="trade"
                  name={
                    predecessorCode ? `HS ${node.code}` : 'Global trade'
                  }
                  stroke={colours.primary}
                  strokeWidth={2}
                  dot={{ r: 3, fill: colours.primary }}
                  activeDot={{ r: 5, stroke: colours.surface, strokeWidth: 2 }}
                  label={lastPointLabel(colours.primary, globalTrend.length)}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>

            <div className="axis-note">USD bn</div>
          </div>
        </article>
      </section>

      <section className="chart-grid">
        <article className="panel chart-panel" id="supplier-chart">
          <PanelHead
            eyebrow="PARTNER NETWORK"
            title="India import sources"
            onPng={() =>
              downloadChart('supplier-chart', `HS-${node.code}-suppliers`, 'png')
            }
            onCsv={() =>
              downloadCsv(
                `HS-${node.code}-suppliers-${year}`,
                annual.india.suppliers?.rows ?? [],
              )
            }
          />

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
                    width={124}
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
                    fill={colours.primary}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={22}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty>No bilateral partner detail for {year}.</Empty>
            )}
          </div>
        </article>

        <article className="panel">
          <PanelHead
            eyebrow={`TOP ECONOMIES · ${node.globalTrade?.year ?? '—'}`}
            title="Largest importing economies"
            note="Ranked on trade net of re-imports."
          />

          <DataTable
            rows={node.globalTrade?.topEconomies ?? []}
            name={`HS-${node.code}-top-economies`}
          />
        </article>
      </section>

      <section className="chart-grid">
        <article className="panel">
          <PanelHead eyebrow="SOURCES" title="India import partners" />

          <DataTable
            rows={annual.india.suppliers?.rows ?? []}
            name={`HS-${node.code}-suppliers-${year}`}
          />
        </article>

        <article className="panel">
          <PanelHead eyebrow="DESTINATIONS" title="India export markets" />

          <DataTable
            rows={annual.india.destinations?.rows ?? []}
            name={`HS-${node.code}-destinations-${year}`}
          />
        </article>
      </section>

      {!showHs8 && tariffPanel}

      <footer className="footerbar">
        <div>
          UN Comtrade · HS-6 global comparison · calendar years
          {tariff ? ' · DGCIS / TradeStat HS-8, financial years' : ''}
        </div>

        <div className="actions">
          <button
            onClick={() => downloadJson(`HStat-${node.code}-${year}`, annual)}
          >
            JSON
          </button>

          <button
            onClick={() =>
              downloadCsv(
                `HStat-${node.code}-${year}-suppliers`,
                annual.india.suppliers?.rows ?? [],
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
