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
import { Download, Layers, Trash2, X } from 'lucide-react'

import type { HsNode } from '../types'
import type { BasketEntry } from '../lib/hstack'
import {
  bestYear,
  combinedSeries,
  familyGaps,
  summarise,
  toRows,
} from '../lib/hstack'
import { concentrationLabel, pct, usd } from '../lib/format'
import { palette } from '../lib/palette'
import { downloadCsv, downloadXlsx } from '../lib/export'
import { DataTable, Empty, MiniMetric, PanelHead } from './primitives'

/*
 * HStack reads a basket of HS codes the way a checkout reads a cart: the
 * combined total first, then what each line contributes to it.
 *
 * Two things are deliberately visible rather than hidden. Codes whose
 * figures are withheld for the chosen year are listed with the reason, so
 * a basket total is never quietly short. And the aggregated country tables
 * declare how much of basket trade they actually cover, because they are
 * built from each product's top economies rather than from every reporter.
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

  const summary = useMemo(
    () => (activeYear && nodes.length ? summarise(nodes, activeYear) : null),
    [nodes, activeYear],
  )

  const composition = useMemo(
    () =>
      (summary?.lines ?? [])
        .filter(line => line.shareOfBasket !== null)
        .slice(0, 12)
        .map(line => ({
          name: `${line.code} · ${line.label}`.slice(0, 42),
          code: line.code,
          sharePct: (line.shareOfBasket ?? 0) * 100,
          value: line.globalTrade ?? 0,
        })),
    [summary],
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
          <div>
            <div className="eyebrow">HSTACK</div>

            <h2>
              {entries.length} code{entries.length === 1 ? '' : 's'} stacked
            </h2>
          </div>

          <div className="hstack-head-actions">
            {activeYear && years.length > 0 && (
              <div className="yearpicker">
                <label htmlFor="hstack-year">Year</label>

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
              </div>
            )}

            {entries.length > 0 && (
              <>
                <button className="download-master" onClick={exportStack}>
                  <Download size={15} />
                  XLSX
                </button>

                <button className="hstack-clear" onClick={onClear}>
                  <Trash2 size={15} />
                  Clear
                </button>
              </>
            )}

            <button className="hstack-close" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </header>

        {entries.length === 0 && (
          <div className="hstack-empty">
            <Layers size={28} />

            <h3>Nothing stacked yet</h3>

            <p>
              Add HS codes from search or from any product page. HStack totals
              their global trade, shows what each one contributes, and rebuilds
              India's position and country rankings across the whole basket.
            </p>
          </div>
        )}

        {entries.length > 0 && loading && (
          <div className="hstack-loading">Loading {entries.length} codes…</div>
        )}

        {summary && !loading && (
          <>
            {summary.overlaps.length > 0 && (
              <div className="hstack-warning">
                <strong>Overlapping codes</strong>

                <span>
                  {summary.overlaps
                    .map(pair => `${pair.child} sits inside ${pair.parent}`)
                    .join('; ')}
                  . Their trade is counted twice in the totals below — remove
                  the parent or the child to fix it.
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
                  counted, net of re-imports
                </small>
              </div>

              <div className="hero-side">
                <MiniMetric
                  label="India imports"
                  value={usd(summary.indiaImports)}
                  detail="basket total"
                />

                <MiniMetric
                  label="India exports"
                  value={usd(summary.indiaExports)}
                  detail="basket total"
                />

                <MiniMetric
                  label="Trade balance"
                  value={usd(summary.indiaBalance)}
                  detail="exports − imports"
                />

                <MiniMetric
                  label="India share"
                  value={pct(summary.indiaShareOfGlobal)}
                  detail="of basket global trade"
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
                    eyebrow="ACROSS THE REVISION"
                    title="The stack over time"
                    note={
                      (spansRevision
                        ? 'Retired codes contribute the years they were reported under, the current codes contribute theirs. They do not overlap, so this is a sum rather than a spliced series. '
                        : 'Combined global trade for every code in the stack. ') +
                      'Years that failed coverage validation are left blank rather than estimated, so a break in the line is a withheld year and not a fall in trade.'
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
                </article>
              </section>
            )}

            <section className="chart-grid">
              <article className="panel chart-panel" id="hstack-composition">
                <PanelHead
                  eyebrow="COMPOSITION"
                  title="Share of the stack"
                  note="Each code's global trade as a share of the basket."
                  onCsv={() => downloadCsv('HStack-composition', composition)}
                />

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
              </article>

              <article className="panel">
                <PanelHead
                  eyebrow="COUNTRY RANKING"
                  title="Largest importing economies"
                  note={
                    summary.economyCoverage === null
                      ? undefined
                      : `Built from each product's top economies, covering ${pct(
                          summary.economyCoverage,
                          0,
                        )} of basket trade.`
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
                  eyebrow="INDIA SOURCING"
                  title="Where the stack is imported from"
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

              <article className="panel">
                <PanelHead
                  eyebrow="LINE ITEMS"
                  title="What is in the stack"
                  note="Click a code to open it."
                />

                <div className="hstack-lines">
                  {summary.lines.map(line => (
                    <div className="hstack-line" key={line.code}>
                      <button
                        className="hstack-line-open"
                        onClick={() => onOpen(line.code, line.level)}
                      >
                        <span className="result-level">HS-{line.level}</span>

                        <strong>{line.code}</strong>

                        <span className="hstack-line-label">{line.label}</span>
                      </button>

                      <div className="hstack-line-figures">
                        <span className="hstack-line-value">
                          {usd(line.globalTrade)}
                        </span>

                        <span className="hstack-line-share">
                          {line.shareOfBasket === null
                            ? line.withheldReason
                            : pct(line.shareOfBasket)}
                        </span>
                      </div>

                      <button
                        className="hstack-line-remove"
                        onClick={() => onRemove(line.code)}
                        aria-label={`Remove ${line.code}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
