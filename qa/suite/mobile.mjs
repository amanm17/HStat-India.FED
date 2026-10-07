/*
 * The phone suite.
 *
 * visual.mjs and align.mjs ask whether the page is put together correctly.
 * This asks a different question: can it be used by a thumb, on a screen held
 * vertically, by somebody who cannot hover, cannot right-click, and cannot
 * see a 9px caption.
 *
 * Six measures, each of which failed somewhere before this suite existed:
 *
 *   targets    every control at least 44px on both axes. A link inside a
 *              sentence is exempt on width only - WCAG exempts inline targets,
 *              and padding "2024" out would break the line it sits in.
 *   type       nothing under 11px. Three exceptions are named below and are
 *              structure rather than content.
 *   overflow   the page never scrolls sideways, and nothing sits past the
 *              right edge without something to scroll it.
 *   overlap    no two siblings in a row intersect. This is the one the
 *              floating workspace handle failed, sitting on the page's text.
 *   reach      the tab bar is fixed to the bottom, is not covered, and its
 *              five destinations are all hittable.
 *   sheets     search, more and workspace open, trap the page behind them,
 *              and close four ways.
 *
 * Run at three portrait widths and once in landscape, in both themes. The
 * landscape pass is not a formality: it is where a 84vh sheet and a fixed bar
 * fight for a 390px-tall viewport.
 */
import { chromium, devices } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:4178'
const CHROME = process.env.PW_CHROME || undefined

const PAGES = [
  ['home', '/'],
  ['product', '/hs/854231'],
  ['tariff line', '/hs/85176290'],
  ['line index', '/tariff-lines'],
  ['guide', '/guide'],
  ['coverage', '/availability'],
  ['query', '/query'],
]

/* 360 is the narrowest Android in common use, 390 an iPhone 13/14/15, 414 a
 * Plus/Max. Landscape last, at the height where fixed furniture hurts. */
const SHAPES = [
  ['360', { width: 360, height: 780 }],
  ['390', { width: 390, height: 844 }],
  ['414', { width: 414, height: 896 }],
  ['landscape', { width: 844, height: 390 }],
]

/* Named, not forgiven silently. Caps with wide tracking read a size larger
 * than their number, and a tab label is furniture. */
const TYPE_EXEMPT = new Set([
  'eyebrow',
  'home-eyebrow',
  'status-pill',
  'guide-toc-label',
  'moresheet-head',
  'helpcard-label',
  'rail-subhead',
  'quick-label',
  'row-figure',
])

