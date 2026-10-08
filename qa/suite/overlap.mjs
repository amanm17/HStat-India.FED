/*
 * Overlap and flow audit.
 *
 * visual.mjs asks whether anything is broken, align.mjs whether it is
 * square, mobile.mjs whether a thumb can use it. This asks the question a
 * reader notices first: does anything sit on top of anything else.
 *
 * Measured, never eyeballed, on every page x width x theme, in the page's
 * resting state and with its folded parts opened (sections, the
 * calculation drawer, the download menu, the search panel, the rail):
 *
 *   text      no two pieces of text intersect (line boxes from Range rects)
 *   clip      no text is cut off by a clipping ancestor without an ellipsis
 *   spill     no text runs out of the tile, card or cell that holds it
 *   siblings  no two in-flow children of a flex/grid container intersect
 *   overflow  nothing pushes the page sideways or past the viewport edge
 *             outside a scroll container
 *   occlusion scrolled through a viewport at a time, no fixed or sticky
 *             control (header, section tabs, tab bar, help, rail handle)
 *             covers readable text
 *   order     headings come before their content and section order matches
 *             the section tabs (the "logical flow" half of the brief)
 *
 *   node qa/suite/overlap.mjs                 # 4178 (live data) + 4190 (fixture)
 *   LOOK=aman node qa/suite/overlap.mjs       # the same, in the secret look
 */
import { chromium } from 'playwright'

const REAL = process.env.BASE || 'http://127.0.0.1:4178'
const FIXTURE = process.env.FIXTURE || 'http://127.0.0.1:4190'
const LOOK = process.env.LOOK || 'fed'
const QUICK = Boolean(process.env.QUICK)

const PAGES = [
  [FIXTURE, '/', 'home'],
  [REAL, '/', 'home (pre-reprocess)'],
  [FIXTURE, '/hs/85', 'HS-2'],
  [FIXTURE, '/hs/8517', 'HS-4'],
  [FIXTURE, '/hs/851713', 'HS-6'],
  [REAL, '/hs/851762', 'HS-6 real'],
  [REAL, '/hs/851770', 'HS-6 retired'],
  [REAL, '/hs/85171300', 'HS-8'],
  [REAL, '/hs/85171211', 'HS-8 predecessor'],
  [FIXTURE, '/top/importers', 'view all (home)'],
  [FIXTURE, '/hs/851713/import-partners', 'view all (product)'],
  [REAL, '/tariff-lines', 'tariff lines'],
  [REAL, '/availability', 'availability'],
  [REAL, '/guide', 'guide'],
  [REAL, '/query', 'query builder'],
]

const SHAPES = QUICK
  ? [[1440, 900, 'desk'], [390, 844, 'phone']]
  : [[1440, 900, 'desk'], [1024, 768, 'laptop'], [768, 1024, 'tablet'], [414, 896, 'p414'], [390, 844, 'p390'], [360, 740, 'p360'], [844, 390, 'landscape']]

const THEMES = QUICK ? ['light'] : ['light', 'dark']

