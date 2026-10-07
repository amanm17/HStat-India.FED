/*
 * A small, dependency-light XLSX writer (Phase 3).
 *
 * The workbook the reader downloads is a document, not a data dump: a
 * branded summary sheet, human headers, real number formats, frozen header
 * rows, filters, set column widths. SheetJS Community Edition cannot write
 * styles, so it could not produce any of that - and it carries two advisories
 * with no fix. This writes the Office Open XML parts directly and zips them
 * with fflate, which the PDF library already ships.
 *
 * Deliberately narrow: inline strings, numbers, a fixed palette of cell
 * styles, merges, a frozen pane, an autofilter and one image per sheet.
 * Nothing here evaluates formulas or reads workbooks.
 */
import { strToU8, zipSync } from 'fflate'

export type CellStyle =
  | 'default'
  | 'title'
  | 'subtitle'
  | 'meta'
  | 'header'
  | 'text'
  | 'int'
  | 'pct'
  | 'bold'
  | 'note'
  | 'figure'
  | 'label'
  | 'dec1'
  | 'section'
  | 'flag'

export type Cell = { v: string | number | null | undefined; s?: CellStyle }

export type SheetSpec = {
  name: string
  rows: (Cell | string | number | null | undefined)[][]
  /* Column widths, in characters. */
  cols?: number[]
  /* Rows above this 1-based row number stay put while scrolling. */
  freezeRows?: number
  /* 0-based [row, col] corners of the filtered range, header row included. */
  autofilter?: { from: [number, number]; to: [number, number] }
  merges?: [number, number, number, number][]
  image?: { png: Uint8Array; widthPx: number; heightPx: number; col?: number; row?: number }
  /* Row heights in points, by 0-based row index. */
  heights?: Record<number, number>
}

const STYLE_INDEX: Record<CellStyle, number> = {
  default: 0,
  title: 1,
  subtitle: 2,
  meta: 3,
  header: 4,
  text: 5,
  int: 6,
  pct: 7,
  bold: 8,
  note: 9,
  figure: 10,
  label: 11,
  dec1: 12,
  section: 13,
  flag: 14,
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0%"/><numFmt numFmtId="165" formatCode="#,##0.0"/></numFmts>
<fonts count="8">
<font><sz val="11"/><color rgb="FF161616"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="18"/><color rgb="FF133E68"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="12"/><color rgb="FF161616"/><name val="Arial"/><family val="2"/></font>
<font><sz val="10"/><color rgb="FF444A52"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF161616"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="FF161616"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="12"/><color rgb="FF133E68"/><name val="Arial"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF133E68"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F5F8"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FFC2C1C2"/></bottom><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="FF133E68"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="3" fontId="6" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="7" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="7" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

export function columnLetter(index: number): string {
  let n = index + 1
  let out = ''

  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }

  return out
}

function ref(row: number, col: number): string {
  return `${columnLetter(col)}${row + 1}`
}

export function safeSheetName(name: string, taken: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet'
  let candidate = base
  let n = 2

  while (taken.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`
    candidate = base.slice(0, 31 - suffix.length) + suffix
    n += 1
  }

  taken.add(candidate.toLowerCase())

  return candidate
}

function sheetXml(sheet: SheetSpec, hasImage: boolean): string {
  const rows = sheet.rows
  const width = Math.max(1, ...rows.map(row => row.length))

  const parts: string[] = []

  parts.push(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
  )

  parts.push('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>')
  parts.push(`<dimension ref="A1:${ref(Math.max(rows.length - 1, 0), width - 1)}"/>`)

  if (sheet.freezeRows && sheet.freezeRows > 0) {
    parts.push(
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>` +
        `<selection pane="bottomLeft" activeCell="A${sheet.freezeRows + 1}" sqref="A${sheet.freezeRows + 1}"/></sheetView></sheetViews>`,
    )
  } else {
    parts.push('<sheetViews><sheetView workbookViewId="0"/></sheetViews>')
  }

  parts.push('<sheetFormatPr defaultRowHeight="15"/>')

  if (sheet.cols && sheet.cols.length) {
    parts.push(
      '<cols>' +
        sheet.cols
          .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, w)}" customWidth="1"/>`)
          .join('') +
        '</cols>',
    )
  }

  parts.push('<sheetData>')

  rows.forEach((row, r) => {
    const height = sheet.heights?.[r]
    const attrs = height ? ` ht="${height}" customHeight="1"` : ''

    parts.push(`<row r="${r + 1}"${attrs}>`)

    row.forEach((raw, c) => {
      const cell: Cell =
        raw !== null && typeof raw === 'object' ? (raw as Cell) : { v: raw as Cell['v'] }

      const style = STYLE_INDEX[cell.s ?? (typeof cell.v === 'number' ? 'int' : 'text')]
      const at = ref(r, c)

      if (cell.v === null || cell.v === undefined || cell.v === '') {
        if (style) parts.push(`<c r="${at}" s="${style}"/>`)
        return
      }

      if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
        parts.push(`<c r="${at}" s="${style}"><v>${cell.v}</v></c>`)
        return
      }

      parts.push(
        `<c r="${at}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escape(String(cell.v))}</t></is></c>`,
      )
    })

    parts.push('</row>')
  })

  parts.push('</sheetData>')

  if (sheet.autofilter) {
    const { from, to } = sheet.autofilter

    parts.push(`<autoFilter ref="${ref(from[0], from[1])}:${ref(to[0], to[1])}"/>`)
  }

  if (sheet.merges && sheet.merges.length) {
    parts.push(
      `<mergeCells count="${sheet.merges.length}">` +
        sheet.merges.map(([r1, c1, r2, c2]) => `<mergeCell ref="${ref(r1, c1)}:${ref(r2, c2)}"/>`).join('') +
        '</mergeCells>',
    )
  }

  parts.push('<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>')
  parts.push('<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>')

  if (hasImage) parts.push('<drawing r:id="rId1"/>')

  parts.push('</worksheet>')

  return parts.join('')
}

