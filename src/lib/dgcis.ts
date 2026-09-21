/*
 * India's own tariff-line detail, from DGCIS.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * Every other number on a product page comes from UN Comtrade: the world's
 * trade in an HS-6 line, summed across reporting economies. This one does
 * not. It is India's customs authority reporting India's own trade with the
 * World partner aggregate, at the Indian eight-digit tariff line, monthly.
 *
 * The partner is called "World" in the source, and that word has cost people
 * money before. It does not mean world trade. It means India, trading, with
 * everywhere. A page that shows both must never let one be read as the other,
 * which is why this loads separately, renders in its own panel, and is
 * labelled with its reporter, partner and flow every time it appears.
 *
 * Periods are monthly and calendar-dated; Comtrade's are annual. They are not
 * plotted together.
 *
 * WHY FLOW IS EVERYWHERE IN THIS FILE
 *
 * The DGCIS extract carries no flow column, and the first version of this
 * pipeline assumed one. It assumed wrong - the figures were India's exports,
 * published for a fortnight's development under the word "imports", and only
 * caught by holding them against Comtrade's India series. Nothing here
 * defaults a flow, infers one from context, or falls back to the other when
 * the asked-for one is missing. A caller names the flow or gets nothing.
 */

export type DgcisFlow = 'exports' | 'imports'

export type DgcisBasis = 'usd' | 'inr'

/* DGCIS's own commodity groupings. The extract carries no tariff-line
 * description, and one is not invented here. */
export type DgcisLine = {
  hs8: string
  /* What to call this line, and where the name came from. DGCIS files eight
   * commodity groups and no line descriptions, so until India's own
   * eight-digit schedule is loaded the title is the heading's authored name
   * and `nameSource` says so. A page must not imply a precision it lacks. */
  /* Empty unless India's own eight-digit schedule gave us a real name for
   * THIS line. A borrowed word is not a name: 29 lines under one heading all
   * called "Electrical machines, other" cannot be told apart, which is the
   * whole job of a name. The code can, so the code leads. */
  title: string
  nameSource: 'schedule' | 'none'
  headingName: string
  description?: string
  principalCommodity: string
  quickEstimateCommodity: string
}

/* Aligned to `periods`. null is a month the source left blank, which is not
 * the same as a month of zero trade. */
export type DgcisSeries = {
  inrCrore: Array<number | null>
  usdMillion: Array<number | null>
}

export type DgcisFlowBlock = {
  latestPeriod: string | null
  series: Record<string, DgcisSeries>
}

export type DgcisNode = {
  hs6: string
  source: string
  reporter: string
  partner: string
  units: { inrCrore: string; usdMillion: string }
  /* False for an HS-6 carried only as a lineage predecessor, whose tariff
   * lines are real India history with no product page of their own. */
  isProduct: boolean
  periods: string[]
  lines: DgcisLine[]
  flows: Partial<Record<DgcisFlow, DgcisFlowBlock>>
}

export type DgcisIndexEntry = Omit<DgcisLine, 'description'> & {
  hs6: string
  isProduct: boolean
  flows: Partial<Record<DgcisFlow, {
    latest: { period: string; usdMillion: number } | null
    last12UsdMillion: number | null
  }>>
}

export type DgcisIndex = {
  builtAt: string
  flows: DgcisFlow[]
  periods: { first: string; last: string }
  lines: DgcisIndexEntry[]
}

export type DgcisManifest = {
  source: string
  builtAt: string
  reporter: string
  partner: string
  flows: DgcisFlow[]
  flowDetail: Partial<Record<DgcisFlow, {
    sourceFile: string | null
    processedAt: string | null
    firstPeriod: string | null
    lastPeriod: string | null
    flowVerdict: {
      status: string
      evidence: string | null
      pairs: number
    } | null
  }>>
  firstPeriod: string
  lastPeriod: string
  hs8Count: number
  productsCovered: number
  productsTotal: number
  coveredHs6: string[]
  predecessorHs6: string[]
}