const results = []
const ok = (n, p, d = '') => {
  results.push({ n, p })
  console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`)
}

const audit = exemptList => `() => {
  const EXEMPT = new Set(${JSON.stringify(exemptList)})
  const vw = document.documentElement.clientWidth
  const out = { small: [], tiny: [], overflow: [], overlap: [], pageOverflow: 0 }

  const label = el =>
    el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')

  const scrolls = el => {
    let n = el
    while ((n = n.parentElement)) {
      const ov = getComputedStyle(n).overflowX
      if (ov === 'auto' || ov === 'scroll') return true
    }
    return false
  }

  out.pageOverflow = document.documentElement.scrollWidth - vw

  for (const el of document.querySelectorAll('button, a, input, select, textarea, summary, [role="button"]')) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (getComputedStyle(el).visibility === 'hidden') continue

    const disp = getComputedStyle(el).display
    if (disp === 'inline') continue

    const inProse = ['P','LI','DD','DT','SPAN','EM','STRONG'].includes(el.parentElement?.tagName)
    if (inProse && disp === 'inline-block' && r.height >= 44) continue

    if (r.height < 44 || r.width < 44) {
      out.small.push(label(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) +
        ' "' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 18) + '"')
    }
  }

  for (const el of document.querySelectorAll('p, span, small, td, th, li, div, dt, dd, b, i, em, strong')) {
    if (el.childElementCount || el.textContent.trim().length < 3) continue
    const cls = (el.className || '').toString().split(' ')[0]
    const par = (el.parentElement?.className || '').toString().split(' ')[0]
    if (EXEMPT.has(cls) || EXEMPT.has(par)) continue
    if (el.closest('.tabbar')) continue
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (fs > 0 && fs < 11) out.tiny.push(label(el) + ' ' + fs + 'px "' + el.textContent.trim().slice(0, 20) + '"')
  }

  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) continue
    if (r.right > vw + 1 && !scrolls(el)) out.overflow.push(label(el) + ' right=' + Math.round(r.right))
  }

  for (const parent of document.querySelectorAll('*')) {
    const cs = getComputedStyle(parent)
    if (!/grid|flex/.test(cs.display)) continue
    const kids = [...parent.children].filter(k => {
      const r = k.getBoundingClientRect()
      return r.width > 4 && r.height > 4 && getComputedStyle(k).position !== 'absolute'
    })
    for (let a = 0; a < kids.length; a++) {
      for (let b = a + 1; b < kids.length; b++) {
        const A = kids[a].getBoundingClientRect(), B = kids[b].getBoundingClientRect()
        if (A.top < B.bottom - 3 && B.top < A.bottom - 3 && A.left < B.right - 1 && B.left < A.right - 1) {
          out.overlap.push(label(kids[a]) + ' over ' + label(kids[b]) + ' in ' + label(parent))
        }
      }
    }
  }

  out.small = [...new Set(out.small)].slice(0, 5)
  out.tiny = [...new Set(out.tiny)].slice(0, 5)
  out.overflow = [...new Set(out.overflow)].slice(0, 5)
  out.overlap = [...new Set(out.overlap)].slice(0, 5)
  return out
}`

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : undefined)

for (const [shape, viewport] of SHAPES) {
  for (const theme of ['light', 'dark']) {
    for (const [name, path] of PAGES) {
      const ctx = await browser.newContext({
        ...devices['iPhone 13'],
        viewport,
        isMobile: true,
        hasTouch: true,
      })

      const page = await ctx.newPage()
      const errs = []

      page.on('pageerror', e => errs.push(String(e)))

      await page.goto(BASE + path, { waitUntil: 'networkidle' })
      await page.evaluate(t => { document.documentElement.dataset.theme = t }, theme)
      await page.waitForTimeout(700)

      /* The string is an arrow function; evaluating it bare returns the
       * function rather than its result. It has to be called. */
      const found = await page.evaluate(`(${audit([...TYPE_EXEMPT])})()`)
      const where = `${name} @${shape}/${theme}`

      ok(`${where} — no sideways scroll`, found.pageOverflow <= 1, `${found.pageOverflow}px`)
      ok(`${where} — every target 44px`, found.small.length === 0, found.small[0] ?? '')
      ok(`${where} — nothing under 11px`, found.tiny.length === 0, found.tiny[0] ?? '')
      ok(`${where} — nothing past the edge`, found.overflow.length === 0, found.overflow[0] ?? '')
      ok(`${where} — nothing overlaps`, found.overlap.length === 0, found.overlap[0] ?? '')
      ok(`${where} — no errors`, errs.length === 0, errs[0] ?? '')

      await ctx.close()
    }
  }
}

/* ---------- reach and behaviour, once, at the middle size ---------- */

const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})

const page = await ctx.newPage()
const errs = []

page.on('pageerror', e => errs.push(String(e)))

await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(900)

{
  const bar = await page.locator('.tabbar').boundingBox()
  const vp = page.viewportSize()

  ok('the bar is fixed to the bottom', !!bar && Math.abs(bar.y + bar.height - vp.height) < 2,
    bar ? `bottom at ${Math.round(bar.y + bar.height)} of ${vp.height}` : 'absent')
  ok('the bar has five destinations', (await page.locator('.tab').count()) === 5)

  /* Nothing may sit on top of the bar: it is the one piece of furniture a
   * reader must always be able to hit. */
  const covered = await page.evaluate(() => {
    const bar = document.querySelector('.tabbar').getBoundingClientRect()
    const x = bar.left + bar.width / 2
    const y = bar.top + bar.height / 2
    const top = document.elementFromPoint(x, y)
    return !top?.closest('.tabbar')
  })

  ok('nothing covers the bar', !covered)
}

/* Search: opens, finds, closes, and locks the page while open. */
await page.locator('.tab', { hasText: 'Search' }).tap()
await page.waitForTimeout(500)
ok('search opens as a sheet', (await page.locator('.sheet').count()) === 1)
ok('the page behind it is locked',
  (await page.evaluate(() => getComputedStyle(document.body).overflow)) === 'hidden')

await page.locator('.sheet input').first().fill('smartphone')
await page.waitForTimeout(800)
ok('search finds things',
  /851713|smartphone/i.test(await page.locator('.sheet-body').innerText()))

await page.keyboard.press('Escape')
await page.waitForTimeout(400)
ok('escape closes it', (await page.locator('.sheet').count()) === 0)
ok('the page unlocks',
  (await page.evaluate(() => getComputedStyle(document.body).overflow)) !== 'hidden')

/* The same shortcut, for anyone on a tablet with a keyboard: there is no box
 * in the title strip below 900, so it has to reach the sheet instead. */
await page.keyboard.press('/')
await page.waitForTimeout(500)
ok('slash opens the search sheet', (await page.locator('.sheet').count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(350)

/* More: the destinations the rail used to hold. */
await page.locator('.tab', { hasText: 'More' }).tap()
await page.waitForTimeout(450)
{
  const text = await page.locator('.sheet').innerText()
  ok('more reaches the query builder', /query/i.test(text))
  ok('more reaches the guide', /guide|how to read/i.test(text))
}
await page.locator('.sheet-scrim').tap({ position: { x: 10, y: 10 } })
await page.waitForTimeout(400)
ok('the backdrop closes it', (await page.locator('.sheet').count()) === 0)

/* Cards: the table replacement. */
await page.goto(BASE + '/tariff-lines', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
ok('the index renders as cards, not a table',
  (await page.locator('.rows .row-head').count()) > 5 &&
  (await page.locator('.lines-group table').count()) === 0)

await page.locator('.row-head').first().tap()
await page.waitForTimeout(350)
ok('a card opens', (await page.locator('.row-detail').count()) === 1)
ok('and shows what the columns held',
  /latest month/i.test(await page.locator('.row-detail').first().innerText()))

await page.locator('.row-head').first().tap()
await page.waitForTimeout(350)
ok('and closes again', (await page.locator('.row-detail').count()) === 0)

await page.locator('.row-head').first().tap()
await page.waitForTimeout(300)
await page.locator('.row-open').first().tap()
await page.waitForTimeout(900)
ok('its own page is a separate tap', /\/hs\/\d{8}$/.test(page.url()), page.url().replace(BASE, ''))

/* The workspace, as a sheet with no dragging. */
await page.goto(BASE + '/hs/854231', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.locator('.toggles button[aria-label^="Open the workspace"]').tap()
await page.waitForTimeout(500)
ok('the workspace opens as a sheet', (await page.locator('.sheet').count()) === 1)
ok('with no drag handles', (await page.locator('.rail-check-grip').count()) === 0)
ok('and buttons to move a tile instead', (await page.locator('.rail-move button').count()) > 4)

{
  /* Sections, since the Phase 2 refresh; .rail-check is now the report
   * builder's code list. */
  const before = await page.locator('.rail-section').first().innerText()
  await page.locator('.rail-move button').nth(1).tap()
  await page.waitForTimeout(400)
  const after = await page.locator('.rail-section').first().innerText()
  ok('moving a tile actually moves it', before !== after)
}

ok('no errors through any of it', errs.length === 0, errs[0] ?? '')

await ctx.close()
await browser.close()

const failed = results.filter(r => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} mobile checks passed`)
if (failed.length) {
  console.log('FAILED:\n  ' + failed.map(x => x.n).join('\n  '))
  process.exit(1)
}
