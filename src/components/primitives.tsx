import { useState, type ReactNode } from 'react'

import { pct, usd } from '../lib/format'
import { downloadCsv, downloadJson, downloadXlsx } from '../lib/export'

export function Metric({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string
  value: string
  note?: string
  emphasis?: boolean
}) {
  return (
    <article className={emphasis ? 'metric emphasis' : 'metric'}>
      <span>{label}</span>

      <strong>{value}</strong>

      {note && <small>{note}</small>}
    </article>
  )
}

export function MiniMetric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="mini-metric">
      <span>{label}</span>

      <strong>{value}</strong>

      {detail && <small>{detail}</small>}
    </div>
  )
}

export function StatusPill({
  status,
  label,
}: {
  status: string
  label?: string
}) {
  return (
    <span className="status-pill" data-status={status}>
      {label ?? status}
    </span>
  )
}

/*
 * A disclosure rather than a tooltip: the methodology behind the headline
 * figure is something a policy user needs to be able to read, quote and
 * disagree with, not something that vanishes on mouse-out.
 */
export function Disclosure({
  summary,
  children,
}: {
  summary: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="disclosure" data-open={open}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {summary}
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {open && <div className="disclosure-body">{children}</div>}
    </div>
  )
}

export function PanelHead({
  eyebrow,
  title,
  note,
  actions,
  onPng,
  onSvg,
  onCsv,
}: {
  eyebrow?: string
  title: string
  note?: string
  actions?: ReactNode
  onPng?: () => void
  onSvg?: () => void
  onCsv?: () => void
}) {
  return (
    <div className="panelhead">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}

        <h3>{title}</h3>

        {note && <p className="panel-note">{note}</p>}
      </div>

      <div className="panel-actions">
        {actions}

        {onPng && <button onClick={onPng}>PNG</button>}
        {onSvg && <button onClick={onSvg}>SVG</button>}
        {onCsv && <button onClick={onCsv}>CSV</button>}
      </div>
    </div>
  )
}

export function InsightPanel({
  eyebrow,
  title,
  rows,
  note,
}: {
  eyebrow: string
  title: string
  rows: string[]
  /* A standing caveat about how the panel's numbers are built. */
  note?: string
}) {
  return (
    <article className="insight-panel">
      <div className="eyebrow">{eyebrow}</div>

      <h3>{title}</h3>

      {note && <p className="insight-note">{note}</p>}

      <div className="insight-lines">
        {rows.length ? (
          rows.map((row, index) => (
            <div key={index} className="insight-line">
              {row}
            </div>
          ))
        ) : (
          <div className="empty-inline">Insufficient data for this signal.</div>
        )}
      </div>
    </article>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

function humanize(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, character => character.toUpperCase())
}

function formatCell(column: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '—'

  if (typeof value !== 'number') return String(value)

  const key = column.toLowerCase()

  if (key.includes('share')) return pct(value)

  if (key === 'rank' || key.includes('rank')) return `#${value}`

  if (key === 'level') return `HS-${value}`

  if (
    key.includes('value') ||
    key.includes('trade') ||
    key.includes('imports') ||
    key.includes('exports') ||
    key === 'balance'
  ) {
    return usd(value)
  }

  return value.toLocaleString()
}

export function DataTable({
  rows,
  name = 'table',
  hide = ['code'],
}: {
  rows: Record<string, unknown>[]
  name?: string
  hide?: string[]
}) {
  if (!rows.length) {
    return <Empty>Data unavailable for this selection.</Empty>
  }

  const columns = Object.keys(rows[0]).filter(column => !hide.includes(column))

  return (
    <>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {columns.map(column => (
                <th key={column}>{humanize(column)}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map(column => (
                  <td key={column}>{formatCell(column, row[column])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tableactions">
        <button onClick={() => downloadCsv(name, rows)}>CSV</button>

        <button onClick={() => downloadJson(name, rows)}>JSON</button>

        <button onClick={() => downloadXlsx(name, { Data: rows })}>XLSX</button>
      </div>
    </>
  )
}

/*
 * A metric that can explain itself.
 *
 * Mirror gap and re-import adjustment are the two figures on this page that
 * a reader cannot act on without knowing what produced them. Left bare they
 * read as noise, or worse as an error in the data. So the number stays where
 * it is and the reading sits one click underneath it - not a tooltip, which
 * vanishes and cannot be quoted in a note to someone else.
 */
export function ExplainMetric({
  label,
  value,
  detail,
  verdict,
  children,
}: {
  label: string
  value: string
  detail?: string
  /* One line: what this particular value means, not what the metric is. */
  verdict?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mini-metric explain" data-open={open}>
      <span>{label}</span>

      <strong>{value}</strong>

      {detail && <small>{detail}</small>}

      <button
        type="button"
        className="explain-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide' : 'What this means'}
      </button>

      {open && (
        <div className="explain-body">
          {verdict && <p className="explain-verdict">{verdict}</p>}
          {children}
        </div>
      )}
    </div>
  )
}

/*
 * Two views of one thing, in one panel.
 *
 * A chart and a table of the same rows are not two findings, and giving them
 * two panels doubles the page for no extra information. Same for a trade
 * series and the market it sits in: the reader wants one at a time.
 */
export function Tabs({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: { id: string; label: string; disabled?: boolean }[]
  active: string
  onChange: (id: string) => void
  label: string
}) {
  return (
    <div className="tabstrip" role="tablist" aria-label={label}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={active === tab.id}
          disabled={tab.disabled}
          className={active === tab.id ? 'active' : ''}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

/*
 * A pinnable region of the page.
 *
 * Two jobs, and they are the same job. It gives every panel a stable DOM id
 * so a report can capture it, and it gives the reader a way to take it off
 * the page. A tile that is not pinned is not rendered at all - hiding it with
 * CSS would leave it in the report captures and in the tab order.
 */
export function Tile({
  id,
  label,
  hidden,
  onUnpin,
  className,
  children,
}: {
  id: string
  label: string
  hidden?: boolean
  onUnpin?: (id: string) => void
  className?: string
  children: ReactNode
}) {
  if (hidden) return null

  return (
    <div
      id={`tile-${id}`}
      className={className ? `tile ${className}` : 'tile'}
      data-tile={id}
    >
      {onUnpin && (
        <button
          type="button"
          className="tile-unpin"
          title={`Remove ${label} from the page`}
          aria-label={`Remove ${label} from the page`}
          onClick={() => onUnpin(id)}
        >
          ×
        </button>
      )}

      {children}
    </div>
  )
}
