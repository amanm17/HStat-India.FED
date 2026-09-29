import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
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

import { Sheet } from './Sheet'
import { useNoRail, useTouch } from '../lib/viewport'

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

  /*
   * Reordering by drag needs a pointer that can hover, press without
   * scrolling and move precisely. On a touchscreen the pick-up gesture and
   * the scroll gesture are the same one, so the list moves when you meant to
   * read it and reads when you meant to move it. Two buttons per row are
   * slower and always do what they say.
   */
  const touch = useTouch()

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

        {ordered.map((tile, position) => (
          <label
            key={tile.id}
            className={
              touch
                ? 'rail-check bytouch'
                : drag === tile.id
                  ? 'rail-check dragging'
                  : 'rail-check'
            }
            draggable={!touch}
            onDragStart={
              touch
                ? undefined
                : event => {
                    setDrag(tile.id)
                    event.dataTransfer.effectAllowed = 'move'
                  }
            }
            onDragEnd={touch ? undefined : () => setDrag(null)}
            onDragOver={
              touch
                ? undefined
                : event => {
                    if (drag && drag !== tile.id) event.preventDefault()
                  }
            }
            onDrop={
              touch
                ? undefined
                : event => {
                    event.preventDefault()

                    if (drag && drag !== tile.id) onReorderTile(drag, tile.id)

                    setDrag(null)
                  }
            }
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

            {touch ? (
              <span className="rail-move">
                <button
                  type="button"
                  disabled={position === 0}
                  aria-label={`Move ${tile.label} up`}
                  onClick={event => {
                    event.preventDefault()
                    onReorderTile(tile.id, ordered[position - 1].id)
                  }}
                >
                  <ChevronUp size={15} />
                </button>

                <button
                  type="button"
                  disabled={position === ordered.length - 1}
                  aria-label={`Move ${tile.label} down`}
                  onClick={event => {
                    event.preventDefault()
                    onReorderTile(tile.id, ordered[position + 2]?.id ?? null)
                  }}
                >
                  <ChevronDown size={15} />
                </button>
              </span>
            ) : (
              <GripVertical size={12} className="rail-check-grip" />
            )}
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
        Tiles are captured from the page, so the report matches what you see.
        Tiles not currently on the page flash up briefly while captured.
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
  onView,
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
  /* The report/glance switch lives in the title bar on a desktop and in this
   * sheet on a phone, where the bar has room for three things and this was
   * the fourth. */
  onView?: (view: 'report' | 'glance') => void
  onTogglePin: (entry: CodeRef) => void
  onGenerate: (name: string, tiles: string[], format: 'pdf' | 'png') => void
  onReorderTile: (dragged: string, before: string | null) => void
  onRunReport: (report: SavedReport, format: 'pdf' | 'png' | 'view') => void
  onRenameReport: (id: string, name: string) => void
  onRemoveReport: (id: string) => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  /*
   * Keyed on the rail's own breakpoint, not on a phone-sized width. Below
   * 900 there is no room for a 300px aside, which is exactly why .navrail
   * hides itself there - so a rotated phone at 844px gets the sheet too,
   * rather than a 34px handle clinging to the right edge of a 390px-tall
   * screen.
   */
  const phone = useNoRail()

  const hidden = useMemo(
    () => TILES.filter(tile => workspace.hiddenTiles.includes(tile.id)),
    [workspace.hiddenTiles],
  )

  /*
   * On a phone the rail is a sheet, and its handle joins the floating dock
   * above the tab bar rather than clinging to the right edge at 34px wide
   * halfway down the screen - which is where a thumb never is, and which
   * overlapped the header's own buttons at 390px.
   */
  /*
   * No floating handle on a phone.
   *
   * It was pinned to the right edge, vertically centred - which on a 6-inch
   * screen is both out of a thumb's reach and directly on top of whatever
   * the page is saying there. The button moved into the title bar beside the
   * other controls that act on this page, which is where a reader already
   * looks for them and where it covers nothing.
   */
  if (!workspace.sidebarOpen) {
    if (phone) return null

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

  const body = (
    <>
      {phone && onView && (
        <section className="rail-block">
          <div className="rail-subhead">How the tiles are laid out</div>

          <div className="viewswitch insheet" role="group" aria-label="View mode">
            {(['report', 'glance'] as const).map(mode => (
              <button
                key={mode}
                className={workspace.view === mode ? 'active' : ''}
                aria-pressed={workspace.view === mode}
                onClick={() => onView(mode)}
              >
                {mode === 'report' ? 'Stacked' : 'One at a time'}
              </button>
            ))}
          </div>
        </section>
      )}

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
            Pin a code from its page to keep it here.
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
            Reports you generate are listed here, in this browser only. Clearing
            site data removes them.
          </p>
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

        <button onClick={onToggle} aria-label="Collapse the workspace rail">
          <ChevronLeft size={16} />
        </button>
      </div>

      {body}
    </aside>
  )
}
