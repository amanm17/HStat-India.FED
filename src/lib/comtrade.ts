/*
 * The four UN Comtrade queries behind a published figure.
 *
 * Two dimensions, four combinations: imports against re-imports, and the
 * world against India. The published figure is world imports minus world
 * re-imports, and India's rank and share come from the other two, so all four
 * are offered separately - a reader checking the arithmetic needs both sides
 * of the subtraction, not one merged link.
 *
 * THE TEMPLATE IS COPIED, NOT INFERRED
 *
 * Every parameter below was taken from a working URL lifted out of Comtrade's
 * own address bar at the download step:
 *
 *   https://comtradeplus.un.org/TradeFlow?Type=C&Frequency=A&Classification=HS
 *     &Period=2020&Reporters=all&Partners=0&CommodityCodes=830120&Flows=M
 *     &Customs=C00&ModeOfTransport=0&secondPartner=0&AggregateBy=NONE
 *     &BreakdownMode=plus
 *
 * Name, order, casing and values are reproduced exactly; only Period,
 * CommodityCodes, Flows and Reporters vary. That matters more than it looks.
 * An earlier version of this file guessed at the shape and got it wrong in
 * seven ways at once - it dropped Type, Classification, Customs,
 * ModeOfTransport and secondPartner, spelled Period in lower case, and sent
 * AggregateBy=none where the page wants NONE. The page does not complain
 * about any of that. It just does not arrive where it was asked to.
 *
 * So: if this ever needs changing, change it the same way. Build the query by
 * hand on Comtrade, go as far as the download, copy the URL out of the
 * address bar, and template that. Do not reason about what the parameters
 * ought to be called.
 */

/* UN Comtrade's query page. Not /BulkFiles - that tier is a paid
 * subscription. */
export const COMTRADE_QUERY_PAGE = 'https://comtradeplus.un.org/TradeFlow'

/* Comtrade's own reporter code for India. */
export const INDIA_REPORTER = '699'

export type ComtradeFlow = 'M' | 'RM'

export type ComtradeQuery = {
  code: string
  year: number
  flow: ComtradeFlow
  /* 'all' is every reporting economy, which is what a world total is. */
  reporter?: string
}

export type ComtradeDataset = {
  id: string
  label: string
  note: string
  query: ComtradeQuery
}

/*
 * Customs=C00, ModeOfTransport=0 and secondPartner=0 are the same aggregate
 * pins the pipeline itself uses when it pulls this data. Left off, Comtrade
 * returns the customs-procedure, mode-of-transport and second-partner
 * breakdowns of the same trade, and adding up what comes back counts it more
 * than once. They are not optional decoration, here or there.
 */
export function comtradeQueryUrl(query: ComtradeQuery): string {
  const params: Array<[string, string]> = [
    ['Type', 'C'],
    ['Frequency', 'A'],
    ['Classification', 'HS'],
    ['Period', String(query.year)],
    ['Reporters', query.reporter ?? 'all'],
    ['Partners', '0'],
    ['CommodityCodes', query.code],
    ['Flows', query.flow],
    ['Customs', 'C00'],
    ['ModeOfTransport', '0'],
    ['secondPartner', '0'],
    ['AggregateBy', 'NONE'],
    ['BreakdownMode', 'plus'],
  ]

  const search = params
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  return `${COMTRADE_QUERY_PAGE}?${search}`
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
