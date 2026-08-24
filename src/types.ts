export type EconomyRow = {
  rank?: number
  code: string
  name: string
  value: number
  share: number
}

export type PartnerSet = {
  rows: EconomyRow[]
  coverage: number | null
  hhi: number | null
  top3Share: number | null
}

export type HS8Row = {
  hs8: string
  description: string
  imports: number
  exports: number
  balance: number
}

export type Coverage = {
  status:
    | 'VALID'
    | 'CAUTION'
    | 'INVALID'
    | 'BASELINE'
    | 'HISTORICAL'
    | string
  [key: string]: unknown
}

export type AnnualRecord = {
  india: {
    imports: number | null
    exports: number | null
    balance: number | null
    suppliers: PartnerSet
    destinations: PartnerSet
    hs8: HS8Row[]
  }

  global: {
    observedImports: number | null
    observedExports: number | null

    imports: number | null
    exports: number | null

    importRankIndia: number | null
    importShareIndia: number | null

    exportRankIndia: number | null
    exportShareIndia: number | null

    topImporters: EconomyRow[]
    topExporters: EconomyRow[]

    mirror?: {
      importExportRatio: number | null
      status: string | null
    }

    importCoverage: Coverage
    exportCoverage: Coverage
  }
}

export type Benchmark = {
  year: number
  status: 'VALID'
  value: number
  indiaRank: number | null
  indiaShare: number | null
  top10: EconomyRow[]
}

export type Product = {
  schemaVersion: string

  /*
   * Generic navigation identity.
   * These are always populated by loadHsNode().
   */
  level: 2 | 4 | 6
  code: string

  /*
   * Existing HS-6 compatibility field.
   * For parent nodes the loader supplies the displayed code
   * so the existing dashboard can operate until Batch C
   * removes legacy HS-6-only assumptions.
   */
  hs6: string

  parentCode?: string | null
  description: string
  classification: string
  refreshedAt: string

  years: number[]
  analyticalYears?: number[]
  latestIndiaYear: number | null

  benchmarks: {
    globalImports: Benchmark | null
    globalExports: Benchmark | null
  }

  annual: Record<string, AnnualRecord>

  /*
   * Source contracts differ slightly between the legacy
   * HS-6 snapshot and the new parent layer.
   */
  sources: unknown
}

export type SearchItem = {
  code: string
  level: 2 | 4 | 6
  description: string
  parent2?: string | null
  parent4?: string | null
  loaded: boolean
  tags: string[]
  searchText: string
}
