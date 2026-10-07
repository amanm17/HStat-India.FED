import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowUpRight } from 'lucide-react'
import { DownloadMenu } from './DownloadMenu'

import type { CatalogueEntry, Manifest } from '../types'
import { palette } from '../lib/palette'
import { ordinal, pct, plural, usd } from '../lib/format'
import { Tabs, type ChartView } from './primitives'
import { FigureTile, Segmented } from './ui'
import { usePageHelp } from '../lib/pagehelp'
import { usePhone } from '../lib/viewport'
import { Rows } from './Rows'
import {
  CY_MONTHS,
  FY_MONTHS,
  monthGrid,
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
  type DgcisLine,
  type DgcisNode,
} from '../lib/dgcis'

export type Hs8DownloadRequest = {
  hs8: string
  data: DgcisNode
  line: DgcisLine
}

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
  onQuickStack,
  inBasket,
  manifest,
}: {
  hs8: string
  catalogue: CatalogueEntry[]
  dark: boolean
  onOpen?: (code: string, level: 2 | 4 | 6) => void
  onOpenHs8?: (hs8: string) => void
  onHome?: () => void
  /* Stacking, from the tariff line itself. A reader looking at one line is
   * the reader most likely to want the rest of them. */
  onQuickStack?: (entries: { code: string; level: 2 | 4 | 6 | 8 }[]) => void
  inBasket?: (code: string) => boolean
  manifest?: Manifest
}) {
  const hs6 = parentOf(hs8)

  const [data, setData] = useState<DgcisNode | null>(null)
  const [state, setState] = useState<'loading' | 'done'>('loading')
  const [basis, setBasis] = useState<DgcisBasis>('usd')
  const [flow, setFlow] = useState<DgcisFlow | null>(null)
  /* Calendar or Indian financial year: a regrouping of the same months. */
  const [period, setPeriod] = useState<'CY' | 'FY'>('CY')
  const phone = usePhone()

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

  const entry = catalogue.find(item => item.code === hs6)

  /*
   * The card in the corner, filled from this line rather than from the route.
   * Everything below is read off what is currently rendered - the flow that
   * is selected, the unit that is selected, the month the data actually ends
   * at - so the card cannot drift from the page.
   */
  const helpRank = siblings.findIndex(item => item.line.hs8 === hs8)
  const mine = helpRank >= 0 ? siblings[helpRank] : null
  const helpLatest = series ? latestOf(series, data?.periods ?? []) : null
  const helpChange = series ? rollingChange(series) : null
  const named = !!line?.title

  usePageHelp(
    () => ({
      title: `HS ${hs8}${line?.title ? ` — ${line.title}` : ''}`,

      lines: [
        `India's own customs figures for one eight-digit tariff line, month by month, in ${flowWord(flow ?? 'exports').toLowerCase()}.`,
        'Eight digits is India\u2019s own schedule, so there is no world figure at this level. The heading card links up to six digits, where there is one.',
      ],

      code: {
        value: `HS ${hs8}`,
        what: named
          ? `${line?.title} — one of ${plural(siblings.length, 'line')} India files under HS ${hs6}${entry ? `, ${entry.displayName || entry.product}` : ''}.`
          : `Not named in the 2025-26 ITC(HS) schedule, so the code stands as the identity. It sits under HS ${hs6}${entry ? `, ${entry.displayName || entry.product}` : ''}.`,
        note: named
          ? 'Name from India\u2019s own eight-digit schedule, not from Comtrade.'
          : 'Filings under this code stop before the current period; it is a line the schedule has since dropped.',
      },

      facts: [
        helpLatest
          ? {
              label: 'Latest month',
              value: `${formatValue(helpLatest.value)} ${unitLabel(basis)}`,
              note: `${formatPeriod(helpLatest.period)} · ${flowWord(flow ?? 'exports').toLowerCase()}`,
            }
          : null,
        series && last12(series) !== null
          ? {
              label: 'Last 12 months',
              value: `${formatValue(last12(series))} ${unitLabel(basis)}`,
              note:
                helpChange === null
                  ? undefined
                  : `${helpChange >= 0 ? '+' : ''}${(helpChange * 100).toFixed(1)}% on the 12 before`,
            }
          : null,
        mine && mine.share !== null
          ? {
              label: 'Share of heading',
              value: pct(mine.share, 1),
              note: `of everything India files under HS ${hs6}`,
            }
          : null,
        helpRank >= 0
          ? {
              label: 'Rank in this heading',
              value: `${ordinal(helpRank + 1)} of ${siblings.length}`,
              note: 'by the last twelve months',
            }
          : null,
      ].filter((fact): fact is NonNullable<typeof fact> => fact !== null),

      presented: [
        { name: 'Monthly series', what: 'every month DGCIS has filed for this line' },
        { name: 'Financial years', what: 'April to March, as India files; part years marked' },
        { name: 'Calendar years', what: 'the only basis on which this line and its heading line up' },
        {
          name: 'The heading above',
          what: `HS ${hs6} from Comtrade — world trade, a different source`,
        },
        {
          name: 'Other lines',
          what: `the other ${plural(Math.max(siblings.length - 1, 0), 'line')} under the same heading, ranked`,
        },
      ],

      watch:
        'partner \u201cWorld\u201d here means India trading with everywhere, not world trade. It must never be added to a Comtrade figure.',
    }),
    [hs8, hs6, line, flow, basis, siblings.length, helpRank, series, entry],
  )

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

  const twelve = last12(series)
  const share = shareOfParent(series, parent)
  const rank = siblings.findIndex(item => item.line.hs8 === hs8) + 1

  const flowTotal = (which: DgcisFlow) => {
    const own = seriesFor(data, which, hs8, basis)

    return own ? last12(own) : null
  }

  const chapter = hs6.slice(0, 2)
  const heading = hs6.slice(0, 4)

  return (
    <div className="rf-product rf-hs8 hs8-page">
      <nav className="rf-crumbs hs8-breadcrumb" aria-label="Breadcrumb">
        {onHome && (
          <button type="button" className="rf-link" onClick={onHome}>
            Home
          </button>
        )}
        {onOpen && (
          <>
            <span>
              <span aria-hidden="true">›</span>
              <button type="button" className="rf-link" onClick={() => onOpen(chapter, 2)}>
                HS-2 {chapter}
              </button>
            </span>
            <span>
              <span aria-hidden="true">›</span>
              <button type="button" className="rf-link" onClick={() => onOpen(heading, 4)}>
                HS-4 {heading}
              </button>
            </span>
            <span>
              <span aria-hidden="true">›</span>
              <button type="button" className="rf-link" onClick={() => onOpen(hs6, 6)}>
                HS-6 {hs6}
              </button>
            </span>
          </>
        )}
        <span>
          <span aria-hidden="true">›</span>
          <span aria-current="page">HS-8 {hs8}</span>
        </span>
      </nav>

      <section className="rf-identity hs8-head">
        <div className="rf-idline">
          <span className="code-chip rf-code-chip">HS-8 {hs8}</span>
          <span className="rf-cat-tag">India tariff line · DGCIS</span>
          {line.principalCommodity && <span className="rf-cat-tag">{line.principalCommodity}</span>}
        </div>

        <h1 className={line.title ? undefined : 'hs8-code-title'}>{line.title || hs8}</h1>

        <p className="rf-official hs8-sub">
          {line.title && <><strong>{hs8}</strong> · </>}
          {siblings.length > 1
            ? <>one of {siblings.length} tariff lines under</>
            : <>the only tariff line under</>}{' '}
          <strong>HS {hs6}</strong>
          {line.headingName && <> · {line.headingName}</>}
          {!data.isProduct && <> · heading carried as a lineage predecessor, with no product page</>}
        </p>

        {nameCaveat(line) && <p className="hs8-namecaveat">{nameCaveat(line)}</p>}
      </section>

      <div className="rf-furniture" role="toolbar" aria-label="Page controls">
        <div className="rf-control">
          <span>Year basis</span>
          <Segmented<'CY' | 'FY'>
            label="Year basis"
            value={period}
            onChange={setPeriod}
            options={[
              { id: 'CY', label: 'Calendar', title: 'January to December' },
              { id: 'FY', label: 'Financial', title: 'April to March, regrouped from the same months' },
            ]}
          />
        </div>

        <div className="rf-control">
          <span>Currency</span>
          <Segmented<DgcisBasis>
            label="Currency"
            value={basis}
            onChange={setBasis}
            options={[
              { id: 'usd', label: 'USD mn' },
              { id: 'inr', label: '₹ crore' },
            ]}
          />
        </div>

        <div className="rf-furniture-actions">
          {manifest && (
            <DownloadMenu
              filename={`HStat-${hs8}`}
              makeTables={() =>
                import('../lib/workbook').then(module =>
                  module.buildHs8Download({ hs8, data, line }, { manifest, currency: 'USD' }),
                )
              }
              makeReport={() =>
                import('../lib/reportdata').then(module => module.hs8Document(hs8, data, line, manifest))
              }
            />
          )}

          {onQuickStack && (
            <>
              <button
                type="button"
                className="rf-button stack-add"
                disabled={inBasket?.(hs8) ?? false}
                onClick={() => onQuickStack([{ code: hs8, level: 8 }])}
                title="Add this tariff line to HStack"
              >
                {inBasket?.(hs8) ? 'In HStack' : 'Add to HStack'}
              </button>

              {siblings.length > 1 && (
                <button
                  type="button"
                  className="rf-button quiet stack-add"
                  onClick={() => onQuickStack(siblings.map(item => ({ code: item.line.hs8, level: 8 as const })))}
                  title={`Add all ${siblings.length} tariff lines under HS ${hs6} to HStack`}
                >
                  All {siblings.length} lines here
                </button>
              )}

              <button
                type="button"
                className="rf-button quiet stack-add"
                onClick={() => onQuickStack([{ code: hs8, level: 8 }, { code: hs6, level: 6 }])}
                title={`Stack this line with HS ${hs6}, the heading it sits under`}
              >
                With HS {hs6}
              </button>
            </>
          )}
        </div>
      </div>

      <section className="rf-headline hs8-metrics" id="tile-hs8-metrics" aria-label="Last twelve months">
        <div className="rf-tiles">
          {available.includes('exports') && (
            <FigureTile
              series="exports"
              label="India Exports · last 12 months"
              value={`${formatValue(flowTotal('exports'))} ${unit}`}
              caption={`to ${formatPeriod(data.flows.exports?.latestPeriod ?? null)}`}
            />
          )}
          {available.includes('imports') && (
            <FigureTile
              series="imports"
              label="India Imports · last 12 months"
              value={`${formatValue(flowTotal('imports'))} ${unit}`}
              caption={`to ${formatPeriod(data.flows.imports?.latestPeriod ?? null)}`}
            />
          )}
          <FigureTile
            series="neutral"
            label={`Share of HS ${hs6}`}
            value={share === null ? '—' : pct(share)}
            caption={
              rank > 0
                ? `${ordinal(rank)} of ${siblings.length} lines · ${flowWord(flow).toLowerCase()}, 12 months to ${formatPeriod(data.periods[data.periods.length - 1] ?? null)}`
                : undefined
            }
          />
        </div>
      </section>

      {entry && (
        <section className="hs8-parent-card rf-parent" id="tile-hs8-heading">
          <div>
            <span className="rf-eyebrow">Heading · UN Comtrade</span>
            <h2>
              HS {hs6} — {entry.displayName || entry.product}
            </h2>
          </div>

          <div className="rf-parent-figures">
            <span>
              <b>Global Trade {entry.globalTradeYear ?? ''}</b>{' '}
              {usd(entry.globalTradeGross ?? entry.globalTrade)}
            </span>
            {onOpen && (
              <button type="button" className="rf-button quiet hs8-parent-open" onClick={() => onOpen(hs6, 6)}>
                Open the heading <ArrowUpRight size={15} aria-hidden />
              </button>
            )}
          </div>
        </section>
      )}

      {available.map(which => (
        <MonthTable
          key={which}
          flow={which}
          data={data}
          hs8={hs8}
          basis={basis}
          period={period}
          dark={dark}
          colour={which === 'exports' ? colours.exports : colours.imports}
          colours={colours}
        />
      ))}

      {siblings.length > 1 && (
        <section className="rf-section hs8-siblings" id="tile-hs8-siblings">
          <header className="rf-section-head">
            <h2 className="rf-section-title rf-static-title">Other Tariff Lines in HS {hs6}</h2>
          </header>

          <div className="rf-section-body">
            {phone ? (
              <Rows
                label={`Every tariff line under HS ${hs6}`}
                items={siblings.map(item => {
                  const here = item.line.hs8 === hs8

                  return {
                    id: item.line.hs8,
                    title: here ? <strong>this line</strong> : item.line.title || item.line.principalCommodity || '—',
                    subtitle: item.line.hs8,
                    onOpen: here || !onOpenHs8 ? undefined : () => onOpenHs8(item.line.hs8),
                    openLabel: `Open ${item.line.hs8}`,
                    fields: [
                      { label: `${unit} (12\u00a0months)`, value: formatValue(item.twelve), lead: true, numeric: true },
                      {
                        label: 'Share of heading',
                        value: item.share === null ? '—' : item.share >= 0.001 ? `${(item.share * 100).toFixed(1)}%` : '<0.1%',
                        numeric: true,
                      },
                    ],
                  }
                })}
              />
            ) : (
              <div className="rf-tablewrap">
                <table className="rf-table dgcis-table">
                  <thead>
                    <tr>
                      <th scope="col">HS-8</th>
                      <th scope="col">Name</th>
                      <th scope="col" className="num">Last 12 months ({unit})</th>
                      <th scope="col" className="num">Share of heading</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siblings.map(item => (
                      <tr key={item.line.hs8} className={item.line.hs8 === hs8 ? 'rf-emphasis current' : undefined}>
                        <td className="rf-code dgcis-code">
                          {item.line.hs8 === hs8 || !onOpenHs8 ? (
                            item.line.hs8
                          ) : (
                            <button type="button" className="rf-link linkish" onClick={() => onOpenHs8(item.line.hs8)}>
                              {item.line.hs8}
                            </button>
                          )}
                        </td>
                        <td>
                          {item.line.hs8 === hs8 ? 'This line' : item.line.title || item.line.principalCommodity || '—'}
                        </td>
                        <td className="num">{formatValue(item.twelve)}</td>
                        <td className="num">
                          {item.share === null ? '—' : item.share >= 0.001 ? `${(item.share * 100).toFixed(1)}%` : '<0.1%'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      <footer className="rf-source dgcis-foot">
        Source: DGCIS / Trade Intelligence &amp; Analytics · India-reported, partner World (India
        with everywhere, not world trade) · {unit}, as published · not estimated · never combined
        with Comtrade figures.
      </footer>
    </div>
  )
}

/*
 * One flow, month by month: a row per year, a column per month, and the
 * rolling twelve-month total. Table by default; a line chart on request.
 */
function MonthTable({
  flow,
  data,
  hs8,
  basis,
  period,
  dark,
  colour,
  colours,
}: {
  flow: DgcisFlow
  data: DgcisNode
  hs8: string
  basis: DgcisBasis
  period: 'CY' | 'FY'
  dark: boolean
  colour: string
  colours: ReturnType<typeof palette>
}) {
  const [view, setView] = useState<ChartView>('table')
  const series = seriesFor(data, flow, hs8, basis)
  const unit = unitLabel(basis)

  const rows = useMemo(() => (series ? monthGrid(series, data.periods, period) : []), [series, data.periods, period])

  const chart = useMemo(
    () =>
      series
        ? data.periods.map((item, position) => ({ label: formatPeriod(item), value: series[position] }))
        : [],
    [series, data.periods],
  )

  if (!series) return null

  const months = period === 'CY' ? CY_MONTHS : FY_MONTHS

  void dark

  return (
    <section className="rf-section hs8-chart" id={`tile-hs8-${flow}`} data-flow={flow}>
      <header className="rf-section-head">
        <h2 className="rf-section-title rf-static-title">
          India {flowWord(flow)}, Month by Month · {unit}
        </h2>

        <Tabs
          label={`${flowWord(flow)} view`}
          active={view}
          onChange={next => setView(next as ChartView)}
          tabs={[
            { id: 'table', label: 'Table' },
            { id: 'chart', label: 'Chart' },
          ]}
        />
      </header>

      <div className="rf-section-body">
        {view === 'table' ? (
          <div className="rf-tablewrap">
            <table className="rf-table rf-month-table">
              <thead>
                <tr>
                  <th scope="col">{period === 'CY' ? 'Year' : 'Financial year'}</th>
                  {months.map(month => (
                    <th key={month} scope="col" className="num">
                      {month}
                    </th>
                  ))}
                  <th scope="col" className="num rf-l12">Last 12 Months Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {row.months.map((value, index) => (
                      <td key={index} className="num">
                        {value === null ? '' : formatValue(value)}
                      </td>
                    ))}
                    <td className="num rf-l12" title={row.last12To ? `12 months to ${formatPeriod(row.last12To)}` : undefined}>
                      {formatValue(row.last12)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rf-chart">
            <span className="rf-axis-unit">{unit}</span>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 28, right: 20, bottom: 8, left: 4 }}>
                <CartesianGrid stroke={colours.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 13, fill: colours.axis }} minTickGap={28} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 13, fill: colours.axis }}
                  width={60}
                  tickFormatter={value => formatValue(value as number)}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: colours.surface, border: `1px solid ${colours.grid}`, color: colours.text, fontSize: 14 }}
                  formatter={(value: unknown) => [`${formatValue(Number(value))} ${unit}`, flowWord(flow)] as [string, string]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={colour}
                  strokeWidth={2.5}
                  connectNulls={false}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  )
}
