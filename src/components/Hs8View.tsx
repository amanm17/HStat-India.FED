import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowUpRight, ChevronLeft } from 'lucide-react'

import type { CatalogueEntry } from '../types'
import { palette } from '../lib/palette'
import { ordinal, pct, usd } from '../lib/format'
import { Metric, MiniMetric } from './primitives'
import {
  calendarYears,
  financialYears,
  flowPhrase,
  flowWord,
  flowsOf,
  formatPeriod,
  formatValue,
  last12,
  nameCaveat,
  latestOf,
  loadDgcis,
  parentOf,
  rollingChange,
  seriesFor,
  shareOfParent,
  totalSeries,
  unitLabel,
  type DgcisBasis,
  type DgcisFlow,
  type DgcisNode,
  type PeriodTotal,
} from '../lib/dgcis'

/*
 * A page for one Indian tariff line.
 *
 * WHY THE EIGHT-DIGIT LEVEL GETS ITS OWN PAGE
 *
 * Six digits is where the world agrees and eight is where India actually
 * files. HS 851762 is "network switches and routers" to Comtrade and eight
 * distinct things to Indian customs, one of which is 97% of the trade. A
 * reader who needs to know what India is really shipping cannot get there
 * from a six-digit page, and a reader who lands on a tariff line needs to be
 * shown the global heading it belongs to or they will quote an Indian number
 * as a world one.
 *
 * So this page is built to be walked in both directions: down from the
 * heading through the composition table, and up from the line through the
 * heading card at the top. Neither direction is a dead end.
 *
 * WHAT THIS PAGE CANNOT SHOW
 *
 * There is no global figure at eight digits, because there is no such thing:
 * beyond six digits every country writes its own tariff schedule, and India's
 * 85176290 has no counterpart to sum across reporters. Everything here is
 * India reporting India, with the World partner aggregate. The card that
 * links up to the heading is where global trade lives, and it is labelled
 * Comtrade so the two can never be read as one series.
 *
 * It loads the parent HS-6 file — the same one the product page loads — which
 * is how the siblings, the share of the heading and the way back up all come
 * for free.
 */
