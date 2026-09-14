/*
 * Public UN Comtrade source links.
 *
 * WHY THIS SHAPE, AND NOT A DOWNLOAD
 *
 * There is exactly one UN Comtrade endpoint that answers without a
 * subscription key, and it is the one the official `comtradeapicall` package
 * falls back to when no key is supplied (PreviewGet.py, getPreviewData):
 *
 *     https://comtradeapi.un.org/public/v1/preview/{type}/{freq}/{classification}
 *
 * It returns JSON, is capped at 500 records, and has no CSV form - the package
 * prints "Only JSON output is supported with this function" for anything else.
 * There is no public bulk-file endpoint, and comtradeplus.un.org is a
 * client-rendered application whose deep-link behaviour could not be verified,
 * so nothing here claims to pre-fill its query builder.
 *
 * So this module builds links, not downloads. Every URL it produces is the
 * exact query the pipeline itself used for that code, year and flow, and
 * opening one shows the same rows the published figure was summed from.
 *
 * THE PINNED DIMENSIONS MATTER
 *
 * partner2Code=0, customsCode=C00 and motCode=0 pin the request to the single
 * aggregate row. Leave them off and Comtrade also returns the second-partner,
 * customs-procedure and mode-of-transport breakdowns of the same trade, and
 * summing what comes back double counts it. They are not decoration.
 */

export const COMTRADE_PREVIEW_BASE =
  'https://comtradeapi.un.org/public/v1/preview/C/A/HS'

export const COMTRADE_PORTAL = 'https://comtradeplus.un.org'

/* Comtrade's own reporter code for India. */
export const INDIA_REPORTER = '699'

/* The public preview endpoint stops at 500 rows. A world-partner year is one
 * row per reporting economy - about 170 at most - so it fits, but a reader
 * should know the ceiling exists. */
export const PREVIEW_RECORD_CAP = 500

export type ComtradeFlow = 'M' | 'RM' | 'X' | 'RX'

export type ComtradeQuery = {
  code: string
  year: number
  flow: ComtradeFlow
  /* Empty means every reporting economy, which is what a world total is. */
  reporter?: string
}

export type ComtradeDataset = {
  id: string
  label: string
  note: string
  query: ComtradeQuery
}

/*
 * Two ways to get this wrong, both of which still return something.
 *
 * CASING: every parameter is camelCase except `reportercode`, which the API
 * spells in lower case. Spelled `reporterCode` it is ignored, and you get
 * every reporter instead of the one you asked for.
 *
 * EMPTY IS NOT ABSENT: the official client builds its parameters and then
 * drops every one whose value is None (PreviewGet.py: `fields = dict(filter(
 * lambda item: item[1] is not None, PARAMS.items()))`). A world query has no
 * reporter, so the key is omitted from the request entirely. Sending
 * `reportercode=` instead is a different request - the API is being told the
 * reporter is the empty string rather than not being told at all - and it
 * does not answer it the same way.
 */
export function comtradeParams(query: ComtradeQuery): Array<[string, string]> {
  const pairs: Array<[string, string | undefined]> = [
    ['reportercode', query.reporter],
    ['flowCode', query.flow],
    ['period', String(query.year)],
    ['cmdCode', query.code],
    ['partnerCode', '0'],
    ['partner2Code', '0'],
    ['customsCode', 'C00'],
    ['motCode', '0'],
    ['breakdownMode', 'classic'],
    ['includeDesc', 'True'],
  ]

  return pairs.filter(
    (pair): pair is [string, string] =>
      pair[1] !== undefined && pair[1] !== '',
  )
}

export type ComtradeRow = Record<string, unknown>

export type ComtradeResult =
  | { ok: true; rows: ComtradeRow[] }
  | { ok: false; reason: string }

/*
 * Fetch one query and hand back its rows.
 *
 * This is a cross-origin request to a server we do not control, so it can
 * fail in a way no amount of correctness on our side prevents: if UN Comtrade
 * does not send the CORS headers, the browser refuses the response before the
 * page ever sees it. That is not something to paper over with a fabricated
 * file - the point of this panel is to hand over the actual source - so a
 * refusal is reported as a refusal, and the query link remains.
 */
