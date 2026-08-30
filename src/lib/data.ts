import type {
  CatalogueEntry,
  HsNode,
  Manifest,
  Methodology,
  SearchItem,
} from '../types'

const BASE = '/data/snapshots'

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-cache' })

  if (!response.ok) {
    throw new Error(`${response.status} ${url}`)
  }

  return response.json()
}

export type SnapshotName = 'current' | 'previous'

export async function loadManifest(): Promise<{
  manifest: Manifest
  snapshot: SnapshotName
}> {
  try {
    return {
      manifest: await getJson<Manifest>(`${BASE}/current/manifest.json`),
      snapshot: 'current',
    }
  } catch {
    // A half-written `current` is the one failure mode that must not take
    // the dashboard down; the previous validated snapshot is still there.
    return {
      manifest: await getJson<Manifest>(`${BASE}/previous/manifest.json`),
      snapshot: 'previous',
    }
  }
}

export function loadCatalogue(snapshot: string) {
  return getJson<CatalogueEntry[]>(`${BASE}/${snapshot}/catalogue.json`)
}

export async function loadMethodology(
  snapshot: string,
): Promise<Methodology | null> {
  try {
    return await getJson<Methodology>(`${BASE}/${snapshot}/methodology.json`)
  } catch {
    return null
  }
}

export async function loadQa(snapshot: string) {
  try {
    return await getJson<{
      failures: unknown[]
      warnings: unknown[]
    }>(`${BASE}/${snapshot}/qa.json`)
  } catch {
    return null
  }
}

function nodeUrl(snapshot: string, code: string, level: 2 | 4 | 6) {
  return level === 6
    ? `${BASE}/${snapshot}/products/${code}.json`
    : `${BASE}/${snapshot}/parents/${level}/${code}.json`
}

/*
 * Nodes are immutable between refreshes, so a session never needs to
 * fetch one twice. HStack in particular reloads the same handful of
 * products every time the basket changes.
 */
const cache = new Map<string, Promise<HsNode>>()

export function loadHsNode(
  snapshot: string,
  code: string,
  level: 2 | 4 | 6,
): Promise<HsNode> {
  const key = `${snapshot}:${level}:${code}`

  const existing = cache.get(key)

  if (existing) return existing

  const request = getJson<HsNode>(nodeUrl(snapshot, code, level)).then(
    raw => ({ ...raw, level, code, hs6: raw.hs6 ?? code }) as HsNode,
  )

  cache.set(key, request)

  request.catch(() => cache.delete(key))

  return request
}

export function loadHsNodes(
  snapshot: string,
  entries: { code: string; level: 2 | 4 | 6 }[],
): Promise<HsNode[]> {
  return Promise.all(
    entries.map(entry => loadHsNode(snapshot, entry.code, entry.level)),
  )
}

export async function loadSearch(): Promise<SearchItem[]> {
  try {
    return await getJson<SearchItem[]>('/data/hs-library.json')
  } catch {
    return []
  }
}