const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  if (!pass) console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`)
}

const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : undefined)

/* ------------------------------------------------------------ in-page */

function measure(includeFixed = false) {
  const vw = document.documentElement.clientWidth
  const out = { text: [], clip: [], spill: [], siblings: [], overflow: [], order: [], controls: [] }

  const visible = el => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
      /* Fixed and sticky chrome is judged by the occlusion pass, scrolled. */
      if ((cs.position === 'fixed' || cs.position === 'sticky') && !includeFixed) return false
    }
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    const cs = getComputedStyle(el)
    if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') return false
    return true
  }

  const label = el => {
    const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').split(' ').filter(Boolean).slice(0, 2).join('.')
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`
  }

  const sx = window.scrollX
  const sy = window.scrollY

  /* -- text line boxes -- */
  const boxes = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim()) continue
    const el = t.parentElement
    if (!el || el.closest('svg, script, style, noscript, .recharts-wrapper, .sr-only, [hidden]')) continue
    if (!visible(el)) continue
    const range = document.createRange()
    range.selectNodeContents(t)
    /* What is drawn is the text clipped by any overflow:hidden ancestor
     * (an ellipsis, a truncating cell); the clip check below judges the cut. */
    let clipBox = null
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const ncs = getComputedStyle(n)
      if (ncs.overflowX !== 'visible' || ncs.overflowY !== 'visible') { clipBox = n.getBoundingClientRect(); break }
    }
    for (const raw of range.getClientRects()) {
      let left = raw.left, top = raw.top, right = raw.right, bottom = raw.bottom
      if (clipBox) {
        left = Math.max(left, clipBox.left); right = Math.min(right, clipBox.right)
        top = Math.max(top, clipBox.top); bottom = Math.min(bottom, clipBox.bottom)
      }
      if (right - left < 1 || bottom - top < 1) continue
      boxes.push({ x: left + sx, y: top + sy, w: right - left, h: bottom - top, el, node: t, raw, text: t.textContent.trim().slice(0, 28) })
    }
  }

  /* Popovers - menus, dropdowns, dialogs - sit over the page by design. A
   * piece of text under an opaque popover is covered, not overlapped; under
   * a see-through one it is a real collision. */
  const layerOf = el => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if ((cs.position === 'absolute' || cs.position === 'fixed') && cs.zIndex !== 'auto' && Number(cs.zIndex) > 0) return n
      if (n.matches('[role="menu"], [role="dialog"], [role="listbox"]')) return n
    }
    return null
  }
  const opaque = layer => {
    for (let n = layer; n && n !== document.body; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) continue
      const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
      const alpha = parts.length > 3 ? parts[3] : 1
      if (alpha >= 0.98) return true
      if (alpha > 0) return false
    }
    return false
  }
  for (const box of boxes) box.layer = layerOf(box.el)

  /* text vs text, bucketed by row */
  const rows = new Map()
  boxes.forEach((box, i) => {
    for (let y = Math.floor(box.y / 40); y <= Math.floor((box.y + box.h) / 40); y += 1) {
      if (!rows.has(y)) rows.set(y, [])
      rows.get(y).push(i)
    }
  })
  const seen = new Set()
  for (const list of rows.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = boxes[list[i]], c = boxes[list[j]]
        if (a.node === c.node) continue
        const key = list[i] < list[j] ? `${list[i]}:${list[j]}` : `${list[j]}:${list[i]}`
        if (seen.has(key)) continue
        seen.add(key)
        const ix = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x)
        const iy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y)
        /* Line boxes of adjacent lines touch by a pixel or two through
         * leading; only a real collision counts. */
        if (ix > 2 && iy > Math.min(a.h, c.h) * 0.35) {
          if (a.layer !== c.layer) {
            const top = a.layer && (!c.layer || c.layer.contains(a.layer) === false && a.layer.contains(c.el) === false) ? a.layer : c.layer
            if (top && opaque(top)) continue
          }
          out.text.push(`"${a.text}" (${label(a.el)}) × "${c.text}" (${label(c.el)}) at ${Math.round(a.x)},${Math.round(a.y)}`)
        }
      }
    }
  }

  /* -- clipping and spill -- */
  const clipped = new Set()
  for (const box of boxes) {
    for (let n = box.el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n)
      const clipsX = cs.overflowX !== 'visible'
      const clipsY = cs.overflowY !== 'visible'
      if (!clipsX && !clipsY) continue
      const r = n.getBoundingClientRect()
      const scrollsX = cs.overflowX === 'auto' || cs.overflowX === 'scroll'
      const scrollsY = cs.overflowY === 'auto' || cs.overflowY === 'scroll'
      const left = r.left + sx, top = r.top + sy
      const rx = box.raw.left + sx, ry = box.raw.top + sy
      const outX = clipsX && !scrollsX && (rx < left - 1 || rx + box.raw.width > left + r.width + 1)
      const outY = clipsY && !scrollsY && (ry < top - 1 || ry + box.raw.height > top + r.height + 1)
      const ellipsis = getComputedStyle(box.el).textOverflow === 'ellipsis' || cs.textOverflow === 'ellipsis'
      if ((outX && !ellipsis) || outY) {
        const key = label(box.el) + box.text
        if (!clipped.has(key)) {
          clipped.add(key)
          out.clip.push(`"${box.text}" (${label(box.el)}) clipped by ${label(n)}`)
        }
      }
      break
    }
    const card = box.el.closest('.rf-figure, .rf-cat, td, th, button, .rf-tariff-tile, .rf-section-head, .chip, .rf-code-chip, .rf-download-menu')
    if (card) {
      const r = card.getBoundingClientRect()
      const left = r.left + sx, top = r.top + sy
      if (box.x + box.w > left + r.width + 1.5 || box.x < left - 1.5 || box.y + box.h > top + r.height + 2 || box.y < top - 2) {
        out.spill.push(`"${box.text}" spills out of ${label(card)} by ${Math.round(Math.max(box.x + box.w - left - r.width, left - box.x, box.y + box.h - top - r.height, top - box.y))}px`)
      }
    }
  }

  /* -- flex/grid siblings -- */
  for (const parent of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(parent)
    if (!/flex|grid/.test(cs.display) || !visible(parent)) continue
    const kids = [...parent.children].filter(k => {
      const kc = getComputedStyle(k)
      return kc.position !== 'absolute' && kc.position !== 'fixed' && visible(k)
    })
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const a = kids[i].getBoundingClientRect(), c = kids[j].getBoundingClientRect()
        const ix = Math.min(a.right, c.right) - Math.max(a.left, c.left)
        const iy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top)
        if (ix > 1.5 && iy > 1.5) {
          out.siblings.push(`${label(kids[i])} × ${label(kids[j])} in ${label(parent)} (${Math.round(ix)}×${Math.round(iy)})`)
        }
      }
    }
  }

  /* -- controls: a row of controls shares one height and one centre line -- */
  const isControl = el =>
    el.matches('select, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), .rf-segmented, button') &&
    !el.matches('.rf-link, .linkish, .rf-segmented button, .search-clear, .search-key, [role="tab"], .rf-tabs button')
  for (const parent of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(parent)
    if (!/flex/.test(cs.display) || cs.flexDirection.startsWith('column') || !visible(parent)) continue
    if (parent.closest('table, nav, .tabbar, .rf-tabs, .search-output, .search-focus-panel, .rail-pins, .rail-reports, .rows, .sheet, .rf-download-menu, .look-switch')) continue
    const controls = []
    for (const child of parent.children) {
      if (!visible(child)) continue
      let control = null
      if (isControl(child)) control = child
      else {
        const inner = [...child.querySelectorAll('select, input, .rf-segmented, button')].filter(el => isControl(el) && visible(el))
        if (inner.length === 1 && !inner[0].closest('.rf-segmented ~ *') ) control = inner[0]
      }
      if (control) controls.push(control)
    }
    if (controls.length < 2) continue
    const boxes = controls.map(el => ({ el, r: el.getBoundingClientRect() }))
    /* Same visual line only: a wrapped row is judged line by line. */
    const lines = []
    for (const box of boxes) {
      const mid = box.r.top + box.r.height / 2
      const line = lines.find(l => Math.abs(l.mid - mid) < 16)
      if (line) line.items.push(box)
      else lines.push({ mid, items: [box] })
    }
    for (const line of lines) {
      if (line.items.length < 2) continue
      const hs = line.items.map(b => b.r.height)
      const cs2 = line.items.map(b => b.r.top + b.r.height / 2)
      const dh = Math.max(...hs) - Math.min(...hs)
      const dc = Math.max(...cs2) - Math.min(...cs2)
      if (dh > 2 || dc > 2) {
        out.controls.push(`${label(parent)}: ${line.items.map(b => `${label(b.el)} ${Math.round(b.r.height)}h@${Math.round(b.r.top + b.r.height / 2)}`).join(', ')}`)
      }
    }
  }

  /* -- overflow -- */
  const pageOverflow = document.documentElement.scrollWidth - vw
  if (pageOverflow > 1) out.overflow.push(`page scrolls sideways by ${pageOverflow}px`)
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.right <= vw + 1 || r.width < 4) continue
    let scrolls = false
    for (let n = el.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX
      if (o === 'auto' || o === 'scroll' || o === 'hidden') { scrolls = true; break }
    }
    if (!scrolls) { out.overflow.push(`${label(el)} reaches ${Math.round(r.right)}px of ${vw}`); break }
  }

  /* -- order: tabs vs sections, headings before bodies -- */
  const tabs = [...document.querySelectorAll('.rf-tabs button')].map(btn => btn.textContent.trim())
  const sections = [...document.querySelectorAll('.rf-section[id^="section-"]')]
  if (tabs.length && sections.length) {
    const titles = sections.map(s => s.id.replace('section-', ''))
    if (tabs.length !== sections.length) out.order.push(`${tabs.length} tabs but ${sections.length} sections`)
    let last = -1
    for (const s of sections) {
      const top = s.getBoundingClientRect().top
      if (top < last) out.order.push(`section ${s.id} sits above the one before it`)
      last = top
    }
    void titles
  }
  for (const s of document.querySelectorAll('.rf-section')) {
    const head = s.querySelector('.rf-section-head')
    const body = s.querySelector('.rf-section-body')
    if (head && body && visible(body) && body.getBoundingClientRect().top < head.getBoundingClientRect().bottom - 1) {
      out.order.push(`${s.id || label(s)}: body starts above its heading ends`)
    }
  }

  return out
}

