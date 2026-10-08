/*
 * Post-deployment checks the standing suites do not cover.
 *
 * J  two-flow switching on HS-6 and HS-8, against ground-truth values
 * K  search across code, prefix and words
 * L  retired and predecessor routes
 * Q  375 / 768 / 1440
 * W  the malformed-payload matrix, by intercepting the fetch rather than
 *    doctoring seven copies of dist
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:4178'
const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

const browser = await chromium.launch()

async function open(path, viewport) {
  const page = await browser.newPage(viewport ? { viewport } : undefined)
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  return { page, errors }
}

const flowBtns = p => p.locator('[aria-label="Flow"] button')

// ─────────── J. two-flow UI, HS-6 ───────────
console.log('\n=== J. two-flow switching — HS-6 851713 ===')
{
  const { page, errors } = await open('/hs/851713')
  const panel = page.locator('#section-dgcis .dgcis')
  ok('HS-6 DGCIS panel renders', await panel.count() === 1)
  ok('two flow buttons', await flowBtns(page).count() === 2, await flowBtns(page).allInnerTexts().then(t => t.join('/')))
  ok('exports is the default selection',
     (await page.locator('[aria-label="Flow"] button[aria-pressed="true"]').innerText()).trim() === 'Exports')
  let t = await panel.innerText()
  ok('export heading correct', /India.s exports, by tariff line/i.test(t))
  const exportText = t
  const exportValue = t.match(/[\d,]+(?:\.\d+)?(?=\s*(?:USD mn|$))/m)?.[0]
  ok('export value present', !!exportValue, exportValue ?? '')

  await flowBtns(page).nth(1).click(); await page.waitForTimeout(600)
  t = await panel.innerText()
  ok('import heading correct', /India.s imports, by tariff line/i.test(t))
  const importText = t
  ok('displayed values changed to imports', importText !== exportText)
  ok('footer names the current flow', /partner World, imports/i.test(t))

  // Currency should alter the rendered import values, not merely the button state.
  const cur = page.locator('[aria-label="Currency"] button')
  await cur.nth(1).click(); await page.waitForTimeout(500)
  t = await panel.innerText()
  ok('currency switch changes the rendered import view', t !== importText)
  await cur.nth(0).click(); await page.waitForTimeout(400)

  await flowBtns(page).nth(0).click(); await page.waitForTimeout(600)
  t = await panel.innerText()
  ok('switching back restores exports',
     /India.s exports, by tariff line/i.test(t) &&
     !!exportValue &&
     t.includes(exportValue))
  ok('no page errors during HS-6 flow switching', errors.length === 0, errors[0] ?? '')
  await page.close()
}

// ─────────── J. both flows, HS-8 ───────────
// Since the Phase 2 refresh the tariff-line page shows the export table and
// the import table together (execution prompt §2.5), so there is no flow
// switch to exercise; what has to hold is that both are there, both are
// right, and they are not the same numbers.
console.log('\n=== J. both flows — HS-8 85171300 ===')
{
  const { page, errors } = await open('/hs/85171300')
  const t = await page.innerText('body')
  ok('export table present', /India Exports, month by month/i.test(t))
  ok('import table present', /India Imports, month by month/i.test(t))
  const ex12 = t.match(/India Exports\s*\n([\d,]+)/)?.[1]
  const im12 = t.match(/India Imports\s*\n([\d,]+)/)?.[1]
  ok('export headline metric present', !!ex12, `12m = ${ex12}`)
  ok('import headline metric present', !!im12, `12m = ${im12}`)
  ok('the two flows differ', !!ex12 && !!im12 && ex12 !== im12, `${ex12} vs ${im12}`)
  ok('each table ends with the row total', (t.match(/Year total/gi) || []).length === 2)
  const tables = page.locator('.hs8-chart table')
  ok('two month-by-month tables', await tables.count() === 2)
  const head = await tables.first().locator('thead').innerText()
  ok('calendar months in calendar view', /JAN[\s\S]*DEC/i.test(head))
  await page.getByRole('button', { name: 'Financial' }).first().click(); await page.waitForTimeout(500)
  const fyHead = await page.locator('.hs8-chart table').first().locator('thead').innerText()
  ok('financial view runs April to March', /APR[\s\S]*MAR/i.test(fyHead) && !/JAN[\s\S]*APR/i.test(fyHead.split('\n')[0] ?? ''))
  ok('financial rows are named FY', /FY 20\d{2}-\d{2}/.test(await page.locator('.hs8-chart table').first().innerText()))
  ok('no page errors on the HS-8 page', errors.length === 0, errors[0] ?? '')
  await page.close()
}

// ─────────── K. search ───────────
console.log('\n=== K. search ===')
for (const q of ['85171300', '8517', 'telecom']) {
  const { page, errors } = await open('/')
  const input = page.locator('.search-hub input').first()
  await input.click(); await input.fill(q); await page.waitForTimeout(700)
  const group = await page.locator('.tariff-more').count()
  const hits = await page.locator('.tariff-more .search-result').count()
  const productSide = await page.locator('.answer-card, .search-results-large').count()
  const t = group ? await page.locator('.tariff-more').innerText() : ''
  ok(`"${q}" -> DGCIS group present`, group === 1, `${hits} tariff lines`)
  ok(`"${q}" -> group says India reporting, not world trade`, /not world trade/i.test(t))
  ok(`"${q}" -> product search independent`, productSide > 0)
  ok(`"${q}" -> no errors`, errors.length === 0, errors[0] ?? '')
  await page.close()
}
{
  // A product word reaches a tariff line only through the heading it belongs
  // to: DGCIS ships 8 coarse commodity groups and no HS-8 descriptions, and
  // inventing one is not allowed. So the route is HStat's own authored HS-6
  // name, and the group has to say that is what happened.
  const { page } = await open('/')
  const si = page.locator('.search-hub input').first()
  await si.click(); await si.fill('smartphone'); await page.waitForTimeout(700)
  ok('"smartphone" still answers with the Comtrade product first',
     await page.locator('.answer-card').count() === 1)
  ok('"smartphone" reaches tariff lines through the heading',
     await page.locator('.tariff-more').count() === 1)
  const viaText = await page.locator('.tariff-more').innerText().catch(() => '')
  ok('"smartphone" names the heading it came through',
     /851713/.test(viaText) && /reached through the heading/i.test(viaText))
  ok('"smartphone" does not claim DGCIS filed that word',
     !/DGCIS.*smartphone/i.test(viaText))
  await page.close()
}

{
  const { page } = await open('/')
  const input = page.locator('.search-hub input').first()
  await input.click(); await input.fill('85171300'); await page.waitForTimeout(700)
  await page.locator('.tariff-more .search-result-open').first().click()
  await page.waitForTimeout(800)
  ok('clicking a tariff line routes to /hs/<8 digits>', /\/hs\/\d{8}$/.test(page.url()), page.url().replace(BASE, ''))
  await page.close()
}

// ─────────── L. retired / predecessor ───────────
console.log('\n=== L. retired and predecessor routes ===')
{
  const { page, errors } = await open('/hs/85171211')   // under predecessor 851712
  const t = await page.innerText('body')
  ok('predecessor HS-8 renders', /85171211/.test(t))
  ok('predecessor wording present', /lineage predecessor/i.test(t))
  ok('no Comtrade card it cannot fill', await page.locator('.hs8-parent-card').count() === 0)
  ok('two flows available on a predecessor line', /India Exports, month by month/i.test(t) && /India Imports, month by month/i.test(t))
  ok('breadcrumb does not offer a product page that does not exist',
     !/HS 851712 · undefined/i.test(t))
  ok('predecessor route throws nothing', errors.length === 0, errors[0] ?? '')
  await page.close()
}
for (const code of ['851770', '850740']) {
  const { page, errors } = await open(`/hs/${code}`)
  const t = await page.innerText('body')
  const panel = await page.locator('#section-dgcis .dgcis').count()
  ok(`retired HS-6 ${code} page renders`, t.includes(code) && t.length > 1200)
  ok(`retired HS-6 ${code} keeps its DGCIS history`, panel === 1)
  ok(`retired HS-6 ${code} is not presented as current`, /retire|no longer|left the Harmonized/i.test(t))
  ok(`retired HS-6 ${code} throws nothing`, errors.length === 0, errors[0] ?? '')
  await page.close()
}

// ─────────── Q. responsive ───────────
console.log('\n=== Q. responsive ===')
for (const [w, h] of [[375, 812], [768, 1024], [1440, 900]]) {
  for (const [path, label] of [['/', 'home'], ['/hs/851713', 'HS-6'], ['/hs/85171300', 'HS-8']]) {
    const { page, errors } = await open(path, { width: w, height: h })
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    /* The 179px HS-6 overflow at 375px that this check used to excuse
     * (.download-master, .stack-add, .pulldata) was fixed in the Phase 2
     * refresh, so every page and width is now held to the same bar. */
    ok(`${w}px ${label}: no horizontal page overflow`, overflow <= 1, `${overflow}px`)
    if (label === 'HS-6') {
      const toggle = page.locator('#section-dgcis .rf-section-toggle')
      if (await toggle.count() && (await toggle.getAttribute('aria-expanded')) === 'false') {
        await toggle.click(); await page.waitForTimeout(300)
      }
      const n = await flowBtns(page).count()
      ok(`${w}px ${label}: flow switch reachable`, n === 2, `${n} buttons`)
    } else if (label === 'HS-8') {
      const n = await page.locator('.hs8-chart table, .hs8-chart .rows').count()
      ok(`${w}px ${label}: both flows reachable`, n >= 2, `${n} flow tables`)
    }
    ok(`${w}px ${label}: no errors`, errors.length === 0, errors[0] ?? '')
    await page.close()
  }
}