function drawingXml(image: NonNullable<SheetSpec['image']>): string {
  const emu = (px: number) => Math.round(px * 9525)

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<xdr:oneCellAnchor>' +
    `<xdr:from><xdr:col>${image.col ?? 0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${image.row ?? 0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${emu(image.widthPx)}" cy="${emu(image.heightPx)}"/>` +
    '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="FED logo" descr="Foundation for Economic Development"/>' +
    '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
    '<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(image.widthPx)}" cy="${emu(image.heightPx)}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>' +
    '<xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>'
  )
}

export function writeXlsx(
  sheets: SheetSpec[],
  props: { title: string; subject?: string; creator?: string },
): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const taken = new Set<string>()
  const names = sheets.map(sheet => safeSheetName(sheet.name, taken))

  const overrides: string[] = []
  const workbookRels: string[] = []
  const definedNames: string[] = []

  let drawingCount = 0

  sheets.forEach((sheet, index) => {
    const n = index + 1
    const hasImage = Boolean(sheet.image)

    files[`xl/worksheets/sheet${n}.xml`] = strToU8(sheetXml(sheet, hasImage))
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    workbookRels.push(
      `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`,
    )

    if (sheet.autofilter) {
      const { from, to } = sheet.autofilter
      const quoted = `'${names[index].replace(/'/g, "''")}'`

      definedNames.push(
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${escape(quoted)}!$${columnLetter(from[1])}$${from[0] + 1}:$${columnLetter(to[1])}$${to[0] + 1}</definedName>`,
      )
    }

    if (hasImage && sheet.image) {
      drawingCount += 1
      const d = drawingCount

      files[`xl/drawings/drawing${d}.xml`] = strToU8(drawingXml(sheet.image))
      files[`xl/media/image${d}.png`] = sheet.image.png
      files[`xl/worksheets/_rels/sheet${n}.xml.rels`] = strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${d}.xml"/>` +
          '</Relationships>',
      )
      files[`xl/drawings/_rels/drawing${d}.xml.rels`] = strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${d}.png"/>` +
          '</Relationships>',
      )
      overrides.push(
        `<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
      )
    }
  })

  const styleRel = sheets.length + 1

  workbookRels.push(
    `<Relationship Id="rId${styleRel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
  )

  files['xl/workbook.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000"/></bookViews>' +
      '<sheets>' +
      names.map((name, i) => `<sheet name="${escape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets>' +
      (definedNames.length ? `<definedNames>${definedNames.join('')}</definedNames>` : '') +
      '</workbook>',
  )

  files['xl/_rels/workbook.xml.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      workbookRels.join('') +
      '</Relationships>',
  )

  files['xl/styles.xml'] = strToU8(STYLES_XML)

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  files['docProps/core.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${escape(props.title)}</dc:title>` +
      (props.subject ? `<dc:subject>${escape(props.subject)}</dc:subject>` : '') +
      `<dc:creator>${escape(props.creator ?? 'HStat.India')}</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
      '</cp:coreProperties>',
  )

  files['docProps/app.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
      '<Application>HStat.India</Application></Properties>',
  )

  files['_rels/.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>',
  )

  files['[Content_Types].xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      overrides.join('') +
      '</Types>',
  )

  return zipSync(files, { level: 6 })
}
