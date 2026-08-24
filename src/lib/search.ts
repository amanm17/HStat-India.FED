import type {
  SearchItem,
} from '../types'


export type SearchResult = {
  item: SearchItem
  score: number
  reason: string
}


export function normalizeQuery(
  value: string,
) {
  return value
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
}


export function searchHs(
  library: SearchItem[],
  query: string,
): SearchResult[] {
  const q =
    normalizeQuery(query)

  if (!q)
    return []

  const numeric =
    /^\d+$/.test(q)

  const tokens =
    q.split(' ')
      .filter(Boolean)

  return library
    .map(item => {
      let score = 0

      let reason =
        'Description'

      const description =
        normalizeQuery(
          item.description
        )

      const tags =
        item.tags.map(
          normalizeQuery
        )

      const searchText =
        normalizeQuery(
          item.searchText
        )


      // Numeric hierarchy

      if (
        numeric
        && item.code === q
      ) {
        score += 10000
        reason =
          'Exact HS code'
      }

      else if (
        numeric
        && item.code.startsWith(
          q
        )
      ) {
        score += 7000

        reason =
          `HS-${item.level} match`
      }

      else if (
        numeric
        && q.startsWith(
          item.code
        )
      ) {
        score += 4500

        reason =
          `Parent HS-${item.level}`
      }


      if (
        numeric
        && !(
          item.code.startsWith(q)
          || q.startsWith(
            item.code
          )
        )
      ) {
        return {
          item,
          score: 0,
          reason,
        }
      }


      // Smart product terminology

      if (
        tags.includes(q)
      ) {
        score += 5000

        reason =
          'Smart product match'
      }

      if (
        description === q
      ) {
        score += 4000

        reason =
          'Exact description'
      }

      if (
        description.includes(q)
      ) {
        score += 2000
      }

      if (
        searchText.includes(q)
      ) {
        score += 1200
      }


      for (
        const token
        of tokens
      ) {
        if (
          tags.includes(token)
        ) {
          score += 900
        }

        else if (
          tags.some(
            tag =>
              tag.includes(
                token
              )
          )
        ) {
          score += 350
        }

        if (
          description.includes(
            token
          )
        ) {
          score += 250
        }
      }


      if (item.loaded)
        score += 300


      return {
        item,
        score,
        reason,
      }
    })

    .filter(
      result =>
        result.score > 0
    )

    .sort(
      (a, b) => {
        if (
          b.score !==
          a.score
        ) {
          return (
            b.score -
            a.score
          )
        }

        return (
          a.item.level -
          b.item.level
        )
      }
    )

    .slice(0, 12)
}


const RECENT_KEY =
  'hstat-recent-searches'


export function
readRecentSearches():
string[] {
  try {
    const value =
      localStorage.getItem(
        RECENT_KEY
      )

    if (!value)
      return []

    const parsed =
      JSON.parse(value)

    return Array.isArray(
      parsed
    )
      ? parsed.slice(0, 6)
      : []
  }
  catch {
    return []
  }
}


export function
saveRecentSearch(
  value: string,
) {
  const clean =
    value.trim()

  if (!clean)
    return

  const next = [
    clean,

    ...readRecentSearches()
      .filter(
        item =>
          item !== clean
      ),

  ].slice(0, 6)

  localStorage.setItem(
    RECENT_KEY,
    JSON.stringify(next),
  )
}
