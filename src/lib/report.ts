/*
 * Reports, laid out rather than captured (execution prompt §3.3).
 *
 * The old PDF was a screenshot of the page's DOM pasted onto A4: whatever the
 * browser happened to draw, at whatever width, cut wherever the page ended.
 * This lays a report out from the data itself - FED header and logo, the
 * palette, proper pagination with table headers repeated, a contents page
 * when there is more than one section, and the marker key on every page that
 * carries a marker.
 *
 * Two layouts, chosen at download time:
 *
 *   report   A4 portrait, the sections stacked as the page reads
 *   glance   A4 landscape, one tile per view - where Glance View now lives
 *
 * PNG is drawn by the same layout engine onto canvases, so a PNG and a PDF
 * of the same report agree to the point. Type is Arial on canvas; the PDF
 * uses the PDF base font Helvetica, which shares Arial's metrics, because a
 * PDF cannot carry Arial without embedding a licensed font file.
 */
import { jsPDF } from 'jspdf'

export type ReportLayout = 'report' | 'glance'

export type FigureItem = {
  label: string
  value: string
  caption?: string
  series: 'global' | 'exports' | 'imports' | 'neutral'
  estimated?: boolean
}

export type TableColumn = { label: string; width: number; align?: 'left' | 'right' }

export type ReportBlock =
  | { kind: 'figures'; title?: string; items: FigureItem[] }
  | { kind: 'table'; title?: string; columns: TableColumn[]; rows: string[][]; emphasis?: number[]; note?: string }
  | {
      kind: 'line'
      title?: string
      unit: string
      labels: string[]
      series: { name: string; colour: string; values: (number | null)[] }[]
      format: (value: number) => string
    }
  | { kind: 'bars'; title?: string; colour: string; rows: { label: string; value: number; text: string }[] }
  | { kind: 'text'; text: string }
  | { kind: 'pairs'; title?: string; rows: [string, string][] }

export type ReportSection = { title: string; blocks: ReportBlock[] }

export type ReportDocument = {
  title: string
  subtitle: string
  meta: string[]
  sections: ReportSection[]
  source: string
}

/* ------------------------------------------------------------ palette */

export const INK = {
  indigo: '#133E68',
  ming: '#009F75',
  red: '#9F4A54',
  sky: '#7DE2D1',
  orange: '#FEB95F',
  silver: '#C2C1C2',
  text: '#161616',
  muted: '#444A52',
  faint: '#5F656D',
  rule: '#DADDE1',
  soft: '#F2F5F8',
  white: '#FFFFFF',
}

const SERIES: Record<FigureItem['series'], string> = {
  global: INK.indigo,
  exports: INK.ming,
  imports: INK.red,
  neutral: INK.silver,
}

/* ------------------------------------------------------------ surfaces */

type TextOptions = { size: number; bold?: boolean; color?: string; align?: 'left' | 'right' | 'center' }

interface Surface {
  readonly width: number
  readonly height: number
  pageCount(): number
  goto(page: number): void
  addPage(): void
  text(value: string, x: number, y: number, options: TextOptions): void
  measure(value: string, size: number, bold?: boolean): number
  rect(x: number, y: number, w: number, h: number, options: { fill?: string; stroke?: string; width?: number }): void
  line(x1: number, y1: number, x2: number, y2: number, options: { color: string; width?: number; dash?: number[] }): void
  path(points: [number, number][], options: { color: string; width?: number }): void
  image(data: string, x: number, y: number, w: number, h: number): void
}

class PdfSurface implements Surface {
  readonly doc: jsPDF
  readonly width: number
  readonly height: number

  constructor(orientation: 'portrait' | 'landscape') {
    this.doc = new jsPDF({ orientation, unit: 'pt', format: 'a4', compress: true })
    this.width = this.doc.internal.pageSize.getWidth()
    this.height = this.doc.internal.pageSize.getHeight()
  }

  pageCount() {
    return this.doc.getNumberOfPages()
  }

  goto(page: number) {
    this.doc.setPage(page)
  }

  addPage() {
    this.doc.addPage()
  }

  private font(size: number, bold?: boolean) {
    this.doc.setFont('helvetica', bold ? 'bold' : 'normal')
    this.doc.setFontSize(size)
  }

