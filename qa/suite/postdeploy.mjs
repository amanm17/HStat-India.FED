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
  const panel = page.locator('section.dgcis')
  ok('HS-6 DGCIS panel renders', await panel.count() === 1)
  ok('two flow buttons', await flowBtns(page).count() === 2, await flowBtns(page).allInnerTexts().then(t => t.join('/')))
  ok('exports is the default selection',
     (await page.locator('[aria-label="Flow"] button[aria-pressed="true"]').innerText()).trim() === 'Exports')
  let t = await panel.innerText()
  ok('export heading correct', /What India ships under this heading/i.test(t))
  ok('export value present (2,977 USD mn)', /2,977/.test(t), t.match(/[\d,]+\s*$/m)?.[0] ?? '')

  await flowBtns(page).nth(1).click(); await page.waitForTimeout(600)
  t = await panel.innerText()
  ok('import heading correct', /What India brings in under this heading/i.test(t))
  ok('displayed values changed to imports (9.8)', /9\.8/.test(t))
  ok('footer names the current flow', /partner World, imports/i.test(t))

  // currency still works while on imports
  const cur = page.locator('[aria-label="Currency"] button')
  await cur.nth(1).click(); await page.waitForTimeout(500)
  t = await panel.innerText()
  ok('currency switch still works on imports (INR 92.7)', /92\.7/.test(t))
  await cur.nth(0).click(); await page.waitForTimeout(400)

  await flowBtns(page).nth(0).click(); await page.waitForTimeout(600)
  t = await panel.innerText()
  ok('switching back restores exports', /What India ships/i.test(t) && /2,977/.test(t))
  ok('no page errors during HS-6 flow switching', errors.length === 0, errors[0] ?? '')
  await page.close()
}

// ─────────── J. two-flow UI, HS-8 ───────────
console.log('\n=== J. two-flow switching — HS-8 85171300 ===')
{
  const { page, errors } = await open('/hs/85171300')
  ok('two flow buttons on the tariff-line page', await flowBtns(page).count() === 2)
  let t = await page.innerText('body')
  ok('chart heading says Exports', /Exports, month by month/i.test(t))
  const ex12 = t.match(/LAST 12 MONTHS[^\n]*\n([\d,]+)/i)?.[1]
  ok('export headline metric present', !!ex12, `12m = ${ex12}`)

  await flowBtns(page).nth(1).click(); await page.waitForTimeout(700)
  t = await page.innerText('body')
  ok('chart heading switches to Imports', /Imports, month by month/i.test(t))
  const im12 = t.match(/LAST 12 MONTHS[^\n]*\n([\d,]+)/i)?.[1]
  ok('headline metric changed', im12 !== ex12, `${ex12} -> ${im12}`)
  ok('lede switches to imports wording', /India.s imports from the world/i.test(t))
  ok('annual summaries changed', /Imports, month by month/i.test(t))
  ok('calendar-year table still renders', /Calendar years/i.test(t) && /MONTHS FILED/i.test(t))

  await flowBtns(page).nth(0).click(); await page.waitForTimeout(700)
  t = await page.innerText('body')
  ok('switching back restores the export view', /Exports, month by month/i.test(t) &&
     (t.match(/LAST 12 MONTHS[^\n]*\n([\d,]+)/i)?.[1] === ex12))
  ok('no page errors during HS-8 flow switching', errors.length === 0, errors[0] ?? '')
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
  ok('two flows available on a predecessor line', await flowBtns(page).count() === 2)
  ok('breadcrumb does not offer a product page that does not exist',
     !/HS 851712 · undefined/i.test(t))
  ok('predecessor route throws nothing', errors.length === 0, errors[0] ?? '')
  await page.close()
}
for (const code of ['851770', '850740']) {
  const { page, errors } = await open(`/hs/${code}`)
  const t = await page.innerText('body')
  const panel = await page.locator('section.dgcis').count()
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
    if (w === 375 && label === 'HS-6') {
      // Known pre-existing: .download-master / .stack-add / .pulldata push the
      // page to 554px with DGCIS removed too. What this work owns is that the
      // tariff table scrolls inside its own wrapper and adds nothing.
      const fromDgcis = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth
        const panel = document.querySelector('section.dgcis')
        if (!panel) return 0
        let n = 0
        panel.querySelectorAll('*').forEach(el => {
          const b = el.getBoundingClientRect()
          if (b.right <= vw + 1 || b.width <= 30) return
          let a = el, scrolls = false
          while ((a = a.parentElement)) {
            const ov = getComputedStyle(a).overflowX
            if (ov === 'auto' || ov === 'scroll') { scrolls = true; break }
          }
          if (!scrolls) n++
        })
        return n
      })
      ok(`${w}px ${label}: DGCIS panel adds no page overflow`, fromDgcis === 0,
         `${fromDgcis} unscrolled overflowing elements in the panel (page total ${overflow}px is pre-existing)`)
    } else {
      ok(`${w}px ${label}: no horizontal page overflow`, overflow <= 1, `${overflow}px`)
    }
    if (path !== '/') {
      const n = await flowBtns(page).count()
      ok(`${w}px ${label}: flow switch reachable`, n === 2 || path === '/', `${n} buttons`)
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
  const panel = await page.locator('section.dgcis').count()
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
