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
 * Note the casing: every parameter is camelCase except `reportercode`, which
 * the API spells in lower case. Getting it wrong silently returns every
 * reporter rather than the one asked for, which is the worst kind of wrong -
 * it still looks like an answer.
 */
export function comtradeParams(query: ComtradeQuery): Array<[string, string]> {
  return [
    ['reportercode', query.reporter ?? ''],
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

  return rows.map(([key, value]) => `${key}: ${value}`).join('\n')
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