  text(value: string, x: number, y: number, options: TextOptions) {
    this.font(options.size, options.bold)
    this.doc.setTextColor(options.color ?? INK.text)
    this.doc.text(value, x, y, { align: options.align ?? 'left', baseline: 'alphabetic' })
  }

  measure(value: string, size: number, bold?: boolean) {
    this.font(size, bold)

    return this.doc.getTextWidth(value)
  }

  rect(x: number, y: number, w: number, h: number, options: { fill?: string; stroke?: string; width?: number }) {
    if (options.fill) this.doc.setFillColor(options.fill)
    if (options.stroke) {
      this.doc.setDrawColor(options.stroke)
      this.doc.setLineWidth(options.width ?? 0.75)
    }

    this.doc.rect(x, y, w, h, options.fill && options.stroke ? 'FD' : options.fill ? 'F' : 'S')
  }

  line(x1: number, y1: number, x2: number, y2: number, options: { color: string; width?: number; dash?: number[] }) {
    this.doc.setDrawColor(options.color)
    this.doc.setLineWidth(options.width ?? 0.75)
    this.doc.setLineDashPattern(options.dash ?? [], 0)
    this.doc.line(x1, y1, x2, y2)
    this.doc.setLineDashPattern([], 0)
  }

  path(points: [number, number][], options: { color: string; width?: number }) {
    for (let index = 1; index < points.length; index += 1) {
      this.line(points[index - 1][0], points[index - 1][1], points[index][0], points[index][1], options)
    }
  }

  image(data: string, x: number, y: number, w: number, h: number) {
    this.doc.addImage(data, 'PNG', x, y, w, h)
  }
}

class CanvasSurface implements Surface {
  readonly width: number
  readonly height: number
  readonly scale = 2
  readonly pages: HTMLCanvasElement[] = []
  private current = 0
  private images = new Map<string, HTMLImageElement>()
  private measurer: CanvasRenderingContext2D

  constructor(orientation: 'portrait' | 'landscape', images: Map<string, HTMLImageElement>) {
    this.width = orientation === 'portrait' ? 595.28 : 841.89
    this.height = orientation === 'portrait' ? 841.89 : 595.28
    this.images = images
    this.measurer = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
    this.addPage()
  }

  private get ctx() {
    return this.pages[this.current].getContext('2d') as CanvasRenderingContext2D
  }

  pageCount() {
    return this.pages.length
  }

  goto(page: number) {
    this.current = page - 1
  }

  addPage() {
    const canvas = document.createElement('canvas')

    canvas.width = Math.round(this.width * this.scale)
    canvas.height = Math.round(this.height * this.scale)

    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

    ctx.fillStyle = INK.white
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    this.pages.push(canvas)
    this.current = this.pages.length - 1
  }

  private font(ctx: CanvasRenderingContext2D, size: number, bold?: boolean) {
    ctx.font = `${bold ? 'bold ' : ''}${size * this.scale}px Arial, Helvetica, sans-serif`
  }

  text(value: string, x: number, y: number, options: TextOptions) {
    const ctx = this.ctx

    this.font(ctx, options.size, options.bold)
    ctx.fillStyle = options.color ?? INK.text
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = options.align ?? 'left'
    ctx.fillText(value, x * this.scale, y * this.scale)
  }

  measure(value: string, size: number, bold?: boolean) {
    this.font(this.measurer, size, bold)

    return this.measurer.measureText(value).width / this.scale
  }

  rect(x: number, y: number, w: number, h: number, options: { fill?: string; stroke?: string; width?: number }) {
    const ctx = this.ctx
    const s = this.scale

    if (options.fill) {
      ctx.fillStyle = options.fill
      ctx.fillRect(x * s, y * s, w * s, h * s)
    }

    if (options.stroke) {
      ctx.strokeStyle = options.stroke
      ctx.lineWidth = (options.width ?? 0.75) * s
      ctx.strokeRect(x * s, y * s, w * s, h * s)
    }
  }

