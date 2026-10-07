/*
 * Contrast audit (execution prompt §2.9): every piece of visible text against
 * the background it actually sits on, in both themes, at 4.5:1 - or 3:1 for
 * large text (24px, or 18.66px bold), as WCAG allows.
 *
 * The background is the first opaque one up the ancestor chain; translucent
 * layers are composited on the way. Text over an image or a chart is skipped
 * rather than guessed.
 *
 *   node qa/suite/contrast.mjs            # against 4178
 *   BASE=http://127.0.0.1:4190 node qa/suite/contrast.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:4178'
const PAGES = ['/', '/hs/85', '/hs/8517', '/hs/851713', '/hs/85171300', '/tariff-lines', '/availability', '/guide', '/query']
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : undefined)
let total = 0
const failures = []

for (const theme of ['light', 'dark']) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const page = await b.newPage({ viewport: { width: w, height: h } })
    for (const path of PAGES) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' })
      await page.waitForTimeout(700)
      if (theme === 'dark') {
        await page.locator('[aria-label="Switch to dark theme"]').first().click().catch(() => {})
        await page.waitForTimeout(400)
      }
      const found = await page.evaluate(() => {
        const parse = c => {
          const m = c.match(/rgba?\(([^)]+)\)/)
          if (!m) return null
          const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
          return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
        }
        const lum = ({ r, g, b }) => {
          const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
        }
        const over = (top, base) => ({
          r: top.r * top.a + base.r * (1 - top.a),
          g: top.g * top.a + base.g * (1 - top.a),
          b: top.b * top.a + base.b * (1 - top.a),
          a: 1,
        })
        const backdrop = el => {
          const layers = []
          for (let n = el; n; n = n.parentElement) {
            const cs = getComputedStyle(n)
            if (cs.backgroundImage && cs.backgroundImage !== 'none') return null
            const c = parse(cs.backgroundColor)
            if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break }
          }
          let base = { r: 255, g: 255, b: 255, a: 1 }
          for (const layer of layers.reverse()) base = layer.a >= 1 ? layer : over(layer, base)
          return base
        }
        const out = []
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        const seen = new Set()
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          if (!t.textContent.trim()) continue
          const el = t.parentElement
          if (!el || seen.has(el) || el.closest('svg, .recharts-wrapper, [aria-hidden="true"]')) continue
          seen.add(el)
          const cs = getComputedStyle(el)
          const box = el.getBoundingClientRect()
          if (cs.visibility === 'hidden' || cs.display === 'none' || box.width === 0 || box.height === 0) continue
          if (Number(cs.opacity) < 1 || el.closest('[disabled], :disabled')) continue
          const fg = parse(cs.color); const bg = backdrop(el)
          if (!fg || !bg) continue
          const color = fg.a < 1 ? over(fg, bg) : fg
          const L1 = lum(color), L2 = lum(bg)
          const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
          const size = parseFloat(cs.fontSize)
          const bold = Number(cs.fontWeight) >= 700
          const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5
          out.push({ ok: ratio >= need, ratio: Math.round(ratio * 100) / 100, need, text: t.textContent.trim().slice(0, 40), cls: String(el.className).slice(0, 40) })
        }
        return out
      })
      total += found.length
      for (const item of found.filter(x => !x.ok)) failures.push({ theme, w, path, ...item })
    }
    await page.close()
  }
}
await b.close()

const unique = new Map()
for (const f of failures) {
  const key = `${f.theme} ${f.cls} ${f.ratio}`
  if (!unique.has(key)) unique.set(key, { ...f, count: 0 })
  unique.get(key).count += 1
}
for (const f of unique.values())
  console.log(`FAIL  ${f.theme} ${f.w}px ${f.path}  ${f.ratio}:1 < ${f.need}  .${f.cls}  "${f.text}" (x${f.count})`)
console.log(`\n${total - failures.length}/${total} text elements pass`)
process.exit(failures.length ? 1 : 0)