/* Fixed and sticky chrome against readable text, a viewport at a time. */
async function occlusion(page) {
  return page.evaluate(async () => {
    const found = []
    const height = document.documentElement.scrollHeight
    const vh = window.innerHeight
    const chrome = () =>
      [...document.querySelectorAll('body *')].filter(el => {
        const cs = getComputedStyle(el)
        if (cs.position !== 'fixed' && cs.position !== 'sticky') return false
        /* A tooltip is an overlay the reader asked for by hovering. */
        if (el.matches('[role="tooltip"]')) return false
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
        const r = el.getBoundingClientRect()
        return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < vh
      })
    const step = Math.max(200, Math.floor(vh * 0.8))
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const fixed = chrome()
      if (!fixed.length) continue
      /* A dimmed page behind a dialog or sheet is a modal, not an overlap. */
      if (fixed.some(f => f.matches('.rail-scrim, .sheet-scrim'))) continue
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!t.textContent.trim()) continue
        const el = t.parentElement
        if (!el || el.closest('svg, .sr-only, script, style')) continue
        const host = fixed.find(f => f.contains(el))
        if (host) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none') continue
        /* Text that scrolls underneath sticky chrome is meant to; text that
         * sits under it at rest is not. Only the part of the chrome that is
         * pinned (not merely in flow) counts. */
        const range = document.createRange()
        range.selectNodeContents(t)
        for (const r of range.getClientRects()) {
          if (r.width < 2 || r.bottom < 0 || r.top > vh) continue
          for (const f of fixed) {
            const fr = f.getBoundingClientRect()
            const fcs = getComputedStyle(f)
            const pinned = fcs.position === 'fixed' || fcs.position === 'sticky'
            if (!pinned) continue
            /* Content passing under a bar - the header, the section tabs, a
             * table's sticky head, the tab bar - is scrolling, not occlusion,
             * unless it is the end of the page and can never be scrolled
             * clear of a bottom bar. Floating things (a help button, a rail
             * handle) are judged everywhere. */
            const vw = window.innerWidth
            const bar = fcs.position === 'sticky' || ((fr.top <= 2 || fr.bottom >= vh - 2) && fr.width > vw * 0.5) || (fr.left <= 2 && fr.height > vh * 0.5)
            const atEnd = window.scrollY + vh >= document.documentElement.scrollHeight - 2
            if (bar && !(atEnd && fr.bottom >= vh - 2 && fr.top > vh / 2)) continue
            const ix = Math.min(r.right, fr.right) - Math.max(r.left, fr.left)
            const iy = Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top)
            if (ix > 2 && iy > 2) {
              const name = `${f.tagName.toLowerCase()}.${String(f.className).split(' ')[0]}`
              found.push(`${name} covers "${t.textContent.trim().slice(0, 24)}" at scroll ${window.scrollY}`)
            }
          }
        }
      }
    }
    window.scrollTo(0, 0)
    return [...new Set(found)].slice(0, 6)
  })
}

