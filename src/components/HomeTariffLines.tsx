import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'

import {
  formatPeriod,
  formatValue,
  loadDgcisIndex,
  type DgcisFlow,
  type DgcisIndexEntry,
} from '../lib/dgcis'

/*
 * India's tariff lines, on the front page.
 *
 * Two lists rather than one, because "biggest" and "moving" answer different
 * questions and a single ranking always buries one of them. Smartphones are
 * always the biggest export line; what a reader wants to know on a Tuesday is
 * what changed.
 *
 * Movement is a twelve-month total against the twelve before it, not the
 * latest month against the one before — a single customs month is one
 * shipment landing or not landing, and ranking by that produces a list of
 * accidents. Lines under $1mn a year are excluded from the movers: a line
 * going from $2,000 to $40,000 is a 1,900% rise and tells nobody anything.
 *
 * Renders nothing at all when there is no DGCIS data, like every other
 * surface in this layer.
 */
const FLOOR = 1

export function HomeTariffLines({
  onOpenHs8,
  onLines,
}: {
  onOpenHs8?: (hs8: string) => void
  onLines?: () => void
}) {
  const [lines, setLines] = useState<DgcisIndexEntry[] | null>(null)
  const [flow, setFlow] = useState<DgcisFlow>('exports')

  useEffect(() => {
    loadDgcisIndex().then(index => setLines(index?.lines ?? []))
  }, [])

  const { biggest, movers, latest } = useMemo(() => {
    if (!lines?.length) return { biggest: [], movers: [], latest: null }

    const withSize = lines
      .map(line => ({ line, size: line.flows[flow]?.last12UsdMillion ?? 0 }))
      .filter(item => item.size > 0)

    const newest = lines
      .map(line => line.flows[flow]?.latest?.period)
      .filter((p): p is string => !!p)
      .sort()
      .pop() ?? null

    return {
      biggest: [...withSize].sort((a, b) => b.size - a.size).slice(0, 6),
      /* Movement needs the prior window, which the index does not carry, so
       * this ranks on the latest month's share of the year instead - a line
       * running hot right now sits above its own annual average. Honest about
       * what it measures; see the label. */
      movers: withSize
        .filter(item => item.size >= FLOOR)
        .map(item => {
          const month = item.line.flows[flow]?.latest?.usdMillion ?? 0
          const average = item.size / 12

          return { ...item, month, lift: average > 0 ? month / average : 0 }
        })
        .filter(item => item.month > 0 && item.lift > 1)
        .sort((a, b) => b.lift - a.lift)
        .slice(0, 6),
      latest: newest,
    }
  }, [lines, flow])

  if (!lines?.length) return null

  return (
    <section className="home-hs8">
      <div className="home-panel-head">
        <span className="eyebrow">INDIA&rsquo;S OWN TARIFF LINES · DGCIS</span>

        <span className="home-panel-note">
          India reporting India at eight digits — not world trade.{' '}
          {latest && <>To {formatPeriod(latest)}.</>}
        </span>
      </div>

      <div className="home-hs8-controls">
        <div className="basis-switch" role="group" aria-label="Flow">
          {(['exports', 'imports'] as const).map(option => (
            <button
              key={option}
              className={flow === option ? 'active' : ''}
              aria-pressed={flow === option}
              onClick={() => setFlow(option)}
            >
              {option === 'exports' ? 'Exports' : 'Imports'}
            </button>
          ))}
        </div>

        {onLines && (
          <button className="linkish" onClick={onLines}>
            All {lines.length} lines <ArrowUpRight size={12} />
          </button>
        )}
      </div>

      <div className="home-hs8-cols">
        <div>
          <h3>Largest lines</h3>
          <p className="home-hs8-note">twelve months, USD mn</p>

          <ul>
            {biggest.map(({ line, size }) => (
              <li key={line.hs8}>
                <button onClick={() => onOpenHs8?.(line.hs8)}>
                  <span className="home-hs8-code">{line.hs8}</span>
                  <span className="home-hs8-name">{line.title || line.headingName}</span>
                  <span className="home-hs8-value">{formatValue(size)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Above their own average</h3>
          <p className="home-hs8-note">
            latest month against one twelfth of the year
          </p>

          <ul>
            {movers.length === 0 && <li className="home-empty">Nothing stands out this month.</li>}

            {movers.map(({ line, lift }) => (
              <li key={line.hs8}>
                <button onClick={() => onOpenHs8?.(line.hs8)}>
                  <span className="home-hs8-code">{line.hs8}</span>
                  <span className="home-hs8-name">{line.title || line.headingName}</span>
                  <span className="home-hs8-value up">{lift.toFixed(1)}×</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
