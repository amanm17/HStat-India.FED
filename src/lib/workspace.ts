/*
 * The reader's own workspace.
 *
 * Everything here belongs to one person in one browser: which codes they
 * pinned, what they looked at, which tiles they want on the page, and the
 * reports they have built. None of it is shared, none of it reaches a server,
 * and none of it is in the snapshot.
 *
 * Two decisions worth knowing about.
 *
 * A report is stored as a *definition* - which code, which year, which tiles -
 * and never as a rendered file. A saved PDF would be a photograph of numbers
 * that have since been revised, and it would fill the browser's storage quota
 * in a dozen reports. Storing the definition means "view again" re-renders
 * against current data, "download" produces a fresh file, and the whole
 * library costs a few kilobytes.
 *
 * Every read and write is wrapped. Storage throws outright in some contexts -
 * a private window with site data blocked, an embedded viewer - and losing a
 * pin list is not a reason to take the dashboard down.
 */

/* 8 is here because a tariff line is a place a reader returns to, the same as
 * a product. Pins, history and saved reports all key off this. */
export type Level = 2 | 4 | 6 | 8

export type CodeRef = {
  code: string
  level: Level
  label: string
}

/*
 * The tiles a reader can pin or unpin.
 *
 * `always` marks the ones that are not a matter of taste: the product's
 * identity and the year control are how the rest of the page is addressed,
 * so they have no unpin control.
 */
export type TileSpec = {
  id: string
  label: string
  note: string
  always?: boolean
}

export const TILES: TileSpec[] = [
  { id: 'identity', label: 'Product', note: 'Code, name and tagging', always: true },
  { id: 'headline', label: 'Headline', note: 'Global Trade, India Exports and India Imports, with the calculation drawer', always: true },
  { id: 'trend', label: 'Trend', note: 'Global Trade and India trade over time, as a table or a chart' },
  { id: 'world', label: 'Importers & Exporters', note: 'The largest importing and exporting countries' },
  { id: 'partners', label: "India's Partners", note: "India's import and export partners" },
  { id: 'dgcis', label: 'Tariff Lines', note: "India's own eight-digit lines, monthly, from DGCIS" },
  { id: 'inside', label: 'Inside', note: 'The headings or lines inside this code, with their shares' },
  { id: 'signals', label: 'Key Changes', note: 'Year-on-year changes and import concentration' },
  { id: 'lineage', label: 'Classification', note: 'What this code was before HS 2022' },
]

export const DEFAULT_TILES = TILES.map(tile => tile.id)

export type ReportScope = 'product' | 'hstack'

export type SavedReport = {
  id: string
  name: string
  createdAt: string
  scope: ReportScope
  code: string | null
  level: Level | null
  subject: string
  year: number
  currency: 'USD' | 'INR'
  tiles: string[]
  /* Bumped every time the report is regenerated, so the list can show it. */
  lastRunAt: string
  /* Since the report builder took several codes and several years. Absent
   * on reports saved before; those mean their one code and one year. */
  codes?: { code: string; level: 2 | 4 | 6 }[]
  years?: number[]
  layout?: 'report' | 'glance'
}

export type Workspace = {
  pinned: CodeRef[]
  recent: CodeRef[]
  hiddenTiles: string[]
  /* The order the page's sections run in, which is also the order a report
   * built from them runs in. */
  order: string[]
  sidebarOpen: boolean
  reports: SavedReport[]
}

/*
 * v2 since the Phase 2 refresh: the page's sections were renamed and
 * reordered, so a stored v1 arrangement would put them in an order nobody
 * chose. Pins, history and saved reports carry over from v1; the layout
 * does not.
 */
const KEY = 'hstat-workspace-v2'
const LEGACY_KEY = 'hstat-workspace-v1'

const EMPTY: Workspace = {
  pinned: [],
  recent: [],
  hiddenTiles: [],
  order: DEFAULT_TILES,
  sidebarOpen: false,
  reports: [],
}

/*
 * A stored order can be stale: tiles get added, renamed or split between
 * releases. Reconciling rather than trusting it means an old arrangement
 * survives an upgrade and a new tile still appears, at the end, where it can
 * be found and moved.
 */
export function reconcileOrder(stored: unknown): string[] {
  const known = new Set(DEFAULT_TILES)

  const kept = Array.isArray(stored)
    ? stored.filter(
        (id, index, all): id is string =>
          typeof id === 'string' && known.has(id) && all.indexOf(id) === index,
      )
    : []

  return [...kept, ...DEFAULT_TILES.filter(id => !kept.includes(id))]
}

const RECENT_LIMIT = 12