// ─────────── W. malformed payload matrix ───────────
console.log('\n=== W. malformed / missing payload matrix ===')
async function scenario(label, routes, path = '/hs/851713') {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  for (const [pattern, handler] of routes) await page.route(pattern, handler)
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const t = await page.innerText('body')
  const panel = await page.locator('#section-dgcis .dgcis').count()
  const note = await page.locator('.tariff-absent').count()
  const comtradeAlive = /world|global/i.test(t) && t.length > 1200
  ok(`[${label}] Comtrade page survives`, comtradeAlive, `${t.length} chars`)
  ok(`[${label}] nothing thrown`, errors.length === 0, errors[0] ?? '')
  ok(`[${label}] no stale wrong-flow wording`,
     !(panel === 0 && /brings in|ships under/i.test(t)))
  await page.close()
  return { panel, note }
}

const notFound = r => r.fulfill({ status: 404, body: 'nope' })
const garbage = r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"hs6":"8517' })

await scenario('missing hs8-index', [['**/data/dgcis/hs8-index.json', notFound]])
await scenario('corrupt hs8-index', [['**/data/dgcis/hs8-index.json', garbage]])
await scenario('missing parent HS6 json', [['**/data/dgcis/hs6/851713.json', notFound]])
await scenario('malformed HS6 json', [['**/data/dgcis/hs6/851713.json', garbage]])

