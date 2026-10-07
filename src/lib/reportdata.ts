/*
 * What goes into a report: the page's figures, as laid-out blocks.
 *
 * Built from the same data as the page and the workbook - never from the
 * screen - so a PDF, a PNG and a workbook of one page say the same things.
 */
import type { CatalogueEntry, HsNode, Manifest } from '../types'
import type { Detail, ScopeSummary } from './scope'
import { headlineFor, rankingFor } from './scope'
import { delta, nameOf, ordinal, pct, usd } from './format'
import {
  flowWord,
  flowsOf,
  formatPeriod,
  formatValue,
  last12,
  monthGrid,
  seriesFor,
  shareOfParent,
  totalSeries,
  type DgcisLine,
  type DgcisNode,
} from './dgcis'
import { INK, type ReportBlock, type ReportDocument, type ReportSection } from './report'
import { segmentKey } from '../components/HomePage'

export type ReportEntry = {
  node: HsNode
  detail: Detail | null
  dgcis?: DgcisNode | null
  children?: HsNode[]
}

export const REPORT_SECTIONS = [
  { id: 'headline', label: 'Headline and calculation' },
  { id: 'trend', label: 'Trend' },
  { id: 'world', label: 'Importers & Exporters' },
  { id: 'partners', label: "India's Partners" },
  { id: 'dgcis', label: 'Tariff Lines' },
  { id: 'inside', label: 'Inside' },
  { id: 'signals', label: 'Key Changes' },
  { id: 'lineage', label: 'Classification' },
]

