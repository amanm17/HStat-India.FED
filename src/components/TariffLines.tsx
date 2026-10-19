import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'

import { plural } from '../lib/format'
import { usePhone } from '../lib/viewport'
import { Rows } from './Rows'
import { Tabs } from './primitives'
import { PageHeader } from './ui'
import { usePageHelp } from '../lib/pagehelp'

import { STREAM_LABEL, STREAM_NOTE, streamOf, type Stream } from '../lib/streams'
import {
  formatPeriod,
  formatValue,
  money,
  loadDgcisIndex,
  relationOf,
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
  /* Electronics first: the tariff lines of other streams are here too, and
   * never added into an electronics figure. */
  const [stream, setStream] = useState<Stream | 'all'>('electronics')
  const phone = usePhone()

  useEffect(() => {
    loadDgcisIndex().then(index => setLines(index?.lines ?? []))
  }, [])

  const groups = useMemo(() => {
    if (!lines) return []

    const text = query.trim().toLowerCase()
    const digits = text.replace(/\D/g, '')

    const matched = lines.filter(line => {
      if (stream !== 'all' && streamOf(line) !== stream) return false
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
        relation: relationOf(items[0]),
        total: items.reduce((sum, line) => sum + size(line), 0),
        items: [...items].sort((a, b) => size(b) - size(a)),
      }))
      .sort((a, b) => b.total - a.total)
  }, [lines, flow, query, stream])

  usePageHelp(
    () => {
      const named = lines?.filter(line => line.title).length ?? 0
      const top = groups[0]?.items[0] ?? null

      return {
        facts: [
          {
            label: 'Lines held',
            value: String(lines?.length ?? 0),
            note: `under ${plural(new Set(lines?.map(line => line.hs6)).size, 'six-digit heading')}`,
          },
          {
            label: 'Named from the schedule',
            value: `${named} of ${lines?.length ?? 0}`,
            note: 'the rest are titled by code, which is what customs files them as',
          },
          top
            ? {
                label: `Largest ${flow.slice(0, -1)} line`,
                value: `HS ${top.hs8}`,
                note: top.title || 'no name in the schedule; see its heading',
              }
            : null,
          {
            label: 'Showing',
            value: plural(groups.reduce((n, g) => n + g.items.length, 0), 'line'),
            note: query.trim() ? `matching \u201c${query.trim()}\u201d` : 'all of them, largest heading first',
          },
        ].filter((fact): fact is NonNullable<typeof fact> => fact !== null),

        presented: [
          { name: 'Flow switch', what: 'exports or imports; every figure below follows it' },
          { name: 'Filter', what: 'by code, by heading name, or by line name' },
          { name: 'Groups', what: 'one block per six-digit heading, largest first' },
        ],
      }
    },
    [lines, flow, query, groups],
  )

  if (!lines) return <div className="lines-page loading">Loading tariff lines…</div>

  /* Lines with no trade in the last twelve months are hidden unless the
   * reader is filtering for them: a row of zeros answers nothing. */
  const live = (line: DgcisIndexEntry) => (line.flows[flow]?.last12UsdMillion ?? 0) > 0
  const filtering = query.trim().length > 0
  const visible = groups
    .map(group => ({ ...group, items: filtering ? group.items : group.items.filter(live) }))
    .filter(group => group.items.length > 0)
  const hidden = filtering ? 0 : groups.reduce((n, g) => n + g.items.filter(line => !live(line)).length, 0)
  const limit = phone ? 20 : 60

  /* A DGCIS commodity group, which customs files in capitals, read as a
   * label: "TELECOM INSTRUMENTS" -> "Telecom instruments". */
  const groupLabel = (text: string | null | undefined) =>
    text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '—'

  return (
    <div className="lines-page">
      <PageHeader
        title="Indian trade lines"
        sub={`${lines.length} eight-digit lines from DGCIS, largest first.`}
        aside={
          <Tabs
            label="Flow"
            active={flow}
            onChange={next => setFlow(next as 'exports' | 'imports')}
            tabs={[
              { id: 'exports', label: 'Exports' },
              { id: 'imports', label: 'Imports' },
            ]}
          />
        }
      />

      <div className="lines-streams" role="group" aria-label="Which lines">
        {(['electronics', 'electronics-inputs', 'other', 'all'] as const)
          .filter(key => key === 'all' || key === 'electronics' || lines.some(line => streamOf(line) === key))
          .map(key => {
            const count = key === 'all' ? lines.length : lines.filter(line => streamOf(line) === key).length

            return (
              <button
                key={key}
                type="button"
                className={stream === key ? 'rf-button active' : 'rf-button quiet'}
                aria-pressed={stream === key}
                onClick={() => setStream(key)}
              >
                {key === 'all' ? 'All' : STREAM_LABEL[key]} ({count})
              </button>
            )
          })}
      </div>
      {stream !== 'electronics' && (
        <p className="rf-beyond-note">
          {stream === 'all'
            ? 'Every line HStat holds. Only electronics lines count toward electronics figures.'
            : STREAM_NOTE[stream]}
        </p>
      )}

      <input
        className="lines-filter"
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder={phone ? 'Filter lines' : 'Filter by code or name, e.g. 8517 or smartphone'}
        aria-label="Filter tariff lines"
      />

      {visible.length === 0 && (
        <p className="rf-empty">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
      )}

      <div className="lines-groups">
        {visible.slice(0, limit).map((group, index) => (
          <section className="lines-group" key={group.hs6}>
            <div className="lines-group-head">
              <div className="lines-group-name">
                {/* Printed once, on the group. A heading name on every row
                  * would read as lines sharing a name instead of a parent. */}
                <strong>HS {group.hs6}</strong>
                <span>{group.heading || 'Heading'}</span>
                {group.relation === 'predecessor' && <em>retired code</em>}
                {group.relation === 'standalone' && <em>not in HStat</em>}
              </div>

              <div className="lines-group-right">
                <span className="lines-total">{money(group.total, 'usd')}</span>

                {group.relation === 'product' && onOpen && (
                  <button type="button" className="linkish lines-open" onClick={() => onOpen(group.hs6, 6)}>
                    Product page <ArrowUpRight size={14} aria-hidden />
                  </button>
                )}
              </div>
            </div>

            {phone ? (
              <Rows
                label={`Tariff lines under HS ${group.hs6}`}
                items={group.items.map(line => {
                  const block = line.flows[flow]

                  return {
                    id: line.hs8,
                    title: line.title || <span className="lines-unnamed">{groupLabel(line.principalCommodity)}</span>,
                    subtitle: line.hs8,
                    onOpen: () => onOpenHs8(line.hs8),
                    openLabel: `Open ${line.hs8}`,
                    fields: [
                      {
                        label: 'Last 12 months',
                        value: money(block?.last12UsdMillion ?? null, 'usd'),
                        lead: true,
                        numeric: true,
                      },
                      {
                        label: 'Latest month',
                        value: block?.latest
                          ? `${money(block.latest.usdMillion, 'usd')}, ${formatPeriod(block.latest.period)}`
                          : '—',
                        numeric: true,
                      },
                    ],
                  }
                })}
              />
            ) : (
              <table className="rf-table lines-table">
                <colgroup>
                  <col className="lines-col-code" />
                  <col />
                  <col className="lines-col-value" />
                  <col className="lines-col-month" />
                </colgroup>
                {/* Column names once, on the first group; the rest share its
                  * columns exactly, and keep the names for screen readers. */}
                <thead className={index === 0 ? undefined : 'sr-only-head'}>
                  <tr>
                    <th scope="col">HS-8</th>
                    <th scope="col">Line</th>
                    <th scope="col" className="num money">Last 12 months</th>
                    <th scope="col" className="num">Latest month</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map(line => {
                    const block = line.flows[flow]

                    return (
                      <tr key={line.hs8}>
                        <td>
                          <button type="button" className="rf-link" onClick={() => onOpenHs8(line.hs8)}>
                            {line.hs8}
                          </button>
                        </td>
                        <td>
                          {line.title || <span className="lines-unnamed">{groupLabel(line.principalCommodity)}</span>}
                        </td>
                        <td className="num money">{money(block?.last12UsdMillion ?? null, 'usd')}</td>
                        <td className="num">{block?.latest ? formatPeriod(block.latest.period) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </section>
        ))}
      </div>

      {(visible.length > limit || hidden > 0) && (
        <p className="lines-more">
          {/* 543 lines as cards is 17,000px of scrolling; the filter is how
            * you reach the rest, and it is directly above. */}
          {visible.length > limit && `Showing the ${limit} largest headings; filter to find the rest. `}
          {hidden > 0 && `${plural(hidden, 'line')} with no trade in the last 12 months ${hidden === 1 ? 'is' : 'are'} hidden.`}
        </p>
      )}
    </div>
  )
}
