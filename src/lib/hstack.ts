import type { EconomyRow, HsNode, PeriodRecord } from '../types'

/*
 * HStack — trade for a basket of HS codes read as one line item.
 *
 * Two honesty constraints shape the maths:
 *
 * 1. Overlap. HS 8471 already contains HS 847130. Adding both to a basket
 *    double counts, so overlapping selections are detected and reported
 *    rather than silently summed.
 *
 * 2. Partial tables. A node publishes its top economies and India's top
 *    partners, not every reporter. Summing those across a basket gives the
 *    right leaders but an understated tail, so every aggregated table
 *    carries the share of basket trade it actually covers.
 */

export type BasketEntry = {
  code: string
  level: 2 | 4 | 6
}

export type BasketLine = {
  code: string
  level: 2 | 4 | 6
  label: string
  description: string
  category: string
  globalTrade: number | null
  shareOfBasket: number | null
  indiaImports: number | null
  indiaExports: number | null
  indiaBalance: number | null
  indiaShare: number | null
  indiaRank: number | null
  /* Why this line contributes nothing to the basket total, if it doesn't. */
  withheldReason: string | null
  /*
   * The broader code in the stack that already contains this one. When set,
   * the line's own figures are still shown - they are what the reader asked
   * to see - but nothing from it enters any total, because the containing
   * code already carries it.
   */
  containedIn: string | null
  /* This line's global trade as a share of the code that contains it. */
  shareOfParent: number | null
}

export type AggregateRow = {
  code: string
  name: string
  value: number
  share: number
}

export type BasketSummary = {
  year: number
  lines: BasketLine[]

  globalTrade: number
  linesCounted: number
  linesWithheld: number

  indiaImports: number
  indiaExports: number
  indiaBalance: number
  /* India's netted imports as a share of the basket's global trade. */
  indiaShareOfGlobal: number | null

  topEconomies: AggregateRow[]
  /* Share of basket trade the aggregated economy table accounts for. */
  economyCoverage: number | null

  suppliers: AggregateRow[]
  supplierCoverage: number | null
  supplierHhi: number | null
  supplierTop3: number | null

  overlaps: { parent: string; child: string }[]
  /* Codes excluded from every total because a broader code covers them. */
  containedCodes: string[]
}

function record(node: HsNode, year: number): PeriodRecord | undefined {
  return node.annual[String(year)]
}

function label(node: HsNode): string {
  if (node.level === 6) {
    return node.product || node.description
  }

  return `HS-${node.level} ${node.code}`
}

/*
 * The most recent year for which every node in the basket has a published
 * figure. Falling back to a year where some are missing is better than
 * showing nothing, so the search walks backwards and takes the first year
 * with any coverage at all.
 */
/* ---------------------------------------------------------------------
 * HS code families
 *
 * A split cannot be apportioned between its successors without inventing a
 * share, which is why the dashboard refuses to join those series. Summing the
 * whole family is a different operation and an honest one: before the revision
 * only the old code carries data, after it only the new ones, so the members
 * never overlap in time and the combined series needs no share at all.
 *
 * That is what makes "see the old code together with the new ones" possible
 * without breaking the rule that produced the refusal in the first place.
 * ------------------------------------------------------------------- */

export type FamilyGap = {
  /* A code already in the stack that belongs to a family. */
  anchor: string
  /* Family members not yet in the stack and openable as products. */
  missing: string[]
  /* Retired members, which have no page but whose years arrive anyway. */
  retired: string[]
  note: string
}

export function familyGaps(nodes: HsNode[]): FamilyGap[] {
  const present = new Set(nodes.map(node => node.code))

  const out: FamilyGap[] = []
  const seen = new Set<string>()

  for (const node of nodes) {
    const family = node.lineage?.family ?? []

    if (family.length < 2) continue

    const signature = [...family].sort().join(',')

    if (seen.has(signature)) continue

    seen.add(signature)

    /* A predecessor has no product page: HS 2022 is the base and a retired
     * code is lineage, not a product. Its years still reach the chart, via
     * the successor's own lineage.series, so it is listed but never added. */
    const retiredCodes = new Set<string>()

    for (const item of nodes) {
      for (const predecessor of item.lineage?.predecessors ?? []) {
        retiredCodes.add(predecessor.code)
      }
    }

    const missing = family.filter(
      code => !present.has(code) && !retiredCodes.has(code),
    )

    const retired = family.filter(code => retiredCodes.has(code))

    if (!missing.length) continue

    out.push({
      anchor: node.code,
      missing,
      retired,
      note:
        node.lineage?.familyNote ??
        'These codes together cover the product across the HS 2022 revision.',
    })
  }

  return out
}

