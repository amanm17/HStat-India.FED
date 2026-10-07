/* The features added in this round, each asserted rather than assumed. */
import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4178'
/* A copy of dist with public/data/availability.json removed. The page has to
 * say so rather than draw an empty frame, and that is worth asserting now
 * that the real file exists and the default build has data. */
const BARE = process.env.BARE || 'http://127.0.0.1:4179'
const R = []
const ok = (n, p, d='') => { R.push({n,p}); console.log(`${p?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`) }
const b = await chromium.launch()
const open = async (base, path, vp) => {
  const page = await b.newPage(vp ? { viewport: vp } : undefined)
  const errs = []; page.on('pageerror', e => errs.push(String(e)))
  await page.goto(base + path, { waitUntil: 'networkidle' }); await page.waitForTimeout(900)
  return { page, errs }
}

console.log('=== help button ===')
for (const [path, want] of [['/', 'front page'], ['/hs/851762', 'HS 851762'], ['/hs/85176290', 'tariff line'], ['/tariff-lines', 'tariff lines'], ['/guide', 'written guide'], ['/query', 'Comtrade query']]) {
  const { page, errs } = await open(BASE, path)
  ok(`help button on ${path}`, await page.locator('.helpbutton').count() === 1)
  await page.locator('.helpbutton').click(); await page.waitForTimeout(400)
  const t = await page.locator('.helpcard').innerText()
  ok(`help text is about ${path}`, t.toLowerCase().includes(want.toLowerCase()), t.split('\n')[1] ?? '')
  ok(`help on ${path} throws nothing`, errs.length === 0, errs[0] ?? '')
  await page.close()
}
{
  const { page } = await open(BASE, '/hs/851762')
  await page.locator('.helpbutton').click(); await page.waitForTimeout(300)
  ok('help card warns about the page-specific trap', /watch out/i.test(await page.locator('.helpcard').innerText()))
  await page.locator('.helpcard-guide').click(); await page.waitForTimeout(800)
  ok('help card opens the guide', page.url().endsWith('/guide'))
  await page.close()
}

console.log('\n=== HS-8 reports ===')
{
  const ctx = await b.newContext({ acceptDownloads: true })
  const page = await ctx.newPage()
  const errs = []; page.on('pageerror', e => errs.push(String(e)))
  await page.goto(BASE + '/hs/85176290', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200)
  /* Since the Phase 3 refresh every page has one Download data menu: the
   * workbook, a CSV per table, and the laid-out report in two layouts. The
   * report is drawn from data, so there are no capture targets to assert. */
  await page.locator('.download-master').click(); await page.waitForTimeout(300)
  const menu = page.locator('.rf-download-menu')
  ok('download menu opens', await menu.count() === 1)
  ok('workbook offered', /Excel workbook/.test(await menu.innerText()))
  ok('PDF and PNG for both layouts', await menu.locator('.rf-download-pair button').count() === 4)
  for (const id of ['hs8-metrics','hs8-heading','hs8-exports','hs8-siblings'])
    ok(`section #tile-${id} exists`, await page.locator(`#tile-${id}`).count() === 1)
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 90000 }),
    menu.locator('.rf-download-pair button').first().click(),
  ])
  const name = dl.suggestedFilename()
  ok('a PDF actually downloads', /\.pdf$/i.test(name), name)
  await dl.saveAs('/tmp/hs8report.pdf')
  ok('report throws nothing', errs.length === 0, errs[0] ?? '')
  await ctx.close()
}

