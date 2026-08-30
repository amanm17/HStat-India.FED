import type { SearchItem } from '../types'

/*
 * Search has two jobs that pull in opposite directions.
 *
 *   Someone types "laptop". They do not want a ranked list of six-digit
 *   codes to choose between — they want to be told, plainly and once,
 *   that laptops are HS 847130, and to be able to trust it.
 *
 *   Someone types "847130". They want the opposite: what is actually
 *   inside this code, in the words they would use for the products.
 *
 * So the engine returns an `answer` — a single confident statement — and
 * a supporting list, rather than one undifferentiated ranked list.
 */

export type Answer = {
  /* The everyday word the user typed, as matched. */
  term: string
  item: SearchItem
  note: string
  confidence: 'exact' | 'strong'
}

export type SearchResult = {
  item: SearchItem
  score: number
  reason: string
}

export type SearchOutcome = {
  query: string
  kind: 'code' | 'product' | 'empty'
  answer: Answer | null
  results: SearchResult[]
  /* Other codes that also carry the searched term, for disambiguation. */
  alsoIn: SearchItem[]
}

export type SearchIndex = {
  items: SearchItem[]
  answers: Map<string, SearchItem[]>
  terms: Map<string, SearchItem[]>
}

export function normalizeQuery(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pushTo(map: Map<string, SearchItem[]>, key: string, item: SearchItem) {
  const bucket = map.get(key)

  if (bucket) {
    bucket.push(item)
  } else {
    map.set(key, [item])
  }
}

/*
 * A code that trades more is the more likely thing someone means. "Battery"
 * should land on lithium-ion cells, not on lead-acid inverter batteries.
 */
function weight(item: SearchItem): number {
  return item.worldExportsUsdBn ?? 0
}

function preferSpecific(a: SearchItem, b: SearchItem): number {
  if (a.level !== b.level) return b.level - a.level

  if (a.inFedDefinition !== b.inFedDefinition) {
    return a.inFedDefinition ? -1 : 1
  }

  return weight(b) - weight(a)
}

export function buildIndex(items: SearchItem[]): SearchIndex {
  const answers = new Map<string, SearchItem[]>()

  const terms = new Map<string, SearchItem[]>()

  for (const item of items) {
    for (const term of item.answerTerms ?? []) {
      pushTo(answers, normalizeQuery(term), item)
    }

    for (const term of item.terms ?? []) {
      pushTo(terms, normalizeQuery(term), item)
    }
  }

  for (const bucket of answers.values()) bucket.sort(preferSpecific)

  for (const bucket of terms.values()) bucket.sort(preferSpecific)

  return { items, answers, terms }
}

function codeResults(index: SearchIndex, query: string): SearchResult[] {
  const results: SearchResult[] = []

  for (const item of index.items) {
    if (item.code === query) {
      results.push({ item, score: 10000, reason: `HS-${item.level} code` })
      continue
    }

    if (item.code.startsWith(query)) {
      // A more specific code under the one typed.
      results.push({
        item,
        score: 7000 - (item.level - query.length) * 10,
        reason: `Inside HS ${query}`,
      })
      continue
    }

    if (query.startsWith(item.code)) {
      results.push({
        item,
        score: 4000 + item.level,
        reason: `Contains HS ${query}`,
      })
    }
  }

  return results.sort((a, b) => b.score - a.score || preferSpecific(a.item, b.item))
}

function productResults(
  index: SearchIndex,
  query: string,
  tokens: string[],
): SearchResult[] {
  const scores = new Map<string, { item: SearchItem; score: number; reason: string }>()

  const bump = (item: SearchItem, points: number, reason: string) => {
    const existing = scores.get(item.code)

    if (existing) {
      existing.score += points

      if (points >= 2000) existing.reason = reason

      return
    }

    scores.set(item.code, { item, score: points, reason })
  }

  for (const item of index.answers.get(query) ?? []) {
    bump(item, 12000, 'Best match for this product')
  }

  for (const item of index.terms.get(query) ?? []) {
    bump(item, 5000, 'Product term')
  }

  // Partial typing: "lapt" should still find laptops. A prefix match is
  // weighted by how much of the term the query actually covers, so
  // "air conditioner" prefers "air conditioners" over
  // "air conditioner parts" rather than treating the two as equal.
  if (query.length >= 3) {
    for (const [term, items] of index.terms) {
      if (term === query || !term.startsWith(query)) continue

      const closeness = query.length / term.length

      for (const item of items) {
        bump(item, Math.round(1600 * closeness), 'Product term')
      }
    }
  }

  for (const item of index.items) {
    const description = normalizeQuery(item.description)

    // A parent's `product` field is a digest of its members' names, so
    // matching on it would let a chapter outrank the specific code the
    // product actually sits in.
    const product = item.level === 6 ? normalizeQuery(item.product) : ''

    if (product && product === query) bump(item, 6000, 'Product name')
    else if (product && product.includes(query)) bump(item, 2200, 'Product name')

    if (description.includes(query)) bump(item, 900, 'Description')

    for (const token of tokens) {
      if (token.length < 3) continue

      if (product.includes(token)) bump(item, 400, 'Product name')

      if (description.includes(token)) bump(item, 160, 'Description')

      if (normalizeQuery(item.category).includes(token)) {
        bump(item, 320, 'Category')
      }
    }
  }

  const results = [...scores.values()]

  for (const result of results) {
    // Core FED scope first, then by how much the code actually trades.
    if (result.item.inFedDefinition) result.score += 250

    result.score += Math.min(weight(result.item), 400)

    if (result.item.level === 6) result.score += 120
  }

  return results.sort(
    (a, b) => b.score - a.score || preferSpecific(a.item, b.item),
  )
}

export function search(
  index: SearchIndex,
  rawQuery: string,
  limit = 12,
): SearchOutcome {
  const query = normalizeQuery(rawQuery)

  if (!query) {
    return { query, kind: 'empty', answer: null, results: [], alsoIn: [] }
  }

  const numeric = /^\d+$/.test(query)

  if (numeric) {
    const results = codeResults(index, query).slice(0, limit)

    const exact = results.find(result => result.item.code === query)

    return {
      query,
      kind: 'code',
      answer: exact
        ? {
            term: query,
            item: exact.item,
            note: exact.item.answerNote,
            confidence: 'exact',
          }
        : null,
      results,
      alsoIn: [],
    }
  }

  const tokens = query.split(' ').filter(Boolean)

  const results = productResults(index, query, tokens)

  const answerCandidates = index.answers.get(query) ?? []

  let answer: Answer | null = null

  if (answerCandidates.length) {
    const item = answerCandidates[0]

    answer = {
      term: query,
      item,
      note: item.answerNote,
      confidence: 'exact',
    }
  } else if (
    results.length &&
    results[0].score >= 5000 &&
    (results.length === 1 || results[0].score >= results[1].score * 1.6)
  ) {
    // No curated answer, but one code stands clear of the field.
    answer = {
      term: query,
      item: results[0].item,
      note: results[0].item.answerNote,
      confidence: 'strong',
    }
  }

  const alsoIn = answer
    ? index.terms
        .get(query)
        ?.filter(item => item.code !== answer!.item.code)
        .slice(0, 4) ?? []
    : []

  return {
    query,
    kind: 'product',
    answer,
    results: results.slice(0, limit),
    alsoIn,
  }
}

/*
 * The everyday words the index knows about, for the suggestion chips.
 * Sorted so the biggest traded products lead.
 */
export function suggestedTerms(index: SearchIndex, count = 10): string[] {
  const seen = new Set<string>()

  const ranked = [...index.items]
    .filter(item => item.level === 6 && item.answerTerms?.length)
    .sort((a, b) => weight(b) - weight(a))

  const output: string[] = []

  for (const item of ranked) {
    const term = item.answerTerms[0]

    if (!term || seen.has(term)) continue

    seen.add(term)

    output.push(term)

    if (output.length >= count) break
  }

  return output
}

const RECENT_KEY = 'hstat-recent-searches'

export function readRecentSearches(): string[] {
  try {
    const value = localStorage.getItem(RECENT_KEY)

    if (!value) return []

    const parsed = JSON.parse(value)

    return Array.isArray(parsed) ? parsed.slice(0, 6) : []
  } catch {
    return []
  }
}

export function saveRecentSearch(value: string) {
  const clean = value.trim()

  if (!clean) return

  try {
    const next = [
      clean,
      ...readRecentSearches().filter(item => item !== clean),
    ].slice(0, 6)

    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* Private browsing and blocked site data are not errors here. */
  }
}
