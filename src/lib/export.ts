import * as XLSX from 'xlsx'
import { toPng, toSvg } from 'html-to-image'

/*
 * Downloads.
 *
 * A file that leaves this dashboard is read somewhere else, by someone who
 * cannot see the page it came from. That sets the bar: it has to say what it
 * is, the numbers have to arrive as numbers, and a blank has to be
 * distinguishable from a zero.
 *
 * The three failures this replaces were all of that kind. Every CSV field was
 * quoted, so Excel imported the figures as text and would not sum them.
 * There was no byte-order mark, so country names with accents arrived
 * mangled. And nothing carried the code, the year, the units or the source,
 * so a sheet on someone's desktop a week later was unattributable.
 */

/* Provenance, written into the head of every file. */
export type ExportMeta = {
  title: string
  code?: string
  level?: number
  description?: string
  period?: string
  currency?: string
  rate?: string
  source?: string
  snapshot?: string
  notes?: string[]
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function metaPairs(meta?: ExportMeta): [string, string][] {
  if (!meta) return []

  const rows: [string, string][] = [['Title', meta.title]]

  if (meta.code) {
    rows.push(['HS code', `HS-${meta.level ?? 6} ${meta.code}`])
  }

  if (meta.description) rows.push(['Definition', meta.description])
  if (meta.period) rows.push(['Period', meta.period])
  if (meta.currency) rows.push(['Currency', meta.currency])
  if (meta.rate) rows.push(['Exchange rate', meta.rate])

  rows.push(['Source', meta.source ?? 'UN Comtrade, via HStat.India'])

  if (meta.snapshot) rows.push(['Snapshot built', meta.snapshot])

  rows.push(['Downloaded', new Date().toISOString()])

  for (const note of meta.notes ?? []) rows.push(['Note', note])

  return rows
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')

  link.href = url
  link.download = filename
  link.click()

  URL.revokeObjectURL(url)
}

export function downloadJson(name: string, data: unknown, meta?: ExportMeta) {
  const payload = meta
    ? { about: Object.fromEntries(metaPairs(meta)), data }
    : data

  save(
    new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    }),
    `${name}-${stamp()}.json`,
  )
}

/*
 * A CSV field only needs quoting if it contains a comma, a quote or a
 * newline. Quoting everything is what turned every figure in these exports
 * into text; a number written bare is a number when it lands.
 */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return ''

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : ''
  }

  const text = String(value)

  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function downloadCsv(
  name: string,
  rows: Record<string, unknown>[],
  meta?: ExportMeta,
) {
  if (!rows.length) return

  const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row))))

  const lines: string[] = []

  /* Commented provenance. Excel and pandas both skip these with one
   * argument; a reader with neither still sees where the file came from. */
  for (const [key, value] of metaPairs(meta)) {
    lines.push(`# ${key}: ${String(value).replaceAll('\n', ' ')}`)
  }

  if (lines.length) lines.push('#')

  lines.push(columns.map(csvField).join(','))

  for (const row of rows) {
    lines.push(columns.map(column => csvField(row[column])).join(','))
  }

  /* The BOM is what stops Excel on Windows mangling accented country
   * names and the rupee sign. */
  save(
    new Blob(['﻿' + lines.join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    }),
    `${name}-${stamp()}.csv`,
  )
}

/*
 * Number formats are inferred from the column heading, which is why the
 * headings in these workbooks are written out in full with their units. A
 * column called "Global trade (USD)" formats as currency; "Share of heading"
 * formats as a percentage and keeps its underlying fraction, so it still
 * sums and charts correctly.
 */
function numberFormat(heading: string): string | null {
  const key = heading.toLowerCase()

  if (key.includes('share') || key.includes('%') || key.includes('gap')) {
    return '0.0%'
  }

  if (key.includes('(usd)') || key.includes('(₹)') || key.includes('(inr)')) {
    return '#,##0'
  }

  if (key.includes('rate')) return '0.000'

  if (key.includes('rank') || key.includes('lines') || key.includes('count')) {
    return '0'
  }

  return null
}

function columnWidths(
  columns: string[],
  rows: Record<string, unknown>[],
): { wch: number }[] {
  return columns.map(column => {
    const longest = rows.reduce((width, row) => {
      const text = row[column]

      return Math.max(
        width,
        text === null || text === undefined ? 0 : String(text).length,
      )
    }, column.length)

    return { wch: Math.min(Math.max(longest + 2, 10), 52) }
  })
}

function sheetFrom(rows: Record<string, unknown>[]): XLSX.WorkSheet {
  const sheet = XLSX.utils.json_to_sheet(rows)

  if (!rows.length) return sheet

  const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row))))

  sheet['!cols'] = columnWidths(columns, rows)

  /* An autofilter on the header row, which is what makes a thirty-year
   * sheet usable. Frozen panes are a SheetJS Pro feature and are not
   * available here, so they are not attempted. */
  sheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: rows.length, c: columns.length - 1 },
    }),
  }

  columns.forEach((column, index) => {
    const format = numberFormat(column)

    if (!format) return

    for (let row = 1; row <= rows.length; row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: index })]

      if (cell && cell.t === 'n') cell.z = format
    }
  })

  return sheet
}

export function downloadXlsx(
  name: string,
  sheets: Record<string, Record<string, unknown>[]>,
  meta?: ExportMeta,
) {
  const book = XLSX.utils.book_new()

  /* The About sheet goes first so it is what opens. A workbook that cannot
   * say which code and which year it describes is not evidence of anything. */
  if (meta) {
    const about = XLSX.utils.aoa_to_sheet([
      ['HStat.India export'],
      [],
      ...metaPairs(meta),
    ])

    about['!cols'] = [{ wch: 18 }, { wch: 92 }]

    XLSX.utils.book_append_sheet(book, about, 'About')
  }

  for (const [label, rows] of Object.entries(sheets)) {
    if (!rows?.length) continue

    XLSX.utils.book_append_sheet(book, sheetFrom(rows), label.slice(0, 31))
  }

  if (!book.SheetNames.length) return

  XLSX.writeFile(book, `${name}-${stamp()}.xlsx`)
}

/*
 * Charts are exported onto the page's own background rather than onto
 * transparency. A transparent PNG dropped into a slide deck loses its axis
 * labels against a dark background and its gridlines against a light one,
 * which is the same picture failing in both directions.
 */
export async function downloadChart(
  id: string,
  name: string,
  format: 'png' | 'svg',
) {
  const node = document.getElementById(id)

  if (!node) return

  const background = getComputedStyle(document.body).backgroundColor || '#fff'

  const url =
    format === 'png'
      ? await toPng(node, { pixelRatio: 2, backgroundColor: background })
      : await toSvg(node, { backgroundColor: background })

  const link = document.createElement('a')

  link.href = url
  link.download = `${name}-${stamp()}.${format}`
  link.click()
}
