import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Download, Sigma, Trash2, X } from 'lucide-react'

import type { HsNode } from '../types'
import type { BasketEntry, BasketLine } from '../lib/hstack'
import type { SnapshotName } from '../lib/data'
import { loadDetail } from '../lib/scope'
import {
  bestYear,
  combinedSeries,
  familyGaps,
  hs8Entries,
  summarise,
  type StackDetails,
  toRows,
} from '../lib/hstack'
import {
  formatValue,
  loadDgcisIndex,
  type DgcisIndexEntry,
} from '../lib/dgcis'
import { concentrationLabel, pct, usd } from '../lib/format'
import { palette } from '../lib/palette'
import { downloadCsv, downloadXlsx } from '../lib/export'
import {
  DataTable,
  Empty,
  MiniMetric,
  PanelHead,
  SeriesTable,
  Tabs,
  ViewTabs,
  type ChartView,
} from './primitives'

/*
 * HStack reads a basket of HS codes the way a checkout reads a cart: the
 * combined total first, then what each line contributes to it.
 *
 * Two things are deliberately visible rather than hidden. Codes whose
 * figures are withheld for the chosen year are listed with the reason, so
 * a basket total is never quietly short. And the aggregated country tables
 * declare how much of basket trade they actually cover: from 2016 they add up
 * every economy in each product's full list; before that, each product's top
 * economies only.
 */

