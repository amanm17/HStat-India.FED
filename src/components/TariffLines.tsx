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
 * All 543 tariff lines, in one place you can scan.
 *
 * Until now an eight-digit line could only be reached by already knowing its
 * code, or by finding its heading first. That is fine if you know what you are
 * looking for and useless if you are trying to see what is there - which is
 * most of what a reader does on a dashboard they did not build.
 *
 * Sorted by size rather than by code, because "what is big" is the question
 * people actually arrive with, and grouped under the heading each line belongs
 * to so the relationship stays visible. The heading name is printed once, on
 * the group - never on the rows, where it would read as 29 lines sharing a
 * name rather than 29 lines sharing a parent.
 */
export function TariffLines({
  onOpenHs8,
  onOpen,
}: {
  onOpenHs8: (hs8: string) => void
  onOpen?: (code: string, level: 2 | 4 | 6) => void
}) {
  const [lines, setLines] = useState<DgcisIndexEntry[] | null>(null)
  const [flow, setFlow] = useState<DgcisFlow>('exports')
  const [query, setQuery] = useState('')

  useEffect(() => {
    loadDgcisIndex().then(index => setLines(index?.lines ?? []))
  }, [])

  const groups = useMemo(() => {
    if (!lines) return []

    const text = query.trim().toLowerCase()
    const digits = text.replace(/\D/g, '')

    const matched = lines.filter(line => {
      if (!text) return true
      if (digits.length >= 2) return line.hs8.startsWith(digits) || line.hs6.startsWith(digits)

      return (
        line.headingName.toLowerCase().includes(text) ||
        line.principalCommodity.toLowerCase().includes(text) ||
        (line.title ?? '').toLowerCase().includes(text)
      )
    })

    const size = (line: DgcisIndexEntry) => line.flows[flow]?.last12UsdMillion ?? 0

    const byHeading = new Map<string, DgcisIndexEntry[]>()

    for (const line of matched) {
      const bucket = byHeading.get(line.hs6)

      if (bucket) bucket.push(line)
      else byHeading.set(line.hs6, [line])
    }

    return [...byHeading.entries()]
      .map(([hs6, items]) => ({
        hs6,
        heading: items[0].headingName,
        isProduct: items[0].isProduct,
        total: items.reduce((sum, line) => sum + size(line), 0),
        items: [...items].sort((a, b) => size(b) - size(a)),
      }))
      .sort((a, b) => b.total - a.total)
  }, [lines, flow, query])

  if (!lines) return <div className="lines-page loading">Loading tariff lines…</div>

  const shown = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <div className="lines-page">
      <header className="lines-head">
        <div>
          <div className="eyebrow">INDIA TARIFF LINES · DGCIS · ITC(HS) 8-DIGIT</div>

          <h1>Every line India files, under the headings we track</h1>

          <p className="lines-lede">
            India reporting its own trade with the world at eight digits — not
            world trade, and not comparable with the Comtrade figures on a
            product page. {shown} of {lines.length} lines shown, largest first.
          </p>
        </div>

        <div className="dgcis-switches">
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
        </div>
      </header>

      <input
        className="lines-filter"
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="Filter by code or heading — 8517, smartphone, telecom…"
        aria-label="Filter tariff lines"
      />

      {groups.length === 0 && (
        <p className="home-empty">Nothing matched “{query.trim()}”.</p>
      )}

      <div className="lines-groups">
        {groups.slice(0, 60).map(group => (
          <section className="lines-group" key={group.hs6}>
            <div className="lines-group-head">
              <div>
                {/* Printed once, on the group. A heading name on every row
                  * would read as lines sharing a name instead of a parent. */}
                <strong>HS {group.hs6}</strong>
                <span>{group.heading || 'heading'}</span>
                {!group.isProduct && <em>lineage predecessor</em>}
              </div>

              <div className="lines-group-right">
                <span className="lines-total">
                  {formatValue(group.total)} <small>USD mn, 12m</small>
                </span>

                {group.isProduct && onOpen && (
                  <button
                    className="linkish"
                    onClick={() => onOpen(group.hs6, 6)}
                    title="Open the heading and its world figures"
                  >
                    heading <ArrowUpRight size={12} />
                  </button>
                )}
              </div>
            </div>

            <table className="dgcis-table compact">
              <tbody>
                {group.items.map(line => {
                  const block = line.flows[flow]

                  return (
                    <tr key={line.hs8}>
                      <td className="dgcis-code">
                        <button className="linkish" onClick={() => onOpenHs8(line.hs8)}>
                          {line.hs8}
                        </button>
                      </td>

                      <td>
                        {line.title || <span className="lines-unnamed">{line.principalCommodity}</span>}
                      </td>

                      <td className="num">{formatValue(block?.last12UsdMillion ?? null)}</td>

                      <td className="num dgcis-month">
                        {block?.latest ? formatPeriod(block.latest.period) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      {groups.length > 60 && (
        <p className="lines-more">
          Showing the 60 largest headings. Filter above to reach the rest.
        </p>
      )}
    </div>
  )
}