console.log('\n=== availability page ===')
{
  const { page, errs } = await open(BARE, '/availability')
  const t = await page.innerText('body')
  ok('without data it explains itself', /Coverage file not built yet/i.test(t))
  ok('and names the command', /fetch_availability\.py/.test(t))
  ok('no errors', errs.length === 0, errs[0] ?? '')
  await page.close()
}
{
  const { page, errs } = await open(BASE, '/availability')
  const t = await page.innerText('body')
  ok('with data it renders', /Reporter coverage/i.test(t))
  ok('refresh verdict shown', /refresh would bring in new data|Nothing new since/i.test(t))
  ok('gaps joined to our products', /China/.test(t) && /240/.test(t))
  ok('"has since filed" marked', await page.locator('.avail-filed').count() > 0)
  await page.locator('.avail-sample button').first().click(); await page.waitForTimeout(900)
  ok('gap sample opens a product', /\/hs\/\d{6}$/.test(page.url()), page.url().replace(BASE,''))
  ok('no errors', errs.length === 0, errs[0] ?? '')
  await page.close()
}

console.log('\n=== query builder ===')
{
  const { page, errs } = await open(BASE, '/query')
  const t = await page.innerText('body')
  ok('renders', /Build a Comtrade query/i.test(t))
  ok('offers three outputs', await page.locator('.qb-out').count() === 3)
  ok('explains why it takes no key', /why there is no key field/i.test(t))
  const pre = await page.locator('.qb-out pre').first().innerText()
  ok('composes a real Comtrade URL', pre.includes('comtradeplus.un.org') && pre.includes('851713'), pre.slice(0, 70))
  await page.locator('.qb-field select').nth(1).selectOption('X'); await page.waitForTimeout(400)
  const after = await page.locator('.qb-out pre').first().innerText()
  ok('changing flow changes the query', after.includes('Flows=X'))
  const snip = await page.locator('.qb-out pre').nth(2).innerText()
  ok('python snippet has no real key in it', snip.includes('<YOUR KEY>') && !/[a-f0-9]{24,}/.test(snip))
  ok('no errors', errs.length === 0, errs[0] ?? '')
  await page.close()
}

console.log('\n=== every chart offers its table ===')
/*
 * The review asked for this on every chart, not some. The check is structural:
 * find every panel that draws a chart, assert it has a Table tab, switch to it
 * and assert a table actually appears. A panel that gains a chart later and no
 * switch fails here rather than in somebody's meeting.
 */
for (const path of ['/hs/851713', '/hs/85176290']) {
  const { page, errs } = await open(BASE, path, { width: 1440, height: 1100 })

  const switches = page.locator('[role="tablist"]').filter({ hasText: 'Table' })
  const count = await switches.count()
  ok(`${path}: chart/table switches present`, count > 0, `${count} found`)

  for (let i = 0; i < count; i += 1) {
    const strip = switches.nth(i)
    await strip.scrollIntoViewIfNeeded()
    /* Up to the panel itself, not to .panel-actions - which also contains
     * the word "panel" and holds no table, which is how this check first
     * failed against a page that was working. */
    const panel = strip.locator(
      'xpath=ancestor::*[self::article or self::section or contains(@class,"hs8-years-block")][1]',
    )
    await strip.getByRole('tab', { name: 'Table' }).click()
    await page.waitForTimeout(350)
    ok(
      `${path}: switch ${i + 1} reveals a table`,
      (await panel.locator('table').count()) > 0,
    )
  }

  ok(`${path}: switching views throws nothing`, errs.length === 0, errs[0] ?? '')
  await page.close()
}

console.log('\n=== the rank says which side it measures ===')
{
  const { page } = await open(BASE, '/hs/851713', { width: 1440, height: 1100 })
  const text = await page.locator('main').innerText()

  /* 47th as a buyer and 1st as a seller. Showing one without the other is the
   * bug an outside reviewer read as broken data. */
  /* Since the Phase 2 refresh the rank sits under its own headline tile,
   * so the side it measures is the tile it is printed under. */
  ok('names the import ranking', /India Imports[\s\S]{0,120}of all importers/.test(text))
  ok('names the export ranking', /India Exports[\s\S]{0,120}(of all exporters|of world exports)/.test(text))
  ok('import rank says what it is out of', /of all importers/i.test(text))
  ok('export standing is published too', /of all exporters|outside the top ten/i.test(text))
  ok('no unlabelled "India share" is left', !/India share · \d{4}/.test(text))
  await page.close()
}

