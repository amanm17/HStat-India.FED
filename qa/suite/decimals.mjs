/*
 * Decimals: the site-wide switch beside Year and Currency.
 *
 *   node qa/suite/decimals.mjs            # against 4178
 *
 * Checks that the control is on the front page, a product page and a tariff
 * line; that minus and plus move every figure; that the result is the exact
 * half-away-from-zero rounding of the published number (not binary
 * toFixed); that the choice survives navigation and a reload; that the
 * number in the label returns to Auto; and that Auto is the site as it was.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE || 'http://127.0.0.1:4178'
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : undefined)
let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) pass += 1
  else { fail += 1; console.log(`FAIL  ${name}${detail ? `  (${detail})` : ''}`) }
}

/* Reference rounding, independent of the app's: decimal string arithmetic. */
function ref(value, digits, shift = 0) {
  const [m, e = '0'] = String(Math.abs(value)).split('e')
  const [whole, frac = ''] = m.split('.')
  let digitsStr = whole + frac
  let point = whole.length + Number(e) + shift
  while (point < 0) { digitsStr = '0' + digitsStr; point += 1 }
  while (digitsStr.length < point + digits + 1) digitsStr += '0'
  const keep = digitsStr.slice(0, point + digits)
  const next = Number(digitsStr[point + digits])
  let n = BigInt(keep || '0')
  if (next >= 5) n += 1n
  let s = n.toString().padStart(digits + 1, '0')
  const text = digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s
  return (value < 0 && Number(text) !== 0 ? '-' : '') + text
}

const scope = JSON.parse(readFileSync('public/data/snapshots/current/scope.json', 'utf8'))
const latest = Object.keys(scope.years).filter(y => scope.years[y].worldImports > 0).sort().pop()
const exportsValue = scope.years[latest].indiaExports
const worldValue = scope.years[latest].worldImports

const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))

const tile = async label =>
  page.evaluate(l => [...document.querySelectorAll('.rf-tiles .rf-figure')].find(f => f.innerText.includes(l))?.querySelector('.rf-figure-value')?.innerText.replace(/\*$/, '').trim(), label)

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.evaluate(() => { try { localStorage.removeItem('hstat-decimals') } catch {} })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)

ok('control on the front page', await page.locator('.rf-decimals').count() === 1)
ok('starts at Auto', (await page.locator('.rf-decimals-state').innerText()).trim() === 'Auto')
const autoExports = await tile('India Exports')
ok('Auto keeps the designed precision', autoExports === `$${ref(exportsValue, 2, -9)}bn`, autoExports)

const minus = page.locator('[aria-label="Decrease decimal places"]').first()
const plus = page.locator('[aria-label="Increase decimal places"]').first()

await minus.click(); await page.waitForTimeout(150)
ok('minus from Auto is one place', (await tile('India Exports')) === `$${ref(exportsValue, 1, -9)}bn`, await tile('India Exports'))
await minus.click(); await page.waitForTimeout(150)
ok('zero places', (await tile('India Exports')) === `$${ref(exportsValue, 0, -9)}bn`, await tile('India Exports'))
ok('minus stops at zero', await minus.isDisabled())

for (let i = 0; i < 6; i += 1) await plus.click()
await page.waitForTimeout(150)
ok('six places', (await tile('India Exports')) === `$${ref(exportsValue, 6, -9)}bn`, await tile('India Exports'))
ok('six places, world', (await tile('Global Trade')) === `$${ref(worldValue, 6, -12)}tn`, await tile('Global Trade'))
ok('plus stops at six', await plus.isDisabled())
ok('label shows the places', (await page.locator('.rf-decimals-state').innerText()).trim() === '6')

const share = await page.evaluate(() => [...document.querySelectorAll('.rf-tiles .rf-figure')].find(f => f.innerText.includes('India Exports'))?.querySelector('.rf-figure-caption')?.innerText)
ok('shares follow', /\d\.\d{6}% of world exports/.test(share ?? ''), share)
const rankRow = await page.locator('#rank-home-importers tbody tr').first().innerText()
ok('rankings follow', /\$[\d.]+\.\d{6}(tn|bn)/.test(rankRow) && /\d\.\d{6}%/.test(rankRow), rankRow)

/* Persists across pages and reloads. */
await page.goto(BASE + '/hs/851713', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
ok('control on a product page', await page.locator('.rf-decimals').count() === 1)
ok('product page keeps the choice', (await page.locator('.rf-decimals-state').innerText()).trim() === '6')
ok('product figures follow', /\.\d{6}(bn|mn|tn)/.test((await tile('Global Trade')) ?? ''), await tile('Global Trade'))

await page.goto(BASE + '/hs/85176290', { waitUntil: 'networkidle' }); await page.waitForTimeout(400)
ok('control on a tariff line', await page.locator('.rf-decimals').count() === 1)
const hs8 = await page.locator('#tile-hs8-exports tbody tr').first().innerText()
ok('tariff-line months follow', /\d\.\d{6}/.test(hs8), hs8.slice(0, 60))

await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400)
ok('survives a reload', (await page.locator('.rf-decimals-state').innerText()).trim() === '6')

await page.locator('.rf-decimals-reset').click(); await page.waitForTimeout(150)
ok('the number returns to Auto', (await page.locator('.rf-decimals-state').innerText()).trim() === 'Auto')
const hs8Auto = await page.locator('#tile-hs8-exports tbody tr').first().innerText()
ok('Auto restores tariff-line precision', !/\d\.\d{6}/.test(hs8Auto))

ok('page errors', errors.length === 0, errors[0] ?? '')

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.evaluate(() => { try { localStorage.removeItem('hstat-decimals') } catch {} })

await b.close()
console.log(`\n${pass}/${pass + fail} decimals checks passed`)
process.exit(fail ? 1 : 0)
