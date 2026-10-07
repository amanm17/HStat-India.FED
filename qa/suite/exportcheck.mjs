/*
 * Downloads, read back.
 *
 * Since the Phase 3 refresh every page has one Download data menu: a
 * workbook (a summary sheet, then one sheet per table on the page, full data
 * rather than the rows displayed), a CSV per table, and a laid-out report in
 * Report or Glance layout, as PDF or PNG. This opens each kind of file and
 * asserts what the execution prompt §3.2-§3.3 requires of it.
 *
 * Two servers: the real build on 4178 for ground-truth DGCIS values, and the
 * fixture build on 4190 (FIXTURE) whose snapshot carries the detail and
 * scope files a real snapshot gains at its next reprocess - which is what
 * "every row, not the top 5" can only be asserted against.
 *
 * Workbooks are read with fflate (already a dependency) rather than the
 * `xlsx` package, which left the project in the same refresh.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'

const BASE = process.env.BASE || 'http://127.0.0.1:4178'
const FIXTURE = process.env.FIXTURE || 'http://127.0.0.1:4190'
const FIXTURE_DIR = process.env.FIXTURE_DIR || '/tmp/dist-p2'

const R = []
const ok = (n, p, d = '') => { R.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : undefined)

/* ------------------------------------------------------------ reading */

const decode = text =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

function colIndex(ref) {
  const letters = ref.replace(/\d+/g, '')
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function readBook(path) {
  const files = unzipSync(new Uint8Array(readFileSync(path)))
  const text = name => (files[name] ? strFromU8(files[name]) : '')
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m =>
    decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')),
  )
  const workbook = text('xl/workbook.xml')
  const rels = text('xl/_rels/workbook.xml.rels')
  const target = id => rels.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`))?.[1]
    ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${id}"`))?.[1]

  const sheets = {}
  const names = []

  for (const m of workbook.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const name = decode(m[1])
    const xml = text(`xl/${target(m[2])}`)
    const rows = []

    for (const row of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = []

      for (const c of row[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]
        const body = c[2] ?? ''
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1]
        const type = attrs.match(/t="([^"]+)"/)?.[1]
        let value = null

        if (type === 'inlineStr') value = decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))
        else if (type === 's') value = shared[Number(body.match(/<v>([^<]*)<\/v>/)?.[1])]
        else if (body.includes('<v>')) value = Number(body.match(/<v>([^<]*)<\/v>/)[1])

        if (ref) cells[colIndex(ref)] = value
      }

      rows[Number(row[1]) - 1] = cells
    }

    names.push(name)
    sheets[name] = {
      rows,
      xml,
      frozen: /<pane [^>]*state="frozen"/.test(xml),
      filtered: /<autoFilter /.test(xml),
    }
  }

  return {
    names,
    sheets,
    media: Object.keys(files).filter(name => name.startsWith('xl/media/')),
    styles: text('xl/styles.xml'),
  }
}

/* The header row is the first row whose first cell is the table's first column. */
function table(sheet, first) {
  const at = sheet.rows.findIndex(row => row && row[0] === first)
  if (at < 0) return { header: [], body: [] }
  const header = sheet.rows[at]
  const body = sheet.rows.slice(at + 1).filter(Boolean).map(row =>
    Object.fromEntries(header.map((label, index) => [label, row[index] ?? null])),
  )
  return { header, body, at }
}

/* ------------------------------------------------------------ fetching */

async function openMenu(base, path) {
  const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  await page.locator('.download-master').first().click()
  await page.waitForTimeout(300)
  return { ctx, page, errors, menu: page.locator('.rf-download-menu') }
}

async function grab(base, path, pick, name) {
  const { ctx, page, errors, menu } = await openMenu(base, path)
  /* The tables are prepared on open; wait for them rather than a timer. */
  await page.waitForFunction(() => !document.querySelector('.rf-download-wait'), null, { timeout: 30000 }).catch(() => {})
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), pick(menu)])
  const to = `/tmp/exportcheck-${name}`
  await dl.saveAs(to)
  await ctx.close()
  return { to, suggested: dl.suggestedFilename(), errors }
}