export type CombinedPoint = {
  year: number
  globalTrade: number | null
  indiaImports: number | null
  indiaExports: number | null
  /* Which codes actually reported in this year. */
  contributors: string[]
  /* True where a retired code supplied part of the year. */
  spansRevision: boolean
}

/*
 * One series for the whole stack, across the revision.
 *
 * Each node contributes its own years. A retired predecessor contributes the
 * years it was reported under, taken from whichever successor carries them,
 * counted once however many siblings are in the stack. The two sets do not
 * overlap, so this is addition, not splicing.
 */
export function combinedSeries(nodes: HsNode[]): CombinedPoint[] {
  const years = new Set<number>()

  for (const node of nodes) {
    for (const year of Object.keys(node.annual)) years.add(Number(year))

    for (const series of Object.values(node.lineage?.series ?? {})) {
      for (const year of Object.keys(series)) years.add(Number(year))
    }
  }

  /* A predecessor appears on every sibling, so bank it once. */
  const predecessorSeries = new Map<string, Record<string, {
    globalTrade: number | null
    indiaImports: number | null
    indiaExports: number | null
  }>>()

  for (const node of nodes) {
    for (const [code, series] of Object.entries(node.lineage?.series ?? {})) {
      if (!predecessorSeries.has(code)) predecessorSeries.set(code, series)
    }
  }

  return [...years]
    .sort((a, b) => a - b)
    .map(year => {
      const key = String(year)

      let globalTrade: number | null = null
      let indiaImports: number | null = null
      let indiaExports: number | null = null

      const contributors: string[] = []

      let spansRevision = false

      const add = (
        code: string,
        trade: number | null | undefined,
        imports: number | null | undefined,
        exports: number | null | undefined,
        fromRetired: boolean,
      ) => {
        let touched = false

        if (trade != null) {
          globalTrade = (globalTrade ?? 0) + trade
          touched = true
        }

        if (imports != null) {
          indiaImports = (indiaImports ?? 0) + imports
          touched = true
        }

        if (exports != null) {
          indiaExports = (indiaExports ?? 0) + exports
          touched = true
        }

        if (touched) {
          contributors.push(code)

          if (fromRetired) spansRevision = true
        }
      }

      for (const node of nodes) {
        const record = node.annual[key]

        add(
          node.code,
          record?.global.trade,
          record?.india.imports,
          record?.india.exports,
          false,
        )
      }

      for (const [code, series] of predecessorSeries) {
        const point = series[key]

        add(
          code,
          point?.globalTrade,
          point?.indiaImports,
          point?.indiaExports,
          true,
        )
      }

      return {
        year,
        globalTrade,
        indiaImports,
        indiaExports,
        contributors,
        spansRevision,
      }
    })
}

export function bestYear(nodes: HsNode[]): number | null {
  if (!nodes.length) return null

  const years = new Set<number>()

  for (const node of nodes) {
    for (const year of node.analyticalYears) years.add(year)
  }

  const ordered = [...years].sort((a, b) => b - a)

  for (const year of ordered) {
    const published = nodes.filter(
      node => record(node, year)?.global.trade != null,
    )

    if (published.length === nodes.length) return year
  }

  for (const year of ordered) {
    const published = nodes.filter(
      node => record(node, year)?.global.trade != null,
    )

    if (published.length) return year
  }

  return ordered[0] ?? null
}

/*
 * Nesting inside the stack.
 *
 * HS 8517 is not a sibling of HS 851713, it is the heading that contains it,
 * and Comtrade's figure for 8517 already includes every six-digit line under
 * it. Adding both and summing reports the smartphone trade twice and inflates
 * the basket by exactly the smaller code.
 *
 * The stack used to notice this and say so, then sum them anyway. It now
 * notices, says so, and counts the containing code once.
 */
