/*
 * The secret look (lib/look.ts, components/LookSwitch.tsx).
 *
 *   ~AM1708    in the search box  -> HStat.India by Aman
 *   ~AM1708/   in the search box  -> back to the FED design
 *
 * Asserts the switch fires, runs its sequence, persists per browser, comes
 * back, never searches or records the code, never changes a figure, and
 * that typing the exit code straight through does not flash the secret look.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:4190'
const R = []
const ok = (n, p, d = '') => { R.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : undefined)

const look = page => page.evaluate(() => document.documentElement.dataset.look ?? 'fed')
const stored = page => page.evaluate(() => localStorage.getItem('hstat-look'))
const figures = page => page.locator('.rf-figure-value').allInnerTexts()

for (const [w, h, shape] of [[1440, 900, 'desk'], [390, 844, 'phone']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 600, hasTouch: w < 600 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const before = await figures(page)
  ok(`[${shape}] starts in the FED look`, (await look(page)) === 'fed')

  const box = page.locator('.search-hub input').first()
  await box.click()
  await box.type('~AM17', { delay: 40 })
  await page.waitForTimeout(300)
  const shown = await page.evaluate(() => [...document.querySelectorAll('.search-output, .search-empty, .search-focus-panel')].filter(el => el.getBoundingClientRect().height > 0).map(el => el.className))
  ok(`[${shape}] a half-typed code shows no search panel`, shown.length === 0, shown.join(', '))
  await box.type('08', { delay: 40 })
  await page.waitForTimeout(1000)
  ok(`[${shape}] the code opens the portal`, (await page.locator('.look-switch').count()) === 1)
  await page.waitForTimeout(1700)
  const title = await page.locator('.look-title').innerText().catch(() => '')
  const byline = await page.locator('.look-byline').innerText().catch(() => '')
  ok(`[${shape}] the portal names HStat.India by Aman`, /HStat\.India/.test(title) && /by aman/i.test(byline), `${title} / ${byline}`)
  await page.waitForTimeout(1800)
  ok(`[${shape}] the portal has closed`, (await page.locator('.look-switch').count()) === 0)
  ok(`[${shape}] the secret look is on`, (await look(page)) === 'aman')
  ok(`[${shape}] the header reads HStat.India by Aman`, /HStat\.India\s*by Aman/.test(await page.locator('.brand').innerText()))
  ok(`[${shape}] the box was cleared`, (await box.inputValue()) === '')
  ok(`[${shape}] the code is not a recent search`, !(await page.evaluate(() => JSON.stringify(localStorage))).includes('AM1708'))
  ok(`[${shape}] figures are unchanged`, JSON.stringify(await figures(page)) === JSON.stringify(before))

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  ok(`[${shape}] the look survives a reload`, (await look(page)) === 'aman' && (await stored(page)) === 'aman')

  await page.goto(BASE + '/hs/851713', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  ok(`[${shape}] product pages take the look`, (await look(page)) === 'aman')
  const chart = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--series-global').trim())
  ok(`[${shape}] series colours follow the look`, chart.toLowerCase() === '#5b45c9', chart)

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const box2 = page.locator('.search-hub input').first()
  await box2.click()
  await box2.type('~AM1708/', { delay: 40 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  ok(`[${shape}] ~AM1708/ returns to the FED look`, (await look(page)) === 'fed' && (await stored(page)) === null)
  ok(`[${shape}] the FED logo is back`, (await page.locator('.fed-logo.color').count()) === 1)

  /* Typing the exit code from the FED look must not flash the secret one. */
  const box3 = page.locator('.search-hub input').first()
  await box3.click()
  await box3.type('~AM1708/', { delay: 40 })
  await page.waitForTimeout(1200)
  ok(`[${shape}] typing straight through ~AM1708 does not trigger it`, (await look(page)) === 'fed')
  await page.waitForTimeout(3000)
  await page.keyboard.press('Escape')
  ok(`[${shape}] no page errors`, errors.length === 0, errors[0] ?? '')
  await ctx.close()
}

/* Reduced motion: a short fade, no portal animation, same outcome. */
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  const box = page.locator('.search-hub input').first()
  await box.click(); await box.fill('~AM1708'); await page.keyboard.press('Enter')
  await page.waitForTimeout(250)
  ok('[reduced motion] calm variant used', (await page.locator('.look-switch.calm').count()) === 1)
  await page.waitForTimeout(800)
  ok('[reduced motion] switched in under a second', (await look(page)) === 'aman' && (await page.locator('.look-switch').count()) === 0)
  await ctx.close()
}

await b.close()
const f = R.filter(r => !r.p)
console.log(`\n${R.length - f.length}/${R.length} easter-egg checks passed`)
process.exit(f.length ? 1 : 0)
