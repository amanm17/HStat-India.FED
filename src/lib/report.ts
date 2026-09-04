import { toPng } from 'html-to-image'

/*
 * Reports.
 *
 * The tiles a report is made of are already on the page, laid out, themed and
 * correct. Rendering them a second time in a separate report component would
 * mean two implementations of every panel drifting apart, and the report would
 * be the one nobody notices going wrong. So a report is a capture of the real
 * tiles, in the order the reader chose.
 *
 * That has one consequence worth stating: a tile has to be in the DOM to be
 * captured. The caller un-hides whatever the report needs, waits a frame for
 * charts to lay out, captures, and puts the page back as it found it.
 */

export type ReportTile = {
  id: string
  label: string
}

export type ReportHeader = {
  title: string
  subtitle: string
  meta: string[]
}

const PAGE = { width: 794, height: 1123, margin: 40 } // A4 at 96dpi

async function captureTile(
  id: string,
  background: string,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const node = document.getElementById(`tile-${id}`)

  if (!node) return null

  const rect = node.getBoundingClientRect()

  if (rect.width < 8 || rect.height < 8) return null

  const dataUrl = await toPng(node, {
    pixelRatio: 2,
    backgroundColor: background,
    /* The unpin control is page furniture, not part of the finding. */
    filter: element =>
      !(element instanceof HTMLElement) ||
      !element.classList?.contains('tile-unpin'),
  })

  return { dataUrl, width: rect.width, height: rect.height }
}

export async function captureTiles(
  tiles: ReportTile[],
): Promise<{ tile: ReportTile; image: { dataUrl: string; width: number; height: number } }[]> {
  const background =
    getComputedStyle(document.body).backgroundColor || '#ffffff'

  const shots: {
    tile: ReportTile
    image: { dataUrl: string; width: number; height: number }
  }[] = []

  for (const tile of tiles) {
    /* Sequential on purpose. Capturing in parallel makes several charts
     * re-layout at once and produces half-drawn axes. */
    const image = await captureTile(tile.id, background)

    if (image) shots.push({ tile, image })
  }

  return shots
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function safeName(name: string): string {
  return (
    name
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'HStat-report'
  )
}

/*
 * PDF.
 *
 * Each tile is placed at its natural aspect ratio, scaled to the text width,
 * and moved to a new page when it will not fit. A tile taller than a whole
 * page is scaled down to fit one - a chart split across a page break is
 * unreadable, and a slightly smaller chart is not.
 */
export async function reportToPdf(
  header: ReportHeader,
  tiles: ReportTile[],
): Promise<boolean> {
  const shots = await captureTiles(tiles)

  if (!shots.length) return false

  const { jsPDF } = await import('jspdf')

  const doc = new jsPDF({ unit: 'px', format: [PAGE.width, PAGE.height] })

  const inner = PAGE.width - PAGE.margin * 2

  let y = PAGE.margin

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.text(header.title, PAGE.margin, y + 6)

  y += 24

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(90, 100, 112)
  doc.text(doc.splitTextToSize(header.subtitle, inner), PAGE.margin, y)

  y += 16

  doc.setFontSize(8.5)

  for (const line of header.meta) {
    doc.text(line, PAGE.margin, y)
    y += 11
  }

  doc.setDrawColor(214, 219, 216)
  doc.line(PAGE.margin, y + 4, PAGE.width - PAGE.margin, y + 4)

  y += 20

  for (const { tile, image } of shots) {
    const scale = inner / image.width

    const height = Math.min(
      image.height * scale,
      PAGE.height - PAGE.margin * 2 - 20,
    )

    const width = (height / (image.height * scale)) * inner

    if (y + height + 18 > PAGE.height - PAGE.margin) {
      doc.addPage()
      y = PAGE.margin
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(120, 131, 141)
    doc.text(tile.label.toUpperCase(), PAGE.margin, y)

    y += 8

    doc.addImage(image.dataUrl, 'PNG', PAGE.margin, y, width, height)

    y += height + 22
  }

  const pages = doc.getNumberOfPages()

  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(140, 150, 160)
    doc.text(
      `HStat.India · UN Comtrade · page ${page} of ${pages}`,
      PAGE.margin,
      PAGE.height - 18,
    )
  }

  doc.save(`${safeName(header.title)}-${stamp()}.pdf`)

  return true
}

/*
 * PNG.
 *
 * One tall image, tiles stacked in order on the page's own background, with
 * the same header the PDF carries. Someone pasting this into a deck should
 * not have to explain what it is.
 */
export async function reportToPng(
  header: ReportHeader,
  tiles: ReportTile[],
): Promise<boolean> {
  const shots = await captureTiles(tiles)

  if (!shots.length) return false

  const scale = 2
  const width = 1200
  const pad = 28
  const headerHeight = 46 + header.meta.length * 16

  const loaded = await Promise.all(
    shots.map(
      shot =>
        new Promise<{ label: string; image: HTMLImageElement }>(resolve => {
          const image = new Image()

          image.onload = () => resolve({ label: shot.tile.label, image })
          image.src = shot.image.dataUrl
        }),
    ),
  )

  const bodyStyle = getComputedStyle(document.body)

  const background = bodyStyle.backgroundColor || '#ffffff'
  const ink = bodyStyle.color || '#111111'

  const blockHeights = loaded.map(
    item => (item.image.height / item.image.width) * (width - pad * 2) + 26,
  )

  const height =
    headerHeight +
    pad +
    blockHeights.reduce((sum, item) => sum + item, 0) +
    pad

  const canvas = document.createElement('canvas')

  canvas.width = width * scale
  canvas.height = Math.ceil(height) * scale

  const context = canvas.getContext('2d')

  if (!context) return false

  context.scale(scale, scale)
  context.fillStyle = background
  context.fillRect(0, 0, width, height)

  context.fillStyle = ink
  context.font = '700 22px system-ui, sans-serif'
  context.fillText(header.title, pad, 34)

  context.font = '13px system-ui, sans-serif'
  context.fillStyle = '#6b7280'
  context.fillText(header.subtitle, pad, 54)

  header.meta.forEach((line, index) => {
    context.font = '11px ui-monospace, monospace'
    context.fillText(line, pad, 72 + index * 15)
  })

  let y = headerHeight + pad

  loaded.forEach((item, index) => {
    context.font = '700 10px ui-monospace, monospace'
    context.fillStyle = '#8a96a5'
    context.fillText(item.label.toUpperCase(), pad, y)

    const drawWidth = width - pad * 2
    const drawHeight = (item.image.height / item.image.width) * drawWidth

    context.drawImage(item.image, pad, y + 8, drawWidth, drawHeight)

    y += blockHeights[index]
  })

  const link = document.createElement('a')

  link.href = canvas.toDataURL('image/png')
  link.download = `${safeName(header.title)}-${stamp()}.png`
  link.click()

  return true
}