  line(x1: number, y1: number, x2: number, y2: number, options: { color: string; width?: number; dash?: number[] }) {
    const ctx = this.ctx
    const s = this.scale

    ctx.strokeStyle = options.color
    ctx.lineWidth = (options.width ?? 0.75) * s
    ctx.setLineDash((options.dash ?? []).map(value => value * s))
    ctx.beginPath()
    ctx.moveTo(x1 * s, y1 * s)
    ctx.lineTo(x2 * s, y2 * s)
    ctx.stroke()
    ctx.setLineDash([])
  }

  path(points: [number, number][], options: { color: string; width?: number }) {
    if (points.length < 2) return

    const ctx = this.ctx
    const s = this.scale

    ctx.strokeStyle = options.color
    ctx.lineWidth = (options.width ?? 1) * s
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(points[0][0] * s, points[0][1] * s)

    for (const [x, y] of points.slice(1)) ctx.lineTo(x * s, y * s)

    ctx.stroke()
  }

  image(data: string, x: number, y: number, w: number, h: number) {
    const image = this.images.get(data)

    if (image) this.ctx.drawImage(image, x * this.scale, y * this.scale, w * this.scale, h * this.scale)
  }

  /* Every page, one under another, as one image. */
  stitched(): HTMLCanvasElement {
    const gap = 24 * this.scale
    const out = document.createElement('canvas')

    out.width = this.pages[0].width
    out.height = this.pages.reduce((sum, page) => sum + page.height, 0) + gap * (this.pages.length - 1)

    const ctx = out.getContext('2d') as CanvasRenderingContext2D

    ctx.fillStyle = '#E1E4E8'
    ctx.fillRect(0, 0, out.width, out.height)

    let y = 0

    for (const page of this.pages) {
      ctx.drawImage(page, 0, y)
      y += page.height + gap
    }

    return out
  }
}

/* ------------------------------------------------------------ logo */

let logoPromise: Promise<{ data: string; image: HTMLImageElement } | null> | null = null

function loadLogo() {
  if (!logoPromise) {
    logoPromise = fetch('/brand/fed-logo-print.png')
      .then(response => (response.ok ? response.blob() : null))
      .then(
        blob =>
          new Promise<{ data: string; image: HTMLImageElement } | null>(resolve => {
            if (!blob) return resolve(null)

            const reader = new FileReader()

            reader.onload = () => {
              const data = String(reader.result)
              const image = new Image()

              image.onload = () => resolve({ data, image })
              image.onerror = () => resolve(null)
              image.src = data
            }

            reader.onerror = () => resolve(null)
            reader.readAsDataURL(blob)
          }),
      )
      .catch(() => null)
  }

  return logoPromise
}

/* ------------------------------------------------------------ layout */

const LOGO_RATIO = 1228 / 321

class Composer {
  readonly margin: number
  readonly top: number
  readonly bottom: number
  y = 0
  page = 1
  readonly markers = new Map<number, boolean>()
  readonly sectionPages: number[] = []

  constructor(
    readonly surface: Surface,
    readonly doc: ReportDocument,
    readonly layout: ReportLayout,
    readonly logo: string | null,
  ) {
    this.margin = layout === 'glance' ? 44 : 40
    this.top = 74
    this.bottom = surface.height - 46
    this.y = this.top
  }

  get contentWidth() {
    return this.surface.width - this.margin * 2
  }

  newPage() {
    this.surface.addPage()
    this.page = this.surface.pageCount()
    this.y = this.top
  }

  ensure(height: number) {
    if (this.y + height > this.bottom && this.y > this.top + 1) this.newPage()
  }

  markEstimated() {
    this.markers.set(this.page, true)
  }

  wrap(text: string, size: number, width: number, bold?: boolean): string[] {
    const words = text.split(/\s+/)
    const lines: string[] = []
    let line = ''

    for (const word of words) {
      const next = line ? `${line} ${word}` : word

      if (this.surface.measure(next, size, bold) > width && line) {
        lines.push(line)
        line = word
      } else {
        line = next
      }
    }

    if (line) lines.push(line)

    return lines
  }

  clip(text: string, size: number, width: number, bold?: boolean): string {
    if (this.surface.measure(text, size, bold) <= width) return text

    let cut = text

    while (cut.length > 1 && this.surface.measure(`${cut}…`, size, bold) > width) cut = cut.slice(0, -1)

    return `${cut}…`
  }

