/*
 * The two Phase 2 data files, and the one function every ranked table reads.
 *
 *   scope.json          the front page: the FED scope summed across every
 *                       published HS-6 line, year by year
 *   detail/{code}.json  every reporter in each ranking, for "view all" and
 *                       for the workbook - full from `fullListsFrom`, the top
 *                       25 before it, and each table says which
 *
 * Both are written by the same refresh as the nodes and add up to them
 * exactly (validate_snapshot checks it). A snapshot built before 7 October
 * has neither; every reader here treats absence as "fall back to what the
 * node carries" rather than as an error, because the code that reads these
 * files reaches the site a few minutes before the refresh that writes them.
 */
import type { HsNode, PeriodRecord } from '../types'

const BASE = '/data/snapshots'

export type ScopeRow = [string, number, number]

/* [code, world imports gross, estimated share, India imports, India exports] */
export type ScopeProduct = [string, number, number, number | null, number | null]

export type ScopeYear = {
  lines: number
  worldImports: number
  estimatedImports: number
  worldExports: number
  estimatedExports: number
  indiaImports: number
  indiaExports: number
  indiaImportLines: number
  indiaExportLines: number
  importers: ScopeRow[]
  exporters: ScopeRow[]
  products: ScopeProduct[]
}

export type ScopeSummary = {
  builtAt: string
  basis: 'gross'
  currency: 'USD'
  linesInScope: number
  reporters: Record<string, string>
  years: Record<string, ScopeYear>
}

export type DetailTable = {
  total: number | null
  count: number
  complete: boolean
  rows: (string | number)[][]
}

export type DetailYear = Partial<
  Record<'importers' | 'exporters' | 'indiaSuppliers' | 'indiaDestinations', DetailTable>
>

export type Detail = {
  code: string
  basis: 'gross'
  fullListsFrom: number
  reporters: Record<string, string>
  years: Record<string, DetailYear>
}

const scopeCache = new Map<string, Promise<ScopeSummary | null>>()
const detailCache = new Map<string, Promise<Detail | null>>()

async function getOptional<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: 'no-cache' })

    if (!response.ok) return null

    return (await response.json()) as T
  } catch {
    return null
  }
}

/*
 * Whether the snapshot has scope.json and detail files at all. Set from the
 * manifest as soon as it loads; null (not yet known) still asks, and simply
 * gets nothing back from an older snapshot.
 */
let pageFiles: boolean | null = null

export function usePageFiles(manifest: { pageFiles?: unknown } | null | undefined): void {
  pageFiles = manifest ? Boolean(manifest.pageFiles) : null
}

export function loadScope(snapshot: string): Promise<ScopeSummary | null> {
  if (pageFiles === false) return Promise.resolve(null)

  const existing = scopeCache.get(snapshot)

  if (existing) return existing

  const request = getOptional<ScopeSummary>(`${BASE}/${snapshot}/scope.json`)

  scopeCache.set(snapshot, request)

  return request
}

export function loadDetail(snapshot: string, code: string): Promise<Detail | null> {
  if (pageFiles === false) return Promise.resolve(null)

  const key = `${snapshot}:${code}`

  const existing = detailCache.get(key)

  if (existing) return existing

  const request = getOptional<Detail>(`${BASE}/${snapshot}/detail/${code}.json`)

  detailCache.set(key, request)

  return request
}

/* The latest year the scope actually has world figures for. */
export function latestScopeYear(scope: ScopeSummary | null): number | null {
  if (!scope) return null

  const years = Object.entries(scope.years)
    .filter(([, year]) => year.lines > 0)
    .map(([period]) => Number(period))

  return years.length ? Math.max(...years) : null
}

/* ------------------------------------------------------------ rankings */

export type RankKind = 'importers' | 'exporters' | 'indiaSuppliers' | 'indiaDestinations'

export type RankRow = {
  rank: number
  code: string
  name: string
  value: number
  share: number | null
  estimated: boolean
  /* 0-1 where known: how much of this row's value is estimated. */
  estimatedShare?: number | null
}

export type Ranking = {
  rows: RankRow[]
  /* The denominator the shares are of. */
  total: number | null
  /* How many entries exist, which can exceed rows.length. */
  count: number
  /* False when rows is the top of a longer list the snapshot does not hold. */
  complete: boolean
  /* gross: world, as filed plus estimated; net: the legacy netted table;
   * india: India's own bilateral filing. */
  basis: 'gross' | 'net' | 'india'
  source: 'detail' | 'node'
}

const INDIA = '699'

function partnerName(kind: RankKind, code: string, name: string): string {
  if (code !== INDIA) return name

  if (kind === 'indiaSuppliers') return 'India (re-imports)'
  if (kind === 'indiaDestinations') return 'India (re-exports)'

  return name
}