export function Hs8View({
  hs8,
  catalogue,
  dark,
  onOpen,
  onOpenHs8,
  onHome,
}: {
  hs8: string
  catalogue: CatalogueEntry[]
  dark: boolean
  onOpen?: (code: string, level: 2 | 4 | 6) => void
  onOpenHs8?: (hs8: string) => void
  onHome?: () => void
}) {
  const hs6 = parentOf(hs8)

  const [data, setData] = useState<DgcisNode | null>(null)
  const [state, setState] = useState<'loading' | 'done'>('loading')
  const [basis, setBasis] = useState<DgcisBasis>('usd')
  const [flow, setFlow] = useState<DgcisFlow | null>(null)
  const [span, setSpan] = useState<'all' | '36'>('36')

  useEffect(() => {
    let live = true

    setState('loading')
    setData(null)

    loadDgcis(hs6).then(result => {
      if (!live) return

      setData(result)
      setFlow(flowsOf(result)[0] ?? null)
      setState('done')
    })

    return () => {
      live = false
    }
  }, [hs6])

  const available = useMemo(() => flowsOf(data), [data])

  const line = useMemo(
    () => data?.lines.find(item => item.hs8 === hs8) ?? null,
    [data, hs8],
  )

  const series = useMemo(
    () => (data && flow ? seriesFor(data, flow, hs8, basis) : null),
    [data, flow, hs8, basis],
  )

  const parent = useMemo(
    () => (data && flow ? totalSeries(data, flow, basis) : []),
    [data, flow, basis],
  )

  /* Siblings, ranked, so the page can say where this line sits among them
   * rather than leaving the reader to eyeball a column. */
  const siblings = useMemo(() => {
    if (!data || !flow) return []

    return data.lines
      .map(item => {
        const own = seriesFor(data, flow, item.hs8, basis)

        return own
          ? {
              line: item,
              twelve: last12(own),
              share: shareOfParent(own, parent),
            }
          : null
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => (b.twelve ?? 0) - (a.twelve ?? 0))
  }, [data, flow, basis, parent])

  const chart = useMemo(() => {
    if (!data || !series) return []

    const points = data.periods.map((period, position) => ({
      period,
      label: formatPeriod(period),
      value: series[position],
    }))

    return span === '36' ? points.slice(-36) : points
  }, [data, series, span])

  const entry = catalogue.find(item => item.code === hs6)

  if (state === 'loading') {
    return <div className="hs8-page loading">Loading tariff line {hs8}…</div>
  }

  /*
   * Not every eight-digit code is in the extract, and a wrong guess in the
   * address bar lands here. Saying so plainly, with the heading it would
   * belong to, is more use than a blank page or a 404.
   */
  if (!data || !line || !flow || !series) {
    return (
      <div className="hs8-page missing">
        <h1>HS {hs8}</h1>

        <p>
          No DGCIS tariff-line data is held for this code. The extract covers
          the electronics and IT tariff lines DGCIS publishes; a code outside
          it, or one that has never been filed against, will not appear here.
        </p>

        <div className="hs8-missing-actions">
          {entry && onOpen && (
            <button type="button" className="linkish" onClick={() => onOpen(hs6, 6)}>
              Open HS {hs6} — {entry.displayName || entry.product}
            </button>
          )}

          {onHome && (
            <button type="button" className="linkish" onClick={onHome}>
              Back to the front page
            </button>
          )}
        </div>
      </div>
    )
  }

  const unit = unitLabel(basis)
  const colours = palette(dark)
  const colour = flow === 'exports' ? colours.exports : colours.imports

  const twelve = last12(series)
  const change = rollingChange(series)
  const share = shareOfParent(series, parent)
  const latest = latestOf(series, data.periods)
  const rank = siblings.findIndex(item => item.line.hs8 === hs8) + 1

  const fy = financialYears(series, data.periods)
  const cy = calendarYears(series, data.periods)

  const lastPeriod = data.periods[data.periods.length - 1]

  return (
    <div className="hs8-page">
      {/*
        * The way back up, first thing on the page and not buried in a
        * footer. A tariff line read without its heading is how an Indian
        * export figure gets quoted as world trade.
        */}
      <nav className="hs8-breadcrumb">
        {onHome && (
          <button type="button" onClick={onHome}>
            <ChevronLeft size={14} /> HStat.India
          </button>
        )}

        <span aria-hidden="true">/</span>

        {onOpen ? (
          <button type="button" onClick={() => onOpen(hs6, 6)}>
            HS {hs6} · {entry?.displayName || entry?.product || 'heading'}
          </button>
        ) : (
          <span>HS {hs6}</span>
        )}

        <span aria-hidden="true">/</span>

        <strong>HS {hs8}</strong>
      </nav>

      <header className="hs8-head">
        <div>
          <div className="eyebrow">INDIA TARIFF LINE · DGCIS · ITC(HS) 8-DIGIT</div>

          <h1>{line.title || `Tariff line ${hs8}`}</h1>

          <p className="hs8-sub">
            <strong>{hs8}</strong>
            {siblings.length > 1 && (
              <> · one of {siblings.length} lines under HS {hs6}</>
            )}
            {line.principalCommodity && (
              <> · DGCIS group: {line.principalCommodity}</>
            )}
            {!data.isProduct && (
              <> · heading carried as a lineage predecessor, with no product page</>
            )}
          </p>

          {/* The name is borrowed from the heading until the real schedule
            * arrives. Saying so is cheaper than letting a reader assume the
            * title distinguishes this line from its seven siblings. */}
          {nameCaveat(line) && (
            <p className="hs8-namecaveat">{nameCaveat(line)}</p>
          )}
        </div>

        <div className="dgcis-switches">
          {available.length > 1 && (
            <div className="basis-switch" role="group" aria-label="Flow">
              {available.map(option => (
                <button
                  key={option}
                  className={flow === option ? 'active' : ''}
                  aria-pressed={flow === option}
                  onClick={() => setFlow(option)}
                >
                  {flowWord(option)}
                </button>
              ))}
            </div>
          )}

          <div className="basis-switch" role="group" aria-label="Currency">
            {(['usd', 'inr'] as const).map(mode => (
              <button
                key={mode}
                className={basis === mode ? 'active' : ''}
                aria-pressed={basis === mode}
                onClick={() => setBasis(mode)}
              >
                {unitLabel(mode)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <p className="hs8-lede">
        {flowPhrase(flow)} under this tariff line, monthly, as filed by
        India&rsquo;s own customs authority. Not world trade: there is no
        eight-digit world figure, because beyond six digits every country
        writes its own schedule. Latest month available:{' '}
        {formatPeriod(data.flows[flow]?.latestPeriod ?? null)}.
      </p>

      <section className="hs8-metrics">
        <Metric
          label={`Last 12 months (${unit})`}
          value={formatValue(twelve)}
          note={`to ${formatPeriod(lastPeriod)}`}
          emphasis
        />

        <Metric
          label="Share of HS-6 heading"
          value={share === null ? '—' : pct(share)}
          note={
            rank > 0
              ? `${ordinal(rank)} of ${siblings.length} tariff lines`
              : undefined
          }
        />

        <Metric
          label="12m vs prior 12m"
          value={
            change === null
              ? '—'
              : `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`
          }
          note="rolling, not month-on-month"
        />

        <Metric
          label={`Latest month (${unit})`}
          value={formatValue(latest?.value ?? null)}
          note={latest ? formatPeriod(latest.period) : 'no month has traded'}
        />
      </section>

      {/*
        * The other direction of the link. The heading's global figure lives
        * on Comtrade and is labelled as such; this card exists so a reader on
        * a tariff line can get to it in one click and can see, without
        * leaving, that the two numbers measure different things.
        */}
      {entry && (
        <section className="hs8-parent-card">
          <div>
            <div className="eyebrow">THE HEADING THIS SITS UNDER · UN COMTRADE</div>

            <h2>
              HS {hs6} — {entry.displayName || entry.product}
            </h2>

            <p>{entry.description}</p>
          </div>

          <div className="hs8-parent-metrics">
            <MiniMetric
              label={`World trade ${entry.globalTradeYear ?? ''}`.trim()}
              value={entry.globalTrade === null ? 'not published' : usd(entry.globalTrade)}
              detail="all reporters, net of re-imports"
            />

            <MiniMetric
              label="India's share"
              value={entry.indiaShare === null ? '—' : pct(entry.indiaShare)}
              detail={
                entry.indiaRank === null
                  ? 'of world imports'
                  : `${ordinal(entry.indiaRank)} largest importer`
              }
            />

            <MiniMetric
              label="Tariff lines here"
              value={String(siblings.length)}
              detail={`under HS ${hs6}`}
            />
          </div>

          {onOpen && (
            <button
              type="button"
              className="hs8-parent-open"
              onClick={() => onOpen(hs6, 6)}
            >
              Open the heading <ArrowUpRight size={15} />
            </button>
          )}
        </section>
      )}

      <section className="hs8-chart">
        <div className="release-section-head">
          <div>
            <div className="eyebrow">MONTHLY · {unit.toUpperCase()}</div>

            <h2>{flowWord(flow)}, month by month</h2>
          </div>

          <div className="basis-switch" role="group" aria-label="Span">
            {([['36', 'Last 3 years'], ['all', 'All']] as const).map(([value, label]) => (
              <button
                key={value}
                className={span === value ? 'active' : ''}
                aria-pressed={span === value}
                onClick={() => setSpan(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={colours.grid} vertical={false} />

            <XAxis
              dataKey="label"
              stroke={colours.axis}
              tick={{ fontSize: 11 }}
              minTickGap={28}
            />

            <YAxis
              stroke={colours.axis}
              tick={{ fontSize: 11 }}
              width={58}
              tickFormatter={value => formatValue(value as number)}
            />

            <Tooltip
              contentStyle={{
                background: colours.surface,
                border: `1px solid ${colours.grid}`,
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: unknown) =>
                [`${formatValue(Number(value))} ${unit}`, flowWord(flow)] as [string, string]
              }
            />

            <Area
              type="monotone"
              dataKey="value"
              stroke={colour}
              fill={colour}
              fillOpacity={0.14}
              strokeWidth={2}
              /* A month the source left blank is a gap in the line, not a
               * dip to zero. connectNulls would draw straight through it and
               * invent a trend across data that does not exist. */
              connectNulls={false}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      <section className="hs8-years">
        <div className="hs8-years-block">
          <h3>Indian financial years</h3>

          <p className="hs8-note">
            April to March, as India files. An incomplete year is marked, and
            is not comparable with a full one.
          </p>

          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={fy} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={colours.grid} vertical={false} />

              <XAxis dataKey="label" stroke={colours.axis} tick={{ fontSize: 11 }} />

              <YAxis
                stroke={colours.axis}
                tick={{ fontSize: 11 }}
                width={58}
                tickFormatter={value => formatValue(value as number)}
              />

              <Tooltip
                contentStyle={{
                  background: colours.surface,
                  border: `1px solid ${colours.grid}`,
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: unknown, _name: unknown, item: unknown) => {
                  const point = (item as { payload?: PeriodTotal })?.payload

                  return [
                    `${formatValue(Number(value))} ${unit}${
                      point && !point.complete ? ` · ${point.months} months only` : ''
                    }`,
                    'Total',
                  ] as [string, string]
                }}
              />

              {/* A part-year bar is drawn hollow. It sits on the same axis
                * as full years and would otherwise be read as a collapse -
                * FY 2026-27 is three months, not a third of the trade. */}
              <Bar dataKey="total" isAnimationActive={false}>
                {fy.map(row => (
                  <Cell
                    key={row.label}
                    fill={row.complete ? colour : 'transparent'}
                    stroke={colour}
                    strokeWidth={row.complete ? 0 : 1.5}
                    strokeDasharray={row.complete ? undefined : '3 2'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="hs8-years-block">
          <h3>Calendar years</h3>

          <p className="hs8-note">
            January to December — the basis Comtrade publishes on, and the only
            one on which this line and the heading above are comparable.
          </p>

          <table className="dgcis-table compact">
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">Total ({unit})</th>
                <th className="num">Months filed</th>
              </tr>
            </thead>

            <tbody>
              {[...cy].reverse().map(row => (
                <tr key={row.label}>
                  <td>{row.label}</td>

                  <td className="num">{formatValue(row.total)}</td>

                  <td className="num">
                    {row.complete ? '12' : <span className="partial">{row.months}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {siblings.length > 1 && (
        <section className="hs8-siblings">
          <div className="release-section-head">
            <div>
              <div className="eyebrow">THE REST OF HS {hs6}</div>

              <h2>What else India files under this heading</h2>
            </div>
          </div>

          <table className="dgcis-table">
            <thead>
              <tr>
                <th>HS8</th>
                <th>DGCIS commodity group</th>
                <th className="num">12 months ({unit})</th>
                <th className="num">Share</th>
              </tr>
            </thead>

            <tbody>
              {siblings.map(item => (
                <tr
                  key={item.line.hs8}
                  className={item.line.hs8 === hs8 ? 'current' : undefined}
                >
                  <td className="dgcis-code">
                    {item.line.hs8 === hs8 ? (
                      <strong>{item.line.hs8}</strong>
                    ) : onOpenHs8 ? (
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => onOpenHs8(item.line.hs8)}
                      >
                        {item.line.hs8}
                      </button>
                    ) : (
                      item.line.hs8
                    )}
                  </td>

                  <td>
                    {item.line.hs8 === hs8 ? <strong>this line</strong> : item.line.title}
                    <small>{item.line.principalCommodity}</small>
                  </td>

                  <td className="num">{formatValue(item.twelve)}</td>

                  <td className="num">
                    {item.share === null
                      ? '—'
                      : item.share >= 0.001
                        ? `${(item.share * 100).toFixed(1)}%`
                        : '<0.1%'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="dgcis-foot">
        Source: DGCIS / Trade Intelligence &amp; Analytics — India reporting,
        partner World, {flow}, monthly. Values are as published: INR crore and
        USD million are both filed by the source and are never converted
        between each other here. The extract carries no tariff-line
        description, so the DGCIS commodity grouping is shown rather than a
        name invented for it. Figures on this page are India&rsquo;s own and
        are never added to, or plotted against, the Comtrade world series in
        the card above.
      </p>
    </div>
  )
}
