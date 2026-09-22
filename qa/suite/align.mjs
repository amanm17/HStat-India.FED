/*
 * Alignment, measured.
 *
 * visual.mjs asks whether anything overlaps, spills or gets clipped. That
 * catches breakage. It does not catch the quieter thing - a panel whose left
 * edge sits two pixels off its neighbour's, a list whose rows are 11px apart
 * except for the one that is 14, a column of figures that is right-aligned
 * except where it is not. None of that breaks anything; all of it is what
 * makes a page feel assembled rather than designed.
 *
 * Three things are checked, each measured rather than judged:
 *
 *   edges     siblings in the same stack share a left edge and a width
 *   rhythm    repeated rows in a list are the same distance apart
 *   columns   cells marked .num share a right edge within their table
 *
 * Tolerance is 1px, which is a rounding difference, not a decision. Anything
 * larger was decided by someone, or by nobody, and either way is worth
 * looking at.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:4178'
const TOL = 1.01

const PAGES = [
  ['front page', '/'],
  ['product', '/hs/854231'],
  ['tariff line', '/hs/85176290'],
  ['tariff index', '/tariff-lines'],
  ['guide', '/guide'],
  ['availability', '/availability'],
  ['query builder', '/query'],
]

const WIDTHS = [375, 768, 1440]
const R = []
const ok = (n, p, d = '') => {
  R.push({ n, p })
  console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`)
}

const audit = () => {
  const round = n => Math.round(n * 100) / 100
  const visible = el => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }

  const edges = []
  const rhythm = []
  const columns = []
  const rows = []

  /* EDGES — a vertical stack of siblings should start at the same x and,
   * where they are block-level, end at the same one. Containers that lay
   * their children out in a row are skipped: there, differing x is the
   * point. */
  for (const parent of document.querySelectorAll(
    '.home, .guide-page, .avail-page, .qb-page, .lines-page, .hs8-page, .panel-stack',
  )) {
    const kids = [...parent.children].filter(visible)

    if (kids.length < 2) continue

    const boxes = kids.map(el => el.getBoundingClientRect())
    const rowish = boxes.some((b, i) => i > 0 && b.top < boxes[i - 1].bottom - 2)

    if (rowish) continue

    const lefts = boxes.map(b => b.left)
    const spread = Math.max(...lefts) - Math.min(...lefts)

    if (spread > 1.01) {
      const off = kids
        .map((el, i) => ({ tag: el.className || el.tagName, x: round(boxes[i].left) }))
        .filter(k => round(k.x) !== round(Math.min(...lefts)))
        .slice(0, 3)

      edges.push({
        parent: parent.className.split(' ')[0],
        spread: round(spread),
        off,
      })
    }
  }

  /* RHYTHM — consecutive rows of one list, the same distance apart.
   *
   * Grouped by column first. Several of these lists are grids at wider
   * viewports, and in a grid "the next child" is often the one beside rather
   * than below - which reads as a negative gap and is not a defect. Within a
   * single column the spacing still has to be even. */
  for (const list of document.querySelectorAll(
    '.home-list, .guide-toc ol, .helpcard-panels, .avail-holes, .nav-group ul',
  )) {
    const kids = [...list.children].filter(visible)

    if (kids.length < 3) continue

    const columns = new Map()

    for (const el of kids) {
      const box = el.getBoundingClientRect()
      const key = round(box.left)
      const seen = columns.get(key) ?? []

      seen.push(box)
      columns.set(key, seen)
    }

    for (const [x, boxes] of columns) {
      if (boxes.length < 3) continue

      boxes.sort((a, b) => a.top - b.top)

      const gaps = boxes.slice(1).map((r, i) => round(r.top - boxes[i].bottom))
      const spread = Math.max(...gaps) - Math.min(...gaps)

      if (spread > 1.01) {
        rhythm.push({
          list: list.className.split(' ')[0] || 'ol',
          column: x,
          gaps,
          spread: round(spread),
        })
      }
    }
  }

  /* ROWS — items sitting side by side are the same distance apart.
   *
   * A row of five figure cards where four gaps are 10px and one is 13 does
   * not look broken; it looks slightly wrong, and nobody can say why. This
   * is the check that says why. Any container with three or more children
   * that share a top edge qualifies, whatever it is called. */
  for (const parent of document.querySelectorAll('div, section, ul, header, nav')) {
    const kids = [...parent.children].filter(visible)

    if (kids.length < 3) continue

    const boxes = kids.map(el => el.getBoundingClientRect())
    const top = boxes[0].top
    const sameLine = boxes.every(b => Math.abs(b.top - top) < 2)

    if (!sameLine) continue

    boxes.sort((a, b) => a.left - b.left)

    const gaps = boxes.slice(1).map((b, i) => round(b.left - boxes[i].right))

    /* A negative gap is an overlap, which visual.mjs already owns. */
    if (gaps.some(g => g < 0)) continue

    const spread = round(Math.max(...gaps) - Math.min(...gaps))

    if (spread > 1.01) {
      rows.push({
        parent: parent.className.split(' ')[0] || parent.tagName.toLowerCase(),
        gaps,
        spread,
      })
    }
  }

  /* COLUMNS — .num cells in one table share a right edge, column by column. */
  for (const table of document.querySelectorAll('table')) {
    const byIndex = new Map()

    for (const row of table.querySelectorAll('tr')) {
      ;[...row.children].forEach((cell, i) => {
        if (!cell.classList.contains('num') || !visible(cell)) return

        const right = cell.getBoundingClientRect().right
        const seen = byIndex.get(i) ?? []

        seen.push(round(right))
        byIndex.set(i, seen)
      })
    }

    for (const [i, rights] of byIndex) {
      if (rights.length < 2) continue

      const spread = round(Math.max(...rights) - Math.min(...rights))

      if (spread > 1.01) {
        columns.push({
          table: table.className.split(' ')[0] || 'table',
          column: i,
          spread,
        })
      }
    }
  }

  return { edges, rhythm, rows, columns }
}

const b = await chromium.launch()

for (const [label, path] of PAGES) {
  for (const width of WIDTHS) {
    const page = await b.newPage({ viewport: { width, height: 1000 } })

    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(700)

    const found = await page.evaluate(`(${audit})()`)

    ok(
      `${label} @${width} — edges line up`,
      found.edges.length === 0,
      found.edges.length ? JSON.stringify(found.edges[0]) : '',
    )

    ok(
      `${label} @${width} — list rhythm is even`,
      found.rhythm.length === 0,
      found.rhythm.length ? JSON.stringify(found.rhythm[0]) : '',
    )

    ok(
      `${label} @${width} — row gaps are even`,
      found.rows.length === 0,
      found.rows.length ? JSON.stringify(found.rows[0]) : '',
    )

    ok(
      `${label} @${width} — number columns share a right edge`,
      found.columns.length === 0,
      found.columns.length ? JSON.stringify(found.columns[0]) : '',
    )

    await page.close()
  }
}

await b.close()

const failed = R.filter(r => !r.p)
console.log(`\n${R.length - failed.length}/${R.length} alignment checks passed`)
if (failed.length) {
  console.log('FAILED:\n  ' + failed.map(x => x.n).join('\n  '))
  process.exit(1)
}
