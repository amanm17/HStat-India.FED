import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const BASE = 'http://127.0.0.1:4178'
const R = []
const ok = (n, p, d = '') => { R.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const b = await chromium.launch()

async function grab(path, clicker, name) {
  const ctx = await b.newContext({ acceptDownloads: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), clicker(page)])
  const to = `/tmp/${name}`
  await dl.saveAs(to)
  await ctx.close()
  return { to, suggested: dl.suggestedFilename(), errors }
}

console.log('=== #88 the panel CSV ===')
{
  const { to, suggested, errors } = await grab('/hs/851713',
    p => p.locator('.dgcis-csv').click(), 'dgcis.csv')
  const text = readFileSync(to, 'utf8')
  const lines = text.split('\n')
  ok('panel CSV downloads', text.length > 500, `${suggested}, ${lines.length} lines`)
  ok('no page errors', errors.length === 0, errors[0] ?? '')

  // the file opens with a metadata block; the column header is the first
  // line that actually starts with the first column name
  const header = lines.find(l => l.startsWith('Reporter,'))
  ok('column header names reporter, partner and flow',
     !!header && /^Reporter,Partner,Flow,/.test(header), header?.slice(0, 90))
  ok('metadata block precedes the columns',
     lines[0].includes('Title') && lines.indexOf(header) > 3, `header at line ${lines.indexOf(header) + 1}`)
  ok('both flows present', /,Exports,/.test(text) && /,Imports,/.test(text))
  ok('partner World is spelled out on rows', (text.match(/India,World/g) || []).length > 100)
  ok('carries the not-world-trade note', /does not\s*\n?\s*mean world trade|not mean world trade/i.test(text.replace(/"/g, '')))
  ok('carries the no-FX note', /never converted/i.test(text))
  ok('both currency columns present', /Value \(INR crore\)/.test(text) && /Value \(USD million\)/.test(text))

  // the ground-truth cell
  const jun = lines.filter(l => l.includes('2026-06') && l.includes('85171300'))
  ok('June 2026 rows present for both flows', jun.length === 2, jun.length + ' rows')
  ok('export June 2026 = 2976.996', jun.some(l => l.includes('Exports') && l.includes('2976.996')), jun.find(l => l.includes('Exports'))?.slice(0, 120))
  ok('import June 2026 = 9.765', jun.some(l => l.includes('Imports') && l.includes('9.765')))
}

console.log('\n=== #88 the workbook ===')
{
  const { to, errors } = await grab('/hs/851762',
    p => p.locator('.download-master').click(), 'book.xlsx')
  ok('workbook downloads', true)
  ok('no page errors', errors.length === 0, errors[0] ?? '')
  const XLSX = (await import('/root/hstat2/node_modules/xlsx/xlsx.mjs')).default ?? await import('/root/hstat2/node_modules/xlsx/xlsx.mjs')
  const wb = XLSX.read(readFileSync(to))
  console.log('   sheets:', wb.SheetNames.join(' | '))
  ok('DGCIS sheet present', wb.SheetNames.includes('India HS-8 · DGCIS'))
  ok('empty legacy ITC(HS)-8 sheet not shipped', !wb.SheetNames.includes('India ITC(HS)-8'))
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['India HS-8 · DGCIS'])
  ok('sheet has rows', rows.length > 500, `${rows.length} rows`)
  const cols = Object.keys(rows[0] ?? {})
  ok('every row carries Reporter/Partner/Flow', ['Reporter','Partner','Flow'].every(c => cols.includes(c)), cols.join(', '))
  ok('both flows in the sheet', new Set(rows.map(r => r.Flow)).size === 2, [...new Set(rows.map(r => r.Flow))].join('/'))
  ok('all rows are HS 851762 lines', rows.every(r => String(r['HS-8']).startsWith('851762')))
  const meta = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames.find(n => /meta|about|notes/i.test(n)) ?? wb.SheetNames[0]], { header: 1 })
  const flat = JSON.stringify(meta)
  ok('workbook metadata carries the DGCIS notes', /mean world trade/i.test(flat), '')
}
await b.close()
const f = R.filter(r => !r.p)
console.log(`\n${R.length - f.length}/${R.length} passed`)
if (f.length) console.log('FAILED:\n  ' + f.map(x => x.n).join('\n  '))
