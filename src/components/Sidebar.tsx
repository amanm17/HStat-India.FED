import { useMemo, useState } from 'react'
import {
  ChevronLeft,
  Download,
  Eye,
  FileText,
  Layers,
  GripVertical,
  Pencil,
  Pin,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'

import {
  TILES,
  type CodeRef,
  type Level,
  type ReportScope,
  type SavedReport,
  type Workspace,
} from '../lib/workspace'

/*
 * The reader's rail.
 *
 * Everything in here is personal and local: what they pinned, where they have
 * been, which tiles they want, and the reports they have built. It is a rail
 * rather than a page because none of it is the subject - the product is - and
 * it collapses to a strip so that stays true.
 */

function when(iso: string): string {
  const date = new Date(iso)

  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      })
}

function ReportBuilder({
  scope,
  subject,
  hasStack,
  order,
  onScope,
  onGenerate,
  onReorderTile,
  busy,
}: {
  scope: ReportScope
  subject: string
  hasStack: boolean
  /* The reader's arrangement. A report runs in the order they arranged the
   * page in, because they already said what order they wanted. */
  order: string[]
  onScope: (scope: ReportScope) => void
  onGenerate: (
    name: string,
    tiles: string[],
    format: 'pdf' | 'png',
  ) => void
  onReorderTile: (dragged: string, before: string | null) => void
  busy: boolean
}) {
  const [name, setName] = useState('')

  const [chosen, setChosen] = useState<string[]>([
    'identity',
    'global',
    'year',
    'trends',
    'importers',
  ])

  const [drag, setDrag] = useState<string | null>(null)

  const ordered = order
    .map(id => TILES.find(tile => tile.id === id))
    .filter((tile): tile is (typeof TILES)[number] => Boolean(tile))

  const toggle = (id: string) =>
    setChosen(current =>
      current.includes(id)
        ? current.filter(item => item !== id)
        : [...current, id],
    )

  return (
    <div className="rail-report">
      <div className="rail-scope">
        {(['product', 'hstack'] as const).map(option => (
          <button
            key={option}
            className={scope === option ? 'active' : ''}
            disabled={option === 'hstack' && !hasStack}
            title={
              option === 'hstack' && !hasStack
                ? 'Add codes to HStack first'
                : undefined
            }
            onClick={() => onScope(option)}
          >
            {option === 'product' ? 'This product' : 'HStack'}
          </button>
        ))}
      </div>

      <p className="rail-subject">{subject}</p>

      <label className="rail-field">
        <span>Report name</span>

        <input
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder="Smartphones — import dependence"
        />
      </label>

      <div className="rail-tilepick">
        <span className="rail-subhead">Include</span>

        {ordered.map(tile => (
          <label
            key={tile.id}
            className={drag === tile.id ? 'rail-check dragging' : 'rail-check'}
            draggable
            onDragStart={event => {
              setDrag(tile.id)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => setDrag(null)}
            onDragOver={event => {
              if (drag && drag !== tile.id) event.preventDefault()
            }}
            onDrop={event => {
              event.preventDefault()

              if (drag && drag !== tile.id) onReorderTile(drag, tile.id)

              setDrag(null)
            }}
          >
            <input
              type="checkbox"
              checked={chosen.includes(tile.id)}
              onChange={() => toggle(tile.id)}
            />

            <span>
              {tile.label}
              <em>{tile.note}</em>
            </span>

            <GripVertical size={12} className="rail-check-grip" />
          </label>
        ))}
      </div>

      <div className="rail-generate">
        <button
          className="primary"
          disabled={busy || !chosen.length}
          onClick={() =>
            onGenerate(name, order.filter(id => chosen.includes(id)), 'pdf')
          }
        >
          <FileText size={14} />
          {busy ? 'Rendering…' : 'PDF'}
        </button>

        <button
          disabled={busy || !chosen.length}
          onClick={() =>
            onGenerate(name, order.filter(id => chosen.includes(id)), 'png')
          }
        >
          <Download size={14} />
          PNG
        </button>
      </div>

      <p className="rail-hint">
        Tiles are captured from the page itself, so a report looks exactly like
        what you are reading. Anything not currently on the page is shown
        briefly while it is captured.
      </p>
    </div>
  )
}

export function Sidebar({
  workspace,
  currentCode,
  subject,
  hasStack,
  busy,
  scope,
  onScope,
  onToggle,
  onOpen,
  onUnpin,
  onResetLayout,
  onTogglePin,
  onGenerate,
  onReorderTile,
  onRunReport,
  onRenameReport,
  onRemoveReport,
}: {
  workspace: Workspace
  currentCode: string
  subject: string
  hasStack: boolean
  busy: boolean
  scope: ReportScope
  onScope: (scope: ReportScope) => void
  onToggle: () => void
  onOpen: (code: string, level: Level) => void
  onUnpin: (id: string) => void
  onResetLayout: () => void
  onTogglePin: (entry: CodeRef) => void
  onGenerate: (name: string, tiles: string[], format: 'pdf' | 'png') => void
  onReorderTile: (dragged: string, before: string | null) => void
  onRunReport: (report: SavedReport, format: 'pdf' | 'png' | 'view') => void
  onRenameReport: (id: string, name: string) => void
  onRemoveReport: (id: string) => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const hidden = useMemo(
    () => TILES.filter(tile => workspace.hiddenTiles.includes(tile.id)),
    [workspace.hiddenTiles],
  )

  if (!workspace.sidebarOpen) {
    return (
      <button
        className="rail-handle"
        onClick={onToggle}
        title="Open the workspace rail"
        aria-label="Open the workspace rail"
      >
        <Layers size={15} />
        <span>{workspace.pinned.length || ''}</span>
      </button>
    )
  }

  return (
    <aside className="rail" aria-label="Workspace">
      <div className="rail-head">
        <strong>Workspace</strong>

        <button onClick={onToggle} aria-label="Collapse the workspace rail">
          <ChevronLeft size={16} />
        </button>
      </div>

      <section className="rail-block">
        <div className="rail-subhead">
          Quick view
          <em>{workspace.pinned.length}</em>
        </div>

        {workspace.pinned.length ? (
          <div className="rail-pins">
            {workspace.pinned.map(entry => (
              <div
                key={entry.code}
                className={
                  entry.code === currentCode ? 'rail-pin active' : 'rail-pin'
                }
              >
                <button
                  className="rail-pin-open"
                  onClick={() => onOpen(entry.code, entry.level)}
                >
                  <span className="result-level">HS-{entry.level}</span>
                  <strong>{entry.code}</strong>
                  <span>{entry.label}</span>
                </button>

                <button
                  className="rail-pin-drop"
                  onClick={() => onTogglePin(entry)}
                  aria-label={`Unpin ${entry.code}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rail-empty">
            Pin a code from its page to keep it here and switch between pinned
            codes in one click.
          </p>
        )}
      </section>

      <section className="rail-block">
        <div className="rail-subhead">Recently viewed</div>

        {workspace.recent.length ? (
          <div className="rail-recent">
            {workspace.recent.map(entry => (
              <button
                key={entry.code}
                onClick={() => onOpen(entry.code, entry.level)}
                title={entry.label}
              >
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
          Tiles
          <em>
            {TILES.length - hidden.length}/{TILES.length}
          </em>

          <button
            className="rail-reset"
            onClick={onResetLayout}
            title="Put every tile back on the page, in the order and slides the dashboard ships with"
          >
            <RotateCcw size={11} />
            Reset
          </button>
        </div>

        <div className="rail-tiles">
          {workspace.order
            .map(id => TILES.find(tile => tile.id === id))
            .filter((tile): tile is (typeof TILES)[number] => Boolean(tile))
            .map(tile => {
            const off = workspace.hiddenTiles.includes(tile.id)

            return (
              <button
                key={tile.id}
                className={off ? 'rail-tile off' : 'rail-tile'}
                disabled={tile.always}
                title={
                  tile.always
                    ? 'Always shown'
                    : off
                      ? `Put ${tile.label} back on the page`
                      : `Take ${tile.label} off the page`
                }
                onClick={() => onUnpin(tile.id)}
              >
                <Pin size={12} />
                {tile.label}
              </button>
            )
          })}
        </div>
      </section>

      <section className="rail-block">
        <div className="rail-subhead">Generate report</div>

        <ReportBuilder
          scope={scope}
          subject={subject}
          hasStack={hasStack}
          order={workspace.order}
          onScope={onScope}
          onGenerate={onGenerate}
          onReorderTile={onReorderTile}
          busy={busy}
        />
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
                    <input
                      autoFocus
                      value={draft}
                      onChange={event => setDraft(event.target.value)}
                      onBlur={() => setRenaming(null)}
                    />
                  </form>
                ) : (
                  <div className="rail-report-name">
                    <strong>{report.name}</strong>

                    <span>
                      {report.scope === 'hstack'
                        ? 'HStack'
                        : `HS-${report.level} ${report.code}`}{' '}
                      · {report.year} · {report.tiles.length} tiles ·{' '}
                      {when(report.createdAt)}
                    </span>
                  </div>
                )}

                <div className="rail-report-actions">
                  <button
                    title="Open this report's product and tiles again"
                    aria-label="View again"
                    onClick={() => onRunReport(report, 'view')}
                  >
                    <Eye size={13} />
                  </button>

                  <button
                    title="Download as PDF"
                    aria-label="Download as PDF"
                    onClick={() => onRunReport(report, 'pdf')}
                  >
                    <Download size={13} />
                  </button>

                  <button
                    title="Rename"
                    aria-label="Rename"
                    onClick={() => {
                      setDraft(report.name)
                      setRenaming(report.id)
                    }}
                  >
                    <Pencil size={13} />
                  </button>

                  <button
                    title="Delete"
                    aria-label="Delete"
                    onClick={() => onRemoveReport(report.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rail-empty">
            Reports you generate are listed here. They are kept in this browser
            only — nobody else can see them, and clearing site data removes
            them.
          </p>
        )}
      </section>
    </aside>
  )
}