const BASE = '/data/dgcis'

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, { cache: 'no-cache' })

    if (!response.ok) return null

    return (await response.json()) as T
  } catch {
    return null
  }
}

/*
 * A miss is the normal case, not an error.
 *
 * The extract covers 251 of 418 products. A page with no DGCIS file is not
 * broken and must not announce anything; it simply has no tariff-line detail
 * to show. So this returns null rather than throwing, and the panel that
 * calls it renders nothing.
 */
/*
 * Which headings have tariff lines at all, resolved once.
 *
 * 167 of the 418 products have no DGCIS file. Asking for each of them and
 * taking the 404 works - loadDgcis has always treated a miss as "no detail" -
 * but it puts a red line in the console of two pages in five, and a console
 * full of expected errors is where an unexpected one goes unnoticed. So the
 * index answers first, and the file is only asked for when it exists.
 *
 * If the index itself is not there - an older deployment, a half-finished
 * upload - this falls back to asking for the file. Missing plumbing must
 * degrade to the old behaviour, never to no behaviour.
 */
let coverage: Promise<Set<string> | null> | null = null

function coveredHeadings(): Promise<Set<string> | null> {
  if (!coverage) {
    coverage = loadDgcisIndex().then(index =>
      index ? new Set(index.lines.map(line => line.hs6)) : null,
    )
  }

  return coverage
}

/*
 * One fetch per heading per session.
 *
 * A reader who opens HS 851762 and then clicks into 85176290 was downloading
 * the same 60 KB file twice: the tariff-line page loads its parent's payload,
 * which is the whole point of the design - siblings, share of heading and the
 * way back up all come from it - but the product page had just fetched it.
 * `cache: 'no-cache'` meant the browser would not help.
 *
 * So the promise is remembered, exactly as the index already is. Second and
 * later callers get the resolved node without a request, and a drill-down is
 * instant instead of a round trip.
 *
 * The memo is per page load, not persisted. Nothing here goes stale within a
 * session: these files are rebuilt monthly, and a reader who leaves the tab
 * open across a deploy reloads to see it, the same as every other asset.
 */
const headings = new Map<string, Promise<DgcisNode | null>>()

export function loadDgcis(hs6: string): Promise<DgcisNode | null> {
  const existing = headings.get(hs6)

  if (existing) return existing

  const request = (async () => {
    const covered = await coveredHeadings()

    if (covered && !covered.has(hs6)) return null

    return usable(await getJson<DgcisNode>(`${BASE}/hs6/${hs6}.json`))
  })()

  headings.set(hs6, request)

  /* A rejected promise must not be remembered, or one blip poisons the
   * heading for the rest of the session. getJson already swallows failures
   * into null, so this is belt and braces. */
  request.catch(() => headings.delete(hs6))

  return request
}

/*
 * A file this code cannot read is treated as a file that is not there.
 *
 * This layer is an addition to a dashboard that worked without it, and it
 * must never be able to subtract. The payload shape changed once already -
 * when flow stopped being assumed - and a deployment that serves the new
 * frontend over the old files, or the other way round, is an ordinary
 * consequence of assets and code shipping as separate objects. The old shape
 * has `children` where this one has `lines` and `flows`; reading it would
 * throw inside a render, and a throw inside a render blanks the page.
 *
 * So: anything that is not recognisably this shape returns null, which every
 * caller already handles as "this product has no tariff-line detail" - the
 * normal state for 167 of the 418 products.
 */
