import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'

import { Sheet } from './Sheet'
import { useNoRail } from '../lib/viewport'
import { REPORT_SECTIONS } from '../lib/reportdata'
import {
  TILES,
  type CodeRef,
  type Level,
  type SavedReport,
  type Workspace,
} from '../lib/workspace'

/*
 * The reader's rail: pins, history, which sections the page shows and in
 * what order, the report builder, and saved reports. Personal and local to
 * this browser.
 *
 * Simplified in the Phase 2 refresh: Glance View is no longer a way to read
 * the page (it is a download layout now), and drag-to-reorder - which never
 * worked on a touchscreen and was easy to trigger by accident with a mouse -
 * is replaced by plain up and down buttons that always do what they say.
 */

export type ReportRequest = {
  name: string
  codes: { code: string; level: 2 | 4 | 6 }[]
  years: number[]
  sections: string[]
  layout: 'report' | 'glance'
  format: 'pdf' | 'png'
}

function when(iso: string): string {
  const date = new Date(iso)

  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function ReportBuilder({
  current,
  candidates,
  years,
  year,
  busy,
  onGenerate,
}: {
  current: CodeRef
  /* Codes the reader can add: their pins and their HStack. */
  candidates: CodeRef[]
  years: number[]
  year: number
  busy: boolean
  onGenerate: (request: ReportRequest) => void
}) {
  const [name, setName] = useState('')
  const [codes, setCodes] = useState<string[]>([current.code])
  const [chosenYears, setChosenYears] = useState<number[]>([year])
  const [sections, setSections] = useState<string[]>(['headline', 'trend', 'world', 'partners'])
  const [layout, setLayout] = useState<'report' | 'glance'>('report')
  const [allYears, setAllYears] = useState(false)

  useEffect(() => setCodes(value => (value.includes(current.code) ? value : [current.code, ...value])), [current.code])
  useEffect(() => setChosenYears(value => (value.includes(year) ? value : [year])), [year])

  const pool = useMemo(() => {
    const seen = new Set<string>()

    return [current, ...candidates].filter(entry => {
      if (entry.level === 8 || seen.has(entry.code)) return false

      seen.add(entry.code)
      return true
    })
  }, [current, candidates])

  const shownYears = allYears ? years : years.slice(0, 10)

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter(item => item !== value) : [...list, value])

  const ready = codes.length > 0 && chosenYears.length > 0 && sections.length > 0

  const request = (format: 'pdf' | 'png'): ReportRequest => ({
    name,
    codes: pool
      .filter(entry => codes.includes(entry.code))
      .map(entry => ({ code: entry.code, level: entry.level as 2 | 4 | 6 })),
    years: [...chosenYears].sort((a, b) => b - a),
    sections: REPORT_SECTIONS.map(item => item.id).filter(id => sections.includes(id)),
    layout,
    format,
  })

  return (
    <div className="rail-report">
      <label className="rail-field">
        <span>Report name</span>
        <input value={name} onChange={event => setName(event.target.value)} placeholder="Smartphones — 2023 to 2025" />
      </label>

      <fieldset className="rail-fieldset">
        <legend>Codes</legend>
        {pool.map(entry => (
          <label key={entry.code} className="rail-check">
            <input type="checkbox" checked={codes.includes(entry.code)} onChange={() => setCodes(value => toggle(value, entry.code))} />
            <span>
              HS-{entry.level} {entry.code}
              <em>{entry.label}</em>
            </span>
          </label>
        ))}
        {pool.length === 1 && <p className="rail-hint">Pin codes or add them to HStack to report on several at once.</p>}
      </fieldset>

      <fieldset className="rail-fieldset">
        <legend>Years</legend>
        <div className="rail-years">
          {shownYears.map(item => (
            <button
              key={item}
              type="button"
              className={chosenYears.includes(item) ? 'active' : ''}
              aria-pressed={chosenYears.includes(item)}
              onClick={() => setChosenYears(value => toggle(value, item))}
            >
              {item}
            </button>
          ))}
        </div>
        {years.length > 10 && (
          <button type="button" className="rail-more" onClick={() => setAllYears(value => !value)}>
            {allYears ? 'Fewer years' : `All ${years.length} years`}
          </button>
        )}
      </fieldset>

      <fieldset className="rail-fieldset">
        <legend>Sections</legend>
        {REPORT_SECTIONS.map(item => (
          <label key={item.id} className="rail-check">
            <input type="checkbox" checked={sections.includes(item.id)} onChange={() => setSections(value => toggle(value, item.id))} />
            <span>{item.label}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="rail-fieldset">
        <legend>Layout</legend>
        <div className="rail-years">
          {(['report', 'glance'] as const).map(option => (
            <button
              key={option}
              type="button"
              className={layout === option ? 'active' : ''}
              aria-pressed={layout === option}
              onClick={() => setLayout(option)}
            >
              {option === 'report' ? 'Report' : 'Glance'}
            </button>
          ))}
        </div>
        <p className="rail-hint">
          {layout === 'report' ? 'Sections stacked, A4 portrait, with a contents page.' : 'One tile per page, A4 landscape.'}
        </p>
      </fieldset>

      <div className="rail-generate">
        <button className="primary" disabled={busy || !ready} onClick={() => onGenerate(request('pdf'))}>
          <FileText size={15} /> {busy ? 'Rendering…' : 'PDF'}
        </button>
        <button disabled={busy || !ready} onClick={() => onGenerate(request('png'))}>
          <ImageIcon size={15} /> PNG
        </button>
      </div>
    </div>
  )
}

export function Sidebar({
  workspace,
  current,
  candidates,
  years,
  year,
  busy,
  onToggle,
  onOpen,
  onUnpin,
  onMove,
  onResetLayout,
  onTogglePin,
  onGenerate,
  onRunReport,
  onRenameReport,
  onRemoveReport,
}: {
  workspace: Workspace
  current: CodeRef
  candidates: CodeRef[]
  years: number[]
  year: number
  busy: boolean
  onToggle: () => void
  onOpen: (code: string, level: Level) => void
  onUnpin: (id: string) => void
  onMove: (id: string, before: string | null) => void
  onResetLayout: () => void
  onTogglePin: (entry: CodeRef) => void
  onGenerate: (request: ReportRequest) => void
  onRunReport: (report: SavedReport, format: 'pdf' | 'png' | 'view') => void
  onRenameReport: (id: string, name: string) => void
  onRemoveReport: (id: string) => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const phone = useNoRail()

  const sections = workspace.order
    .map(id => TILES.find(tile => tile.id === id))
    .filter((tile): tile is (typeof TILES)[number] => Boolean(tile) && !tile!.always)

  if (!workspace.sidebarOpen) {
    if (phone) return null

    return (
      <button className="rail-handle" onClick={onToggle} title="Open the workspace" aria-label="Open the workspace">
        <LayoutGrid size={15} />
        <span>{workspace.pinned.length || ''}</span>
      </button>
    )
  }

  const body = (
    <>
      <section className="rail-block">
        <div className="rail-subhead">
          Pinned
          <em>{workspace.pinned.length}</em>
        </div>

        {workspace.pinned.length ? (
          <div className="rail-pins">
            {workspace.pinned.map(entry => (
              <div key={entry.code} className={entry.code === current.code ? 'rail-pin active' : 'rail-pin'}>
                <button className="rail-pin-open" onClick={() => onOpen(entry.code, entry.level)}>
                  <span className="result-level">HS-{entry.level}</span>
                  <strong>{entry.code}</strong>
                  <span>{entry.label}</span>
                </button>
                <button className="rail-pin-drop" onClick={() => onTogglePin(entry)} aria-label={`Unpin ${entry.code}`}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rail-empty">Pin a code from its page to keep it here.</p>
        )}
      </section>

      <section className="rail-block">
        <div className="rail-subhead">Recently viewed</div>

        {workspace.recent.length ? (
          <div className="rail-recent">
            {workspace.recent.map(entry => (
              <button key={entry.code} onClick={() => onOpen(entry.code, entry.level)} title={entry.label}>
                <strong>{entry.code}</strong>
                <span>{entry.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="rail-empty">Nothing yet.</p>
        )}
      </section>

      <section className="rail-block">
        <div className="rail-subhead">
          Sections on the page
          <button className="rail-reset" onClick={onResetLayout} title="Show every section, in the order the dashboard ships with">
            <RotateCcw size={12} /> Reset
          </button>
        </div>

        <div className="rail-sections">
          {sections.map((tile, position) => {
            const off = workspace.hiddenTiles.includes(tile.id)

            return (
              <div key={tile.id} className={off ? 'rail-section off' : 'rail-section'}>
                <label>
                  <input type="checkbox" checked={!off} onChange={() => onUnpin(tile.id)} />
                  <span>{tile.label}</span>
                </label>

                <span className="rail-move">
                  <button
                    type="button"
                    disabled={position === 0}
                    aria-label={`Move ${tile.label} up`}
                    onClick={() => onMove(tile.id, sections[position - 1].id)}
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    disabled={position === sections.length - 1}
                    aria-label={`Move ${tile.label} down`}
                    onClick={() => onMove(tile.id, sections[position + 2]?.id ?? null)}
                  >
                    <ChevronDown size={16} />
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      </section>

      <section className="rail-block">
        <div className="rail-subhead">Build a report</div>
        <ReportBuilder current={current} candidates={candidates} years={years} year={year} busy={busy} onGenerate={onGenerate} />
      </section>

      <section className="rail-block">
        <div className="rail-subhead">
          Your reports
          <em>{workspace.reports.length}</em>
        </div>

        {workspace.reports.length ? (
          <div className="rail-reports">
            {workspace.reports.map(report => (
              <div className="rail-report-row" key={report.id}>
                {renaming === report.id ? (
                  <form
                    className="rail-rename"
                    onSubmit={event => {
                      event.preventDefault()
                      onRenameReport(report.id, draft)
                      setRenaming(null)
                    }}
                  >
                    <input autoFocus value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => setRenaming(null)} />
                  </form>
                ) : (
                  <div className="rail-report-name">
                    <strong>{report.name}</strong>
                    <span>
                      {(report.codes ?? (report.code ? [{ code: report.code, level: report.level ?? 6 }] : []))
                        .map(item => `HS ${item.code}`)
                        .join(', ')}{' '}
                      · {(report.years ?? [report.year]).join(', ')} · {when(report.createdAt)}
                    </span>
                  </div>
                )}

                <div className="rail-report-actions">
                  <button title="Open this report's code and year" aria-label="View again" onClick={() => onRunReport(report, 'view')}>
                    <Eye size={14} />
                  </button>
                  <button title="Download as PDF" aria-label="Download as PDF" onClick={() => onRunReport(report, 'pdf')}>
                    <Download size={14} />
                  </button>
                  <button
                    title="Rename"
                    aria-label="Rename"
                    onClick={() => {
                      setDraft(report.name)
                      setRenaming(report.id)
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button title="Delete" aria-label="Delete" onClick={() => onRemoveReport(report.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rail-empty">Reports you build are listed here, in this browser only.</p>
        )}
      </section>
    </>
  )

  if (phone) {
    return (
      <Sheet open title="Workspace" tall onClose={onToggle}>
        {body}
      </Sheet>
    )
  }

  return (
    <aside className="rail" aria-label="Workspace">
      <div className="rail-head">
        <strong>Workspace</strong>
        <button onClick={onToggle} aria-label="Collapse the workspace">
          <ChevronLeft size={16} />
        </button>
      </div>

      {body}
    </aside>
  )
}
