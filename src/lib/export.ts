import { writeXlsx, type Cell, type CellStyle, type SheetSpec } from './xlsx'

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
  document.body.appendChild(link)
  link.click()
  link.remove()

  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
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
 * column called "Global trade (USD)" formats as whole numbers; "Share of
 * heading" formats as a percentage and keeps its underlying fraction, so it
 * still sums and charts correctly.
 *
 * Written with the dashboard's own workbook writer (lib/xlsx) since the
 * Phase 3 refresh: the `xlsx` package has an unfixed advisory and no
 * supported upgrade on npm, and this writer also freezes the header row,
 * which the old one could not.
 */
function styleFor(heading: string): CellStyle {
  const key = heading.toLowerCase()

  if (key.includes('share') || key.includes('%') || key.includes('gap')) return 'pct'
  if (key.includes('rate')) return 'dec1'

  return 'int'
}

function widths(columns: string[], rows: Record<string, unknown>[]): number[] {
  return columns.map(column => {
    const longest = rows.reduce((width, row) => {
      const text = row[column]

      return Math.max(width, text === null || text === undefined ? 0 : String(text).length)
    }, column.length)

    return Math.min(Math.max(longest + 2, 10), 52)
  })
}

function sheetFrom(label: string, rows: Record<string, unknown>[]): SheetSpec {
  const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row))))

  const header: Cell[] = columns.map(column => ({ v: column, s: 'header' }))

  const body: Cell[][] = rows.map(row =>
    columns.map(column => {
      const value = row[column]

      if (typeof value === 'number') {
        return Number.isFinite(value) ? { v: value, s: styleFor(column) } : { v: null }
      }

      return { v: value === null || value === undefined ? null : String(value), s: 'text' }
    }),
  )

  return {
    name: label,
    rows: [header, ...body],
    cols: widths(columns, rows),
    freezeRows: 1,
    autofilter: { from: [0, 0], to: [rows.length, columns.length - 1] },
  }
}

export function downloadXlsx(
  name: string,
  sheets: Record<string, Record<string, unknown>[]>,
  meta?: ExportMeta,
) {
  const specs: SheetSpec[] = []

  /* The About sheet goes first so it is what opens. A workbook that cannot
   * say which code and which year it describes is not evidence of anything. */
  if (meta) {
    specs.push({
      name: 'About',
      rows: [
        [{ v: 'HStat.India export', s: 'title' }],
        [],
        ...metaPairs(meta).map(([key, value]): Cell[] => [
          { v: key, s: 'label' },
          { v: value, s: 'text' },
        ]),
      ],
      cols: [18, 92],
    })
  }

  for (const [label, rows] of Object.entries(sheets)) {
    if (!rows?.length) continue

    specs.push(sheetFrom(label, rows))
  }

  if (!specs.length) return

  const bytes = writeXlsx(specs, { title: meta?.title ?? name })

  save(
    new Blob([bytes as Uint8Array<ArrayBuffer>], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${name}-${stamp()}.xlsx`,
  )
}
