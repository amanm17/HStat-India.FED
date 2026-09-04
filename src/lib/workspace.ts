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

export type Level = 2 | 4 | 6

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
  { id: 'identity', label: 'Product', note: 'Name, code and official definition', always: true },
  { id: 'lineage', label: 'Code history', note: 'What this code was before HS 2022' },
  { id: 'global', label: 'World market', note: 'Global trade, adjusted for re-imports' },
  { id: 'year', label: 'India this year', note: 'Imports, exports and rank for the selected year' },
  { id: 'whats-inside', label: "What's inside", note: 'Child lines and their shares' },
  { id: 'signals', label: 'Signals', note: 'What stands out, sourcing concentration' },
  { id: 'coverage', label: 'Coverage', note: 'How much of the heading is tracked' },
  { id: 'trends', label: 'Trends', note: 'India trade and the world market over time' },
  { id: 'importers', label: 'Who buys', note: 'Largest importing economies' },
  { id: 'exporters', label: 'Who sells', note: 'Largest exporting economies' },
  { id: 'partners', label: 'Trade partners', note: "India's own sources and markets" },
  { id: 'tariff', label: 'Tariff lines', note: 'India ITC(HS)-8 detail, when supplied' },
]

export const DEFAULT_TILES = TILES.map(tile => tile.id)

/*
 * How the tiles are clubbed into slides out of the box.
 *
 * One tile per slide is the honest default for a page, and the wrong one for
 * a deck: it makes twelve thin slides where the identity block or the
 * coverage note has a whole screen to itself. These four pairings are the
 * ones that belong together when you are reading a screen at a time - the
 * product and where its code came from, the world market beside India's year
 * in it, what stands out beside how much of the heading is tracked, and the
 * two sides of the trade. Everything else earns its own slide because it is
 * a full-width chart or table.
 *
 * A reader can merge and split from the slide's own bar; the moment they do,
 * their arrangement is what is stored and these defaults stop applying.
 */
export const DEFAULT_SLIDES: string[][] = [
  ['identity', 'lineage'],
  ['global', 'year'],
  ['signals', 'coverage'],
  ['importers', 'exporters'],
]

/*
 * Tiles that read properly in half a slide: a short note, a list, a ranked
 * table. Everything else - the identity banner, the figure cards, a chart,
 * a wide table - needs the width of the slide and takes both columns.
 */
const NARROW_TILES = new Set([
  'lineage',
  'signals',
  'coverage',
  'importers',
  'exporters',
])

export function isNarrowTile(id: string): boolean {
  return NARROW_TILES.has(id)
}

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
}

export type ViewMode = 'report' | 'glance'

export type Workspace = {
  pinned: CodeRef[]
  recent: CodeRef[]
  hiddenTiles: string[]
  /*
   * One arrangement, used everywhere: the page in Report View, the slides in
   * Glance View, and the running order of a generated report. Two orders
   * would mean the report never quite matched what you arranged.
   */
  order: string[]
  /*
   * Slides that carry more than one tile. Each entry is a list of tile ids
   * that share a slide in Glance View; the first id is where the group sits
   * in the order. Report View ignores this - a merged pair is just two tiles
   * next to each other there.
   */
  merged: string[][]
  /*
   * Whether the deck arranges itself.
   *
   * How full a tile is depends on the data behind it: "who sells" is a
   * ranked table for one code and a single line saying the export side is
   * not published for another, and a fixed grouping gives that one line a
   * whole screen. When this is on, the deck measures every tile and packs
   * as many as fit into each slide. The moment the reader merges or splits
   * a slide themselves it goes off and their arrangement stands.
   */
  autoPack: boolean
  view: ViewMode
  sidebarOpen: boolean
  reports: SavedReport[]
}

const KEY = 'hstat-workspace-v1'

const EMPTY: Workspace = {
  pinned: [],
  recent: [],
  hiddenTiles: [],
  order: DEFAULT_TILES,
  merged: [],
  autoPack: true,
  view: 'report',
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
    [2, 4, 6].includes(item.level) &&
    typeof item.label === 'string'
  )
}

export function readWorkspace(): Workspace {
  try {
    const raw = window.localStorage.getItem(KEY)

    if (!raw) return { ...EMPTY }

    const parsed = JSON.parse(raw) as Partial<Workspace>

    return {
      pinned: (parsed.pinned ?? []).filter(isCodeRef),
      recent: (parsed.recent ?? []).filter(isCodeRef).slice(0, RECENT_LIMIT),
      hiddenTiles: (parsed.hiddenTiles ?? []).filter(
        id => typeof id === 'string' && !TILES.find(t => t.id === id)?.always,
      ),
      order: reconcileOrder(parsed.order),
      merged: (parsed.merged ?? [])
        .filter(group => Array.isArray(group) && group.length > 1)
        .map(group => group.filter(id => DEFAULT_TILES.includes(id)))
        .filter(group => group.length > 1),
      autoPack: parsed.autoPack !== false,
      view: parsed.view === 'glance' ? 'glance' : 'report',
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
 * Move one tile to sit immediately before another. This is the whole of
 * reordering: a drag ends on some tile, and the dragged one lands in front
 * of it. Dropping on the last tile's trailing edge appends instead.
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

/* The slide a tile belongs to: itself, or the group it was merged into. */
export function slideOf(workspace: Workspace, id: string): string[] {
  return workspace.merged.find(group => group.includes(id)) ?? [id]
}

/*
 * Glance View slides, in order, each one or more tiles.
 *
 * A group is placed where its first visible member sits in the order, and
 * every other member is absorbed there, so merging never silently changes
 * where a slide appears.
 */
export function slides(workspace: Workspace, visible: string[]): string[][] {
  const seen = new Set<string>()

  const out: string[][] = []

  for (const id of workspace.order) {
    if (!visible.includes(id) || seen.has(id)) continue

    const group = slideOf(workspace, id).filter(
      item => visible.includes(item),
    )

    for (const item of group) seen.add(item)

    out.push(group)
  }

  return out
}

/*
 * The reader has arranged the slides themselves. Whatever the deck was
 * showing becomes the arrangement - including the groups the packer had
 * chosen - so a merge changes one slide rather than rearranging the deck
 * under them.
 */
export function arrangeSlides(
  workspace: Workspace,
  groups: string[][],
): Workspace {
  return {
    ...workspace,
    merged: groups.filter(group => group.length > 1),
    autoPack: false,
  }
}

export function mergeWithNext(
  workspace: Workspace,
  visible: string[],
): (id: string) => Workspace {
  return id => {
    const list = slides(workspace, visible)

    const index = list.findIndex(group => group.includes(id))

    if (index < 0 || index === list.length - 1) return workspace

    const combined = [...list[index], ...list[index + 1]]

    return {
      ...workspace,
      merged: [
        ...workspace.merged.filter(
          group => !group.some(item => combined.includes(item)),
        ),
        combined,
      ],
    }
  }
}

export function splitSlide(workspace: Workspace, id: string): Workspace {
  return {
    ...workspace,
    merged: workspace.merged.filter(group => !group.includes(id)),
  }
}

/* Back to the arrangement the dashboard ships with. Pins, history and saved
 * reports are the reader's own and are left alone. */
export function resetLayout(workspace: Workspace): Workspace {
  return {
    ...workspace,
    order: DEFAULT_TILES,
    merged: [],
    autoPack: true,
    hiddenTiles: [],
  }
}