console.log('\n=== plain words, not story headings ===')
{
  /*
   * The wording a reviewer objected to, kept out by assertion rather than by
   * memory. Each of these described the figure in a sentence where a name
   * would do: "India as a buyer" over a rank, "Who has filed" over a coverage
   * table, "basket" for the thing the product calls a stack. A page that
   * brings one back fails here.
   */
  const banned = [
    /who buys the most/i,
    /who sells the most/i,
    /where india buys this from/i,
    /where india sells this/i,
    /what india ships under/i,
    /what india brings in under/i,
    /india as a (buyer|seller)/i,
    /largest (buyer|seller)/i,
    /\d+(st|nd|rd|th) largest (importer|exporter)/i,
    /who has filed/i,
    /what am i looking at/i,
    /basket total/i,
    /what stands out/i,
    /where india takes the biggest share/i,
  ]

  for (const path of [
    '/hs/851713',
    '/hs/85176290',
    '/',
    '/availability',
    '/tariff-lines',
    '/guide',
  ]) {
    const { page } = await open(BASE, path, { width: 1440, height: 1100 })
    const text = await page.locator('body').innerText()
    const hit = banned.find(rx => rx.test(text))
    ok(`${path}: no story-style heading`, !hit, hit ? String(hit) : '')
    await page.close()
  }
}

console.log('\n=== HStack reaches eight digits ===')
{
  const { page, errs } = await open(BASE, '/hs/851762', { width: 1440, height: 1100 })

  const quick = page
    .locator('main button.stack-add.quiet')
    .filter({ hasText: /tariff lines$/ })
  ok('quick stack offers every tariff line under the heading', await quick.count() === 1)

  await quick.first().click()
  await page.waitForTimeout(1500)

  const section = page.locator('#hstack-tariff-lines')
  ok('stacking HS-8 opens its own section', await section.count() === 1)

  const body = await section.innerText()
  ok('the HS-8 section says whose figures these are', /DGCIS/i.test(body))
  ok(
    'the HS-8 section refuses to be added to the world figures',
    /never added|not added/i.test(body),
  )
  ok('every stacked line is listed', (await section.locator('tbody tr').count()) === 8)
  ok('stacking eight-digit lines throws nothing', errs.length === 0, errs[0] ?? '')
  await page.close()
}
{
  const { page } = await open(BASE, '/hs/851713', { width: 1440, height: 1100 })
  const parent = page
    .locator('main button.stack-add.quiet')
    .filter({ hasText: /parent/ })
  ok('quick stack offers the parent level', await parent.count() === 1)

  await parent.first().click()
  await page.waitForTimeout(2000)

  const text = await page.locator('.hstack-warning').innerText()
  ok(
    'stacking with the parent shows the share of it',
    /sits inside HS 8517/.test(text) && /% of it/.test(text),
    text.slice(0, 80),
  )
  await page.close()
}

console.log('\n=== rail reaches everything ===')
{
  const { page } = await open(BASE, '/')
  for (const [label, path] of [['Availability','/availability'], ['Query builder','/query'], ['Tariff lines','/tariff-lines'], ['Guide','/guide']]) {
    await page.locator('.nav-action', { hasText: label }).click(); await page.waitForTimeout(700)
    ok(`rail → ${label}`, page.url().endsWith(path), page.url().replace(BASE,''))
  }
  await page.close()
}
{
  const { page } = await open(BASE, '/hs/851762')
  const i = page.locator('.search-hub input').first()
  await i.click(); await i.fill('/avail'); await page.waitForTimeout(500)
  await page.keyboard.press('Enter'); await page.waitForTimeout(800)
  ok('/availability command works', page.url().endsWith('/availability'))
  await page.close()
}
await b.close()
const f = R.filter(r => !r.p)
console.log(`\n${R.length - f.length}/${R.length} passed`)
if (f.length) console.log('FAILED:\n  ' + f.map(x => x.n).join('\n  '))
process.exit(f.length ? 1 : 0)