export function findOverlaps(nodes: HsNode[]) {
  const codes = nodes.map(node => node.code)

  const overlaps: { parent: string; child: string }[] = []

  for (const parent of codes) {
    for (const child of codes) {
      if (parent !== child && child.startsWith(parent)) {
        overlaps.push({ parent, child })
      }
    }
  }

  return overlaps
}

/*
 * For each contained code, the narrowest code in the stack that contains it.
 *
 * Narrowest matters: with 84, 8471 and 847130 all stacked, 847130 is reported
 * as sitting inside 8471 rather than inside 84, because that is the more
 * useful thing to tell someone, and 8471 is itself reported inside 84. Only
 * the outermost code is counted, which is right - it contains both.
 */
export function containment(nodes: HsNode[]): Map<string, string> {
  const codes = nodes.map(node => node.code)

  const inside = new Map<string, string>()

  for (const child of codes) {
    let holder: string | null = null

    for (const parent of codes) {
      if (parent === child || !child.startsWith(parent)) continue

      if (holder === null || parent.length > holder.length) holder = parent
    }

    if (holder !== null) inside.set(child, holder)
  }

  return inside
}

function aggregate(
  rows: { code: string; name: string; value: number }[],
  denominator: number,
  limit: number,
): { rows: AggregateRow[]; all: AggregateRow[]; covered: number } {
  const totals = new Map<string, { name: string; value: number }>()

  let covered = 0

  for (const row of rows) {
    if (!Number.isFinite(row.value)) continue

    covered += row.value

    const existing = totals.get(row.code)

    if (existing) {
      existing.value += row.value
    } else {
      totals.set(row.code, { name: row.name, value: row.value })
    }
  }

  const ordered = [...totals.entries()]
    .map(([code, entry]) => ({
      code,
      name: entry.name,
      value: entry.value,
      share: denominator > 0 ? entry.value / denominator : 0,
    }))
    .sort((a, b) => b.value - a.value)

  return { rows: ordered.slice(0, limit), all: ordered, covered }
}

