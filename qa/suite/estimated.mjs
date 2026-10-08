/*
 * The estimation marker.
 *
 * Since 7 October a published figure may contain values no country filed.
 * That is defensible only while the two kinds of number are told apart on
 * sight, so this asserts the mark appears exactly when the data says
 * something was estimated - and, just as importantly, does not appear when
 * nothing was.
 *
 * Runs against a doctored copy of dist, because the live snapshot carries no
 * estimation block until the first reprocess. The copy is made by this file,
 * so there is nothing to remember:
 *
 *     node qa/suite/serve.mjs dist 4178 &
 *     node qa/suite/estimated.mjs
 *
 * It writes its copy to /tmp/hstat-estimated and serves it itself.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

const COPY = '/tmp/hstat-estimated'
const PORT = 4193

const results = []
const ok = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

// A copy of the build with an estimation block laid into one product: one
// year partly estimated, one year fully filed.
rmSync(COPY, { recursive: true, force: true })
cpSync(join(root, 'dist'), COPY, { recursive: true })

const target = join(COPY, 'data/snapshots/current/products/851762.json')
const node = JSON.parse(readFileSync(target, 'utf8'))

const SHARE = 0.184
const REPORTERS = 7

for (const [year, share, reporters] of [
  ['2025', SHARE, REPORTERS],
  ['2020', 0, 0],
]) {
  const block = node.annual[year]?.global
  if (!block) continue

  block.estimation = {
    imports: {
      estimatedReporters: reporters,
      filedReporters: 60,
      estimatedValue: (block.trade ?? 0) * share,
      estimatedShare: share,
      flaggedReporters: reporters ? 1 : 0,
    },
    exports: {
      estimatedReporters: 0,
      filedReporters: 55,
      estimatedValue: 0,
      estimatedShare: 0,
      flaggedReporters: 0,
    },
  }
}

writeFileSync(target, JSON.stringify(node))

const server = spawn(
  process.execPath,
  [join(here, 'serve.mjs'), COPY, String(PORT)],
  { stdio: 'ignore' },
)

await new Promise(resolve => setTimeout(resolve, 1500))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })

const errors = []
page.on('pageerror', event => errors.push(String(event)))

try {
  await page.goto(`http://127.0.0.1:${PORT}/hs/851762`, {
    waitUntil: 'networkidle',
  })
  await page.waitForTimeout(1200)

  const marks = page.locator('.estimated-mark')
  const count = await marks.count()

  ok('an estimated figure is marked', count > 0, `${count} marks`)

  const title = count ? await marks.first().getAttribute('data-tip') : ''
  /* The explanation shows on hover, at once (components/MarkTip). */
  if (count) await marks.first().hover()
  await page.waitForTimeout(200)
  ok('hovering the mark shows its explanation', (await page.locator('.mark-tip').count()) === 1 && /18\.4%/.test(await page.locator('.mark-tip').innerText().catch(() => '')))

  ok(
    'the mark says how much was estimated',
    /18\.4%/.test(title ?? ''),
    title ?? '',
  )

  ok(
    'the mark names the reporters behind it',
    /7 economies/.test(title ?? ''),
    title ?? '',
  )

  ok(
    'the legend explains the mark',
    (await page.locator('.marker-legend').count()) >= 1,
  )

  // The marker must be typographic, not coloured: colour on this dashboard
  // says which series a mark belongs to and cannot carry a second meaning.
  const text = count ? (await marks.first().innerText()).trim() : ''

  ok('the mark is an asterisk, not a colour', text === '*', text)

  ok('marking throws nothing', errors.length === 0, errors[0] ?? '')

  // And the other half of the contract: a year nobody estimated is clean.
  //
  // Driven through the year selector rather than a query string - the page
  // keeps the year in component state, so a URL parameter changes nothing and
  // the check would silently keep measuring 2025.
  await page.selectOption('#year-select', '2020')
  await page.waitForTimeout(900)

  const heroMarks = await page
    .locator('#tile-headline .rf-tiles .estimated-mark')
    .count()

  ok('a fully filed figure carries no mark', heroMarks === 0, `${heroMarks}`)
} finally {
  await browser.close()
  server.kill()
  rmSync(COPY, { recursive: true, force: true })
}

const failed = results.filter(result => !result.pass)

console.log(`\n${results.length - failed.length}/${results.length} passed`)

if (failed.length) {
  console.log('FAILED:\n  ' + failed.map(item => item.name).join('\n  '))
  process.exit(1)
}