function snapshotDate(manifest: Manifest) {
  return new Date(manifest.refreshedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

const star = (text: string, estimated: boolean) => (estimated ? `${text}*` : text)

function grossOf(node: HsNode, year: number): number | null {
  const record = node.annual[String(year)]

  if (!record || record.global.trade === null) return null

  return record.global.observed.grossImports ?? record.global.trade
}

function estimatedOf(node: HsNode, year: number): boolean {
  const estimation = node.annual[String(year)]?.global.estimation?.imports

  return ((estimation?.estimatedGrossShare ?? estimation?.estimatedShare) ?? 0) > 0
}

function rankingTable(
  title: string,
  ranking: ReturnType<typeof rankingFor>,
  valueLabel: string,
  shareLabel: string,
  limit = 10,
): ReportBlock {
  const rows = ranking.rows.slice(0, limit)
  const india = rows.findIndex(row => row.code === '699')

  return {
    kind: 'table',
    title,
    columns: [
      { label: 'Rank', width: 0.6 },
      { label: 'Country', width: 3 },
      { label: valueLabel, width: 1.6, align: 'right' },
      { label: shareLabel, width: 1.6, align: 'right' },
    ],
    rows: rows.map(row => [String(row.rank), row.name, star(usd(row.value), row.estimated), pct(row.share, 1)]),
    emphasis: india >= 0 ? [india] : undefined,
    note: ranking.basis === 'net' ? 'Net of re-imports.' : undefined,
  }
}

export function productDocument(
  entries: ReportEntry[],
  years: number[],
  sections: string[],
  manifest: Manifest,
  title?: string,
): ReportDocument {
  const sorted = [...years].sort((a, b) => b - a)
  const latest = sorted[0]
  const many = entries.length > 1
  const out: ReportSection[] = []

  for (const entry of entries) {
    const { node, detail } = entry
    const name = `${nameOf(node)} · HS-${node.level} ${node.code}`
    const prefix = many ? `${nameOf(node)} — ` : ''

    if (sections.includes('headline')) {
      const blocks: ReportBlock[] = []

      for (const year of sorted) {
        const headline = headlineFor(node, year)

        blocks.push({
          kind: 'figures',
          title: `Calendar year ${year}`,
          items: [
            {
              label: 'Global Trade',
              value: headline.published ? usd(headline.global) : 'Not published',
              caption: 'World imports',
              series: 'global',
              estimated: (headline.globalEstimatedShare ?? 0) > 0,
            },
            {
              label: 'India Exports',
              value: usd(headline.indiaExports),
              caption:
                headline.indiaExportRank !== null
                  ? `${ordinal(headline.indiaExportRank)} of all exporters · ${pct(headline.indiaExportShare, 1)}`
                  : headline.indiaExportShare !== null
                    ? `${pct(headline.indiaExportShare, 1)} of world exports`
                    : undefined,
              series: 'exports',
            },
            {
              label: 'India Imports',
              value: usd(headline.indiaImports),
              caption:
                headline.indiaImportRank !== null
                  ? `${ordinal(headline.indiaImportRank)} of all importers · ${pct(headline.indiaImportShare, 1)}`
                  : undefined,
              series: 'imports',
            },
          ],
        })
      }

      const record = node.annual[String(latest)]

      if (record) {
        const estimation = record.global.estimation?.imports
        const gross = grossOf(node, latest)
        const net = record.global.trade
        const gap = gross && net !== null ? (gross - net) / gross : null

        blocks.push({
          kind: 'pairs',
          title: `How Global Trade is calculated · ${latest}`,
          rows: [
            ['Global Trade, gross', `${usd(gross)}${estimatedOf(node, latest) ? '*' : ''}`],
            ['Net of re-imports', `${usd(net)} (re-import coverage ${pct(record.global.observed.adjustmentCoverage, 0)})`],
            ['Gross–net gap', gap === null ? '—' : `${pct(gap, 1)}${gap > 0.1 ? ' — above 10%, gross overstates' : ''}`],
            ['Coverage verdict', String((record.global.coverage as { gateStatus?: string })?.gateStatus ?? record.global.coverage?.status ?? '—')],
            [
              'Estimated',
              estimation
                ? `${pct(estimation.estimatedGrossShare ?? estimation.estimatedShare ?? 0, 1)} of the figure; ${estimation.estimatedReporters} economies estimated, ${estimation.filedReporters} filed`
                : 'None',
            ],
            ['Mirror check', record.global.mirror?.gap === null || record.global.mirror?.gap === undefined ? '—' : `${delta(record.global.mirror.gap)} import side against export side`],
            ['Source', `UN Comtrade · snapshot ${snapshotDate(manifest)}`],
          ],
        })
      }

      out.push({ title: `${prefix}Headline`, blocks })
    }

    if (sections.includes('trend')) {
      const allYears = [...node.years].sort((a, b) => a - b).filter(year => {
        const record = node.annual[String(year)]

        return Boolean(record && (grossOf(node, year) !== null || record.india.imports !== null || record.india.exports !== null))
      })

      const tableYears = [...allYears].reverse().slice(0, Math.max(10, sorted.length))

      out.push({
        title: `${prefix}Global Trade and India Trade over Time`,
        blocks: [
          {
            kind: 'line',
            title: 'Global Trade',
            unit: 'US dollars',
            labels: allYears.map(String),
            series: [{ name: 'Global Trade', colour: INK.indigo, values: allYears.map(year => grossOf(node, year)) }],
            format: value => usd(value, 0),
          },
          {
            kind: 'line',
            title: 'India Trade',
            unit: 'US dollars',
            labels: allYears.map(String),
            series: [
              { name: 'India Imports', colour: INK.red, values: allYears.map(year => node.annual[String(year)]?.india.imports ?? null) },
              { name: 'India Exports', colour: INK.ming, values: allYears.map(year => node.annual[String(year)]?.india.exports ?? null) },
            ],
            format: value => usd(value, 0),
          },
          {
            kind: 'table',
            title: 'By year',
            columns: [
              { label: 'Year', width: 0.8 },
              { label: 'Global Trade', width: 1.6, align: 'right' },
              { label: 'India Imports', width: 1.6, align: 'right' },
              { label: 'India Exports', width: 1.6, align: 'right' },
            ],
            rows: tableYears.map(year => [
              String(year),
              star(usd(grossOf(node, year)), estimatedOf(node, year)),
              usd(node.annual[String(year)]?.india.imports),
              usd(node.annual[String(year)]?.india.exports),
            ]),
            emphasis: tableYears.map((year, index) => (sorted.includes(year) ? index : -1)).filter(index => index >= 0),
          },
        ],
      })
    }

    if (sections.includes('world')) {
      const blocks: ReportBlock[] = []

      for (const year of sorted) {
        if (grossOf(node, year) === null) continue

        blocks.push(rankingTable(`Top Importers · ${year}`, rankingFor('importers', node, year, detail), 'Imports', 'Share of product trade'))
        blocks.push(rankingTable(`Top Exporters · ${year}`, rankingFor('exporters', node, year, detail), 'Exports', 'Share of product trade'))
      }

      if (blocks.length) out.push({ title: `${prefix}Top Importers and Exporters`, blocks })
    }

    if (sections.includes('partners')) {
      const blocks: ReportBlock[] = []

      for (const year of sorted) {
        const suppliers = rankingFor('indiaSuppliers', node, year, detail)
        const destinations = rankingFor('indiaDestinations', node, year, detail)

        if (suppliers.rows.length) {
          blocks.push(rankingTable(`India Import Partners · ${year}`, suppliers, 'India imports', "Share of India's imports"))
        }

        if (destinations.rows.length) {
          blocks.push(rankingTable(`India Export Partners · ${year}`, destinations, 'India exports', "Share of India's exports"))
        }
      }

      if (blocks.length) out.push({ title: `${prefix}India's Partners`, blocks })
    }

    if (sections.includes('dgcis') && entry.dgcis) {
      const data = entry.dgcis
      const blocks: ReportBlock[] = []

      for (const flow of flowsOf(data)) {
        const parent = totalSeries(data, flow, 'usd')
        const rows = data.lines
          .map(line => {
            const series = seriesFor(data, flow, line.hs8, 'usd')

            return series ? { line, twelve: last12(series), share: shareOfParent(series, parent) } : null
          })
          .filter((row): row is NonNullable<typeof row> => row !== null)
          .sort((a, b) => (b.twelve ?? 0) - (a.twelve ?? 0))

        if (!rows.length) continue

        blocks.push({
          kind: 'table',
          title: `India ${flowWord(flow)} by tariff line · last 12 months to ${formatPeriod(data.periods[data.periods.length - 1] ?? null)}`,
          columns: [
            { label: 'HS-8', width: 1 },
            { label: 'Name', width: 3 },
            { label: 'USD mn, 12 months', width: 1.4, align: 'right' },
            { label: 'Share of heading', width: 1.2, align: 'right' },
          ],
          rows: rows.map(row => [
            row.line.hs8,
            row.line.title || row.line.principalCommodity || '—',
            formatValue(row.twelve),
            row.share === null ? '—' : pct(row.share, 1),
          ]),
          note: "DGCIS: India reporting its own trade. Not world trade; never added to the Comtrade figures.",
        })
      }

      if (blocks.length) out.push({ title: `${prefix}India Tariff Lines`, blocks })
    }

    if (sections.includes('inside') && entry.children?.length) {
      const blocks: ReportBlock[] = []

      for (const year of sorted) {
        const parent = grossOf(node, year)
        const rows = entry.children
          .map(child => ({ child, gross: grossOf(child, year), estimated: estimatedOf(child, year) }))
          .sort((a, b) => (b.gross ?? -1) - (a.gross ?? -1))

        blocks.push({
          kind: 'table',
          title: `${node.level === 2 ? 'HS-4 headings' : 'HS-6 lines'} · ${year}`,
          columns: [
            { label: 'Code', width: 0.9 },
            { label: 'Name', width: 3 },
            { label: 'Global Trade', width: 1.4, align: 'right' },
            { label: `Share of ${node.code}`, width: 1.1, align: 'right' },
            { label: 'India Imports', width: 1.3, align: 'right' },
            { label: 'India Exports', width: 1.3, align: 'right' },
          ],
          rows: rows.map(({ child, gross, estimated }) => [
            child.code,
            nameOf(child),
            star(usd(gross), estimated),
            gross !== null && parent ? pct(gross / parent, 1) : '—',
            usd(child.annual[String(year)]?.india.imports),
            usd(child.annual[String(year)]?.india.exports),
          ]),
        })
      }

      out.push({ title: `${prefix}Inside HS-${node.level} ${node.code}`, blocks })
    }

    if (sections.includes('signals')) {
      const current = node.annual[String(latest)]
      const prior = node.annual[String(latest - 1)]
      const change = (now: number | null | undefined, before: number | null | undefined) =>
        now != null && before ? delta(now / before - 1) : '—'

      if (current) {
        out.push({
          title: `${prefix}Key Changes · ${latest}`,
          blocks: [
            {
              kind: 'pairs',
              rows: [
                [`Global Trade, ${latest - 1}–${latest}`, change(grossOf(node, latest), grossOf(node, latest - 1))],
                [`India Exports, ${latest - 1}–${latest}`, change(current.india.exports, prior?.india.exports)],
                [`India Imports, ${latest - 1}–${latest}`, change(current.india.imports, prior?.india.imports)],
                ['India trade balance', usd(current.india.balance)],
                ...(current.india.suppliers?.rows[0]
                  ? ([['Largest import source', `${current.india.suppliers.rows[0].name}, ${pct(current.india.suppliers.rows[0].share, 1)}`]] as [string, string][])
                  : []),
              ],
            },
          ],
        })
      }
    }

    if (sections.includes('lineage') && (node.lineage?.predecessors?.length || node.lineage?.retired)) {
      const lineage = node.lineage!
      const rows: [string, string][] = lineage.predecessors.map(item => [item.code ? `HS ${item.code}` : item.relation, item.note])

      if (lineage.retired) {
        rows.unshift([`Retired in HS ${lineage.retired.revision}`, lineage.retired.note || `Last valid ${lineage.retired.validTo}`])
      }

      out.push({ title: `${prefix}Classification History`, blocks: [{ kind: 'pairs', rows }] })
    }

    void name
  }

  const first = entries[0]?.node

  return {
    title:
      title ||
      (many
        ? `${entries.length} codes · ${sorted.join(', ')}`
        : `${nameOf(first)} · HS-${first?.level} ${first?.code}`),
    subtitle: many
      ? entries.map(entry => `HS ${entry.node.code}`).join(' · ')
      : first?.description ?? '',
    meta: [
      `Calendar year${sorted.length > 1 ? 's' : ''} ${sorted.join(', ')} · values in US dollars`,
      'Global Trade is world imports, gross: as filed, plus estimates for economies that have not filed (marked *).',
      `Source: UN Comtrade${entries.some(entry => entry.dgcis) ? '; India tariff lines: DGCIS' : ''} · snapshot ${snapshotDate(manifest)} · HStat.India, Foundation for Economic Development`,
    ],
    sections: out,
    source: `HStat.India · UN Comtrade · snapshot ${snapshotDate(manifest)}`,
  }
}

export function hs8Document(
  hs8: string,
  data: DgcisNode,
  line: DgcisLine,
  manifest: Manifest,
): ReportDocument {
  const sections: ReportSection[] = []
  const figures: ReportBlock = {
    kind: 'figures',
    title: `Last 12 months to ${formatPeriod(data.periods[data.periods.length - 1] ?? null)}`,
    items: flowsOf(data).map(flow => {
      const series = seriesFor(data, flow, hs8, 'usd')

      return {
        label: `India ${flowWord(flow)}`,
        value: `${formatValue(series ? last12(series) : null)} USD mn`,
        series: flow === 'exports' ? 'exports' : 'imports',
      }
    }),
  }

  sections.push({ title: 'Headline', blocks: [figures] })

  for (const flow of flowsOf(data)) {
    const series = seriesFor(data, flow, hs8, 'usd')

    if (!series) continue

    const grid = monthGrid(series, data.periods, 'CY')

    sections.push({
      title: `India ${flowWord(flow)}, Month by Month`,
      blocks: [
        {
          kind: 'line',
          title: 'Monthly, USD mn',
          unit: 'USD million',
          labels: data.periods.map(period => formatPeriod(period)),
          series: [{ name: `India ${flowWord(flow)}`, colour: flow === 'exports' ? INK.ming : INK.red, values: series }],
          format: value => formatValue(value),
        },
        {
          kind: 'table',
          title: 'By calendar year, USD mn',
          columns: [
            { label: 'Year', width: 0.8 },
            { label: 'Months filed', width: 0.9, align: 'right' },
            { label: 'Total', width: 1.2, align: 'right' },
            { label: 'Last 12 months', width: 1.3, align: 'right' },
          ],
          rows: grid.map(row => [
            row.label,
            String(row.filled),
            formatValue(row.months.reduce<number>((sum, value) => sum + (value ?? 0), 0)),
            formatValue(row.last12),
          ]),
          note: 'DGCIS: India reporting its own trade, partner World. Not world trade. Reported data; never estimated.',
        },
      ],
    })
  }

  return {
    title: line.title ? `${line.title} · HS-8 ${hs8}` : `Tariff line HS-8 ${hs8}`,
    subtitle: `Under HS ${data.hs6}${line.headingName ? ` — ${line.headingName}` : ''}`,
    meta: [
      `Monthly ${formatPeriod(data.periods[0] ?? null)} – ${formatPeriod(data.periods[data.periods.length - 1] ?? null)} · USD million as filed`,
      `Source: DGCIS / Trade Intelligence & Analytics · snapshot ${snapshotDate(manifest)} · HStat.India, Foundation for Economic Development`,
    ],
    sections,
    source: `HStat.India · DGCIS · snapshot ${snapshotDate(manifest)}`,
  }
}

export function homeDocument(
  scope: ScopeSummary,
  catalogue: CatalogueEntry[],
  year: number,
  manifest: Manifest,
): ReportDocument {
  const record = scope.years[String(year)]
  const byCode = new Map(catalogue.map(entry => [entry.code, entry]))

  const countryTable = (title: string, rows: [string, number, number][], total: number): ReportBlock => {
    const top = rows.slice(0, 10)
    const india = top.findIndex(row => row[0] === '699')

    return {
      kind: 'table',
      title,
      columns: [
        { label: 'Rank', width: 0.6 },
        { label: 'Country', width: 3 },
        { label: 'Value', width: 1.6, align: 'right' },
        { label: 'Share of scope', width: 1.4, align: 'right' },
      ],
      rows: top.map(([code, value, estimated], index) => [
        String(index + 1),
        scope.reporters[code] ?? code,
        star(usd(value), estimated > 0),
        pct(total ? value / total : null, 1),
      ]),
      emphasis: india >= 0 ? [india] : undefined,
    }
  }

  const productTable = (title: string, segment: 'finished' | 'components'): ReportBlock => ({
    kind: 'table',
    title,
    columns: [
      { label: 'Rank', width: 0.6 },
      { label: 'Product', width: 3 },
      { label: 'HS-6', width: 0.9 },
      { label: 'World imports', width: 1.5, align: 'right' },
      { label: 'Share of scope', width: 1.3, align: 'right' },
    ],
    rows: record.products
      .filter(([code]) => segmentKey(byCode.get(code)?.segment) === segment)
      .slice(0, 10)
      .map(([code, value, estimatedShare], index) => [
        String(index + 1),
        nameOf(byCode.get(code)),
        code,
        star(usd(value), estimatedShare > 0),
        pct(record.worldImports ? value / record.worldImports : null, 1),
      ]),
  })

  return {
    title: `Electronics scope · CY ${year}`,
    subtitle: `${scope.linesInScope} HS-6 lines in the FED electronics definition`,
    meta: [
      'Global Trade is world imports, gross: as filed, plus estimates for economies that have not filed (marked *).',
      `Source: UN Comtrade · snapshot ${snapshotDate(manifest)} · HStat.India, Foundation for Economic Development`,
    ],
    sections: [
      {
        title: 'Headline',
        blocks: [
          {
            kind: 'figures',
            items: [
              { label: 'Global Trade', value: usd(record.worldImports), caption: 'World imports', series: 'global', estimated: record.estimatedImports > 0 },
              { label: 'India Exports', value: usd(record.indiaExports), series: 'exports' },
              { label: 'India Imports', value: usd(record.indiaImports), series: 'imports' },
            ],
          },
        ],
      },
      {
        title: 'Top Importers and Exporters',
        blocks: [
          countryTable('Top Importers', record.importers, record.worldImports),
          countryTable('Top Exporters', record.exporters, record.worldExports),
        ],
      },
      {
        title: 'Top Traded Products',
        blocks: [
          productTable('Finished Goods', 'finished'),
          productTable('Components & Inputs', 'components'),
        ],
      },
    ],
    source: `HStat.India · UN Comtrade · snapshot ${snapshotDate(manifest)}`,
  }
}
