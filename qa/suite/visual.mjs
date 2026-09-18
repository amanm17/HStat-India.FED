/*
 * The rigorous visual pass.
 *
 * Three things break a page in ways a screenshot review usually misses, so
 * they are measured rather than eyeballed:
 *
 *   overlap  — two siblings in a grid or flex row whose boxes intersect. This
 *              is what produced "/currency" sitting on top of "Show rupees".
 *   overflow — an element past the viewport with no scrolling ancestor, which
 *              is what makes a phone scroll sideways.
 *   clipping — text wider than its box with no ellipsis and no wrapping.
 *
 * Run against every page, at three widths, in both themes.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:4178'
const AVAIL = process.env.AVAIL || 'http://127.0.0.1:4179'

const PAGES = [
  ['/', 'home'],
  ['/hs/851762', 'product'],
  ['/hs/85176290', 'tariff line'],
  ['/hs/85437099', 'tariff line (29 siblings)'],
  ['/tariff-lines', 'line index'],
  ['/guide', 'guide'],
  ['/query', 'query builder'],
]

const WIDTHS = [[375, 812], [768, 1024], [1440, 900]]

const results = []
const ok = (n, p, d = '') => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}${d ? '  — ' + d : ''}`) }

const audit = `() => {
  const vw = document.documentElement.clientWidth
  const out = { overlap: [], overflow: [], clipped: [] }

  const scrolls = el => {
    let n = el
    while ((n = n.parentElement)) {
      const ov = getComputedStyle(n).overflowX
      if (ov === 'auto' || ov === 'scroll') return true
    }
    return false
  }

  const label = el =>
    el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')

  document.querySelectorAll('*').forEach(el => {
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return

    if (r.right > vw + 1 && !scrolls(el)) out.overflow.push(label(el) + ' right=' + Math.round(r.right))

    const cs = getComputedStyle(el)
    if (el.children.length === 0 && el.textContent.trim()) {
      const clips = el.scrollWidth > el.clientWidth + 2
      const handled = cs.textOverflow === 'ellipsis' || cs.overflowX !== 'visible' ||
                      cs.whiteSpace === 'normal' || cs.whiteSpace === 'pre-wrap'
      if (clips && !handled) out.clipped.push(label(el) + ' "' + el.textContent.trim().slice(0, 28) + '"')
    }
  })

  // siblings that intersect, within one row of a grid or flex container
  document.querySelectorAll('*').forEach(parent => {
    const cs = getComputedStyle(parent)
    if (!/grid|flex/.test(cs.display)) return
    const kids = [...parent.children].filter(k => {
      const r = k.getBoundingClientRect()
      return r.width > 4 && r.height > 4 && getComputedStyle(k).position !== 'absolute'
    })
    for (let a = 0; a < kids.length; a++) {
      for (let b = a + 1; b < kids.length; b++) {
        const A = kids[a].getBoundingClientRect(), B = kids[b].getBoundingClientRect()
        const sameRow = A.top < B.bottom - 3 && B.top < A.bottom - 3
        const hit = A.left < B.right - 1 && B.left < A.right - 1
        if (sameRow && hit) out.overlap.push(label(kids[a]) + ' ∩ ' + label(kids[b]) + ' in ' + label(parent))
      }
    }
  })

  out.overlap = [...new Set(out.overlap)].slice(0, 6)
  out.overflow = [...new Set(out.overflow)].slice(0, 6)
  out.clipped = [...new Set(out.clipped)].slice(0, 6)
  return out
}`

const b = await chromium.launch()

for (const theme of ['light', 'dark']) {
  for (const [w, h] of WIDTHS) {
    for (const [path, label] of PAGES) {
      const page = await b.newPage({ viewport: { width: w, height: h }, colorScheme: theme })
      const errs = []
      page.on('pageerror', e => errs.push(String(e)))
      await page.goto(BASE + path, { waitUntil: 'networkidle' })
      if (theme === 'dark') await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
      await page.waitForTimeout(700)

      const r = await page.evaluate(`(${audit})()`)
      const tag = `${theme} ${w}px ${label}`

      ok(`${tag}: no overlapping siblings`, r.overlap.length === 0, r.overlap.join(' | '))
      ok(`${tag}: no unscrollable overflow`, r.overflow.length === 0, r.overflow.join(' | '))
      ok(`${tag}: no clipped text`, r.clipped.length === 0, r.clipped.join(' | '))
      ok(`${tag}: no page errors`, errs.length === 0, errs[0] ?? '')
      await page.close()
    }
  }
}

// the availability page needs its data file, served separately
for (const [w, h] of WIDTHS) {
  for (const theme of ['light', 'dark']) {
    const page = await b.newPage({ viewport: { width: w, height: h }, colorScheme: theme })
    const errs = []
    page.on('pageerror', e => errs.push(String(e)))
    await page.goto(AVAIL + '/availability', { waitUntil: 'networkidle' })
    if (theme === 'dark') await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    await page.waitForTimeout(800)
    const r = await page.evaluate(`(${audit})()`)
    const tag = `${theme} ${w}px availability`
    ok(`${tag}: no overlapping siblings`, r.overlap.length === 0, r.overlap.join(' | '))
    ok(`${tag}: no unscrollable overflow`, r.overflow.length === 0, r.overflow.join(' | '))
    ok(`${tag}: no clipped text`, r.clipped.length === 0, r.clipped.join(' | '))
    ok(`${tag}: no page errors`, errs.length === 0, errs[0] ?? '')
    await page.close()
  }
}

// the help card opens over content on every page: check it too
for (const [w] of WIDTHS) {
  const page = await b.newPage({ viewport: { width: w, height: 900 } })
  await page.goto(BASE + '/hs/851762', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.locator('.helpbutton').click()
  await page.waitForTimeout(400)
  const r = await page.evaluate(`(${audit})()`)
  ok(`${w}px help card: no overlap`, r.overlap.length === 0, r.overlap.join(' | '))
  ok(`${w}px help card: fits the viewport`, r.overflow.length === 0, r.overflow.join(' | '))
  await page.close()
}

await b.close()
const failed = results.filter(r => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} visual checks passed`)
process.exit(failed.length ? 1 : 0)
