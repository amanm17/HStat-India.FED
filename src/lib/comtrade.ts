/*
 * The four UN Comtrade requests behind a published figure.
 *
 * Two dimensions, four combinations: imports against re-imports, and the
 * world against India. The published figure is world imports minus world
 * re-imports, and India's rank and share come from the other two, so all four
 * are needed to check the arithmetic and they are never merged into one link.
 *
 * These open UN Comtrade's public preview endpoint - the one the official
 * comtradeapicall package falls back to when no subscription key is supplied.
 * No key, no account. It answers with JSON; for a spreadsheet, the query page
 * linked at the foot of the panel runs the same selection and downloads the
 * result.
 */

export const COMTRADE_PREVIEW_BASE =
  'https://comtradeapi.un.org/public/v1/preview/C/A/HS'

/* UN Comtrade's free query page, where a selection can be run and the result
 * downloaded. Not /BulkFiles - that tier is a paid subscription. */
export const COMTRADE_QUERY_PAGE = 'https://comtradeplus.un.org/TradeFlow'

/* Comtrade's own reporter code for India. */
export const INDIA_REPORTER = '699'

export type ComtradeFlow = 'M' | 'RM'

export type ComtradeQuery = {
  code: string
  year: number
  flow: ComtradeFlow
  /* Absent means every reporting economy, which is what a world total is. */
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
 * spells in lower case. Spelled `reporterCode` it is ignored and you get every
 * reporter instead of the one you asked for.
 *
 * EMPTY IS NOT ABSENT: the official client drops every parameter whose value
 * is None before sending (PreviewGet.py: `fields = dict(filter(lambda item:
 * item[1] is not None, PARAMS.items()))`). A world query has no reporter, so
 * the key is omitted entirely. Sending `reportercode=` instead tells the API
 * the reporter is the empty string rather than not telling it at all, and it
 * does not answer that the same way.
 *
 * partner2Code, customsCode and motCode pin the request to a single aggregate
 * row. Without them Comtrade also returns the second-partner, customs and
 * mode-of-transport breakdowns of the same trade, and summing what comes back
 * counts it more than once.
 */
export function comtradeUrl(query: ComtradeQuery): string {
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

  const search = pairs
    .filter((pair): pair is [string, string] => !!pair[1])
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  return `${COMTRADE_PREVIEW_BASE}?${search}`
}

export function datasetsFor(code: string, year: number): ComtradeDataset[] {
  return [
    {
      id: 'world-imports',
      label: 'World imports',
      note: 'Every reporting economy’s imports from the World',
      query: { code, year, flow: 'M' },
    },
    {
      id: 'world-reimports',
      label: 'World re-imports',
      note: 'Subtracted reporter by reporter to give the net figure',
      query: { code, year, flow: 'RM' },
    },
    {
      id: 'india-imports',
      label: 'India imports',
      note: 'India’s own filing, behind its rank and share',
      query: { code, year, flow: 'M', reporter: INDIA_REPORTER },
    },
    {
      id: 'india-reimports',
      label: 'India re-imports',
      note: 'Netted off the figure above',
      query: { code, year, flow: 'RM', reporter: INDIA_REPORTER },
    },
  ]
}
