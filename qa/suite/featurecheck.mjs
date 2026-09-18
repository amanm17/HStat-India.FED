/* The features added in this round, each asserted rather than assumed. */
import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4178'
const AVAIL = 'http://127.0.0.1:4179'
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
  ok('PDF and PNG controls present', await page.locator('[aria-label="Report"] button').count() === 2)
  for (const id of ['hs8-metrics','hs8-heading','hs8-chart','hs8-years','hs8-siblings'])
    ok(`capture target #tile-${id} exists`, await page.locator(`#tile-${id}`).count() === 1)
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 90000 }),
    page.locator('[aria-label="Report"] button').first().click(),
  ])
  const name = dl.suggestedFilename()
  ok('a PDF actually downloads', /\.pdf$/i.test(name), name)
  await dl.saveAs('/tmp/hs8report.pdf')
  ok('report throws nothing', errs.length === 0, errs[0] ?? '')
  await ctx.close()
}

console.log('\n=== availability page ===')
{
  const { page, errs } = await open(BASE, '/availability')
  const t = await page.innerText('body')
  ok('without data it explains itself', /Not fetched yet/i.test(t))
  ok('and names the command', /fetch_availability\.py/.test(t))
  ok('no errors', errs.length === 0, errs[0] ?? '')
  await page.close()
}
{
  const { page, errs } = await open(AVAIL, '/availability')
  const t = await page.innerText('body')
  ok('with data it renders', /Who has filed/i.test(t))
  ok('refresh verdict shown', /refresh would bring in new data|Nothing new since/i.test(t))
  ok('gaps joined to our products', /China/.test(t) && /240/.test(t))
  ok('"has since filed" marked', await page.locator('.avail-filed').count() > 0)
  await page.locator('.avail-sample button').first().click(); await page.waitForTimeout(900)
  ok('gap sample opens a product', /\/hs\/\d{6}$/.test(page.url()), page.url().replace(AVAIL,''))
  ok('no errors', errs.length === 0, errs[0] ?? '')
  await page.close()
}

console.log('\n=== query builder ===')
{
  const { page, errs } = await open(BASE, '/query')
  const t = await page.innerText('body')
  ok('renders', /Build a Comtrade query/i.test(t))
  ok('offers three outputs', await page.locator('.qb-out').count() === 3)
  ok('explains why it takes no key', /does not take your key/i.test(t))
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