  /* Chrome on every page: header band, logo, title; footer with source,
   * page number and - where the page used one - the marker key. */
  chrome(total: number) {
    const s = this.surface

    for (let page = 1; page <= total; page += 1) {
      s.goto(page)

      s.rect(0, 0, s.width * 0.732, 5, { fill: INK.indigo })
      s.rect(s.width * 0.732 + 2, 0, s.width, 5, { fill: INK.ming })

      if (this.logo) s.image(this.logo, this.margin, 18, 34 * LOGO_RATIO, 34)

      s.text('HStat.India', s.width - this.margin, 32, { size: 11, bold: true, color: INK.indigo, align: 'right' })
      s.text(this.clip(this.doc.title, 8.5, s.width / 2), s.width - this.margin, 46, {
        size: 8.5,
        color: INK.faint,
        align: 'right',
      })
      s.line(this.margin, 60, s.width - this.margin, 60, { color: INK.rule, width: 0.75 })

      const foot = s.height - 26

      s.line(this.margin, foot - 12, s.width - this.margin, foot - 12, { color: INK.rule, width: 0.5 })
      s.text(this.clip(this.doc.source, 7.5, s.width * 0.55), this.margin, foot, { size: 7.5, color: INK.faint })
      s.text(`Page ${page} of ${total}`, s.width - this.margin, foot, { size: 7.5, color: INK.faint, align: 'right' })

      if (this.markers.get(page)) {
        s.text('* contains estimated values', s.width - this.margin - 70, foot, {
          size: 7.5,
          color: INK.text,
          align: 'right',
          bold: true,
        })
      }
    }
  }

  title() {
    const s = this.surface

    s.text(this.clip(this.doc.title, 22, this.contentWidth, true), this.margin, this.y + 22, {
      size: 22,
      bold: true,
      color: INK.indigo,
    })
    this.y += 34

    s.text(this.doc.subtitle, this.margin, this.y + 12, { size: 12, color: INK.text })
    this.y += 22

    for (const line of this.doc.meta) {
      for (const wrapped of this.wrap(line, 9, this.contentWidth)) {
        s.text(wrapped, this.margin, this.y + 10, { size: 9, color: INK.muted })
        this.y += 13
      }
    }

    this.y += 10
  }

  contents(pages: number[]) {
    const s = this.surface

    this.ensure(40 + this.doc.sections.length * 18)
    s.text('Contents', this.margin, this.y + 16, { size: 15, bold: true, color: INK.indigo })
    this.y += 24
    s.line(this.margin, this.y, this.margin + this.contentWidth, this.y, { color: INK.indigo, width: 1 })
    this.y += 14

    this.doc.sections.forEach((section, index) => {
      s.text(`${index + 1}.  ${section.title}`, this.margin, this.y + 9, { size: 10.5, color: INK.text })
      s.text(pages[index] ? String(pages[index]) : '', this.margin + this.contentWidth, this.y + 9, {
        size: 10.5,
        color: INK.muted,
        align: 'right',
      })
      this.y += 18
    })
  }

  sectionHeading(text: string) {
    const s = this.surface
    const size = this.layout === 'glance' ? 20 : 15

    this.ensure(size + 60)
    s.text(this.clip(text, size, this.contentWidth, true), this.margin, this.y + size, { size, bold: true, color: INK.indigo })
    this.y += size + 8
    s.line(this.margin, this.y, this.margin + this.contentWidth, this.y, { color: INK.indigo, width: 1.25 })
    this.y += 14
  }

  blockTitle(text: string) {
    const size = this.layout === 'glance' ? 13 : 11.5

    this.ensure(size + 40)
    this.surface.text(this.clip(text, size, this.contentWidth, true), this.margin, this.y + size, {
      size,
      bold: true,
      color: INK.indigo,
    })
    this.y += size + 9
  }

  /* The least of a block that has to follow its title onto the same page,
   * so a heading is never left alone at the foot of one. */
  lead(block: ReportBlock): number {
    const glance = this.layout === 'glance'

    switch (block.kind) {
      case 'figures':
        return (glance ? 104 : 74) + 8
      case 'line':
        return (glance ? 300 : 190) + 10
      case 'table':
        return (glance ? 22 : 17) * Math.min(block.rows.length + 1, 4)
      case 'bars':
        return (glance ? 26 : 18) * Math.min(block.rows.length, 4)
      default:
        return 36
    }
  }

