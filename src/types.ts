/*
 * Snapshot schema 2.0.0.
 *
 * The headline change from 1.x: global imports and global exports are no
 * longer published as two competing figures. A node carries one
 * `globalTrade` benchmark, net of re-imports, and keeps both raw sides
 * under `observed` for audit.
 */

export type EconomyRow = {
  rank?: number
  code: string
  name: string
  value: number
  share: number
}

export type PartnerRow = {
  code: string
  name: string
  value: number
  share: number
}

export type PartnerSet = {
  rows: PartnerRow[]
  coverage: number | null
  hhi: number | null
  top3Share: number | null
  /* Partner rows are gross; re-imports are not filed by partner. */
  basis: 'gross'
}

export type HS8Row = {
  hs8: string
  description: string
  /* US dollars. Null where the source filed rupees and no rate exists. */
  imports: number | null
  exports: number | null
  balance: number | null
  /* Rupees. Null where the source filed dollars and no rate exists. */
  importsInr: number | null
  exportsInr: number | null
  balanceInr: number | null
  /* Which side was actually filed; the other is derived. */
  native: 'inr' | 'usd'
}

export type TariffReconciliation = {
  status: 'ok' | 'out-of-band' | 'unavailable' | 'skipped' | string
  ratio?: number
  reason?: string
  comparedWith?: string | null
  basis?: string
}

export type TariffYearMeta = {
  fy: string
  monthsCovered: number | null
  /* Null when the source did not say. */
  complete: boolean | null
  native: string[]
  rate: number | null
  rateSource: string | null
  /* The calendar year this financial year starts inside. */
  overlapsCalendarYear: number
  lines: number
  totalImports: number | null
  totalExports: number | null
  totalImportsInr: number | null
  totalExportsInr: number | null
  reconciliation: TariffReconciliation
}

export type TariffYear = {
  meta: TariffYearMeta
  rows: HS8Row[]
}

/*
 * Tariff lines sit outside `annual` on purpose: they are Indian financial
 * years and `annual` is Comtrade calendar years. Two blocks, never one.
 */
export type TariffLines = {
  basis: 'FY'
  periodLabel?: string
  source: string
  financialYears: Record<string, TariffYear>
}

export type CurrencyMode = 'USD' | 'INR'

export type RateEntry = {
  rate: number
  status: string
  source: string
  note?: string
}

export type CurrencyBlock = {
  base: 'USD'
  display: CurrencyMode[]
  applies: string[]
  rates: Partial<Record<'CY' | 'FY' | 'MONTH', Record<string, RateEntry>>>
  coverage: {
    periods: number
    convertible: number
    missing: string[]
    complete: boolean
    fraction: number
  }
}

export type CoverageStatus =
  | 'VALID'
  | 'CAUTION'
  | 'INVALID'
  | 'BASELINE'
  | 'HISTORICAL'

export type Coverage = {
  status: CoverageStatus | string
  reason?: string
  reconciliation?: string
  candidateReporters?: number
  previousReporters?: number
  priorTop10Present?: number
  priorTop20ValueCoverage?: number
  missingPriorTop10?: unknown[]
}

export type Mirror = {
  /* netImports / netExports */
  ratio: number | null
  /* ratio - 1, so 0.06 reads as "the import side is 6% larger" */
  gap: number | null
  status: 'OK' | 'WARNING' | 'UNAVAILABLE' | string
}

export type Observed = {
  grossImports: number | null
  reImportsRemoved: number | null
  netImports: number | null
  grossExports: number | null
  reExportsRemoved: number | null
  netExports: number | null
  reporters: number
  adjustedReporters: number
  /* Share of the world total filed by reporters that separate re-imports. */
  adjustmentCoverage: number | null
}

export type PeriodRecord = {
  india: {
    imports: number | null
    exports: number | null
    balance: number | null
    importsNetReImports: number | null
    exportsNetReExports: number | null
    suppliers?: PartnerSet
    destinations?: PartnerSet
  }

  global: {
    /* Null unless reporter coverage passed for this period. */
    trade: number | null
    tradeStatus: string
    indiaRank: number | null
    indiaShare: number | null
    observed: Observed
    mirror: Mirror
    coverage: Coverage
    topEconomies?: EconomyRow[]
    topExporters?: EconomyRow[]
  }
}

export type GlobalTradeBenchmark = {
  year: number
  status: 'VALID'
  value: number
  basis: 'imports'
  netReImports: boolean
  indiaRank: number | null
  indiaShare: number | null
  adjustmentCoverage: number | null
  mirror: Mirror | null
  topEconomies: EconomyRow[]
  /* Export side, ranked on its own FOB total - never merged with the above. */
  netExports?: number | null
  topExporters?: EconomyRow[]
}