export function summarise(
  nodes: HsNode[],
  year: number,
  topN = 10,
): BasketSummary {
  const lines: BasketLine[] = []

  let globalTrade = 0
  let indiaImports = 0
  let indiaExports = 0
  let indiaNetImports = 0

  const economyRows: { code: string; name: string; value: number }[] = []

  const supplierRows: { code: string; name: string; value: number }[] = []

  let withheld = 0

  /*
   * Codes already covered by a broader code in the same stack. Their figures
   * are shown; none of them are added to anything.
   */
  const inside = containment(nodes)

  const parentTrade = new Map<string, number | null>()

  for (const node of nodes) {
    parentTrade.set(node.code, record(node, year)?.global.trade ?? null)
  }

  for (const node of nodes) {
    const entry = record(node, year)

    const trade = entry?.global.trade ?? null

    const holder = inside.get(node.code) ?? null

    let reason: string | null = null

    if (holder) {
      reason = `Inside HS ${holder}, which is already in this stack`
    } else if (!entry) {
      reason = `No data for ${year}`
    } else if (trade === null) {
      const status = entry.global.coverage?.status ?? 'unknown'

      reason =
        status === 'VALID'
          ? 'No global figure for this year'
          : `Reporter coverage ${status.toLowerCase()} for ${year}`
    }

    const imports = entry?.india.imports ?? null
    const exports = entry?.india.exports ?? null

    /*
     * The one branch that matters. A contained code contributes nothing -
     * not its global trade, not India's figures, not a single row to the
     * aggregated economy or partner tables, all of which the containing
     * code already carries.
     */
    if (!holder) {
      if (trade !== null) {
        globalTrade += trade

        for (const economy of entry?.global.topEconomies ?? []) {
          economyRows.push({
            code: economy.code,
            name: economy.name,
            value: economy.value,
          })
        }
      } else {
        withheld += 1
      }

      if (imports !== null) indiaImports += imports
      if (exports !== null) indiaExports += exports

      if (entry?.india.importsNetReImports != null) {
        indiaNetImports += entry.india.importsNetReImports
      }

      for (const supplier of entry?.india.suppliers?.rows ?? []) {
        supplierRows.push({
          code: supplier.code,
          name: supplier.name,
          value: supplier.value,
        })
      }
    }

    const holderTrade = holder ? parentTrade.get(holder) ?? null : null

    lines.push({
      containedIn: holder,
      shareOfParent:
        holder && trade !== null && holderTrade
          ? trade / holderTrade
          : null,
      code: node.code,
      level: node.level,
      label: label(node),
      description: node.description,
      category: node.category,
      globalTrade: trade,
      shareOfBasket: null,
      indiaImports: imports,
      indiaExports: exports,
      indiaBalance: entry?.india.balance ?? null,
      indiaShare: entry?.global.indiaShare ?? null,
      indiaRank: entry?.global.indiaRank ?? null,
      withheldReason: reason,
    })
  }

  for (const line of lines) {
    line.shareOfBasket =
      line.containedIn === null && line.globalTrade !== null && globalTrade > 0
        ? line.globalTrade / globalTrade
        : null
  }

  lines.sort((a, b) => (b.globalTrade ?? -1) - (a.globalTrade ?? -1))

  const economies = aggregate(economyRows, globalTrade, topN)

  const suppliers = aggregate(supplierRows, indiaImports, topN)

  // HHI must be computed on merged per-partner totals. Squaring each
  // product's fragment of a partner's trade separately would report a
  // basket as far less concentrated than it is.
  const supplierTotal = suppliers.covered

  const hhi =
    supplierTotal > 0 && suppliers.all.length
      ? suppliers.all.reduce((sum, row) => {
          const share = row.value / supplierTotal
          return sum + share * share
        }, 0)
      : null

  return {
    year,
    lines,

    globalTrade,
    linesCounted: lines.length - withheld - inside.size,
    linesWithheld: withheld,

    indiaImports,
    indiaExports,
    indiaBalance: indiaExports - indiaImports,
    indiaShareOfGlobal:
      globalTrade > 0 && indiaNetImports > 0
        ? indiaNetImports / globalTrade
        : null,

    topEconomies: economies.rows,
    economyCoverage:
      globalTrade > 0 ? Math.min(economies.covered / globalTrade, 1) : null,

    suppliers: suppliers.rows,
    supplierCoverage:
      indiaImports > 0 ? Math.min(suppliers.covered / indiaImports, 1) : null,
    supplierHhi: hhi,
    supplierTop3: suppliers.rows
      .slice(0, 3)
      .reduce((sum, row) => sum + row.share, 0),

    overlaps: findOverlaps(nodes),
    containedCodes: [...inside.keys()].sort(),
  }
}

export function toRows(summary: BasketSummary) {
  return summary.lines.map(line => ({
    code: line.code,
    level: line.level,
    product: line.label,
    description: line.description,
    category: line.category,
    globalTrade: line.globalTrade,
    shareOfBasket: line.shareOfBasket,
    indiaImports: line.indiaImports,
    indiaExports: line.indiaExports,
    indiaBalance: line.indiaBalance,
    indiaShare: line.indiaShare,
    indiaRank: line.indiaRank,
    note: line.withheldReason ?? '',
  }))
}

const BASKET_KEY = 'hstat-basket'

export function readBasket(): BasketEntry[] {
  try {
    const value = localStorage.getItem(BASKET_KEY)

    if (!value) return []

    const parsed = JSON.parse(value)

    if (!Array.isArray(parsed)) return []

    return parsed
      .filter(
        (entry): entry is BasketEntry =>
          typeof entry?.code === 'string' &&
          [2, 4, 6].includes(entry?.level),
      )
      .slice(0, 40)
  } catch {
    return []
  }
}

export function saveBasket(entries: BasketEntry[]) {
  try {
    localStorage.setItem(BASKET_KEY, JSON.stringify(entries.slice(0, 40)))
  } catch {
    /* Private browsing and blocked site data are not errors here. */
  }
}