const workbook = menu => menu.getByRole('menuitem', { name: /Excel workbook/ }).click()

/* Every data sheet, whatever the page: frozen header, filter, human headers. */
function dataSheetRules(label, book, skip = ['Summary']) {
  for (const name of book.names.filter(n => !skip.includes(n))) {
    const sheet = book.sheets[name]
    ok(`${label} "${name}": header row frozen`, sheet.frozen)
    ok(`${label} "${name}": autofilter on`, sheet.filtered)
    const header = sheet.rows[3] ?? []
    ok(`${label} "${name}": headers are words, not keys`, header.length > 1 && header.every(h => typeof h === 'string' && !/^[a-z]+[A-Z]/.test(h)), header.slice(0, 4).join(' | '))
    const hasValue = header.some(h => /\((USD|INR|USD million|INR crore)\)/.test(h ?? ''))
    if (hasValue) {
      ok(`${label} "${name}": Estimated flag column`, header.includes('Estimated'))
      ok(`${label} "${name}": Estimated share column`, header.includes('Estimated share'))
    }
  }
}

/* ============================================================ HS-6 */

console.log('=== HS-6 workbook (851713, real data) ===')
{
  const { to, suggested, errors } = await grab(BASE, '/hs/851713', workbook, 'hs6.xlsx')
  const book = readBook(to)
  console.log('   sheets:', book.names.join(' | '))
  ok('workbook downloads', /^HStat-851713-.*\.xlsx$/.test(suggested), suggested)
  ok('no page errors', errors.length === 0, errors[0] ?? '')
  ok('summary sheet first', book.names[0] === 'Summary')
  ok('summary carries the logo', book.media.some(name => name.endsWith('.png')))
  const summary = JSON.stringify(book.sheets.Summary.rows)
  ok('summary names code, snapshot and source', /851713/.test(summary) && /Snapshot/i.test(summary) && /Comtrade/.test(summary))
  ok('fewer sheets than one per variant', book.names.length <= 7, `${book.names.length} sheets`)
  for (const name of ['Trend', 'World Rankings', 'India Partners', 'India HS-8 · DGCIS'])
    ok(`sheet "${name}" present`, book.names.includes(name))
  ok('no separate predecessor sheet', !book.names.some(n => /851712|predecessor|retired/i.test(n)))
  dataSheetRules('HS-6', book)
  ok('real number formats', book.styles.includes('#,##0') && book.styles.includes('0.0%'))

  const trend = table(book.sheets.Trend, 'Year')
  ok('trend has a Carried from column', trend.header.includes('Carried from'))
  const carried = trend.body.filter(row => /HS 851712 \*\*/.test(row['Carried from'] ?? ''))
  ok('retired predecessor appears in the successor\'s table', carried.length > 0, `${carried.length} carried rows`)
  ok('carried rows are under the predecessor code', carried.every(row => row['HS code'] === '851712'))
  ok('values are numbers, not text', trend.body.filter(r => r['Global Trade (USD)'] !== null).every(r => typeof r['Global Trade (USD)'] === 'number'))
  ok('every own year is marked Yes or No', trend.body.filter(r => r['HS code'] === '851713').every(r => r.Estimated === 'Yes' || r.Estimated === 'No'))

  const dgcis = table(book.sheets['India HS-8 · DGCIS'], 'Flow')
  ok('DGCIS sheet has every month', dgcis.body.length > 150, `${dgcis.body.length} rows`)
  ok('DGCIS sheet keeps both currencies as filed', dgcis.header.includes('Value (USD million)') && dgcis.header.includes('Value (INR crore)'))
  ok('DGCIS sheet holds no Comtrade column', !dgcis.header.some(h => /Global Trade|Comtrade/i.test(h ?? '')))
  const june = dgcis.body.filter(r => r.Month === 'Jun 2026' && r['HS-8'] === '85171300')
  ok('June 2026 export = 2976.996', june.some(r => r.Flow === 'Exports' && Math.abs(r['Value (USD million)'] - 2976.996) < 1e-6), JSON.stringify(june.map(r => [r.Flow, r['Value (USD million)']])))
  ok('June 2026 import = 9.765', june.some(r => r.Flow === 'Imports' && Math.abs(r['Value (USD million)'] - 9.765) < 1e-6))
  ok('DGCIS rows never estimated', dgcis.body.every(r => r.Estimated === 'No'))
  const note = JSON.stringify(book.sheets['India HS-8 · DGCIS'].rows.slice(0, 3))
  ok('DGCIS sheet says partner World is not world trade', /not world trade/i.test(note))
  ok('DGCIS sheet says the two currencies are never converted', /never converted/i.test(note))
}

