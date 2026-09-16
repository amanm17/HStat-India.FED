import { chromium } from 'playwright'
const results = []
const ok = (n, p, d = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const browser = await chromium.launch()
for (const [port, label] of [[4184, 'no dgcis data'], [4178, 'full data']]) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(`http://127.0.0.1:${port}/hs/851762`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const note = await page.locator('.tariff-absent').count()
  const panel = await page.locator('section.dgcis').count()
  ok(`[${label}] exactly one of panel/note is shown`, note + panel === 1, `note=${note} panel=${panel}`)
  if (label === 'no dgcis data') ok('[no dgcis data] the note is the one shown', note === 1)
  if (label === 'full data') ok('[full data] the panel is the one shown', panel === 1)
  ok(`[${label}] nothing thrown`, errors.length === 0, errors[0] ?? '')
  await page.close()
}
await browser.close()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
