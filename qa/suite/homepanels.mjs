/*
 * Front-page panels: the search tile, the product rankings and DGCIS
 * Reporting.
 *
 *   node qa/suite/homepanels.mjs            # against 4178
 *
 * The search tile carries no visible heading and keeps its controls; the
 * product rankings have no Segment column and say "Share of electronics";
 * DGCIS reporting is one collapsed line that opens to a standard table whose
 * figures read like every other money figure ($33bn, not 32,535), and whose
 * Exports/Imports tabs switch it. Light and dark, desktop and phone.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { render } from '../../scripts/build_hs_names.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4178'
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : undefined)
let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) pass += 1
  else { fail += 1; console.log(`FAIL  ${name}${detail ? `  (${detail})` : ''}`) }
}

/* The curated HS-2/HS-4 names are compiled into the bundle; the module must
 * match config/hs_short_names.csv and config/hs_titles.json. */
ok('HS names module matches config (node scripts/build_hs_names.mjs)', render() === readFileSync('src/lib/hsnames.generated.ts', 'utf8'))

for (const [shape, width, theme] of [['desk', 1440, 'light'], ['desk', 1440, 'dark'], ['phone', 390, 'light']]) {
  const tag = `[${shape} ${theme}]`
  const ctx = await b.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(t => { document.documentElement.dataset.theme = t }, theme)
  await page.waitForTimeout(400)

  /* Search tile. */
  const heroText = await page.locator('.rf-home-hero').evaluate(el =>
    [...el.querySelectorAll('h1, h2, p')].filter(n => n.getBoundingClientRect().height > 1).map(n => n.innerText.trim()).filter(Boolean))
  ok(`${tag} search tile has no visible heading`, heroText.length === 0, heroText.join(' | '))
  ok(`${tag} search tile keeps the search box`, await page.locator('.rf-home-hero .search-primary input').count() === 1)
  const strip = await page.locator('.rf-home-hero').evaluate(el => getComputedStyle(el, '::before').height)
  ok(`${tag} search tile carries its strip`, parseFloat(strip) >= 3, strip)

  /* Product rankings. */
  for (const id of ['home-finished', 'home-components']) {
    const heads = await page.locator(`#rank-${id} thead th`).allInnerTexts()
    ok(`${tag} ${id} has no Segment column`, !heads.some(h => /segment/i.test(h)), heads.join(' | '))
    ok(`${tag} ${id} says Share of electronics`, heads.some(h => /share of electronics/i.test(h)), heads.join(' | '))
  }
  const anyScope = await page.evaluate(() => /share of scope/i.test(document.body.innerText))
  ok(`${tag} "Share of scope" is gone`, !anyScope)

  /* DGCIS reporting. */
  const panel = page.locator('.rf-dgcis')
  ok(`${tag} DGCIS panel present`, await panel.count() === 1)
  const toggle = panel.locator('.rf-dgcis-toggle')
  ok(`${tag} collapsed by default`, (await toggle.getAttribute('aria-expanded')) === 'false' && await panel.locator('table').count() === 0)
  ok(`${tag} titled DGCIS reporting`, /DGCIS reporting/.test(await toggle.innerText()))
  const head = await panel.locator('.rf-h2').boundingBox()
  const show = await panel.locator('.rf-dgcis-show').boundingBox()
  ok(`${tag} heading and Show on one line`, Math.abs((head.y + head.height / 2) - (show.y + show.height / 2)) < 16, `${head.y}/${show.y}`)

  await toggle.click(); await page.waitForTimeout(300)
  ok(`${tag} opens`, (await toggle.getAttribute('aria-expanded')) === 'true')
  ok(`${tag} one table`, await panel.locator('table').count() === 1)
  const rows = await panel.locator('tbody tr').allInnerTexts()
  ok(`${tag} six lines`, rows.length === 6, String(rows.length))
  ok(`${tag} figures read as money`, rows.every(r => /\$\d[\d.,]*(tn|bn|mn|k)?\s*$/.test(r.trim())), rows[0])
  ok(`${tag} no bare USD mn figures`, !rows.some(r => /\b\d{1,3},\d{3}\s*$/.test(r.trim())), rows[0])
  ok(`${tag} no "Above usual pace"`, !/usual pace/i.test(await panel.innerText()))
  const exportsFirst = rows[0]
  await panel.getByRole('tab', { name: 'Imports' }).click(); await page.waitForTimeout(200)
  const importsFirst = (await panel.locator('tbody tr').first().innerText())
  ok(`${tag} Imports tab switches the table`, importsFirst !== exportsFirst && /Largest imports/.test(await panel.innerText()))
  const link = panel.locator('tbody .rf-link').first()
  const code = (await link.innerText()).trim()
  await link.click(); await page.waitForTimeout(600)
  ok(`${tag} a code opens its tariff line`, page.url().endsWith(`/hs/${code}`), page.url())

  ok(`${tag} no page errors`, errors.length === 0, errors[0] ?? '')
  await ctx.close()
}

await b.close()
console.log(`\n${pass}/${pass + fail} home-panel checks passed`)
process.exit(fail ? 1 : 0)
