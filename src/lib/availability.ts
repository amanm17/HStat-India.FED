/*
 * What UN Comtrade holds, and what it costs us.
 *
 * Built by pipeline/comtrade/fetch_availability.py from Comtrade's public
 * availability endpoint - the same data behind their own DA Dashboard - and
 * then joined to our 418 products, which their page cannot do.
 *
 * Absent until that script has been run. Treated exactly like a missing DGCIS
 * file: the page says so and offers the command, rather than rendering an
 * empty frame or, worse, plausible-looking zeros.
 */
export type AvailabilityPeriod = {
  period: string
  reporters: number
  latestRelease: string | null
}

export type AvailabilityHole = {
  period: string
  reporter: string
  products: number
  priorValue: number
  sample: string[]
  filedSince: boolean
}

export type Availability = {
  source: string
  sourceUrl: string
  fetchedAt: string
  builtAt: string
  snapshotRefreshedAt: string | null
  annual: AvailabilityPeriod[]
  monthly: AvailabilityPeriod[]
  holes: AvailabilityHole[]
  productsTotal: number
}

let cached: Promise<Availability | null> | null = null

export function loadAvailability(): Promise<Availability | null> {
  if (!cached) {
    cached = fetch('/data/availability.json', { cache: 'no-cache' })
      .then(response => (response.ok ? response.json() : null))
      .then(data =>
        data && Array.isArray(data.annual) && Array.isArray(data.holes)
          ? (data as Availability)
          : null,
      )
      .catch(() => null)
  }

  return cached
}

/*
 * Is a refresh due?
 *
 * Yes when Comtrade has released something after the date our snapshot was
 * built. That is the whole signal, and it is the one question this page exists
 * to answer - "is what I am looking at as good as it can be right now".
 */
export function refreshDue(data: Availability): { due: boolean; since: string | null } {
  if (!data.snapshotRefreshedAt) return { due: false, since: null }

  const built = data.snapshotRefreshedAt.slice(0, 10)

  const releases = [...data.annual, ...data.monthly]
    .map(row => row.latestRelease)
    .filter((value): value is string => !!value)
    .filter(value => value > built)
    .sort()

  return { due: releases.length > 0, since: releases[releases.length - 1] ?? null }
}

export function monthLabel(period: string): string {
  if (period.length !== 6) return period

  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  return `${names[Number(period.slice(4)) - 1] ?? period.slice(4)} ${period.slice(0, 4)}`
}