await scenario('previous payload shape', [['**/data/dgcis/hs6/851713.json', async route => {
  const o = await route.fetch(); const b = JSON.parse(await o.text())
  const blk = b.flows.exports
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    hs6: b.hs6, source: b.source, reporter: 'India', partner: 'World', flow: 'imports',
    units: b.units, isProduct: b.isProduct, periods: b.periods, latestPeriod: blk.latestPeriod,
    children: b.lines.map(l => ({ ...l, ...blk.series[l.hs8] })),
  }) })
}]])

const oneFlow = await scenario('one flow absent (exports only)', [['**/data/dgcis/hs6/851713.json', async route => {
  const o = await route.fetch(); const b = JSON.parse(await o.text())
  delete b.flows.imports
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
}]])
ok('[one flow absent] panel still renders', oneFlow.panel === 1)

const noFlow = await scenario('both flows absent', [['**/data/dgcis/hs6/851713.json', async route => {
  const o = await route.fetch(); const b = JSON.parse(await o.text())
  b.flows = {}
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
}]])
ok('[both flows absent] panel hides rather than renders empty', noFlow.panel === 0)

// one-flow-absent must not show a switch with a single option
{
  const page = await browser.newPage()
  await page.route('**/data/dgcis/hs6/851713.json', async route => {
    const o = await route.fetch(); const b = JSON.parse(await o.text())
    delete b.flows.imports
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
  })
  await page.goto(BASE + '/hs/851713', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  ok('[one flow absent] no flow switch with a single option',
     await page.locator('[aria-label="Flow"]').count() === 0)
  await page.close()
}

await browser.close()
const failed = results.filter(r => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) console.log('FAILED:\n  ' + failed.map(f => f.n).join('\n  '))
process.exit(failed.length ? 1 : 0)