export function HStackPanel({
  entries,
  nodes,
  loading,
  onRemove,
  onClear,
  onOpen,
  onAdd,
  onClose,
  dark,
  title,
  snapshot = 'current',
}: {
  entries: BasketEntry[]
  nodes: HsNode[]
  loading: boolean
  onRemove: (code: string) => void
  onClear: () => void
  onOpen: (code: string, level: 2 | 4 | 6) => void
  onAdd?: (code: string, level: 2 | 4 | 6) => void
  onClose: () => void
  dark: boolean
  /* Set when the stack is a key-segment category from the front page. */
  title?: { name: string; segment: string; lines: number } | null
  /* Which snapshot the full economy lists are read from. */
  snapshot?: SnapshotName
}) {
  const colours = palette(dark)

  const suggested = useMemo(() => bestYear(nodes), [nodes])

  /* Families the stack has started but not finished, and the one series that
   * spans the revision once it has. */
  const gaps = useMemo(() => familyGaps(nodes), [nodes])

  const longSeries = useMemo(() => combinedSeries(nodes), [nodes])

  const spansRevision = longSeries.some(point => point.spansRevision)

  const [year, setYear] = useState<number | null>(suggested)

  useEffect(() => {
    setYear(current => current ?? suggested)
  }, [suggested])

  const activeYear = year ?? suggested

  const years = useMemo(() => {
    const all = new Set<number>()

    for (const node of nodes) {
      for (const item of node.analyticalYears) all.add(item)
    }

    return [...all].sort((a, b) => b - a)
  }, [nodes])

  /*
   * Every economy behind each code, from 2016. Fetched once per code and
   * cached by loadDetail; until they arrive the tables use each product's
   * gross top ten and say how much of the total that covers.
   */
  const [details, setDetails] = useState<StackDetails | undefined>(undefined)

  useEffect(() => {
    if (!nodes.length) {
      setDetails(undefined)
      return
    }

    let live = true

    Promise.all(
      nodes.map(node =>
        loadDetail(snapshot, node.code)
          .catch(() => null)
          .then(detail => [node.code, detail] as const),
      ),
    ).then(pairs => {
      if (live) setDetails(new Map(pairs))
    })

    return () => {
      live = false
    }
  }, [nodes, snapshot])

  const summary = useMemo(
    () => (activeYear && nodes.length ? summarise(nodes, activeYear, 10, details) : null),
    [nodes, activeYear, details],
  )

  /*
   * Which combined figure the composition is a composition of.
   *
   * A stack's split is not one number. Two products can be near-equal in
   * world trade and nine-to-one in what India actually buys, and that
   * difference is usually the point of stacking them in the first place.
   */
  const [metric, setMetric] = useState<'trade' | 'imports' | 'exports'>('trade')

  /* Chart or table, on both charts in this panel. */
  const [longView, setLongView] = useState<ChartView>('chart')
  const [compositionView, setCompositionView] = useState<ChartView>('chart')

  /*
   * The eight-digit side of the stack.
   *
   * Loaded from the DGCIS index rather than the snapshot, because that is
   * where tariff lines live, and held apart from `summary` for the reason set
   * out in lib/hstack.ts: these are India's own filings against a national
   * schedule, with no world total to sit beside and no basis on which to be
   * added to the Comtrade figures above.
   */
  const stackedHs8 = useMemo(() => hs8Entries(entries), [entries])

  const [hs8Lines, setHs8Lines] = useState<DgcisIndexEntry[] | null>(null)

  useEffect(() => {
    if (!stackedHs8.length) {
      setHs8Lines(null)
      return
    }

    let live = true

    loadDgcisIndex()
      .then(index => {
        if (!live || !index) return

        const wanted = new Set(stackedHs8.map(entry => entry.code))

        setHs8Lines(index.lines.filter(line => wanted.has(line.hs8)))
      })
      .catch(() => {
        /* The tariff layer is an addition; a stack without it still totals
         * everything else on the page. */
        if (live) setHs8Lines([])
      })

    return () => {
      live = false
    }
  }, [stackedHs8])

  const hs8Totals = useMemo(() => {
    if (!hs8Lines?.length) return null

    const sum = (flow: 'exports' | 'imports') =>
      hs8Lines.reduce(
        (total, line) => total + (line.flows[flow]?.last12UsdMillion ?? 0),
        0,
      )

    return { exports: sum('exports'), imports: sum('imports') }
  }, [hs8Lines])

  const METRICS = {
    trade: {
      label: 'Global trade',
      phrase: 'global trade',
      value: (line: BasketLine) => line.globalTrade,
      share: (line: BasketLine) => line.shareOfBasket,
    },
    imports: {
      label: 'India imports',
      phrase: 'India imports',
      value: (line: BasketLine) => line.indiaImports,
      share: (line: BasketLine) => line.shareOfIndiaImports,
    },
    exports: {
      label: 'India exports',
      phrase: 'India exports',
      value: (line: BasketLine) => line.indiaExports,
      share: (line: BasketLine) => line.shareOfIndiaExports,
    },
  } as const

  const active = METRICS[metric]

  const composition = useMemo(
    () =>
      (summary?.lines ?? [])
        .filter(line => active.share(line) !== null)
        .sort((a, b) => (active.share(b) ?? 0) - (active.share(a) ?? 0))
        .slice(0, 12)
        .map(line => ({
          name: `${line.code} · ${line.label}`.slice(0, 42),
          code: line.code,
          sharePct: (active.share(line) ?? 0) * 100,
          value: active.value(line) ?? 0,
        })),
    [summary, metric],
  )

  function exportStack() {
    if (!summary) return

    downloadXlsx(`HStat-HStack-${summary.year}`, {
      Basket: toRows(summary),
      TopEconomies: summary.topEconomies,
      IndiaSuppliers: summary.suppliers,
      Summary: [
        {
          year: summary.year,
          codes: summary.lines.length,
          codesCounted: summary.linesCounted,
          codesWithheld: summary.linesWithheld,
          globalTrade: summary.globalTrade,
          indiaImports: summary.indiaImports,
          indiaExports: summary.indiaExports,
          indiaBalance: summary.indiaBalance,
          indiaShareOfGlobal: summary.indiaShareOfGlobal,
          supplierHhi: summary.supplierHhi,
          economyTableCoverage: summary.economyCoverage,
          supplierTableCoverage: summary.supplierCoverage,
        },
      ],
    })
  }

  return (
    <div className="hstack-overlay" role="dialog" aria-label="HStack">
      <div className="hstack-panel">
        <header className="hstack-head">
          <div className="hstack-title">
            <div className="eyebrow">{title ? 'HStack · Key segment' : 'HStack'}</div>

            <h2>
              {title ? title.name : `${entries.length} code${entries.length === 1 ? '' : 's'} stacked`}
            </h2>

            <p className="hstack-sub">
              {title ? (
                <>
                  <span>{title.segment}</span>
                  <span>
                    {entries.length} of {title.lines} HS-6 line{title.lines === 1 ? '' : 's'} stacked
                  </span>
                </>
              ) : (
                entries.length > 0 && (
                  <span>
                    {[...new Set(entries.map(entry => `HS-${entry.level}`))].join(', ')} codes, each counted once
                  </span>
                )
              )}
            </p>
          </div>

          <div className="hstack-head-actions">
            {activeYear && years.length > 0 && (
              <label className="rf-control hstack-year">
                <span>Year</span>

                <select
                  id="hstack-year"
                  value={activeYear}
                  onChange={event => setYear(Number(event.target.value))}
                >
                  {years.map(item => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {entries.length > 0 && (
              <>
                <button type="button" className="rf-button quiet hstack-tool" onClick={exportStack}>
                  <Download size={16} aria-hidden />
                  Excel
                </button>

                <button type="button" className="rf-button quiet hstack-tool" onClick={onClear}>
                  <Trash2 size={16} aria-hidden />
                  Clear
                </button>
              </>
            )}

            <button type="button" className="rf-button quiet hstack-tool hstack-close" onClick={onClose} aria-label="Close">
              <X size={18} aria-hidden />
            </button>
          </div>
        </header>

        {entries.length === 0 && (
          <div className="hstack-empty">
            <Sigma size={28} />

            <h3>Nothing stacked yet</h3>

            <p>
              Add HS codes from search or from any product page. HStack totals
              their global trade, shows what each one contributes, and rebuilds
              India's position and country rankings across the whole stack.
            </p>
          </div>
        )}

        {entries.length > 0 && loading && (
          <div className="hstack-loading">Loading {entries.length} codes…</div>
        )}

        {/*
          * India's tariff lines, totalled on their own.
          *
          * Placed above the Comtrade section when that section is empty - a
          * stack of only eight-digit lines should not open on a blank panel -
          * and below it otherwise, because the world figures are the wider
          * context and the tariff lines are the detail inside them.
          */}
        {hs8Lines !== null && hs8Lines.length > 0 && (
          <section className="hstack-hs8" id="hstack-tariff-lines">
            <PanelHead
              eyebrow="INDIA TARIFF LINES · DGCIS"
              title={`${hs8Lines.length} eight-digit line${hs8Lines.length === 1 ? '' : 's'}, last 12 months`}
              note="India's own filings against its tariff schedule. There is no world figure at eight digits, so these are totalled on their own and never added to the global figures above."
              onCsv={() =>
                downloadCsv(
                  'HStack-tariff-lines',
                  hs8Lines.map(line => ({
                    'HS8': line.hs8,
                    Name: line.title || line.headingName,
                    'Heading': line.hs6,
                    'Exports (USD mn, 12 months)':
                      line.flows.exports?.last12UsdMillion ?? null,
                    'Imports (USD mn, 12 months)':
                      line.flows.imports?.last12UsdMillion ?? null,
                  })),
                )
              }
            />

            {hs8Totals && (
              <div className="hstack-metrics">
                {/* The unit belongs in the caption, not the number: at tile
                    width "32,535 USD mn" truncated to "32,535 USD …", which
                    reads as a figure that has been cut off. */}
                <MiniMetric
                  label="India exports"
                  value={formatValue(hs8Totals.exports)}
                  detail={`USD mn · ${hs8Lines.length} line${hs8Lines.length === 1 ? '' : 's'}, last 12 months`}
                />

                <MiniMetric
                  label="India imports"
                  value={formatValue(hs8Totals.imports)}
                  detail={`USD mn · ${hs8Lines.length} line${hs8Lines.length === 1 ? '' : 's'}, last 12 months`}
                />
              </div>
            )}

            <SeriesTable
              caption="Stacked tariff lines, last twelve months"
              columns={[
                { key: 'code', label: 'HS8' },
                { key: 'name', label: 'Name' },
                { key: 'exports', label: 'Exports (USD mn)', numeric: true },
                { key: 'imports', label: 'Imports (USD mn)', numeric: true },
              ]}
              rows={[...hs8Lines]
                .sort(
                  (a, b) =>
                    (b.flows.exports?.last12UsdMillion ?? 0) -
                    (a.flows.exports?.last12UsdMillion ?? 0),
                )
                .map(line => ({
                  code: line.hs8,
                  name: line.title || line.headingName,
                  exports: formatValue(
                    line.flows.exports?.last12UsdMillion ?? null,
                  ),
                  imports: formatValue(
                    line.flows.imports?.last12UsdMillion ?? null,
                  ),
                }))}
            />
          </section>
        )}

        {summary && !loading && (
          <>
            {summary.containedCodes.length > 0 && (
              <div className="hstack-warning" data-tone="resolved">
                <strong>Overlapping codes, counted once</strong>

                <span>
                  {summary.lines
                    .filter(line => line.containedIn)
                    .map(
                      line =>
                        `HS ${line.code} sits inside HS ${line.containedIn}` +
                        /* Only when it reads as a share. A figure above
                         * 100% means the two codes disagree, which is a
                         * data question, not something to print as a
                         * fraction. */
                        (line.shareOfParent !== null &&
                        line.shareOfParent > 0 &&
                        line.shareOfParent <= 1
                          ? ` (${pct(line.shareOfParent)} of it)`
                          : ''),
                    )
                    .join('; ')}
                  . A heading already contains every line beneath it, so the
                  narrower {summary.containedCodes.length === 1 ? 'code is' : 'codes are'}{' '}
                  shown in the table below with{' '}
                  {summary.containedCodes.length === 1 ? 'its' : 'their'} own
                  figures but left out of every total. Remove the broader code
                  to total the narrower {summary.containedCodes.length === 1 ? 'one' : 'ones'} instead.
                </span>
              </div>
            )}

            {gaps.length > 0 && (
              <div className="family-prompt">
                <div>
                  <strong>This product changed code in HS 2022.</strong>{' '}
                  {gaps[0].note}{' '}
                  {gaps[0].retired.length > 0 && (
                    <>
                      HS {gaps[0].retired.join(' and ')} is retired and has no
                      page, but its years arrive with the successor, so adding{' '}
                      {gaps[0].missing.length === 1 ? 'the' : 'the'} missing
                      code{gaps[0].missing.length === 1 ? '' : 's'} completes
                      the series.
                    </>
                  )}
                </div>

                {onAdd && (
                  <button
                    className="family-add"
                    onClick={() => {
                      for (const code of gaps[0].missing) {
                        onAdd(code, code.length === 6 ? 6 : code.length === 4 ? 4 : 2)
                      }
                    }}
                  >
                    Add HS {gaps[0].missing.join(' and ')}
                  </button>
                )}
              </div>
            )}

            <section className="hstack-summary">
              <div className="hero-figure">
                <span>Combined global trade · {summary.year}</span>

                <strong>{usd(summary.globalTrade)}</strong>

                <small>
                  {summary.linesCounted} of {summary.lines.length} codes
                  counted, gross
                </small>
              </div>

              <div className="hero-side">
                <MiniMetric
                  label="India imports"
                  value={usd(summary.indiaImports)}
                  detail="stack total"
                />

                <MiniMetric
                  label="India exports"
                  value={usd(summary.indiaExports)}
                  detail="stack total"
                />

                <MiniMetric
                  label="Trade balance"
                  value={usd(summary.indiaBalance)}
                  detail="exports − imports"
                />

                <MiniMetric
                  label="India's share of world imports"
                  value={pct(summary.indiaShareOfGlobal)}
                  detail="India's imports over the stack's world total"
                />
              </div>
            </section>

            {summary.linesWithheld > 0 && (
              <div className="coverage-note">
                {summary.linesWithheld} code
                {summary.linesWithheld === 1 ? '' : 's'} contributed nothing to
                the total for {summary.year} because their reporter coverage
                did not validate. They are listed below with the reason.
              </div>
            )}

            {longSeries.length > 1 && (
              <section className="chart-grid single">
                <article className="panel chart-panel" id="hstack-longseries">
                  <PanelHead
                    eyebrow="STACK OVER TIME"
                    title="Stack total by year"
                    actions={
                      <ViewTabs
                        label="Stack over time view"
                        view={longView}
                        onChange={setLongView}
                      />
                    }
                    note={
                      (spansRevision
                        ? 'Retired codes contribute the years they were reported under, the current codes contribute theirs. They do not overlap, so this is a sum rather than a spliced series. '
                        : 'Combined global trade for every code in the stack. ') +
                      'A year that could not be published is left blank: a break in the line is a withheld year, not a fall in trade.'
                    }
                    onCsv={() =>
                      downloadCsv(
                        'HStack-long-series',
                        longSeries.map(point => ({
                          year: point.year,
                          globalTrade: point.globalTrade,
                          indiaImports: point.indiaImports,
                          indiaExports: point.indiaExports,
                          reportedUnder: point.contributors.join(' + '),
                        })),
                      )
                    }
                  />

                  {longView === 'table' ? (
                    <SeriesTable
                      caption="The stack's combined trade by year"
                      columns={[
                        { key: 'year', label: 'Year' },
                        { key: 'globalTrade', label: 'Global trade', numeric: true },
                        { key: 'indiaImports', label: 'India imports', numeric: true },
                        { key: 'indiaExports', label: 'India exports', numeric: true },
                        { key: 'reportedUnder', label: 'Reported under' },
                      ]}
                      rows={[...longSeries].reverse().map(point => ({
                        year: String(point.year),
                        globalTrade:
                          point.globalTrade === null ? null : usd(point.globalTrade),
                        indiaImports:
                          point.indiaImports === null ? null : usd(point.indiaImports),
                        indiaExports:
                          point.indiaExports === null ? null : usd(point.indiaExports),
                        reportedUnder: point.contributors.join(' + '),
                      }))}
                    />
                  ) : (
                  <div className="chart-shell">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={longSeries}
                        margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
                      >
                        <CartesianGrid
                          strokeDasharray="2 4"
                          stroke={colours.grid}
                          vertical={false}
                        />

                        <XAxis
                          dataKey="year"
                          tick={{ fill: colours.axis, fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                        />

                        <YAxis
                          tick={{ fill: colours.axis, fontSize: 11 }}
                          tickLine={false}
                          axisLine={false}
                          width={64}
                          tickFormatter={value => usd(Number(value), 0)}
                        />

                        <Tooltip
                          contentStyle={{
                            background: colours.surface,
                            border: `1px solid ${colours.grid}`,
                            borderRadius: 8,
                          }}
                          formatter={(value: unknown) => usd(Number(value))}
                          labelFormatter={(label: unknown) => {
                            const point = longSeries.find(
                              item => item.year === Number(label),
                            )

                            return point?.contributors.length
                              ? `${label} · reported under ${point.contributors.join(' + ')}`
                              : String(label)
                          }}
                        />

                        <Area
                          type="monotone"
                          dataKey="globalTrade"
                          name="Combined global trade"
                          stroke={colours.primary}
                          fill={colours.primary}
                          fillOpacity={0.12}
                          strokeWidth={2}
                          connectNulls={false}
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  )}
                </article>
              </section>
            )}

            <section className="chart-grid">
              <article className="panel chart-panel" id="hstack-composition">
                <PanelHead
                  eyebrow="COMPOSITION"
                  title={`Share of ${active.phrase}`}
                  note={`Each code's ${active.phrase} as a share of the stack's combined figure.`}
                  actions={
                    <>
                      <Tabs
                        label="Which figure to split"
                        active={metric}
                        onChange={id =>
                          setMetric(id as 'trade' | 'imports' | 'exports')
                        }
                        tabs={[
                          { id: 'trade', label: 'Global' },
                          { id: 'imports', label: 'Imports' },
                          { id: 'exports', label: 'Exports' },
                        ]}
                      />

                      <ViewTabs
                        label="Composition view"
                        view={compositionView}
                        onChange={setCompositionView}
                      />
                    </>
                  }
                  onCsv={() => downloadCsv('HStack-composition', composition)}
                />

                {compositionView === 'table' ? (
                  <SeriesTable
                    caption={`Each code's share of the stack's ${active.phrase}`}
                    columns={[
                      { key: 'code', label: 'Code' },
                      { key: 'label', label: 'Name' },
                      { key: 'value', label: 'Value', numeric: true },
                      { key: 'share', label: 'Share of stack', numeric: true },
                    ]}
                    rows={composition.map(row => ({
                      code: row.code,
                      label: row.name,
                      value: usd(row.value),
                      share: `${row.sharePct.toFixed(1)}%`,
                    }))}
                  />
                ) : (
                <div className="chart-shell tall">
                  {composition.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={composition}
                        layout="vertical"
                        margin={{ top: 8, right: 24, bottom: 10, left: 12 }}
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
                          width={210}
                          tick={{ fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                          stroke={colours.axis}
                        />

                        <Tooltip
                          formatter={(value: unknown, _name, item) =>
                            [
                              `${Number(value).toFixed(1)}%`,
                              usd(
                                (item?.payload as { value?: number })?.value ??
                                  null,
                              ),
                            ].join(' · ')
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
                          name="Share of stack"
                          fill={colours.primary}
                          radius={[0, 4, 4, 0]}
                          maxBarSize={20}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <Empty>
                      No code in the stack has a published figure for{' '}
                      {summary.year}.
                    </Empty>
                  )}
                </div>
                )}
              </article>

              <article className="panel">
                <PanelHead
                  eyebrow="TOP IMPORTERS"
                  title="Top importers worldwide"
                  note={
                    summary.economyCoverage === null
                      ? undefined
                      : summary.economyCoverage >= 0.995
                        ? "Every economy in each product's list, added up across the stack."
                        : `Built from each product's top economies, covering ${pct(
                            summary.economyCoverage,
                            0,
                          )} of the stack's trade.`
                  }
                />

                <DataTable
                  rows={summary.topEconomies}
                  name={`HStack-economies-${summary.year}`}
                />
              </article>
            </section>

            <section className="chart-grid">
              <article className="panel">
                <PanelHead
                  eyebrow="IMPORT PARTNERS"
                  title="India: import partners"
                  note={
                    summary.supplierCoverage === null
                      ? undefined
                      : `Covers ${pct(
                          summary.supplierCoverage,
                          0,
                        )} of India's imports in the stack. HHI ${
                          summary.supplierHhi?.toFixed(3) ?? '—'
                        } (${concentrationLabel(
                          summary.supplierHhi,
                        ).toLowerCase()} concentration).`
                  }
                />

                <DataTable
                  rows={summary.suppliers}
                  name={`HStack-suppliers-${summary.year}`}
                />
              </article>

              {/*
                * What each code contributes, on every figure at once.
                *
                * The combined total answers "how big is this together"; this
                * answers "and which of them is it". A stack where one line is
                * 90% of world trade but 20% of what India buys is telling you
                * something, and a single share column would hide it.
                */}
              <article className="panel">
                <PanelHead
                  eyebrow="CONTRIBUTION"
                  title="Share by code"
                  note={`Share of the stack's combined figure, for CY ${summary.year}. Click a code to open it.`}
                  onCsv={() => downloadCsv(`HStack-contribution-${summary.year}`, toRows(summary))}
                />

                <div className="tablewrap">
                  <table className="contribution">
                    <thead>
                      <tr>
                        <th scope="col">Code</th>
                        <th scope="col" className="num">Global trade</th>
                        <th scope="col" className="num">India imports</th>
                        <th scope="col" className="num">India exports</th>
                        <th scope="col"><span className="sr-only">Remove</span></th>
                      </tr>
                    </thead>

                    <tbody>
                      {summary.lines.map(line => (
                        <tr key={line.code} data-excluded={line.containedIn ? 'yes' : undefined}>
                          <th scope="row">
                            <button
                              className="hstack-line-open"
                              onClick={() => onOpen(line.code, line.level)}
                            >
                              <span className="result-level">HS-{line.level}</span>
                              <strong>{line.code}</strong>
                              <span className="hstack-line-label">{line.label}</span>
                            </button>

                            {line.containedIn && (
                              <span className="contribution-note">
                                inside HS {line.containedIn} — not added again
                              </span>
                            )}

                            {!line.containedIn && line.withheldReason && (
                              <span className="contribution-note">
                                {line.withheldReason}
                              </span>
                            )}
                          </th>

                          <td className="num">
                            <span className="cell-value">{usd(line.globalTrade)}</span>
                            <span className="cell-share">
                              {line.shareOfBasket === null ? '—' : pct(line.shareOfBasket)}
                            </span>
                          </td>

                          <td className="num">
                            <span className="cell-value">{usd(line.indiaImports)}</span>
                            <span className="cell-share">
                              {line.shareOfIndiaImports === null
                                ? '—'
                                : pct(line.shareOfIndiaImports)}
                            </span>
                          </td>

                          <td className="num">
                            <span className="cell-value">{usd(line.indiaExports)}</span>
                            <span className="cell-share">
                              {line.shareOfIndiaExports === null
                                ? '—'
                                : pct(line.shareOfIndiaExports)}
                            </span>
                          </td>

                          <td>
                            <button
                              className="hstack-line-remove"
                              onClick={() => onRemove(line.code)}
                              aria-label={`Remove ${line.code}`}
                            >
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>

                    <tfoot>
                      <tr>
                        <th scope="row">Combined</th>
                        <td className="num"><span className="cell-value">{usd(summary.globalTrade)}</span></td>
                        <td className="num"><span className="cell-value">{usd(summary.indiaImports)}</span></td>
                        <td className="num"><span className="cell-value">{usd(summary.indiaExports)}</span></td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </article>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