function usable(node: DgcisNode | null): DgcisNode | null {
  if (!node) return null

  const shaped =
    typeof node.hs6 === 'string' &&
    Array.isArray(node.periods) &&
    Array.isArray(node.lines) &&
    node.flows !== null &&
    typeof node.flows === 'object'

  if (!shaped) return null

  /* A flow block with no series is not a flow. */
  const flows: Partial<Record<DgcisFlow, DgcisFlowBlock>> = {}

  for (const flow of ['exports', 'imports'] as const) {
    const block = node.flows[flow]

    if (block && block.series && typeof block.series === 'object') {
      flows[flow] = block
    }
  }

  if (!Object.keys(flows).length) return null

  return { ...node, flows }
}

export async function loadDgcisManifest(): Promise<DgcisManifest | null> {
  return getJson<DgcisManifest>(`${BASE}/manifest.json`)
}

/*
 * The HS-8 catalogue, fetched once per session.
 *
 * 126 KB, and every consumer of it - search, the tariff-line route, the
 * "does this code exist" check - wants the whole thing. Caching the promise
 * rather than the value means five callers during the first paint make one
 * request between them.
 */
let indexPromise: Promise<DgcisIndex | null> | null = null

export function loadDgcisIndex(): Promise<DgcisIndex | null> {
  if (!indexPromise) {
    indexPromise = getJson<DgcisIndex>(`${BASE}/hs8-index.json`).then(index =>
      index && Array.isArray(index.lines) ? index : null,
    )
  }

  return indexPromise
}

export function parentOf(hs8: string): string {
  return hs8.slice(0, 6)
}

export function isHs8(code: string): boolean {
  return /^\d{8}$/.test(code)
}

/* The flows this HS-6 actually has, in a fixed order so a switch does not
 * reorder itself between products. */
export function flowsOf(node: DgcisNode | null): DgcisFlow[] {
  if (!node) return []

  return (['exports', 'imports'] as const).filter(flow => node.flows[flow])
}

export function seriesFor(
  node: DgcisNode | null,
  flow: DgcisFlow,
  hs8: string,
  basis: DgcisBasis,
): Array<number | null> | null {
  const series = node?.flows[flow]?.series[hs8]

  if (!series) return null

  return basis === 'usd' ? series.usdMillion : series.inrCrore
}

/*
 * The heading's own series, as the sum of its tariff lines.
 *
 * A month is null only when every line beneath it is null - that is a month
 * the source did not publish. A month where some lines are blank and others
 * are not is a real month, and the blanks are lines that did not trade.
 * Treating the whole month as missing there would put a hole in a series
 * that has none.
 */
export function totalSeries(
  node: DgcisNode | null,
  flow: DgcisFlow,
  basis: DgcisBasis,
): Array<number | null> {
  const block = node?.flows[flow]

  if (!node || !block) return []

  return node.periods.map((_, position) => {
    let total = 0
    let seen = false

    for (const hs8 of Object.keys(block.series)) {
      const series = basis === 'usd'
        ? block.series[hs8].usdMillion
        : block.series[hs8].inrCrore

      const value = series[position]

      if (value !== null && value !== undefined) {
        total += value
        seen = true
      }
    }

    return seen ? total : null
  })
}

/* The last month this line actually traded, and the value then. */
export function latestOf(
  series: Array<number | null>,
  periods: string[],
): { period: string; value: number } | null {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const value = series[index]

    if (value) return { period: periods[index], value }
  }

  return null
}

/* Total over a window, or null if any month in it is missing. A part-window
 * total silently understates, and understating is how a rising line gets
 * reported as a falling one. */
export function windowTotal(
  series: Array<number | null>,
  from: number,
  to: number,
): number | null {
  if (from < 0 || to > series.length) return null

  let total = 0

  for (let index = from; index < to; index += 1) {
    const value = series[index]

    if (value === null || value === undefined) return null

    total += value
  }

  return total
}

export function last12(series: Array<number | null>): number | null {
  return windowTotal(series, series.length - 12, series.length)
}

