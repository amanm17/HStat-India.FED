import type {
  Product,
  SearchItem,
} from '../types'

const BASE = '/data/snapshots'

async function getJson<T>(
  url: string
): Promise<T> {
  const response =
    await fetch(
      url,
      {
        cache: 'no-cache',
      }
    )

  if (!response.ok) {
    throw new Error(
      `${response.status} ${url}`
    )
  }

  return response.json()
}

export async function loadManifest() {
  try {
    return {
      manifest:
        await getJson<any>(
          `${BASE}/current/manifest.json`
        ),
      snapshot:
        'current' as const,
    }
  } catch {
    return {
      manifest:
        await getJson<any>(
          `${BASE}/previous/manifest.json`
        ),
      snapshot:
        'previous' as const,
    }
  }
}

export async function loadCatalogue(
  snapshot: string
) {
  return getJson<any[]>(
    `${BASE}/${snapshot}/catalogue.json`
  )
}

export async function loadProduct(
  snapshot: string,
  hs6: string
): Promise<Product> {
  const raw =
    await getJson<any>(
      `${BASE}/${snapshot}/products/${hs6}.json`
    )

  return {
    ...raw,
    level: 6,
    code: raw.hs6 ?? hs6,
    hs6: raw.hs6 ?? hs6,
  } as Product
}

export async function loadHsNode(
  snapshot: string,
  code: string,
  level: 2 | 4 | 6
): Promise<Product> {
  if (level === 6) {
    return loadProduct(
      snapshot,
      code
    )
  }

  const raw =
    await getJson<any>(
      `${BASE}/${snapshot}/parents/${level}/${code}.json`
    )

  return {
    ...raw,

    level,
    code,

    /*
     * Temporary compatibility alias for existing
     * dashboard sections that still read product.hs6.
     * Batch C removes those visual HS-6 assumptions.
     */
    hs6: code,
  } as Product
}

export async function loadSearch():
  Promise<SearchItem[]> {
  try {
    return await getJson<SearchItem[]>(
      '/data/hs-library.json'
    )
  } catch {
    return []
  }
}
