import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, ChevronDown } from 'lucide-react'
import { usd } from '../lib/format'
import { Tabs } from './primitives'

import {
  formatPeriod,
  loadDgcisIndex,
  type DgcisFlow,
  type DgcisIndexEntry,
} from '../lib/dgcis'

/*
 * DGCIS Reporting: India's own tariff lines, on the front page.
 *
 * Collapsed by default to one line - the world view above is what the page
 * is for, and this is India's customs data, a different source. Opened, it
 * is a standard panel: the same heading, tab strip and tables as Top
 * Importers, so it reads as part of the dashboard rather than a widget.
 *
 * One table: the largest lines over the last twelve months. The whole set,
 * with every month, is a click away on the tariff-lines page.
 *
 * Renders nothing at all when there is no DGCIS data, like every other
 * surface in this layer.
 */
const SHOWN = 6

export function HomeTariffLines({
  onOpenHs8,
  onLines,
}: {
  onOpenHs8?: (hs8: string) => void
  onLines?: () => void
}) {
  const [lines, setLines] = useState<DgcisIndexEntry[] | null>(null)
  const [flow, setFlow] = useState<DgcisFlow>('exports')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    loadDgcisIndex().then(index => setLines(index?.lines ?? []))
  }, [])

  const latest = useMemo(
    () =>
      (lines ?? [])
        .flatMap(line => [line.flows.exports?.latest?.period, line.flows.imports?.latest?.period])
        .filter((p): p is string => !!p)
        .sort()
        .pop() ?? null,
    [lines],
  )

  const biggest = useMemo(
    () =>
      (lines ?? [])
        .map(line => ({ line, size: line.flows[flow]?.last12UsdMillion ?? 0 }))
        .filter(item => item.size > 0)
        .sort((a, b) => b.size - a.size)
        .slice(0, SHOWN),
    [lines, flow],
  )

  if (!lines?.length) return null

  const noun = flow === 'exports' ? 'exports' : 'imports'

  return (
    <section className="rf-panel rf-dgcis" aria-labelledby="dgcis-reporting">
      <button
        type="button"
        className="rf-dgcis-toggle"
        aria-expanded={open}
        aria-controls="dgcis-body"
        onClick={() => setOpen(value => !value)}
      >
        <h2 id="dgcis-reporting" className="rf-h2">DGCIS Reporting</h2>
        <span className="rf-dgcis-meta">
          India&rsquo;s {lines.length} tariff lines{latest ? `, to ${formatPeriod(latest)}` : ''}
        </span>
        <span className="rf-dgcis-show">
          {open ? 'Hide' : 'Show'}
          <ChevronDown size={18} aria-hidden className={open ? 'rf-dgcis-chev open' : 'rf-dgcis-chev'} />
        </span>
      </button>

      {open && (
        <div id="dgcis-body" className="rf-dgcis-body">
          <div className="rf-dgcis-bar">
            <Tabs
              label="Flow"
              active={flow}
              onChange={next => setFlow(next as DgcisFlow)}
              tabs={[
                { id: 'exports', label: 'Exports' },
                { id: 'imports', label: 'Imports' },
              ]}
            />

            {onLines && (
              <button type="button" className="linkish rf-dgcis-all" onClick={onLines}>
                All {lines.length} lines <ArrowUpRight size={14} aria-hidden />
              </button>
            )}
          </div>

          <div className="rf-dgcis-grid">
            <article className="rf-ranked">
              <div className="rf-ranked-head">
                <h3>Largest {noun}</h3>
              </div>

              <div className="rf-tablewrap">
                <table className="rf-table">
                  <thead>
                    <tr>
                      <th scope="col">HS-8</th>
                      <th scope="col">Line</th>
                      <th scope="col" className="num money">Last 12 months</th>
                    </tr>
                  </thead>
                  <tbody>
                    {biggest.map(({ line, size }) => (
                      <tr key={line.hs8}>
                        <td className="rf-dgcis-code">
                          <button type="button" className="rf-link" onClick={() => onOpenHs8?.(line.hs8)}>
                            {line.hs8}
                          </button>
                        </td>
                        <td>{line.title || line.headingName}</td>
                        {/* Dollars with their unit, as every other table: the
                          * index carries USD only, so INR mode shows USD here
                          * too, as the Global Trade tile does. */}
                        <td className="num money">{usd(size * 1e6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </div>
      )}
    </section>
  )
}