  block(block: ReportBlock) {
    if ('title' in block && block.title) {
      this.ensure((this.layout === 'glance' ? 13 : 11.5) + 9 + this.lead(block))
      this.blockTitle(block.title)
    }

    switch (block.kind) {
      case 'figures':
        return this.figures(block.items)
      case 'table':
        return this.table(block)
      case 'line':
        return this.lineChart(block)
      case 'bars':
        return this.bars(block)
      case 'text':
        return this.paragraph(block.text)
      case 'pairs':
        return this.pairs(block.rows)
    }
  }

  figures(items: FigureItem[]) {
    const s = this.surface
    const glance = this.layout === 'glance'
    const gap = 10
    const count = Math.max(items.length, 1)
    const width = (this.contentWidth - gap * (count - 1)) / count
    const height = glance ? 104 : 74

    this.ensure(height + 8)

    items.forEach((item, index) => {
      const x = this.margin + index * (width + gap)

      s.rect(x, this.y, width, height, { fill: INK.soft })
      s.rect(x, this.y, width, 3.5, { fill: SERIES[item.series] })
      s.text(this.clip(item.label, glance ? 11 : 9, width - 20, true), x + 10, this.y + (glance ? 24 : 19), {
        size: glance ? 11 : 9,
        bold: true,
        color: INK.indigo,
      })

      const valueSize = glance ? 26 : 18
      const value = this.clip(item.value, valueSize, width - 24, true)

      s.text(value, x + 10, this.y + (glance ? 58 : 44), { size: valueSize, bold: true, color: INK.text })

      if (item.estimated) {
        s.text('*', x + 12 + s.measure(value, valueSize, true), this.y + (glance ? 46 : 36), {
          size: valueSize * 0.6,
          bold: true,
          color: INK.indigo,
        })
        this.markEstimated()
      }

      if (item.caption) {
        s.text(this.clip(item.caption, glance ? 10 : 8, width - 20), x + 10, this.y + (glance ? 84 : 62), {
          size: glance ? 10 : 8,
          color: INK.muted,
        })
      }
    })

    this.y += height + 14
  }

  table(block: Extract<ReportBlock, { kind: 'table' }>) {
    const s = this.surface
    const glance = this.layout === 'glance'
    const size = glance ? 10 : 8.5
    const rowHeight = glance ? 19 : 15.5
    const totalWidth = block.columns.reduce((sum, column) => sum + column.width, 0)
    const widths = block.columns.map(column => (column.width / totalWidth) * this.contentWidth)

    const header = () => {
      let x = this.margin

      block.columns.forEach((column, index) => {
        const right = column.align === 'right'
        const label = this.clip(column.label, size, widths[index] - 8, true)

        s.text(label, right ? x + widths[index] - 4 : x + 4, this.y + size + 2, {
          size,
          bold: true,
          color: INK.indigo,
          align: right ? 'right' : 'left',
        })
        x += widths[index]
      })

      this.y += rowHeight
      s.line(this.margin, this.y - 3, this.margin + this.contentWidth, this.y - 3, { color: INK.indigo, width: 1 })
    }

    this.ensure(rowHeight * 3)
    header()

    block.rows.forEach((row, rowIndex) => {
      if (this.y + rowHeight > this.bottom) {
        this.newPage()
        header()
      }

      if (block.emphasis?.includes(rowIndex)) {
        s.rect(this.margin, this.y - 3, this.contentWidth, rowHeight, { fill: INK.soft })
      }

      let x = this.margin

      row.forEach((cell, index) => {
        const column = block.columns[index]
        const right = column?.align === 'right'
        const bold = block.emphasis?.includes(rowIndex)

        if (cell.endsWith('*')) this.markEstimated()

        const text = this.clip(cell, size, widths[index] - 8, bold)

        s.text(text, right ? x + widths[index] - 4 : x + 4, this.y + size + 1, {
          size,
          bold,
          color: INK.text,
          align: right ? 'right' : 'left',
        })
        x += widths[index]
      })

      this.y += rowHeight
      s.line(this.margin, this.y - 3, this.margin + this.contentWidth, this.y - 3, { color: INK.rule, width: 0.5 })
    })

    if (block.note) {
      this.y += 4
      this.paragraph(block.note, 7.5, INK.faint)
    }

    this.y += 12
  }

