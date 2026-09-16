/*
 * Does the boundary actually earn its place?
 *
 * The graceful-degradation tests above all passed without necessarily
 * exercising it - null-safe code may simply have coped. This forces a real
 * throw inside the tariff-line panel, mid-render, and asserts that the
 * product page around it survives intact.
 */
import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4178'
const results = []
const ok = (n, p, d = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

const browser = await chromium.launch()
const page = await browser.newPage()

const thrown = []
page.on('pageerror', e => thrown.push(String(e)))

// A payload that passes every shape check and then explodes on first use:
// lines is an array, as required, of null.
await page.route('**/data/dgcis/hs6/851762.json', async route => {
  const original = await route.fetch()
  const body = JSON.parse(await original.text())
  body.lines = [null, null]
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
})

await page.goto(`${BASE}/hs/851762`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)

const text = await page.innerText('body')
ok('page survives a throw inside the panel', text.includes('851762') && text.length > 1500, `${text.length} chars`)
ok('the broken panel is gone', (await page.locator('section.dgcis').count()) === 0)
ok('nothing escaped to the window', thrown.length === 0, thrown[0] ?? '')
ok('the rest of the product page is intact', /world|global/i.test(text) &&
   (await page.locator('.tile, section.release-section').count()) > 5)

// and the tariff-line page for the same poisoned heading
const page2 = await browser.newPage()
const thrown2 = []
page2.on('pageerror', e => thrown2.push(String(e)))
await page2.route('**/data/dgcis/hs6/851762.json', async route => {
  const original = await route.fetch()
  const body = JSON.parse(await original.text())
  body.lines = [null]
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
})
await page2.goto(`${BASE}/hs/85176290`, { waitUntil: 'networkidle' })
await page2.waitForTimeout(900)
const t2 = await page2.innerText('body')
ok('HS-8 page survives the same throw', t2.length > 80, `${t2.length} chars`)
ok('HS-8 page offers a way back', /front page|No DGCIS|could not be shown/i.test(t2))
ok('nothing escaped there either', thrown2.length === 0, thrown2[0] ?? '')

await browser.close()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
