/*
 * Downloads, rebuilt (execution prompt Phase 3, §3.2).
 *
 * One workbook per page:
 *
 *   Summary    the page's headline figures, laid out to be read: logo, code,
 *              period, currency, snapshot date, then the figures and a key
 *   then one sheet per table on the page, each carrying the FULL data the
 *   snapshot holds - every reporter, every year - not the rows on screen.
 *
 * Every data sheet: a provenance block (code, period, flow, snapshot,
 * source), human headers with units in the header, numbers stored as
 * numbers with real formats, set widths, a frozen header row, an autofilter,
 * and an Estimated flag plus an Estimated share column on every value table.
 * Variants of one table are one sheet with a dimension column (Year, Flow)
 * rather than a sheet each. India's DGCIS tariff lines keep their own sheet
 * and are never placed in a table with Comtrade data.
 *
 * The same table specs drive the per-table CSVs, so a CSV and its sheet have
 * the same columns and the same rows.
 */
import type { DownloadRequest } from '../components/ProductPage'
import type { Hs8DownloadRequest } from '../components/Hs8View'
import type { CatalogueEntry, CurrencyMode, HsNode, Manifest } from '../types'
import { writeXlsx, type Cell, type CellStyle, type SheetSpec } from './xlsx'
import { headlineFor, loadDetail, rankingFor, type RankKind, type ScopeSummary } from './scope'
import { flowWord, flowsOf, formatPeriod, monthGrid, seriesFor, type DgcisFlow, type DgcisNode } from './dgcis'
/* Files keep the designed precision: the on-screen Decimals choice is for
 * reading, and never changes what a download says. */
import { monthLabel, nameOf, ordinal, pctFixed as pct, usdFixed as usd } from './format'

export type PageContext = {
  manifest: Manifest
  currency: CurrencyMode
}

export type ColumnKind = 'text' | 'int' | 'pct' | 'dec1' | 'flag' | 'year'

export type ColumnSpec = { label: string; kind: ColumnKind; width?: number }

export type TableSpec = {
  key: string
  /* Sheet name: short, unique, human. */
  sheet: string
  title: string
  provenance: string
  columns: ColumnSpec[]
  rows: (string | number | null)[][]
  note?: string
}

export type SummarySpec = {
  title: string
  subtitle: string
  facts: [string, string][]
  headline: { heading: string; rows: [string, string | number, CellStyle?][] }
  markers: string[]
  notes: string[]
}

export type PageDownload = {
  filename: string
  summary: SummarySpec
  tables: TableSpec[]
}

const FED = 'Foundation for Economic Development'

function stamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function snapshotDate(manifest: Manifest): string {
  return new Date(manifest.refreshedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()

  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

let logoBytes: Promise<Uint8Array | null> | null = null

export function loadLogoPng(): Promise<Uint8Array | null> {
  if (!logoBytes) {
    logoBytes = fetch('/brand/fed-logo.png')
      .then(response => (response.ok ? response.arrayBuffer() : null))
      .then(buffer => (buffer ? new Uint8Array(buffer) : null))
      .catch(() => null)
  }

  return logoBytes
}

/* ------------------------------------------------------------ sheets */

const STYLE_OF: Record<ColumnKind, CellStyle> = {
  text: 'text',
  int: 'int',
  pct: 'pct',
  dec1: 'dec1',
  flag: 'flag',
  year: 'text',
}

function widthOf(column: ColumnSpec, rows: TableSpec['rows'], index: number): number {
  if (column.width) return column.width

  const longest = rows.slice(0, 400).reduce((width, row) => {
    const value = row[index]

    if (value === null || value === undefined) return width

    const text = typeof value === 'number' ? value.toLocaleString('en-GB', { maximumFractionDigits: 1 }) : String(value)

    return Math.max(width, text.length)
  }, 0)

  return Math.min(Math.max(longest + 3, Math.min(column.label.length + 2, 26), 8), 60)
}

function tableSheet(table: TableSpec): SheetSpec {
  const header = 4
  const rows: SheetSpec['rows'] = [
    [{ v: table.title, s: 'section' }],
    [{ v: table.provenance, s: 'meta' }],
    [{ v: table.note ?? '', s: 'meta' }],
    table.columns.map(column => ({ v: column.label, s: 'header' as const })),
    ...table.rows.map(row =>
      row.map((value, index): Cell => {
        const kind = table.columns[index]?.kind ?? 'text'

        if (value === null || value === undefined || value === '') return { v: null, s: STYLE_OF[kind] }

        if (kind === 'year') return { v: typeof value === 'number' ? value : String(value), s: 'text' }

        return { v: value, s: STYLE_OF[kind] }
      }),
    ),
  ]

  const last = table.columns.length - 1

  return {
    name: table.sheet,
    rows,
    cols: table.columns.map((column, index) => widthOf(column, table.rows, index)),
    freezeRows: header,
    autofilter: table.rows.length
      ? { from: [header - 1, 0], to: [header - 1 + table.rows.length, last] }
      : undefined,
    merges: [
      [0, 0, 0, Math.max(last, 3)],
      [1, 0, 1, Math.max(last, 3)],
      [2, 0, 2, Math.max(last, 3)],
    ],
    heights: { 1: 30, 2: table.note ? 30 : 15, 3: 32 },
  }
}

function summarySheet(summary: SummarySpec, tables: TableSpec[], logo: Uint8Array | null): SheetSpec {
  const rows: SheetSpec['rows'] = []
  const merges: [number, number, number, number][] = []

  const push = (row: SheetSpec['rows'][number], merge = false) => {
    rows.push(row)

    if (merge) merges.push([rows.length - 1, 0, rows.length - 1, 2])
  }

  const blank = (): SheetSpec['rows'][number] => [{ v: null, s: 'default' }]

  push(blank())
  push(blank())
  push(blank())
  push([{ v: summary.title, s: 'title' }], true)
  push([{ v: summary.subtitle, s: 'meta' }], true)
  push(blank())

  for (const [label, value] of summary.facts) {
    push([{ v: label, s: 'bold' }, { v: value, s: 'text' }])
  }

  push(blank())
  push([{ v: summary.headline.heading, s: 'section' }, { v: null, s: 'section' }, { v: null, s: 'section' }])

  for (const [label, value, style] of summary.headline.rows) {
    push([
      { v: label, s: 'label' },
      { v: value, s: style ?? (typeof value === 'number' ? 'figure' : 'label') },
    ])
  }

  push(blank())
  push([{ v: 'In this workbook', s: 'section' }, { v: null, s: 'section' }, { v: null, s: 'section' }])

  for (const table of tables) {
    push([{ v: table.sheet, s: 'bold' }, { v: table.title, s: 'text' }])
  }

  if (summary.markers.length) {
    push(blank())
    push([{ v: 'Key', s: 'section' }, { v: null, s: 'section' }, { v: null, s: 'section' }])

    for (const marker of summary.markers) push([{ v: marker, s: 'note' }], true)
  }

  if (summary.notes.length) {
    push(blank())
    push([{ v: 'Notes', s: 'section' }, { v: null, s: 'section' }, { v: null, s: 'section' }])

    for (const note of summary.notes) push([{ v: note, s: 'note' }], true)
  }

  const heights: Record<number, number> = { 0: 20, 1: 20, 2: 20, 3: 26 }

  rows.forEach((row, index) => {
    const first = row[0] as Cell | null

    if (first && typeof first === 'object' && first.s === 'note' && String(first.v ?? '').length > 110) {
      heights[index] = 30
    }
  })

  return {
    name: 'Summary',
    rows,
    cols: [34, 26, 70],
    merges,
    heights,
    image: logo ? { png: logo, widthPx: 230, heightPx: 60, col: 0, row: 0 } : undefined,
  }
}

export async function saveWorkbook(download: PageDownload): Promise<void> {
  const logo = await loadLogoPng()

  const sheets = [summarySheet(download.summary, download.tables, logo), ...download.tables.map(tableSheet)]

  const bytes = writeXlsx(sheets, { title: download.summary.title, subject: download.summary.subtitle, creator: `HStat.India · ${FED}` })

  save(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${download.filename}-${stamp()}.xlsx`,
  )
}

function csvField(value: unknown): string {
  if (value === null || value === undefined) return ''

  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''

  const text = String(value)

  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function saveTableCsv(download: PageDownload, table: TableSpec): void {
  const lines = [
    `# ${table.title}`,
    `# ${table.provenance}`,
    ...(table.note ? [`# ${table.note}`] : []),
    `# ${download.summary.title} · HStat.India, ${FED}`,
    '#',
    table.columns.map(column => csvField(column.label)).join(','),
    ...table.rows.map(row => row.map(csvField).join(',')),
  ]

  save(
    new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
    `${download.filename}-${table.key}-${stamp()}.csv`,
  )
}

/* -------------------------------------------------- product pages */

const yesNo = (flag: boolean) => (flag ? 'Yes' : 'No')

const round3 = (value: number) => Math.round(value * 1000) / 1000

function grossOf(node: HsNode, year: string): number | null {
  const record = node.annual[year]

  if (!record || record.global.trade === null) return null

  return record.global.observed.grossImports ?? record.global.trade
}

function estimatedShareOf(node: HsNode, year: string): number | null {
  const estimation = node.annual[year]?.global.estimation?.imports

  if (!estimation) return null

  return estimation.estimatedGrossShare ?? estimation.estimatedShare ?? null
}

export async function buildProductDownload(request: DownloadRequest, context: PageContext): Promise<PageDownload> {
  const { node, year } = request
  const detail = request.detail ?? (await loadDetail('current', node.code))
  const snapshot = snapshotDate(context.manifest)
  const label = `HS-${node.level} ${node.code}`
  const name = nameOf(node)
  const headline = headlineFor(node, year)
  const years = [...node.years].sort((a, b) => b - a)
  const lineage = node.lineage

  const provenance = (period: string, flow?: string) =>
    [label, name, period, flow ? `Flow: ${flow}` : null, `Snapshot: ${snapshot}`, 'Source: UN Comtrade via HStat.India']
      .filter(Boolean)
      .join(' · ')

  const tables: TableSpec[] = []

  /* Trend, with any predecessor's own series in the same table. */
  const trendRows: TableSpec['rows'] = []

  for (const item of years) {
    const key = String(item)
    const record = node.annual[key]

    if (!record) continue

    const gross = grossOf(node, key)
    const share = estimatedShareOf(node, key)

    if (gross === null && record.india.imports === null && record.india.exports === null) continue

    trendRows.push([
      item,
      node.code,
      '',
      gross,
      yesNo((share ?? 0) > 0),
      gross === null ? null : share ?? 0,
      record.global.trade,
      record.india.imports,
      record.india.exports,
      String((record.global.coverage as { gateStatus?: string })?.gateStatus ?? record.global.coverage?.status ?? record.global.tradeStatus ?? ''),
      '',
    ])
  }

  for (const [code, series] of Object.entries(lineage?.series ?? {})) {
    for (const [item, values] of Object.entries(series).sort((a, b) => Number(b[0]) - Number(a[0]))) {
      trendRows.push([
        Number(item),
        code,
        `HS ${code} **`,
        values.globalTrade,
        'No',
        values.globalTrade === null ? null : 0,
        null,
        values.indiaImports,
        values.indiaExports,
        '',
        `Predecessor HS ${code}, as it was reported. Shown beside HS ${node.code}, never added to it.`,
      ])
    }
  }

  tables.push({
    key: 'trend',
    sheet: 'Trend',
    title: 'Global Trade and India Trade over Time',
    provenance: provenance(`Calendar years ${years[years.length - 1]}–${years[0]}`),
    note: 'Global Trade is gross: world imports as filed, plus estimates for economies that have not filed. Net of re-imports is shown for reference.',
    columns: [
      { label: 'Year', kind: 'year', width: 8 },
      { label: 'HS code', kind: 'text', width: 10 },
      { label: 'Carried from', kind: 'text', width: 14 },
      { label: 'Global Trade (USD)', kind: 'int', width: 20 },
      { label: 'Estimated', kind: 'flag', width: 11 },
      { label: 'Estimated share', kind: 'pct', width: 12 },
      { label: 'Net of re-imports (USD)', kind: 'int', width: 20 },
      { label: 'India Imports (USD)', kind: 'int', width: 18 },
      { label: 'India Exports (USD)', kind: 'int', width: 18 },
      { label: 'Coverage verdict', kind: 'text', width: 14 },
      { label: 'Series note', kind: 'text', width: 60 },
    ],
    rows: trendRows,
  })

  /* World rankings: every reporter the snapshot holds, every year, one sheet. */
  const worldRows: TableSpec['rows'] = []
  let worldPartial = false

  for (const item of years) {
    for (const kind of ['importers', 'exporters'] as RankKind[]) {
      const ranking = rankingFor(kind, node, item, detail)

      if (!ranking.rows.length) continue

      if (!ranking.complete) worldPartial = true

      for (const row of ranking.rows) {
        worldRows.push([
          item,
          kind === 'importers' ? 'Imports' : 'Exports',
          row.rank,
          row.name,
          row.code,
          row.value,
          row.share,
          yesNo(row.estimated),
          row.estimated ? 1 : 0,
          ranking.basis === 'net' ? 'Net' : 'Gross',
        ])
      }
    }
  }

  tables.push({
    key: 'world-rankings',
    sheet: 'World Rankings',
    title: 'Top Importers and Exporters, every year',
    provenance: provenance('All years', 'Imports and exports'),
    note: worldPartial
      ? `Full country lists from ${detail?.fullListsFrom ?? 2016}; earlier years carry the largest ${detail ? 25 : 10}. Shares are of the world total for that flow and year.`
      : 'Shares are of the world total for that flow and year.',
    columns: [
      { label: 'Year', kind: 'year', width: 8 },
      { label: 'Flow', kind: 'text', width: 9 },
      { label: 'Rank', kind: 'int', width: 7 },
      { label: 'Country', kind: 'text', width: 28 },
      { label: 'Comtrade code', kind: 'text', width: 9 },
      { label: 'Value (USD)', kind: 'int', width: 18 },
      { label: 'Share of world total', kind: 'pct', width: 12 },
      { label: 'Estimated', kind: 'flag', width: 11 },
      { label: 'Estimated share', kind: 'pct', width: 12 },
      { label: 'Basis', kind: 'text', width: 8 },
    ],
    rows: worldRows,
  })

  /* India's partners, both flows, every year. */
  const partnerRows: TableSpec['rows'] = []

  for (const item of years) {
    for (const kind of ['indiaSuppliers', 'indiaDestinations'] as RankKind[]) {
      const ranking = rankingFor(kind, node, item, detail)

      for (const row of ranking.rows) {
        partnerRows.push([
          item,
          kind === 'indiaSuppliers' ? 'Imports' : 'Exports',
          row.rank,
          row.name,
          row.code,
          row.value,
          row.share,
          'No',
          0,
        ])
      }
    }
  }

  if (partnerRows.length) {
    tables.push({
      key: 'india-partners',
      sheet: 'India Partners',
      title: "India Import and Export Partners, every year",
      provenance: provenance('All years', 'Imports and exports'),
      note: "India's own bilateral filings. Shares are of India's own total for this line, flow and year, so each year and flow sums to 100%.",
      columns: [
        { label: 'Year', kind: 'year', width: 8 },
        { label: 'Flow', kind: 'text', width: 9 },
        { label: 'Rank', kind: 'int', width: 7 },
        { label: 'Partner', kind: 'text', width: 28 },
        { label: 'Comtrade code', kind: 'text', width: 9 },
        { label: 'Value (USD)', kind: 'int', width: 18 },
        { label: "Share of India's total", kind: 'pct', width: 13 },
        { label: 'Estimated', kind: 'flag', width: 11 },
        { label: 'Estimated share', kind: 'pct', width: 12 },
      ],
      rows: partnerRows,
    })
  }

  /* What is inside a heading, every year. */
  if (request.children.length) {
    const insideRows: TableSpec['rows'] = []

    for (const item of years) {
      const key = String(item)
      const parentGross = grossOf(node, key)

      for (const child of request.children) {
        const gross = grossOf(child, key)
        const record = child.annual[key]
        const share = estimatedShareOf(child, key)

        if (gross === null && !record?.india.imports && !record?.india.exports) continue

        insideRows.push([
          item,
          child.code,
          nameOf(child),
          gross,
          yesNo((share ?? 0) > 0),
          gross === null ? null : share ?? 0,
          gross !== null && parentGross ? gross / parentGross : null,
          record?.india.imports ?? null,
          record?.india.exports ?? null,
        ])
      }
    }

    tables.push({
      key: 'inside',
      sheet: node.level === 2 ? 'Headings' : 'Lines',
      title: node.level === 2 ? `HS-4 headings in chapter ${node.code}, every year` : `HS-6 lines in heading ${node.code}, every year`,
      provenance: provenance('All years'),
      note: `Each code's own published figure, and its share of ${label}'s own figure. Nothing is apportioned.`,
      columns: [
        { label: 'Year', kind: 'year', width: 8 },
        { label: 'HS code', kind: 'text', width: 10 },
        { label: 'Name', kind: 'text', width: 40 },
        { label: 'Global Trade (USD)', kind: 'int', width: 20 },
        { label: 'Estimated', kind: 'flag', width: 11 },
        { label: 'Estimated share', kind: 'pct', width: 12 },
        { label: `Share of ${label}`, kind: 'pct', width: 13 },
        { label: 'India Imports (USD)', kind: 'int', width: 18 },
        { label: 'India Exports (USD)', kind: 'int', width: 18 },
      ],
      rows: insideRows,
    })
  }

  /* India monthly, from Comtrade. */
  if (node.months.length) {
    tables.push({
      key: 'india-monthly',
      sheet: 'India Monthly',
      title: 'India Imports and Exports, monthly',
      provenance: provenance(`${monthLabel(node.months[0])} – ${monthLabel(node.months[node.months.length - 1])}`),
      note: 'India reporting to UN Comtrade, monthly. Recent months may be incomplete.',
      columns: [
        { label: 'Month', kind: 'text', width: 11 },
        { label: 'India Imports (USD)', kind: 'int', width: 18 },
        { label: 'India Exports (USD)', kind: 'int', width: 18 },
        { label: 'Estimated', kind: 'flag', width: 11 },
        { label: 'Estimated share', kind: 'pct', width: 12 },
      ],
      rows: [...node.months]
        .sort()
        .reverse()
        .map(period => [
          monthLabel(period),
          node.monthly[period]?.india.imports ?? null,
          node.monthly[period]?.india.exports ?? null,
          'No',
          0,
        ]),
    })
  }

  /* India's own tariff lines: their own sheet, never beside Comtrade rows. */
  if (request.dgcis) tables.push(dgcisTable(request.dgcis, snapshot))

  const estimated = (headline.globalEstimatedShare ?? 0) > 0
  const record = node.annual[String(year)]

  return {
    filename: `HStat-${node.code}`,
    summary: {
      title: `${name} — ${label}`,
      subtitle: `HStat.India · ${FED}`,
      facts: [
        ['HS code', label],
        ['Product', name],
        ['Official description', node.description],
        ['Segment and category', [node.segment, node.category].filter(Boolean).join(' · ')],
        ['Headline period', `Calendar year ${year}`],
        ['Tables cover', `Calendar years ${years[years.length - 1]}–${years[0]}`],
        ['Currency', 'US dollars'],
        ['Snapshot', snapshot],
        ['Source', 'UN Comtrade; India tariff lines from DGCIS'],
      ],
      headline: {
        heading: `Headline · CY ${year}`,
        rows: [
          ['Global Trade (USD)', headline.global ?? 'Not published'],
          ['Estimated share of Global Trade', headline.global === null ? '—' : pct(headline.globalEstimatedShare ?? 0, 1), 'label'],
          ['Net of re-imports (USD)', headline.net ?? '—'],
          ['India Exports (USD)', headline.indiaExports ?? '—'],
          ['India Imports (USD)', headline.indiaImports ?? '—'],
          ['India: Export Ranking', headline.indiaExportRank ? `${ordinal(headline.indiaExportRank)} · ${pct(headline.indiaExportShare, 1)} of world exports` : '—', 'label'],
          ['India: Import Ranking', headline.indiaImportRank ? `${ordinal(headline.indiaImportRank)} · ${pct(headline.indiaImportShare, 1)} of world imports` : '—', 'label'],
          ['Coverage verdict', String((record?.global.coverage as { gateStatus?: string })?.gateStatus ?? record?.global.coverage?.status ?? '—'), 'label'],
        ],
      },
      markers: [
        ...(estimated || trendRows.some(row => row[4] === 'Yes')
          ? ['Estimated = Yes: the value contains estimates for economies that have not filed; Estimated share is the estimated part of it.']
          : []),
        ...(trendRows.some(row => String(row[2] ?? '').includes('**'))
          ? ['** in Carried from: the row is a retired predecessor’s own series, as it was reported under its own code. It sits beside the successor and is never added to it.']
          : []),
      ],
      notes: [
        'Global Trade is gross: every reporting economy’s imports from the world as filed, plus estimates where an economy has not filed, projected from its own history of this code. Filed values are never changed.',
        'Import totals are valued CIF and export totals FOB, so the two sides are not comparable line for line.',
        'Comtrade figures are calendar years. The DGCIS sheet is India reporting its own trade, monthly; partner “World” there means India with everywhere, not world trade.',
      ],
    },
    tables,
  }
}

function dgcisTable(data: DgcisNode, snapshot: string): TableSpec {
  const described = new Map(data.lines.map(line => [line.hs8, line]))
  const rows: TableSpec['rows'] = []

  for (const flow of flowsOf(data)) {
    const block = data.flows[flow]

    if (!block) continue

    for (const hs8 of Object.keys(block.series).sort()) {
      const series = block.series[hs8]
      const line = described.get(hs8)

      data.periods.forEach((period, position) => {
        const inr = series.inrCrore[position]
        const usdMn = series.usdMillion[position]

        if (inr === null && usdMn === null) return

        rows.push([
          flowWord(flow),
          hs8,
          line?.title || '',
          line?.principalCommodity ?? '',
          formatPeriod(period),
          usdMn,
          inr,
          'No',
          0,
        ])
      })
    }
  }

  return {
    key: 'india-hs8-dgcis',
    sheet: 'India HS-8 · DGCIS',
    title: `India's tariff lines under HS ${data.hs6} — DGCIS, monthly`,
    provenance: `HS ${data.hs6} · ${data.reporter} reporting, partner ${data.partner} · Snapshot: ${snapshot} · Source: DGCIS / Trade Intelligence & Analytics`,
    note: 'India reporting its own trade. Partner "World" means India with everywhere, not world trade. USD million and INR crore are both as filed and are never converted between each other. Reported data; never estimated.',
    columns: [
      { label: 'Flow', kind: 'text', width: 9 },
      { label: 'HS-8', kind: 'text', width: 11 },
      { label: 'Name', kind: 'text', width: 28 },
      { label: 'DGCIS commodity group', kind: 'text', width: 26 },
      { label: 'Month', kind: 'text', width: 10 },
      { label: 'Value (USD million)', kind: 'dec1', width: 14 },
      { label: 'Value (INR crore)', kind: 'dec1', width: 14 },
      { label: 'Estimated', kind: 'flag', width: 11 },
      { label: 'Estimated share', kind: 'pct', width: 12 },
    ],
    rows,
  }
}

/* --------------------------------------------------------- HS-8 page */

export function buildHs8Download(request: Hs8DownloadRequest, context: PageContext): PageDownload {
  const { hs8, data, line } = request
  const snapshot = snapshotDate(context.manifest)
  const title = line.title ? `${line.title} — HS-8 ${hs8}` : `Tariff line HS-8 ${hs8}`
  const provenance = (period: string, flow?: string) =>
    [`HS-8 ${hs8}`, `under HS ${data.hs6}`, period, flow ? `Flow: ${flow}` : null, `Snapshot: ${snapshot}`, 'Source: DGCIS']
      .filter(Boolean)
      .join(' · ')

  const annual: TableSpec['rows'] = []

  for (const basis of ['CY', 'FY'] as const) {
    for (const flow of flowsOf(data)) {
      const usdSeries = seriesFor(data, flow, hs8, 'usd')
      const inrSeries = seriesFor(data, flow, hs8, 'inr')

      if (!usdSeries) continue

      const usdGrid = monthGrid(usdSeries, data.periods, basis)
      const inrGrid = inrSeries ? monthGrid(inrSeries, data.periods, basis) : []

      for (const row of usdGrid) {
        const inrRow = inrGrid.find(item => item.label === row.label)
        const total = row.months.reduce<number>((sum, value) => sum + (value ?? 0), 0)

        annual.push([
          row.label,
          basis === 'CY' ? 'Calendar' : 'Financial',
          flowWord(flow),
          row.filled,
          round3(total),
          inrRow ? round3(inrRow.months.reduce<number>((sum, value) => sum + (value ?? 0), 0)) : null,
          row.last12 === null ? null : round3(row.last12),
          row.last12To ? formatPeriod(row.last12To) : '',
          'No',
          0,
        ])
      }
    }
  }

  const monthly: TableSpec['rows'] = []

  for (const flow of flowsOf(data)) {
    const usdSeries = seriesFor(data, flow, hs8, 'usd')
    const inrSeries = seriesFor(data, flow, hs8, 'inr')

    data.periods.forEach((period, position) => {
      const usdMn = usdSeries?.[position] ?? null
      const inr = inrSeries?.[position] ?? null

      if (usdMn === null && inr === null) return

      monthly.push([flowWord(flow), formatPeriod(period), usdMn, inr, 'No', 0])
    })
  }

  const exportsTwelve = (() => {
    const series = seriesFor(data, 'exports', hs8, 'usd')

    return series ? monthGrid(series, data.periods, 'CY')[0]?.last12 ?? null : null
  })()

  const importsTwelve = (() => {
    const series = seriesFor(data, 'imports', hs8, 'usd')

    return series ? monthGrid(series, data.periods, 'CY')[0]?.last12 ?? null : null
  })()

  const last = data.periods[data.periods.length - 1] ?? null

  return {
    filename: `HStat-${hs8}`,
    summary: {
      title,
      subtitle: `HStat.India · ${FED}`,
      facts: [
        ['Tariff line', `ITC(HS) ${hs8}`],
        ['Heading', `HS ${data.hs6}${line.headingName ? ` — ${line.headingName}` : ''}`],
        ['DGCIS commodity group', line.principalCommodity || '—'],
        ['Period', `${formatPeriod(data.periods[0] ?? null)} – ${formatPeriod(last)}`],
        ['Currency', 'USD million and INR crore, both as filed'],
        ['Snapshot', snapshot],
        ['Source', 'DGCIS / Trade Intelligence & Analytics, India reporting'],
      ],
      headline: {
        heading: `Last 12 months to ${formatPeriod(last)}`,
        rows: [
          ['India Exports (USD million)', exportsTwelve ?? '—', 'dec1'],
          ['India Imports (USD million)', importsTwelve ?? '—', 'dec1'],
        ],
      },
      markers: [],
      notes: [
        'India reporting its own trade at the eight-digit tariff line. There is no world figure at eight digits; these values are never added to UN Comtrade figures.',
        'Financial years are April to March, regrouped from the same calendar months. Nothing is estimated.',
      ],
    },
    tables: [
      {
        key: 'annual',
        sheet: 'Annual',
        title: 'Annual totals, calendar and financial years',
        provenance: provenance('All years', 'Exports and imports'),
        note: 'Last 12 months is the twelve months ending at that row’s latest filed month.',
        columns: [
          { label: 'Year', kind: 'text', width: 11 },
          { label: 'Year basis', kind: 'text', width: 11 },
          { label: 'Flow', kind: 'text', width: 9 },
          { label: 'Months filed', kind: 'int', width: 9 },
          { label: 'Total (USD million)', kind: 'dec1', width: 14 },
          { label: 'Total (INR crore)', kind: 'dec1', width: 14 },
          { label: 'Last 12 months (USD million)', kind: 'dec1', width: 16 },
          { label: 'Last 12 months to', kind: 'text', width: 13 },
          { label: 'Estimated', kind: 'flag', width: 11 },
          { label: 'Estimated share', kind: 'pct', width: 12 },
        ],
        rows: annual,
      },
      {
        key: 'monthly',
        sheet: 'Monthly',
        title: 'Every month, both flows',
        provenance: provenance('All months', 'Exports and imports'),
        columns: [
          { label: 'Flow', kind: 'text', width: 9 },
          { label: 'Month', kind: 'text', width: 10 },
          { label: 'Value (USD million)', kind: 'dec1', width: 14 },
          { label: 'Value (INR crore)', kind: 'dec1', width: 14 },
          { label: 'Estimated', kind: 'flag', width: 11 },
          { label: 'Estimated share', kind: 'pct', width: 12 },
        ],
        rows: monthly,
      },
    ],
  }
}

/* --------------------------------------------------------- home page */

export function buildHomeDownload(
  scope: ScopeSummary,
  catalogue: CatalogueEntry[],
  year: number,
  context: PageContext,
): PageDownload {
  const snapshot = snapshotDate(context.manifest)
  const byCode = new Map(catalogue.map(entry => [entry.code, entry]))
  const record = scope.years[String(year)]
  const years = Object.keys(scope.years)
    .filter(item => scope.years[item].lines > 0)
    .sort((a, b) => Number(b) - Number(a))

  const provenance = (period: string, flow?: string) =>
    ['Electronics scope', `${scope.linesInScope} HS-6 lines`, period, flow ? `Flow: ${flow}` : null, `Snapshot: ${snapshot}`, 'Source: UN Comtrade via HStat.India']
      .filter(Boolean)
      .join(' · ')

  const countries: TableSpec['rows'] = []
  const products: TableSpec['rows'] = []

  for (const item of years) {
    const yearRecord = scope.years[item]

    for (const [flow, rows, total] of [
      ['Imports', yearRecord.importers, yearRecord.worldImports],
      ['Exports', yearRecord.exporters, yearRecord.worldExports],
    ] as const) {
      rows.forEach(([code, value, estimated], position) => {
        countries.push([
          Number(item),
          flow,
          position + 1,
          scope.reporters[code] ?? code,
          code,
          value,
          total ? value / total : null,
          yesNo(estimated > 0),
          value ? estimated / value : 0,
        ])
      })
    }

    yearRecord.products.forEach(([code, value, estimatedShare, indiaImports, indiaExports], position) => {
      const entry = byCode.get(code)

      products.push([
        Number(item),
        position + 1,
        code,
        entry ? nameOf(entry) : code,
        entry?.segment ?? '',
        entry?.category ?? '',
        value,
        yearRecord.worldImports ? value / yearRecord.worldImports : null,
        yesNo(estimatedShare > 0),
        estimatedShare,
        indiaImports,
        indiaExports,
      ])
    })
  }

  return {
    filename: `HStat-scope-${year}`,
    summary: {
      title: `Electronics scope — CY ${year}`,
      subtitle: `HStat.India · ${FED}`,
      facts: [
        ['Scope', `${scope.linesInScope} HS-6 lines in the FED electronics definition`],
        ['Headline period', `Calendar year ${year}`],
        ['Tables cover', `Calendar years ${years[years.length - 1]}–${years[0]}`],
        ['Currency', 'US dollars'],
        ['Snapshot', snapshot],
        ['Source', 'UN Comtrade'],
      ],
      headline: {
        heading: `Headline · CY ${year}`,
        rows: record
          ? [
              ['Global Trade (USD)', record.worldImports],
              ['Estimated share of Global Trade', pct(record.worldImports ? record.estimatedImports / record.worldImports : 0, 1), 'label'],
              ['India Exports (USD)', record.indiaExports],
              ['India Imports (USD)', record.indiaImports],
              ['Lines with a published figure', record.lines],
            ]
          : [],
      },
      markers: ['Estimated = Yes: the value contains estimates for economies that have not filed; Estimated share is the estimated part of it.'],
      notes: [
        'Every figure is the sum of the published HS-6 lines for that year, from the same reporter tables the product pages rank.',
        `Global Trade ${usd(record?.worldImports ?? null)} is world imports, gross, for CY ${year}.`,
      ],
    },
    tables: [
      {
        key: 'countries',
        sheet: 'Countries',
        title: 'Top Importers and Exporters across the scope, every year',
        provenance: provenance('All years', 'Imports and exports'),
        note: 'Shares are of the scope total for that flow and year.',
        columns: [
          { label: 'Year', kind: 'year', width: 8 },
          { label: 'Flow', kind: 'text', width: 9 },
          { label: 'Rank', kind: 'int', width: 7 },
          { label: 'Country', kind: 'text', width: 28 },
          { label: 'Comtrade code', kind: 'text', width: 9 },
          { label: 'Value (USD)', kind: 'int', width: 20 },
          { label: 'Share of scope', kind: 'pct', width: 12 },
          { label: 'Estimated', kind: 'flag', width: 11 },
          { label: 'Estimated share', kind: 'pct', width: 12 },
        ],
        rows: countries,
      },
      {
        key: 'products',
        sheet: 'Products',
        title: 'Top Traded Products, every year',
        provenance: provenance('All years', 'World imports'),
        note: 'Ranked at HS-6 only; mixing levels would double-count.',
        columns: [
          { label: 'Year', kind: 'year', width: 8 },
          { label: 'Rank', kind: 'int', width: 7 },
          { label: 'HS-6', kind: 'text', width: 9 },
          { label: 'Product', kind: 'text', width: 34 },
          { label: 'Segment', kind: 'text', width: 14 },
          { label: 'Category', kind: 'text', width: 22 },
          { label: 'World imports (USD)', kind: 'int', width: 19 },
          { label: 'Share of scope', kind: 'pct', width: 12 },
          { label: 'Estimated', kind: 'flag', width: 11 },
          { label: 'Estimated share', kind: 'pct', width: 12 },
          { label: 'India Imports (USD)', kind: 'int', width: 18 },
          { label: 'India Exports (USD)', kind: 'int', width: 18 },
        ],
        rows: products,
      },
    ],
  }
}

/* ----------------------------------------------------------- entry */

export async function downloadProductWorkbook(request: DownloadRequest, context: PageContext): Promise<void> {
  await saveWorkbook(await buildProductDownload(request, context))
}

export async function downloadHs8Workbook(request: Hs8DownloadRequest, context: PageContext): Promise<void> {
  await saveWorkbook(buildHs8Download(request, context))
}

export type { DgcisFlow }