function isCodeRef(value: unknown): value is CodeRef {
  const item = value as CodeRef

  return (
    !!item &&
    typeof item.code === 'string' &&
    [2, 4, 6, 8].includes(item.level) &&
    typeof item.label === 'string'
  )
}

export function readWorkspace(): Workspace {
  try {
    const raw = window.localStorage.getItem(KEY)
    const legacy = raw ? null : window.localStorage.getItem(LEGACY_KEY)

    if (!raw && !legacy) return { ...EMPTY }

    const parsed = (
      raw
        ? JSON.parse(raw)
        : { ...JSON.parse(legacy as string), order: undefined, hiddenTiles: [] }
    ) as Partial<Workspace>

    return {
      pinned: (parsed.pinned ?? []).filter(isCodeRef),
      recent: (parsed.recent ?? []).filter(isCodeRef).slice(0, RECENT_LIMIT),
      hiddenTiles: (parsed.hiddenTiles ?? []).filter(
        id => typeof id === 'string' && !TILES.find(t => t.id === id)?.always,
      ),
      order: reconcileOrder(parsed.order),
      sidebarOpen: Boolean(parsed.sidebarOpen),
      reports: (parsed.reports ?? []).filter(
        report => report && typeof report.id === 'string',
      ),
    }
  } catch {
    return { ...EMPTY }
  }
}

export function writeWorkspace(workspace: Workspace): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(workspace))
  } catch {
    /* Quota, private mode, or storage disabled. The session still works. */
  }
}

/* --- operations, all pure so the caller stays in control of state --- */

export function togglePin(workspace: Workspace, entry: CodeRef): Workspace {
  const already = workspace.pinned.some(item => item.code === entry.code)

  return {
    ...workspace,
    pinned: already
      ? workspace.pinned.filter(item => item.code !== entry.code)
      : [...workspace.pinned, entry],
  }
}

export function noteVisit(workspace: Workspace, entry: CodeRef): Workspace {
  return {
    ...workspace,
    recent: [
      entry,
      ...workspace.recent.filter(item => item.code !== entry.code),
    ].slice(0, RECENT_LIMIT),
  }
}

export function toggleTile(workspace: Workspace, id: string): Workspace {
  if (TILES.find(tile => tile.id === id)?.always) return workspace

  const hidden = workspace.hiddenTiles.includes(id)

  return {
    ...workspace,
    hiddenTiles: hidden
      ? workspace.hiddenTiles.filter(item => item !== id)
      : [...workspace.hiddenTiles, id],
  }
}

export function visibleTiles(workspace: Workspace): string[] {
  return workspace.order.filter(id => !workspace.hiddenTiles.includes(id))
}

function reportId(): string {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function saveReport(
  workspace: Workspace,
  report: Omit<SavedReport, 'id' | 'createdAt' | 'lastRunAt'>,
): { workspace: Workspace; report: SavedReport } {
  const now = new Date().toISOString()

  const saved: SavedReport = {
    ...report,
    id: reportId(),
    createdAt: now,
    lastRunAt: now,
  }

  return {
    workspace: { ...workspace, reports: [saved, ...workspace.reports] },
    report: saved,
  }
}

export function renameReport(
  workspace: Workspace,
  id: string,
  name: string,
): Workspace {
  return {
    ...workspace,
    reports: workspace.reports.map(report =>
      report.id === id ? { ...report, name: name.trim() || report.name } : report,
    ),
  }
}

export function touchReport(workspace: Workspace, id: string): Workspace {
  return {
    ...workspace,
    reports: workspace.reports.map(report =>
      report.id === id
        ? { ...report, lastRunAt: new Date().toISOString() }
        : report,
    ),
  }
}

export function removeReport(workspace: Workspace, id: string): Workspace {
  return {
    ...workspace,
    reports: workspace.reports.filter(report => report.id !== id),
  }
}


/* --- arrangement ---------------------------------------------------- */

/*
 * Move one section to sit immediately before another (null: to the end).
 * The rail's up and down buttons are the only caller since drag-to-reorder
 * was retired in the Phase 2 refresh.
 */
export function moveTile(
  workspace: Workspace,
  dragged: string,
  before: string | null,
): Workspace {
  if (dragged === before) return workspace

  const rest = workspace.order.filter(id => id !== dragged)

  const at = before === null ? rest.length : rest.indexOf(before)

  if (at < 0) return workspace

  return {
    ...workspace,
    order: [...rest.slice(0, at), dragged, ...rest.slice(at)],
  }
}

/* Back to the arrangement the dashboard ships with. Pins, history and saved
 * reports are the reader's own and are left alone. */
export function resetLayout(workspace: Workspace): Workspace {
  return {
    ...workspace,
    order: DEFAULT_TILES,
    hiddenTiles: [],
  }
}