/*
 * Twelve months against the twelve before them.
 *
 * Not "latest month against the same month last year", which on a monthly
 * customs series is mostly noise - a single shipment lands or it does not.
 * Rolling twelve-month totals are what a reader means by "is this growing".
 * Returns null unless both windows are complete, because a part-year compared
 * against a full one always looks like a collapse.
 */
export function rollingChange(series: Array<number | null>): number | null {
  if (series.length < 24) return null

  const end = series.length
  const recent = windowTotal(series, end - 12, end)
  const prior = windowTotal(series, end - 24, end - 12)

  if (recent === null || prior === null || prior === 0) return null

  return (recent - prior) / prior
}

/*
 * India's financial year, April to March, named the way India names it.
 *
 * Calendar totals are what Comtrade publishes and what the rest of the
 * dashboard compares against; financial years are what an Indian reader of a
 * monthly customs series expects to see. Both are offered, and neither is
 * converted into the other. A year is marked incomplete when the source has
 * not filed all twelve of its months - that is the ordinary state of the
 * current year, and a figure that does not say so invites a reader to compare
 * four months against twelve.
 */
export type PeriodTotal = {
  label: string
  total: number
  months: number
  complete: boolean
}

export function financialYears(
  series: Array<number | null>,
  periods: string[],
): PeriodTotal[] {
  const buckets = new Map<string, { total: number; months: number }>()

  periods.forEach((period, position) => {
    const value = series[position]

    if (value === null || value === undefined) return

    const year = Number(period.slice(0, 4))
    const month = Number(period.slice(5, 7))
    const start = month >= 4 ? year : year - 1
    const label = `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`

    const bucket = buckets.get(label) ?? { total: 0, months: 0 }

    bucket.total += value
    bucket.months += 1
    buckets.set(label, bucket)
  })

  return [...buckets.entries()]
    .map(([label, bucket]) => ({
      label,
      total: bucket.total,
      months: bucket.months,
      complete: bucket.months === 12,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function calendarYears(
  series: Array<number | null>,
  periods: string[],
): PeriodTotal[] {
  const buckets = new Map<string, { total: number; months: number }>()

  periods.forEach((period, position) => {
    const value = series[position]

    if (value === null || value === undefined) return

    const label = period.slice(0, 4)
    const bucket = buckets.get(label) ?? { total: 0, months: 0 }

    bucket.total += value
    bucket.months += 1
    buckets.set(label, bucket)
  })

  return [...buckets.entries()]
    .map(([label, bucket]) => ({
      label,
      total: bucket.total,
      months: bucket.months,
      complete: bucket.months === 12,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/*
 * What share of its heading a tariff line is.
 *
 * Over a stated window, and only when the window is complete for both - a
 * share computed from a line with eleven months against a heading with twelve
 * is not a share of anything. Returns null rather than a number that would
 * be quoted.
 */
export function shareOfParent(
  line: Array<number | null>,
  parent: Array<number | null>,
  months = 12,
): number | null {
  const end = Math.min(line.length, parent.length)

  const part = windowTotal(line, end - months, end)
  const whole = windowTotal(parent, end - months, end)

  if (part === null || whole === null || whole <= 0) return null

  return part / whole
}

export function formatPeriod(period: string | null): string {
  if (!period) return '—'

  const [year, month] = period.split('-')

  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]

  return `${names[Number(month) - 1] ?? month} ${year}`
}

/*
 * A tariff line's month, at whatever size it happens to be.
 *
 * These span six orders of magnitude - $2,977 million of smartphones next to
 * $0.04 million of some connector - and one fixed precision cannot serve
 * both. Rounding the small ones to a single decimal printed "0" against a
 * month that did trade, which reads as nothing happened rather than as very
 * little did.
 */
export function formatValue(value: number | null): string {
  if (value === null || value === undefined) return '—'

  if (value === 0) return '0'

  if (Math.abs(value) < 0.01) return '<0.01'

  const places = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 1 ? 1 : 2

  return value.toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}

/*
 * Tariff lines as rows, for a file rather than a screen.
 *
 * One builder, used by both the panel's CSV button and the product
 * workbook's sheet, so the two can never disagree about what a column means.
 *
 * Long format - one row per flow, line and month - rather than a grid. A grid
 * of 90 month columns is unreadable and unpivotable; this sorts, filters and
 * pivots in any spreadsheet, and every row carries its own flow so no row can
 * be read out of context once someone sorts the sheet.
 *
 * Reporter and partner ride on every row for the same reason. A file outlives
 * the page it came from: it gets mailed on, pasted into a deck, opened in six
 * months by someone who was not here. "World" in a partner column has cost
 * people money before, so it is spelled out next to the word India rather
 * than left to a header a reader may never scroll back to.
 */
export function exportRows(node: DgcisNode | null): Record<string, unknown>[] {
  if (!node) return []

  const rows: Record<string, unknown>[] = []
  const described = new Map(node.lines.map(line => [line.hs8, line]))

  for (const flow of flowsOf(node)) {
    const block = node.flows[flow]

    if (!block) continue

    for (const hs8 of Object.keys(block.series).sort()) {
      const series = block.series[hs8]
      const line = described.get(hs8)

      node.periods.forEach((period, position) => {
        const inr = series.inrCrore[position]
        const usd = series.usdMillion[position]

        /* A month the source never filed is not a row. A month it filed as
         * zero is. */
        if (inr === null && usd === null) return

        rows.push({
          Reporter: node.reporter,
          Partner: node.partner,
          Flow: flowWord(flow),
          'HS-6': node.hs6,
          'HS-8': hs8,
          'DGCIS commodity group': line?.principalCommodity ?? '',
          'Quick estimate group': line?.quickEstimateCommodity ?? '',
          Month: period,
          'Value (INR crore)': inr,
          'Value (USD million)': usd,
        })
      })
    }
  }

  return rows
}

/* The lines a file must carry with these rows, wherever they end up. */
export const EXPORT_NOTES = [
  'India HS-8 rows are DGCIS / Trade Intelligence & Analytics: India reporting ' +
    'its own trade with the World partner aggregate. Partner "World" does not ' +
    'mean world trade.',
  'INR crore and USD million are both filed by DGCIS and are never converted ' +
    'between each other. Neither can be used to derive an exchange rate.',
  'DGCIS months are calendar-dated and are not comparable with, or addable to, ' +
    'the UN Comtrade sheets beside them.',
]

/*
 * How to write a tariff line in a sentence or a list.
 *
 * Always the code, because that is the part that is unique. The name, when
 * there is one, follows it. When there is not, the caller shows the heading
 * separately and labelled - never glued on as though it were this line's name.
 */
export function lineRef(line: { hs8: string; title?: string }): string {
  return line.title ? `${line.hs8} — ${line.title}` : line.hs8
}

export function unitLabel(basis: DgcisBasis): string {
  return basis === 'usd' ? 'USD mn' : 'INR cr'
}

/*
 * How precise is this line's name?
 *
 * Shown wherever a tariff line is titled, because a page called "Network
 * switches and routers" that is one of eight such pages must not read as the
 * name of that one line. When the real schedule lands this returns null and
 * the caveat disappears on its own.
 */
export function nameCaveat(line: { nameSource?: string }): string | null {
  if (!line.nameSource || line.nameSource === 'schedule') return null

  return (
    'India’s eight-digit schedule has no name for this code, so the line is ' +
    'shown by its code. The name beside it belongs to the heading, not to ' +
    'this line.'
  )
}

/* Said the same way everywhere, because this is the word that was wrong. */
export function flowPhrase(flow: DgcisFlow): string {
  return flow === 'exports'
    ? 'India’s exports to the world'
    : 'India’s imports from the world'
}

export function flowWord(flow: DgcisFlow): string {
  return flow === 'exports' ? 'Exports' : 'Imports'
}