console.log('\n=== a CSV per table ===')
{
  const { to, suggested } = await grab(BASE, '/hs/851713', menu => menu.getByRole('menuitem', { name: 'CSV · India HS-8 · DGCIS' }).click(), 'dgcis.csv')
  const text = readFileSync(to, 'utf8')
  const lines = text.split(/\r?\n/)
  ok('CSV downloads', /\.csv$/.test(suggested) && lines.length > 150, `${suggested}, ${lines.length} lines`)
  ok('opens with a BOM', text.charCodeAt(0) === 0xfeff)
  const header = lines.find(line => line.startsWith('Flow,'))
  ok('provenance precedes the columns', lines[0].replace(/^﻿/, '').startsWith('#') && lines.indexOf(header) > 1)
  ok('same columns as the sheet', /^Flow,HS-8,Name,DGCIS commodity group,Month,Value \(USD million\),Value \(INR crore\),Estimated,Estimated share/.test(header ?? ''), header?.slice(0, 100))
  ok('figures land as bare numbers', lines.some(line => /,2976\.996,/.test(line)))
}

/* ============================================================ full data */

console.log('\n=== full data, not the rows displayed (fixture with detail files) ===')
{
  const detail = JSON.parse(readFileSync(`${FIXTURE_DIR}/data/snapshots/current/detail/851762.json`, 'utf8'))
  const years = Object.keys(detail.years).map(Number).sort((a, c) => c - a)
  const year = years.find(y => detail.years[y]?.importers?.complete)
  const expected = detail.years[year].importers.count
  const { to } = await grab(FIXTURE, `/hs/851762?year=${year}`, workbook, 'full.xlsx')
  const book = readBook(to)
  const world = table(book.sheets['World Rankings'], 'Year')
  const rows = world.body.filter(r => String(r.Year) === String(year) && r.Flow === 'Imports')
  ok(`every importer for ${year}, not the top 5`, rows.length === expected && expected > 10, `${rows.length} rows, detail has ${expected}`)
  const share = rows.reduce((sum, r) => sum + (r['Share of world total'] ?? 0), 0)
  ok('shares of a complete ranking sum to 100%', Math.abs(share - 1) < 0.002, share.toFixed(4))
  ok('estimated flags carried row by row', rows.every(r => r.Estimated === 'Yes' || r.Estimated === 'No'))
  ok('rankings consolidated with a Year and Flow dimension', new Set(world.body.map(r => r.Flow)).size === 2 && new Set(world.body.map(r => r.Year)).size > 1)
}

/* ============================================================ HS-4 / HS-2 */

for (const [code, level, inside] of [['8517', 4, 'Lines'], ['85', 2, 'Headings']]) {
  console.log(`\n=== HS-${level} workbook (${code}) ===`)
  const { to, suggested, errors } = await grab(BASE, `/hs/${code}`, workbook, `hs${level}.xlsx`)
  const book = readBook(to)
  console.log('   sheets:', book.names.join(' | '))
  ok(`HS-${level} workbook downloads`, new RegExp(`^HStat-${code}-.*\\.xlsx$`).test(suggested), suggested)
  ok(`HS-${level} no page errors`, errors.length === 0, errors[0] ?? '')
  ok(`HS-${level} child listing sheet "${inside}"`, book.names.includes(inside))
  ok(`HS-${level} has no DGCIS sheet`, !book.names.includes('India HS-8 · DGCIS'))
  dataSheetRules(`HS-${level}`, book)
}

