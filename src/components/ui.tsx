/*
 * The building blocks of the refreshed pages (execution prompt, Phase 2).
 *
 *   Section       a titled, collapsible block with a stable anchor, so the
 *                 sticky tabs can reach it and a phone can fold it away
 *   SectionTabs   the sticky strip of those anchors
 *   FigureTile    one headline figure: label, value, one caption line
 *   RankedTable   every ranking on the site, one control: table by default,
 *                 bar chart on request, top 5 -> "+" -> top 10 -> view all
 *
 * Colour is passed in, never chosen here: a ranking of world importers is
 * drawn in the Global Trade colour, India's import partners in the India
 * Imports colour, and so on, so a hue means the same thing on every page.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Plus, Minus } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Estimated, Mark, Tabs, estimateTip, type ChartView } from './primitives'
import { ordinal, pct } from '../lib/format'
import type { RankRow } from '../lib/scope'
import { palette } from '../lib/palette'

/* ------------------------------------------------------------- Section */

export function Section({
  id,
  title,
  eyebrow,
  actions,
  collapsedByDefault = false,
  forceOpen,
  children,
  className,
}: {
  id: string
  title: string
  eyebrow?: string
  actions?: ReactNode
  collapsedByDefault?: boolean
  /* Set by the tabs: a section scrolled to is opened. */
  forceOpen?: number
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(!collapsedByDefault)

  useEffect(() => {
    setOpen(!collapsedByDefault)
  }, [collapsedByDefault])

  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  return (
    <section
      id={`section-${id}`}
      data-section={id}
      data-open={open}
      className={className ? `rf-section ${className}` : 'rf-section'}
    >
      <header className="rf-section-head">
        <button
          type="button"
          className="rf-section-toggle"
          aria-expanded={open}
          aria-controls={`section-body-${id}`}
          onClick={() => setOpen(value => !value)}
        >
          {open ? <ChevronDown size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
          <span className="rf-section-titles">
            {eyebrow && <span className="rf-eyebrow">{eyebrow}</span>}
            <span className="rf-section-title">{title}</span>
          </span>
        </button>

        {open && actions && <div className="rf-section-actions">{actions}</div>}
      </header>

      {open && (
        <div className="rf-section-body" id={`section-body-${id}`}>
          {children}
        </div>
      )}
    </section>
  )
}

/* --------------------------------------------------------- SectionTabs */

export function SectionTabs({
  sections,
  onJump,
}: {
  sections: { id: string; label: string }[]
  onJump: (id: string) => void
}) {
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return

    const targets = sections
      .map(section => document.getElementById(`section-${section.id}`))
      .filter((element): element is HTMLElement => element !== null)

    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

        if (visible[0]) {
          setActive((visible[0].target as HTMLElement).dataset.section ?? null)
        }
      },
      { rootMargin: '-140px 0px -55% 0px' },
    )

    targets.forEach(target => observer.observe(target))

    return () => observer.disconnect()
  }, [sections])

  if (sections.length < 2) return null

  return (
    <nav className="rf-tabs" aria-label="Sections on this page">
      <div className="rf-tabs-inner">
        {sections.map(section => (
          <button
            key={section.id}
            type="button"
            className={active === section.id ? 'active' : ''}
            aria-current={active === section.id ? 'true' : undefined}
            onClick={() => {
              setActive(section.id)
              onJump(section.id)
            }}
          >
            {section.label}
          </button>
        ))}
      </div>
    </nav>
  )
}

/* scroll a section into view below the sticky header and tabs */
export function jumpTo(id: string) {
  const element = document.getElementById(`section-${id}`)

  if (!element) return

  const top = element.getBoundingClientRect().top + window.scrollY - 136

  window.scrollTo({ top, behavior: 'smooth' })
}

/* ---------------------------------------------------------- FigureTile */