export type LineagePredecessor = {
  code: string
  relation: 'identical' | 'split' | 'merge' | 'new' | string
  validTo: number | null
  note: string
}

export type Lineage = {
  predecessors: LineagePredecessor[]
  /* Every code that together covers this product across the revision: this
   * code, what it came from, and its siblings. Time-disjoint, so summing them
   * is legitimate where apportioning one between the others is not. */
  family?: string[]
  familyNote?: string
  /* True only when an unchanged code had its predecessor's years joined on.
   * A split is never spliced: its total cannot be apportioned. */
  spliced: boolean
  seriesStartsAt: number | null
  /* The heading where the split is internal, so the series is continuous. */
  continuousAt: string | null
  series: Record<string, Record<string, {
    globalTrade: number | null
    indiaImports: number | null
    indiaExports: number | null
  }>>
}

export type DefinitionShareYear = {
  members: number
  membersWithTrade: number
  membersWithIndia: number
  headingGlobalTrade: number | null
  definedGlobalTrade: number | null
  headingIndiaImports: number | null
  definedIndiaImports: number | null
  headingIndiaExports: number | null
  definedIndiaExports: number | null
  globalShare: number | null
  indiaImportShare: number | null
}

/*
 * How much of an official heading the FED definition tracks.
 *
 * Parent nodes only. The heading figure is Comtrade's own aggregate and stays
 * the published number; this says what share of it the sector definition
 * actually covers, so a heading total is not read as a sector total.
 */
export type DefinitionShare = {
  officialLines: number | null
  definedLines: number
  lineShare: number | null
  countSource: string
  basis: string
  caution: string
  years: Record<string, DefinitionShareYear>
}

export type HsNode = {
  schemaVersion: string
  level: 2 | 4 | 6
  code: string
  /* Compatibility alias kept equal to `code`. */
  hs6: string

  description: string
  product: string
  category: string
  segment: string
  dgcisSegment: string
  inFedDefinition: boolean
  referenceFlags: Record<string, boolean>
  /* HS-6 members, on parent nodes only. */
  members: string[]

  parentCode: string | null
  classification: string

  years: number[]
  analyticalYears: number[]
  months: string[]

  latestIndiaYear: number | null
  latestIndiaMonth: string | null

  lineage: Lineage | null

  /* Null at HS-6, where the question does not arise. */
  definitionShare: DefinitionShare | null

  globalTrade: GlobalTradeBenchmark | null

  annual: Record<string, PeriodRecord>
  monthly: Record<string, PeriodRecord>

  tariffLines: TariffLines

  sources: Record<string, string>
}

export type CatalogueEntry = {
  code: string
  level: 2 | 4 | 6
  description: string
  product: string
  category: string
  segment: string
  inFedDefinition: boolean
  latestIndiaYear: number | null
  latestIndiaMonth: string | null
  globalTradeYear: number | null
  globalTrade: number | null
  indiaRank: number | null
  indiaShare: number | null
  indiaImports: number | null
  indiaExports: number | null
}

export type SearchItem = {
  code: string
  level: 2 | 4 | 6
  description: string
  product: string
  /* The distinguishing short label: a curated term where one exists,
   * otherwise the workbook product name. */
  label: string
  category: string
  segment: string
  inFedDefinition: boolean
  loaded: boolean
  /* Retired in HS 2022: indexed as a signpost, never as a product. */
  retired?: boolean
  successors?: string[]
  parent2: string | null
  parent4: string | null
  /* The devices and components that make this code up. */
  keywords: string[]
  /* Everything this entry can be matched on. */
  terms: string[]
  /* Everyday words this code is the canonical home for. */
  answerTerms: string[]
  answerNote: string
  members?: string[]
  worldExportsUsdBn: number | null
}

export type Manifest = {
  schemaVersion: string
  refreshedAt: string
  classification: string
  startYear: number
  endYear: number
  analysisStartYear: number
  months: string[]
  financialYears: string[]
  tariffLines: {
    present: boolean
    basis: 'FY'
    financialYears: Record<string, TariffYearMeta | Record<string, unknown>>
  }
  currency: CurrencyBlock
  products: number
  parents: Record<string, number>
  nodes: number
  globalTradeBasis: string
  monthlyEnabled: boolean
}

export type Methodology = {
  globalTrade: {
    label: string
    basis: string
    netReExports: boolean
    statement: string
    formula: string
    notes: string[]
  }
  definition: {
    source: string
    products: number
    inFedDefinition: number
    categories: Record<string, string[]>
    segments: Record<string, string[]>
  }
  periods?: {
    comtrade: string
    tariffLines: string
    statement: string
  }
  currency?: {
    base: string
    display: string[]
    applies: string
    statement: string
    source: string
    convention: string
    missingRatePolicy: string
    rates: CurrencyBlock['rates']
    coverage: CurrencyBlock['coverage']
  }
}
