/*
 * Sectors: published groupings of HS-6 lines with their own totals.
 *
 * A sector is a lens, not a stream (lib/streams.ts). A stream says which
 * figures a line is added into, and each line has one. A sector may take
 * lines from any stream: capital goods holds its own 370 lines plus 66
 * machines and instruments that are also electronics or electronics inputs.
 * Its totals are its own file and never move an electronics figure.
 *
 *   sectors.json          the sectors in this snapshot, with their groups
 *   sector-<id>.json      one sector's totals, year by year (the same shape
 *                         as scope.json)
 *
 * Both are absent from a snapshot built before sectors existed; every reader
 * treats that as "no sectors".
 */
import type { ScopeSummary } from './scope'

const BASE = '/data/snapshots'

export type SectorGroups = {
  /* group name -> member HS-6 codes */
  broadCategory?: Record<string, string[]>
  nicheCategory?: Record<string, string[]>
  scomet?: Record<string, string[]>
}

export type SectorInfo = {
  id: string
  label: string
  note: string
  lines: number
  historyStart: number | null
  streams: Record<string, number>
  groups: SectorGroups
}

const cache = new Map<string, Promise<unknown>>()

async function getOptional<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: 'no-cache' })

    if (!response.ok) return null

    return (await response.json()) as T
  } catch {
    return null
  }
}

function cached<T>(key: string, url: string): Promise<T | null> {
  const existing = cache.get(key)

  if (existing) return existing as Promise<T | null>

  const request = getOptional<T>(url)

  cache.set(key, request)

  return request
}

export function loadSectors(snapshot: string): Promise<SectorInfo[]> {
  return cached<{ sectors: SectorInfo[] }>(`${snapshot}:sectors`, `${BASE}/${snapshot}/sectors.json`).then(
    result => result?.sectors ?? [],
  )
}

export function loadSectorScope(snapshot: string, id: string): Promise<ScopeSummary | null> {
  return cached<ScopeSummary>(`${snapshot}:sector:${id}`, `${BASE}/${snapshot}/sector-${id}.json`)
}