export function rankingFor(
  kind: RankKind,
  node: HsNode,
  year: number,
  detail: Detail | null,
): Ranking {
  const table = detail?.years?.[String(year)]?.[kind]

  if (table && table.rows.length) {
    const total = table.total ?? null

    return {
      rows: table.rows.map((row, index) => {
        const code = String(row[0])
        const value = Number(row[1])

        return {
          rank: index + 1,
          code,
          name: partnerName(kind, code, detail?.reporters?.[code] ?? code),
          value,
          share: total ? value / total : null,
          estimated: kind === 'importers' || kind === 'exporters' ? Boolean(row[2]) : false,
          /* A country row is estimated whole: it is an economy that has not
           * filed this year. */
          estimatedShare: (kind === 'importers' || kind === 'exporters') && row[2] ? 1 : null,
        }
      }),
      total,
      count: table.count,
      complete: table.complete,
      basis: kind.startsWith('india') ? 'india' : 'gross',
      source: 'detail',
    }
  }

  const record: PeriodRecord | undefined = node.annual[String(year)]

  if (!record) {
    return { rows: [], total: null, count: 0, complete: true, basis: 'gross', source: 'node' }
  }

  if (kind === 'indiaSuppliers' || kind === 'indiaDestinations') {
    const set = kind === 'indiaSuppliers' ? record.india.suppliers : record.india.destinations
    const total = kind === 'indiaSuppliers' ? record.india.imports : record.india.exports

    const rows = (set?.rows ?? []).map((row, index) => ({
      rank: index + 1,
      code: row.code,
      name: partnerName(kind, row.code, row.name),
      value: row.value,
      share: row.share,
      estimated: false,
    }))

    return {
      rows,
      total: total ?? null,
      count: rows.length,
      complete: false,
      basis: 'india',
      source: 'node',
    }
  }

  const gross = kind === 'importers' ? record.global.importers : record.global.exporters

  if (gross && gross.length) {
    const total =
      kind === 'importers'
        ? record.global.observed.grossImports
        : record.global.observed.grossExports

    return {
      rows: gross.map(row => ({
        rank: row.rank ?? 0,
        code: row.code,
        name: row.name,
        value: row.value,
        share: row.share,
        estimated: Boolean(row.estimated),
      })),
      total: total ?? null,
      count: gross.length,
      complete: false,
      basis: 'gross',
      source: 'node',
    }
  }

  const net = kind === 'importers' ? record.global.topEconomies : record.global.topExporters

  return {
    rows: (net ?? []).map((row, index) => ({
      rank: row.rank ?? index + 1,
      code: row.code,
      name: row.name,
      value: row.value,
      share: row.share,
      estimated: false,
    })),
    total:
      kind === 'importers'
        ? record.global.observed.netImports
        : record.global.observed.netExports,
    count: (net ?? []).length,
    complete: false,
    basis: 'net',
    source: 'node',
  }
}

/* ------------------------------------------------------ headline figures */

export type Headline = {
  /* Gross world imports, as filed plus estimated. */
  global: number | null
  globalEstimatedShare: number | null
  globalEstimatedReporters: number | null
  net: number | null
  /* (gross - net) / gross */
  grossNetGap: number | null
  indiaExports: number | null
  indiaImports: number | null
  indiaImportRank: number | null
  indiaImportShare: number | null
  indiaExportRank: number | null
  indiaExportShare: number | null
  /* Out of how many economies, where the snapshot says. */
  importersCount: number | null
  exportersCount: number | null
  published: boolean
}

export function headlineFor(node: HsNode, year: number): Headline {
  const record = node.annual[String(year)]

  const empty: Headline = {
    global: null,
    globalEstimatedShare: null,
    globalEstimatedReporters: null,
    net: null,
    grossNetGap: null,
    indiaExports: record?.india.exports ?? null,
    indiaImports: record?.india.imports ?? null,
    indiaImportRank: null,
    indiaImportShare: null,
    indiaExportRank: null,
    indiaExportShare: null,
    importersCount: null,
    exportersCount: null,
    published: false,
  }

  if (!record || record.global.trade === null) return empty

  const observed = record.global.observed
  const gross = observed.grossImports ?? record.global.trade
  const net = record.global.trade

  const estimation = record.global.estimation?.imports

  const importPosition = record.global.indiaImportPosition ?? null
  const exportPosition = record.global.indiaExportPosition ?? null

  /* Before the gross rankings existed, India's import standing was the
   * netted rank and share; her export standing came from the netted top ten. */
  const legacyExport = (record.global.topExporters ?? []).find(row => row.code === INDIA)

  return {
    global: gross,
    globalEstimatedShare:
      estimation?.estimatedGrossShare ?? estimation?.estimatedShare ?? null,
    globalEstimatedReporters: estimation?.estimatedReporters ?? null,
    net,
    grossNetGap: gross && net !== null ? (gross - net) / gross : null,
    indiaExports: record.india.exports,
    indiaImports: record.india.imports,
    indiaImportRank: importPosition?.rank ?? record.global.indiaRank,
    indiaImportShare: importPosition?.share ?? record.global.indiaShare,
    indiaExportRank: exportPosition?.rank ?? legacyExport?.rank ?? null,
    indiaExportShare:
      exportPosition?.share ??
      (record.india.exports !== null && observed.grossExports
        ? record.india.exports / observed.grossExports
        : null),
    importersCount: importPosition?.of ?? null,
    exportersCount: exportPosition?.of ?? null,
    published: true,
  }
}