export async function fetchComtrade(
  query: ComtradeQuery,
): Promise<ComtradeResult> {
  let response: Response

  try {
    response = await fetch(comtradeUrl(query), {
      headers: { accept: 'application/json' },
    })
  } catch {
    return {
      ok: false,
      reason:
        'Your browser could not reach UN Comtrade directly. This is usually ' +
        'a cross-origin restriction on their server rather than a fault in ' +
        'the query. Open query still works, and Copy spec reproduces it in ' +
        'Comtrade’s own interface.',
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: `UN Comtrade answered ${response.status} ${response.statusText}.`,
    }
  }

  let payload: { data?: ComtradeRow[]; count?: number } | null = null

  try {
    payload = await response.json()
  } catch {
    return { ok: false, reason: 'UN Comtrade returned something that is not JSON.' }
  }

  const rows = payload?.data ?? []

  if (!rows.length) {
    return {
      ok: false,
      reason:
        'UN Comtrade returned no rows for this query. The code may not have ' +
        'been reported for this year.',
    }
  }

  return { ok: true, rows }
}

/* A stable, self-describing file name: what, which flow, which year. */
export function fileNameFor(dataset: ComtradeDataset): string {
  return `comtrade-${dataset.query.code}-${dataset.query.year}-${dataset.id}`
}

export function comtradeUrl(query: ComtradeQuery): string {
  const search = comtradeParams(query)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  return `${COMTRADE_PREVIEW_BASE}?${search}`
}

/* The same query as a block a reader can paste into Comtrade's own query
 * builder, or into a script, without reverse-engineering it from the URL. */
export function comtradeSpec(query: ComtradeQuery): string {
  const rows: Array<[string, string]> = [
    ['Type', 'C — commodities'],
    ['Frequency', 'A — annual'],
    ['Classification', 'HS'],
    ['Commodity code', query.code],
    ['Period', String(query.year)],
    ['Flow', flowLabel(query.flow)],
    ['Reporter', query.reporter ? `${query.reporter} — India` : 'All'],
    ['Partner', '0 — World'],
    ['2nd partner', '0 — World (aggregate)'],
    ['Customs', 'C00 — TOTAL'],
    ['Mode of transport', '0 — TOTAL'],
  ]

  return [
    ...rows.map(([key, value]) => `${key}: ${value}`),
    '',
    'Direct URL (public, no key required):',
    comtradeUrl(query),
  ].join('\n')
}

export function flowLabel(flow: ComtradeFlow): string {
  return flow === 'M'
    ? 'M — imports'
    : flow === 'RM'
      ? 'RM — re-imports'
      : flow === 'X'
        ? 'X — exports'
        : 'RX — re-exports'
}

/*
 * The four requests behind a published figure.
 *
 * Imports and re-imports are listed separately and never as one dataset,
 * because the published global figure is the first minus the second and a
 * reader checking the arithmetic needs both sides of it.
 */
export function datasetsFor(code: string, year: number): ComtradeDataset[] {
  return [
    {
      id: 'world-imports',
      label: 'World imports',
      note: 'Every reporting economy’s imports from the World. Summed, this is the gross figure.',
      query: { code, year, flow: 'M' },
    },
    {
      id: 'world-reimports',
      label: 'World re-imports',
      note: 'The same economies’ re-imports, subtracted reporter by reporter to give the net figure.',
      query: { code, year, flow: 'RM' },
    },
    {
      id: 'india-imports',
      label: 'India imports',
      note: 'India’s own filing, the row behind India’s rank and share.',
      query: { code, year, flow: 'M', reporter: INDIA_REPORTER },
    },
    {
      id: 'india-reimports',
      label: 'India re-imports',
      note: 'India’s re-imports, netted off the figure above.',
      query: { code, year, flow: 'RM', reporter: INDIA_REPORTER },
    },
  ]
}
