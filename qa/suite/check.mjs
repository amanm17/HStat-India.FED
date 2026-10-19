import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:4178'
const results = []

function ok(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch()

/* Picked from the build, not hard-coded: since every HS-8 in scope is kept
 * (Oct 2026), which products lack tariff-line detail changes with the data.
 * `bare` is a product page with no DGCIS file; `loose` a standalone line. */
const json = async path => (await fetch(BASE + path)).json()
const dgcisManifest = await json('/data/dgcis/manifest.json')
const hs8Index = await json('/data/dgcis/hs8-index.json')
const catalogue = await json('/data/snapshots/current/catalogue.json')
const covered = new Set(dgcisManifest.coveredHs6)
const bare = catalogue.find(e => e.level === 6 && !covered.has(e.code))?.code
const loose = hs8Index.lines.find(l => l.relation === 'standalone')

async function open(path) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  return { page, errors }
}

// 1 — front page
{
  const { page, errors } = await open('/')
  const text = await page.innerText('body')
  ok('home renders', text.includes('HStat') && text.length > 400, `${text.length} chars`)
  ok('home has no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

// 2 — a product page that has DGCIS data
{
  const { page, errors } = await open('/hs/851762')
  const text = await page.innerText('body')
  ok('product page renders', text.includes('851762'), '')
  ok('product page has no errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  const panel = await page.locator('#section-dgcis .dgcis').count()
  ok('DGCIS panel present', panel === 1, `${panel} found`)
  const panelText = panel ? await page.locator('#section-dgcis .dgcis').innerText() : ''
  ok('panel says exports, not imports',
     /export/i.test(panelText) && !/India’s imports|India's imports/i.test(panelText),
     panelText.split('\n')[1] ?? '')
  ok('panel shows each line\'s share', /% of this product/.test(panelText))
  const codes = await page.locator('#section-dgcis .rf-tariff-tile').count()
  ok('tariff lines are links', codes >= 2, `${codes} links`)
  await page.close()
}

// 3 — clicking through to a tariff line
{
  const { page, errors } = await open('/hs/851762')
  await page.locator('#section-dgcis .rf-tariff-tile').first().click()
  await page.waitForTimeout(900)
  const url = page.url()
  ok('click navigates to an HS-8 URL', /\/hs\/\d{8}$/.test(url), url.replace(BASE, ''))
  const text = await page.innerText('body')
  ok('HS-8 page shows the parent heading card', text.includes('HS 851762'))
  ok('HS-8 page shows siblings', /Other tariff lines in HS \d{6}/i.test(text))
  ok('HS-8 click-through has no errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  // back button must return to the heading
  await page.goBack(); await page.waitForTimeout(700)
  ok('back returns to the heading', page.url().endsWith('/hs/851762'), page.url().replace(BASE, ''))
  await page.close()
}

// 4 — cold deep link to a tariff line
{
  const { page, errors } = await open('/hs/85176290')
  const text = await page.innerText('body')
  ok("cold deep link to HS-8 renders", text.includes("85176290") && /Last 12 months/i.test(text))
  ok('cold deep link has no errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  ok('HS-8 page states it is not world trade', /not world trade/i.test(text))
  await page.close()
}

// 5 — an HS-8 code that is not held
{
  const { page, errors } = await open('/hs/99999999')
  const text = await page.innerText('body')
  ok('unknown HS-8 explains itself', /No DGCIS tariff-line data/.test(text))
  ok('unknown HS-8 does not error', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

// 6 — a product with NO DGCIS file must be untouched
if (bare) {
  const { page, errors } = await open(`/hs/${bare}`)
  const text = await page.innerText('body')
  ok('product without DGCIS still renders', text.includes(bare) && text.length > 800)
  ok('product without DGCIS shows no panel', (await page.locator('#section-dgcis .dgcis').count()) === 0)
  ok('product without DGCIS has no errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

// 7 — a tariff line whose heading has no product page of its own.
//     851712 was split by HS 2022; India still files under it, so the lines
//     are real history with nothing above them in the catalogue.
{
  const { page, errors } = await open('/hs/85171211')
  const text = await page.innerText('body')
  ok('standalone HS-8 renders', text.includes('85171211') && /Last 12 months/i.test(text))
  ok('standalone HS-8 says it has no product page',
     /no product page/i.test(text), '')
  ok('standalone HS-8 shows no Comtrade card it cannot fill',
     (await page.locator('.hs8-parent-card').count()) === 0)
  ok('standalone HS-8 throws nothing', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

// 8 — the product page no longer contradicts itself
{
  const { page } = await open('/hs/851762')
  const absent = await page.locator('.tariff-absent').count()
  ok('no "detail is not held" line above a table of detail', absent === 0)
  await page.close()
}

if (bare) {
  const { page } = await open(`/hs/${bare}`)
  const absent = await page.locator('.tariff-absent').count()
  ok('the absence note still appears where there is a real absence', absent === 1)
  await page.close()
}

// 9 — a tariff line whose HS-6 HStat does not carry: its own page, no
//     Comtrade card, no link to levels HStat has no page for.
if (loose) {
  const { page, errors } = await open(`/hs/${loose.hs8}`)
  const text = await page.innerText('body')
  ok('standalone line renders', text.includes(loose.hs8) && text.length > 400)
  ok('standalone line says its heading has no product page', /no HStat product page for this heading yet/.test(text))
  ok('standalone line has no Comtrade card', (await page.locator('.hs8-parent-card').count()) === 0)
  const crumbs = await page.locator('.hs8-breadcrumb button').allInnerTexts()
  ok('standalone line links no missing HS-6 page', !crumbs.some(c => c.includes(loose.hs6)), crumbs.join(' / '))
  ok('standalone line throws nothing', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

// 10 - every tariff line has a name, and no two share one
{
  const titles = hs8Index.lines.map(l => (l.title || '').trim().toLowerCase())
  ok('every tariff line is named', titles.every(Boolean), `${titles.filter(t => !t).length} unnamed`)
  ok('no two tariff lines share a name', new Set(titles).size === titles.length)

  // Names and headings are written out in full: no cut-off text, no stray
  // spacing, no DGCIS abbreviations (pipeline/dgcis/check_line_names.py
  // checks every word; this catches the commonest by eye).
  const cut = hs8Index.lines.filter(l => /\u2026| ,/.test(`${l.title} ${l.headingName || ''}`))
  ok('no tariff name or heading is cut off', cut.length === 0, cut.slice(0, 3).map(l => l.hs8).join(', '))
  const ABBR = /\b(othr|papr|paprbord|mchns|mchnry|smlr|wth|fr|eqpmnt|artcls|prts|shts|pltes|apprts|nt)\b/i
  const short = hs8Index.lines.filter(l => l.nameSource !== 'schedule' && ABBR.test(l.title))
  ok('no tariff name keeps a DGCIS abbreviation', short.length === 0, short.slice(0, 3).map(l => `${l.hs8} ${l.title}`).join(' | '))
}

// 11 - a line filed on one flow only opens on that flow, not on "no data"
{
  const single = hs8Index.lines.find(l => Object.keys(l.flows).length === 1 && l.filed !== false)
  if (single) {
    const { page, errors } = await open(`/hs/${single.hs8}`)
    const h1 = (await page.locator('h1').first().innerText()).trim()
    ok('one-flow line renders its page', h1 === single.title, `${single.hs8}: ${h1}`)
    ok('one-flow line throws nothing', errors.length === 0, errors.slice(0, 2).join(' | '))
    await page.close()
  }
}

await browser.close()

const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