  lineChart(block: Extract<ReportBlock, { kind: 'line' }>) {
    const s = this.surface
    const glance = this.layout === 'glance'
    const height = glance ? 300 : 190

    this.ensure(height + 10)

    const values = block.series.flatMap(series => series.values.filter((value): value is number => value !== null))
    const peak = values.length ? Math.max(...values) : 1
    const step = niceStep(peak / 4)
    const top = Math.max(step * Math.ceil(peak / step), step)

    const left = this.margin + 50
    const right = this.margin + this.contentWidth - 8
    const chartTop = this.y + 22
    const chartBottom = this.y + height - 22

    const x = (index: number) =>
      block.labels.length < 2 ? (left + right) / 2 : left + ((right - left) * index) / (block.labels.length - 1)
    const y = (value: number) => chartBottom - ((chartBottom - chartTop) * value) / top

    s.text(block.unit, this.margin, this.y + 10, { size: 7.5, color: INK.faint })

    for (let tick = 0; tick <= top + step / 2; tick += step) {
      const ty = y(tick)

      s.line(left, ty, right, ty, { color: INK.rule, width: 0.5, dash: tick === 0 ? undefined : [2, 2] })
      s.text(block.format(tick), left - 6, ty + 3, { size: 7.5, color: INK.muted, align: 'right' })
    }

    const every = Math.max(1, Math.ceil(block.labels.length / (glance ? 16 : 11)))

    block.labels.forEach((label, index) => {
      if (index % every !== 0 && index !== block.labels.length - 1) return

      s.text(label, x(index), chartBottom + 13, { size: 7.5, color: INK.muted, align: 'center' })
    })

    for (const series of block.series) {
      let run: [number, number][] = []

      series.values.forEach((value, index) => {
        if (value === null) {
          s.path(run, { color: series.colour, width: 1.75 })
          run = []
          return
        }

        run.push([x(index), y(value)])
      })

      s.path(run, { color: series.colour, width: 1.75 })
    }

    let legendX = right

    for (const series of [...block.series].reverse()) {
      const width = s.measure(series.name, 8)

      s.text(series.name, legendX, this.y + 10, { size: 8, color: INK.text, align: 'right' })
      s.rect(legendX - width - 14, this.y + 4, 9, 9, { fill: series.colour })
      legendX -= width + 26
    }

    this.y += height + 10
  }

  bars(block: Extract<ReportBlock, { kind: 'bars' }>) {
    const s = this.surface
    const glance = this.layout === 'glance'
    const rowHeight = glance ? 22 : 16
    const labelWidth = 150
    const valueWidth = 70

    this.ensure(rowHeight * Math.min(block.rows.length, 6) + 10)

    const peak = Math.max(...block.rows.map(row => row.value), 1)
    const span = this.contentWidth - labelWidth - valueWidth

    for (const row of block.rows) {
      this.ensure(rowHeight)

      const size = glance ? 10 : 8.5

      s.text(this.clip(row.label, size, labelWidth - 8), this.margin, this.y + size + 2, { size, color: INK.text })

      const width = Math.max((span * row.value) / peak, 1)

      s.rect(this.margin + labelWidth, this.y + 2, width, rowHeight - 6, {
        fill: block.colour,
        stroke: INK.muted,
        width: 0.3,
      })
      s.text(row.text, this.margin + labelWidth + width + 6, this.y + size + 2, { size, color: INK.muted })

      this.y += rowHeight
    }

    this.y += 12
  }

  paragraph(text: string, size = 9, color = INK.text) {
    const lines = this.wrap(text, size, this.contentWidth)

    for (const line of lines) {
      this.ensure(size + 4)
      this.surface.text(line, this.margin, this.y + size, { size, color })
      this.y += size + 4
    }

    this.y += 6
  }