/* ============================================================ HS-8 */

console.log('\n=== HS-8 workbook (85171300) ===')
{
  const { to, suggested, errors } = await grab(BASE, '/hs/85171300', workbook, 'hs8.xlsx')
  const book = readBook(to)
  console.log('   sheets:', book.names.join(' | '))
  ok('HS-8 workbook downloads', /85171300/.test(suggested), suggested)
  ok('HS-8 no page errors', errors.length === 0, errors[0] ?? '')
  ok('HS-8 sheets: Summary, Annual, Monthly', ['Summary', 'Annual', 'Monthly'].every(n => book.names.includes(n)))
  dataSheetRules('HS-8', book)
  const annual = table(book.sheets.Annual, book.sheets.Annual.rows[3]?.[0])
  const bases = new Set(annual.body.map(r => r['Year basis']))
  ok('annual sheet holds calendar and financial years', bases.has('Calendar') && bases.has('Financial'), [...bases].join('/'))
  ok('financial years named FY', annual.body.some(r => /^FY 20\d{2}-\d{2}$/.test(String(Object.values(r)[0]))))
  ok('a Last 12 months column', annual.header.some(h => /Last 12 months/i.test(h ?? '')))
  ok('both flows', new Set(annual.body.map(r => r.Flow)).size === 2)
  ok('never estimated', annual.body.every(r => r.Estimated === undefined || r.Estimated === 'No'))
}

/* ============================================================ home */

console.log('\n=== front-page workbook (fixture scope) ===')
{
  const { to, errors } = await grab(FIXTURE, '/', workbook, 'home.xlsx')
  const book = readBook(to)
  console.log('   sheets:', book.names.join(' | '))
  ok('home no page errors', errors.length === 0, errors[0] ?? '')
  ok('home sheets: Summary, Countries, Products', ['Summary', 'Countries', 'Products'].every(n => book.names.includes(n)))
  dataSheetRules('home', book)
  const products = table(book.sheets.Products, book.sheets.Products.rows[3]?.[0])
  const latest = Math.max(...products.body.map(r => Number(r.Year)).filter(Number.isFinite))
  const count = products.body.filter(r => Number(r.Year) === latest).length
  const scope = JSON.parse(readFileSync(`${FIXTURE_DIR}/data/snapshots/current/scope.json`, 'utf8'))
  const expected = scope.years[String(latest)].products.length
  ok('every HS-6 line with a figure for the year, not the top 5', count === expected && count > 400, `${count} lines in ${latest}, scope has ${expected}`)
}

/* ============================================================ reports */

console.log('\n=== laid-out reports ===')
for (const [label, index, format] of [['Report-layout PDF', 0, 'pdf'], ['Report-layout PNG', 1, 'png'], ['Glance-layout PDF', 2, 'pdf'], ['Glance-layout PNG', 3, 'png']]) {
  const { to, suggested, errors } = await grab(BASE, '/hs/851713', menu => menu.locator('.rf-download-pair button').nth(index).click(), `report-${index}.${format}`)
  const bytes = readFileSync(to)
  ok(`${label} downloads`, new RegExp(`-(report|glance)-.*\\.${format}$`).test(suggested), suggested)
  ok(`${label} throws nothing`, errors.length === 0, errors[0] ?? '')
  if (format === 'pdf') {
    const text = bytes.toString('latin1')
    const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length
    ok(`${label} is a PDF of several pages`, text.startsWith('%PDF') && pages > 1, `${pages} pages, ${bytes.length} bytes`)
    ok(`${label} carries the logo`, /\/Subtype\s*\/Image/.test(text))
    ok(`${label} uses Helvetica (Arial metrics)`, /Helvetica/.test(text))
  } else {
    const png = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    ok(`${label} is a PNG`, png && width > 1000 && height > 1000, `${width}×${height}`)
  }
}

await b.close()
const f = R.filter(r => !r.p)
console.log(`\n${R.length - f.length}/${R.length} passed`)
if (f.length) console.log('FAILED:\n  ' + f.map(x => x.n).join('\n  '))
process.exit(f.length ? 1 : 0)