async function openEverything(page) {
  await page.evaluate(() => {
    for (const btn of document.querySelectorAll('.rf-section-toggle[aria-expanded="false"]')) btn.click()
  })
  await page.waitForTimeout(250)
  const drawer = page.locator('.rf-drawer summary, .rf-drawer-toggle, button:has-text("How this figure is calculated")').first()
  if (await drawer.count()) { await drawer.click().catch(() => {}); await page.waitForTimeout(250) }
}

async function setLook(page) {
  if (LOOK !== 'aman') return
  await page.evaluate(() => {
    try { localStorage.setItem('hstat-look', 'aman') } catch {}
  })
}

let checked = 0

for (const [w, h, shape] of SHAPES) {
  for (const theme of THEMES) {
    const ctx = await b.newContext({
      viewport: { width: w, height: h },
      isMobile: w < 900 && shape !== 'tablet' && shape !== 'laptop',
      hasTouch: w < 900,
      reducedMotion: 'reduce',
    })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    let primed = false
    for (const [base, path, name] of PAGES) {
      await page.goto(base + path, { waitUntil: 'networkidle' })
      if (!primed) { await setLook(page); primed = true; await page.reload({ waitUntil: 'networkidle' }) }
      await page.waitForTimeout(700)
      if (theme === 'dark') {
        await page.locator('[aria-label="Switch to dark theme"]').first().click().catch(() => {})
        await page.waitForTimeout(250)
      }
      const tag = `${name} @${shape}/${theme}`
      for (const state of ['rest', 'open']) {
        if (state === 'open') await openEverything(page)
        await page.evaluate(() => window.scrollTo(0, 0))
        const m = await page.evaluate(measure)
        checked += 1
        ok(`${tag} [${state}] text overlaps`, m.text.length === 0, m.text.slice(0, 3).join(' | '))
        ok(`${tag} [${state}] clipped text`, m.clip.length === 0, m.clip.slice(0, 3).join(' | '))
        ok(`${tag} [${state}] spill`, m.spill.length === 0, m.spill.slice(0, 3).join(' | '))
        ok(`${tag} [${state}] sibling overlaps`, m.siblings.length === 0, m.siblings.slice(0, 3).join(' | '))
        ok(`${tag} [${state}] overflow`, m.overflow.length === 0, m.overflow.slice(0, 2).join(' | '))
        ok(`${tag} [${state}] order`, m.order.length === 0, m.order.slice(0, 2).join(' | '))
        ok(`${tag} [${state}] control rows`, m.controls.length === 0, m.controls.slice(0, 3).join(' | '))
        /* The header, section tabs and other pinned chrome, judged at rest. */
        const chrome = await page.evaluate(measure, true)
        const extra = chrome.siblings.filter(item => !m.siblings.includes(item))
        ok(`${tag} [${state}] chrome sibling overlaps`, extra.length === 0, extra.slice(0, 3).join(' | '))
      }
      const covered = await occlusion(page)
      ok(`${tag} occlusion`, covered.length === 0, covered.slice(0, 3).join(' | '))

      /* Popovers, opened one at a time where the page has them. */
      if (path.startsWith('/hs/') && shape === 'desk') {
        const dl = page.locator('.download-master').first()
        if (await dl.count()) {
          await dl.click(); await page.waitForTimeout(300)
          const m = await page.evaluate(measure)
          ok(`${tag} [download menu] text overlaps`, m.text.length === 0, m.text.slice(0, 3).join(' | '))
          ok(`${tag} [download menu] spill`, m.spill.length === 0, m.spill.slice(0, 3).join(' | '))
          await page.keyboard.press('Escape'); await dl.click().catch(() => {}); await page.waitForTimeout(200)
        }
      }
      if (path === '/' ) {
        const box = page.locator('.search-hub input').first()
        if (await box.count()) {
          await box.click(); await page.waitForTimeout(300)
          const m = await page.evaluate(measure)
          ok(`${tag} [search panel] text overlaps`, m.text.length === 0, m.text.slice(0, 3).join(' | '))
          await box.fill('smartphone'); await page.waitForTimeout(500)
          const m2 = await page.evaluate(measure)
          ok(`${tag} [search results] text overlaps`, m2.text.length === 0, m2.text.slice(0, 3).join(' | '))
          ok(`${tag} [search results] sibling overlaps`, m2.siblings.length === 0, m2.siblings.slice(0, 3).join(' | '))
          await box.fill(''); await page.keyboard.press('Escape')
        }
      }
      if (path === '/' && name === 'home') {
        /* The HStack panel, built from a key-segment category. */
        const cat = page.locator('.rf-cat').first()
        if (await cat.count()) {
          await cat.click(); await page.waitForTimeout(300)
          const stack = page.locator('.rf-stack-actions .rf-button, .rf-stack button.rf-button').first()
          if (await stack.count()) {
            await stack.click(); await page.waitForTimeout(1500)
            await page.evaluate(() => window.scrollTo(0, 0))
            const m = await page.evaluate(measure, true)
            ok(`${tag} [hstack] control rows`, m.controls.length === 0, m.controls.slice(0, 3).join(' | '))
            ok(`${tag} [hstack] sibling overlaps`, m.siblings.length === 0, m.siblings.slice(0, 3).join(' | '))
            await page.locator('.hstack-close').first().click().catch(() => {})
            await page.evaluate(() => { try { localStorage.removeItem('hstat-basket'); localStorage.removeItem('hstat-stack-title') } catch {} })
          }
        }
      }
      if (path === '/hs/851713' && (shape === 'desk' || shape === 'laptop')) {
        const handle = page.locator('.rail-handle').first()
        if (await handle.count()) {
          await handle.click(); await page.waitForTimeout(400)
          const m = await page.evaluate(measure)
          ok(`${tag} [rail open] text overlaps`, m.text.length === 0, m.text.slice(0, 3).join(' | '))
          ok(`${tag} [rail open] sibling overlaps`, m.siblings.length === 0, m.siblings.slice(0, 3).join(' | '))
          const chrome2 = await page.evaluate(measure, true)
          ok(`${tag} [rail open] chrome sibling overlaps`, chrome2.siblings.length === 0, chrome2.siblings.slice(0, 3).join(' | '))
          ok(`${tag} [rail open] overflow`, m.overflow.length === 0, m.overflow.slice(0, 2).join(' | '))
          const covered2 = await occlusion(page)
          ok(`${tag} [rail open] occlusion`, covered2.length === 0, covered2.slice(0, 3).join(' | '))
          await page.locator('.rail-close, [aria-label="Close the workspace"]').first().click().catch(() => {})
        }
      }
      ok(`${tag} no page errors`, errors.length === 0, errors.splice(0).slice(0, 1).join(''))
    }
    await ctx.close()
  }
}

await b.close()
const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} overlap checks passed (${checked} page states, look: ${LOOK})`)
process.exit(failed.length ? 1 : 0)