  pairs(rows: [string, string][]) {
    const s = this.surface
    const glance = this.layout === 'glance'
    const size = glance ? 10.5 : 9
    const keyWidth = this.contentWidth * 0.34

    for (const [key, value] of rows) {
      const lines = this.wrap(value, size, this.contentWidth - keyWidth - 8)
      const height = Math.max(lines.length, 1) * (size + 4) + 8

      this.ensure(height)

      if (value.endsWith('*')) this.markEstimated()

      s.text(this.clip(key, size, keyWidth - 8, true), this.margin, this.y + size + 2, { size, bold: true, color: INK.indigo })

      lines.forEach((line, index) => {
        s.text(line, this.margin + keyWidth, this.y + size + 2 + index * (size + 4), { size, color: INK.text })
      })

      this.y += height
      s.line(this.margin, this.y - 3, this.margin + this.contentWidth, this.y - 3, { color: INK.rule, width: 0.5 })
    }

    this.y += 10
  }
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1

  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / power

  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power
}

/* Lay a document out on a surface. Run twice when there is a contents page:
 * once to learn where sections start, once to draw. */
function compose(surface: Surface, doc: ReportDocument, layout: ReportLayout, logo: string | null, pages?: number[]) {
  const composer = new Composer(surface, doc, layout, logo)
  const contents = layout === 'report' && doc.sections.length > 2

  composer.title()

  if (contents) {
    composer.contents(pages ?? [])
  }

  doc.sections.forEach((section, index) => {
    if (layout === 'glance') {
      section.blocks.forEach((block, blockIndex) => {
        if (index > 0 || blockIndex > 0 || composer.y > composer.top + 260) composer.newPage()

        if (blockIndex === 0 || layout === 'glance') composer.sectionHeading(section.title)

        if (blockIndex === 0) composer.sectionPages[index] = composer.page

        composer.block(block)
      })

      return
    }

    if (contents && index === 0) composer.newPage()
    else composer.ensure(60 + (section.blocks[0] ? 22 + composer.lead(section.blocks[0]) : 0))

    composer.sectionPages[index] = composer.page
    composer.sectionHeading(section.title)

    for (const block of section.blocks) composer.block(block)
  })

  return composer
}

export async function renderPdf(doc: ReportDocument, layout: ReportLayout): Promise<Blob> {
  const logo = await loadLogo()
  const orientation = layout === 'glance' ? 'landscape' : 'portrait'

  let pages: number[] | undefined

  if (layout === 'report' && doc.sections.length > 2) {
    const dry = compose(new PdfSurface(orientation), doc, layout, logo?.data ?? null)

    pages = dry.sectionPages
  }

  const surface = new PdfSurface(orientation)
  const composer = compose(surface, doc, layout, logo?.data ?? null, pages)

  composer.chrome(surface.pageCount())
  surface.doc.setProperties({ title: doc.title, subject: doc.subtitle, creator: 'HStat.India · Foundation for Economic Development' })

  return surface.doc.output('blob')
}

export async function renderPng(doc: ReportDocument, layout: ReportLayout): Promise<Blob> {
  const logo = await loadLogo()
  const orientation = layout === 'glance' ? 'landscape' : 'portrait'
  const images = new Map<string, HTMLImageElement>()

  if (logo) images.set(logo.data, logo.image)

  let pages: number[] | undefined

  if (layout === 'report' && doc.sections.length > 2) {
    pages = compose(new CanvasSurface(orientation, images), doc, layout, logo?.data ?? null).sectionPages
  }

  const surface = new CanvasSurface(orientation, images)
  const composer = compose(surface, doc, layout, logo?.data ?? null, pages)

  composer.chrome(surface.pageCount())

  const canvas = surface.stitched()

  return new Promise((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('PNG could not be encoded'))), 'image/png'),
  )
}

export async function saveReport(
  doc: ReportDocument,
  layout: ReportLayout,
  format: 'pdf' | 'png',
  filename: string,
): Promise<void> {
  const blob = format === 'pdf' ? await renderPdf(doc, layout) : await renderPng(doc, layout)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = `${filename}-${layout}-${new Date().toISOString().slice(0, 10)}.${format}`
  document.body.appendChild(link)
  link.click()
  link.remove()

  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