export function FigureTile({
  label,
  value,
  estimatedShare,
  estimatedReporters,
  caption,
  series,
  note,
  unit,
}: {
  label: string
  value: string
  /* A unit set small after the figure ("USD mn"), so the number stays the
   * thing read first and the tile does not wrap it. */
  unit?: string
  estimatedShare?: number | null
  estimatedReporters?: number | null
  caption?: ReactNode
  series: 'global' | 'exports' | 'imports' | 'neutral'
  note?: ReactNode
}) {
  return (
    <article className="rf-figure" data-series={series}>
      <span className="rf-figure-label">
        <i className="rf-swatch" aria-hidden="true" />
        {label}
      </span>

      <strong className="rf-figure-value">
        {value}
        {unit && <small className="rf-figure-unit"> {unit}</small>}
        <Estimated share={estimatedShare} reporters={estimatedReporters ?? undefined} />
      </strong>

      {caption && <span className="rf-figure-caption">{caption}</span>}
      {note && <span className="rf-figure-note">{note}</span>}
    </article>
  )
}

/* ------------------------------------------------------- RankedTable */

export type RankColumn = {
  key: string
  label: string
  numeric?: boolean
  render: (row: RankRow) => ReactNode
}

export function RankedTable({
  id,
  title,
  rows,
  count,
  complete,
  nameLabel = 'Country',
  valueLabel,
  shareLabel,
  formatValue,
  colour,
  extraColumns = [],
  highlight,
  pinnedRow,
  onViewAll,
  onRowOpen,
  emptyText = 'No ranking for this year.',
  footnote,
  dark = false,
}: {
  id: string
  title: string
  rows: RankRow[]
  count: number
  complete: boolean
  nameLabel?: string
  valueLabel: string
  /* Names the denominator: "Share of India's imports". */
  shareLabel: string
  formatValue: (value: number) => string
  colour: string
  extraColumns?: RankColumn[]
  /* A row to emphasise, by code - India, in a world ranking. */
  highlight?: string
  /* Shown beneath the table when the highlighted row is not among those
   * displayed: India at 56th still gets a line. */
  pinnedRow?: RankRow | null
  onViewAll?: () => void
  onRowOpen?: (row: RankRow) => void
  emptyText?: string
  footnote?: ReactNode
  dark?: boolean
}) {
  const colours = palette(dark)
  const [view, setView] = useState<ChartView>('table')
  const [limit, setLimit] = useState(5)

  const shown = useMemo(() => rows.slice(0, limit), [rows, limit])

  const highlightShown = highlight ? shown.some(row => row.code === highlight) : true

  const more = rows.length > limit
  const fullCount = Math.max(count, rows.length)
  const canViewAll = Boolean(onViewAll) && (fullCount > 10 || !complete)

  const chartRows = shown.map(row => ({
    name: row.name.length > 22 ? `${row.name.slice(0, 21)}…` : row.name,
    full: row.name,
    value: row.value,
  }))

  return (
    <article className="rf-ranked" id={`rank-${id}`} data-ranked={id}>
      <div className="rf-ranked-head">
        <h3>{title}</h3>

        <Tabs
          label={`${title} view`}
          active={view}
          onChange={next => setView(next as ChartView)}
          tabs={[
            { id: 'table', label: 'Table' },
            { id: 'chart', label: 'Chart' },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <p className="rf-empty">{emptyText}</p>
      ) : view === 'table' ? (
        <div className="rf-tablewrap">
          <table className="rf-table">
            <thead>
              <tr>
                <th scope="col" className="rf-rank">Rank</th>
                <th scope="col">{nameLabel}</th>
                <th scope="col" className="num">{valueLabel}</th>
                <th scope="col" className="num rf-share-col">{shareLabel}</th>
                {extraColumns.map(column => (
                  <th key={column.key} scope="col" className={column.numeric ? 'num' : undefined}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {shown.map(row => (
                <RankLine
                  nameLabel={nameLabel}
                  key={row.code}
                  row={row}
                  formatValue={formatValue}
                  extraColumns={extraColumns}
                  emphasis={highlight === row.code}
                  onOpen={onRowOpen}
                />
              ))}

              {!highlightShown && pinnedRow && (
                <RankLine
                  nameLabel={nameLabel}
                  row={pinnedRow}
                  formatValue={formatValue}
                  extraColumns={extraColumns}
                  emphasis
                  pinned
                  onOpen={onRowOpen}
                />
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rf-barchart" style={{ height: 44 + chartRows.length * 34 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartRows}
              layout="vertical"
              margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={colours.grid} />
              <XAxis
                type="number"
                tickFormatter={value => formatValue(Number(value))}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 13, fill: colours.axis }}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 14, fill: colours.text }}
              />
              <Tooltip
                formatter={(value: unknown) => formatValue(Number(value))}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.full ?? ''}
                contentStyle={{
                  background: colours.surface,
                  border: `1px solid ${colours.grid}`,
                  color: colours.text,
                  borderRadius: 4,
                  fontSize: 14,
                }}
                cursor={{ fillOpacity: 0.06 }}
              />
              <Bar
                dataKey="value"
                name={valueLabel}
                fill={colour}
                stroke={colours.text}
                strokeOpacity={0.3}
                maxBarSize={22}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {rows.length > 0 && (
        <div className="rf-ranked-foot">
          {rows.length > 5 && (
            <button
              type="button"
              className="rf-more"
              aria-label={limit === 5 ? 'Show the top 10' : 'Show the top 5'}
              onClick={() => setLimit(current => (current === 5 ? 10 : 5))}
            >
              {limit === 5 ? <Plus size={16} aria-hidden /> : <Minus size={16} aria-hidden />}
              {limit === 5 ? 'Top 10' : 'Top 5'}
            </button>
          )}

          {canViewAll && (limit === 10 || !more) && (
            <button type="button" className="rf-viewall" onClick={onViewAll}>
              View all{fullCount > rows.length || complete ? ` ${fullCount}` : ''}
            </button>
          )}

          {footnote && <span className="rf-foot-note">{footnote}</span>}
        </div>
      )}
    </article>
  )
}

function RankLine({
  row,
  formatValue,
  extraColumns,
  emphasis,
  pinned,
  onOpen,
  nameLabel = 'Country',
}: {
  row: RankRow
  formatValue: (value: number) => string
  extraColumns: RankColumn[]
  emphasis?: boolean
  pinned?: boolean
  onOpen?: (row: RankRow) => void
  nameLabel?: string
}) {
  return (
    <tr className={[emphasis ? 'rf-emphasis' : '', pinned ? 'rf-pinned' : ''].join(' ').trim() || undefined}>
      <td className="rf-rank">{pinned ? ordinal(row.rank) : row.rank}</td>
      <td className="rf-name">
        {onOpen ? (
          <button type="button" className="rf-link" onClick={() => onOpen(row)}>
            {row.name}
          </button>
        ) : (
          row.name
        )}
      </td>
      <td className="num">
        {formatValue(row.value)}
        {row.estimated && <Mark tip={estimateTip(row.estimatedShare, row.name, nameLabel === 'Product' ? 'line' : 'country')} />}
      </td>
      <td className="num rf-share-col">{row.share === null ? '—' : pct(row.share, 1)}</td>
      {extraColumns.map(column => (
        <td key={column.key} className={column.numeric ? 'num' : undefined}>
          {column.render(row)}
        </td>
      ))}
    </tr>
  )
}

/* ------------------------------------------------------------ Toggle */

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string; title?: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="rf-segmented" role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option.id}
          type="button"
          className={value === option.id ? 'active' : ''}
          aria-pressed={value === option.id}
          title={option.title}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* The legend for the markers, wherever a marker appears. */
export function Markers({ estimated, carried }: { estimated?: boolean; carried?: boolean }) {
  if (!estimated && !carried) return null

  return (
    <p className="rf-markers marker-legend">
      {estimated && (
        <span>
          <b className="estimated-mark">*</b> contains estimated values; hover or tap the mark
          for the estimated share
        </span>
      )}
      {carried && (
        <span>
          <b className="carried-mark">**</b> carried from a retired predecessor code
        </span>
      )}
    </p>
  )
}
