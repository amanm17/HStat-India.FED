/*
 * India's own tariff-line detail, from DGCIS.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 *
 * Every other number on a product page comes from UN Comtrade: the world's
 * imports of an HS-6 line, summed across reporting economies. This one does
 * not. It is India's customs authority reporting India's own imports from the
 * World partner aggregate, at the Indian eight-digit tariff line, monthly.
 *
 * The partner is called "World" in the source, and that word has cost people
 * money before. It does not mean world trade. It means India, importing, from
 * everywhere. A page that shows both must never let one be read as the other,
 * which is why this loads separately, renders in its own panel, and is
 * labelled with its reporter and partner every time it appears.
 *
 * Periods are monthly and calendar-dated; Comtrade's are annual. They are not
 * plotted together.
 */

export type DgcisChild = {
  hs8: string
  /* DGCIS's own commodity groupings. The extract carries no tariff-line
   * description, and one is not invented here. */
  principalCommodity: string
  quickEstimateCommodity: string
  /* Aligned to `periods`. null is a month the source left blank, which is not
   * the same as a month of zero trade. */
  inrCrore: Array<number | null>
  usdMillion: Array<number | null>
}

export type DgcisNode = {
  hs6: string
  source: string
  reporter: string
  partner: string
  flow: string
  units: { inrCrore: string; usdMillion: string }
  /* False for an HS-6 carried only as a lineage predecessor, whose tariff
   * lines are real India history with no product page of their own. */
  isProduct: boolean
  periods: string[]
  latestPeriod: string | null
  children: DgcisChild[]
}

export type DgcisManifest = {
  source: string
  builtAt: string
  reporter: string
  partner: string
  flow: string
  firstPeriod: string
  lastPeriod: string
  hs8Count: number
  productsCovered: number
  productsTotal: number
  coveredHs6: string[]
  predecessorHs6: string[]
}

const BASE = '/data/dgcis'

/*
 * A miss is the normal case, not an error.
 *
 * The extract covers 251 of 418 products. A page with no DGCIS file is not
 * broken and must not announce anything; it simply has no tariff-line detail
 * to show. So this returns null rather than throwing, and the panel that
 * calls it renders nothing.
 */
export async function loadDgcis(hs6: string): Promise<DgcisNode | null> {
  try {
    const response = await fetch(`${BASE}/hs6/${hs6}.json`, { cache: 'no-cache' })

    if (!response.ok) return null

    return (await response.json()) as DgcisNode
  } catch {
    return null
  }
}

export async function loadDgcisManifest(): Promise<DgcisManifest | null> {
  try {
    const response = await fetch(`${BASE}/manifest.json`, { cache: 'no-cache' })

    if (!response.ok) return null

    return (await response.json()) as DgcisManifest
  } catch {
    return null
  }
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

  const window = (from: number, to: number) => {
    let total = 0
    let seen = 0

    for (let index = from; index < to; index += 1) {
      const value = series[index]

      if (value !== null && value !== undefined) {
        total += value
        seen += 1
      }
    }

    return seen === to - from ? total : null
  }

  const end = series.length
  const recent = window(end - 12, end)
  const prior = window(end - 24, end - 12)

  if (recent === null || prior === null || prior === 0) return null

  return (recent - prior) / prior
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
