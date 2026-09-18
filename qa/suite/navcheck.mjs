import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4178'
const R = []
const ok = (n, p, d='') => { R.push({n,p}); console.log(`${p?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`) }
const b = await chromium.launch()

async function open(path, vp) {
  const page = await b.newPage(vp ? { viewport: vp } : undefined)
  const errs = []
  page.on('pageerror', e => errs.push(String(e)))
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  return { page, errs }
}

console.log('=== left rail ===')
for (const [path, label] of [['/', 'home'], ['/hs/851762', 'product'], ['/hs/85176290', 'tariff line'], ['/tariff-lines', 'lines'], ['/guide', 'guide']]) {
  const { page, errs } = await open(path)
  ok(`rail on ${label}`, await page.locator('.navrail').count() === 1)
  ok(`no errors on ${label}`, errs.length === 0, errs[0] ?? '')
  await page.close()
}
{
  const { page } = await open('/hs/851762')
  ok("right rail still reachable on a product page", await page.locator(".rail-handle, .rail-report, [class^=rail-]").count() > 0)
  await page.locator('.nav-collapse').click(); await page.waitForTimeout(400)
  ok('rail collapses to icons', await page.evaluate(() => document.documentElement.dataset.nav) === 'icons')
  ok('labels hidden when collapsed', !(await page.locator('.nav-action span').first().isVisible()))
  await page.locator('.nav-collapse').click(); await page.waitForTimeout(400)
  ok('rail expands again', await page.evaluate(() => document.documentElement.dataset.nav) === 'open')
  await page.close()
}
{ // rail navigation actually navigates
  const { page } = await open('/')
  await page.locator('.nav-action', { hasText: 'Tariff lines' }).click(); await page.waitForTimeout(900)
  ok('rail opens the tariff-line index', page.url().endsWith('/tariff-lines'), page.url().replace(BASE,''))
  await page.locator('.nav-action', { hasText: 'Guide' }).click(); await page.waitForTimeout(700)
  ok('rail opens the guide', page.url().endsWith('/guide'))
  await page.locator('.nav-action', { hasText: 'Home' }).click(); await page.waitForTimeout(700)
  ok('rail goes home', new URL(page.url()).pathname === '/')
  await page.close()
}

console.log('\n=== slash commands ===')
{
  const { page, errs } = await open('/hs/851762')
  const i = page.locator('.search-hub input').first()
  await i.click(); await i.fill('/'); await page.waitForTimeout(600)
  const n = await page.locator('.command-more .search-result').count()
  ok('"/" opens the command palette', n >= 4, `${n} commands`)
  ok('normal results are replaced, not appended', await page.locator('.answer-card').count() === 0)
  await i.fill('/lines'); await page.waitForTimeout(500)
  ok('typing filters commands', await page.locator('.command-more .search-result').count() === 1)
  await page.keyboard.press('Enter'); await page.waitForTimeout(900)
  ok('Enter runs the command', page.url().endsWith('/tariff-lines'), page.url().replace(BASE,''))
  ok('no errors from commands', errs.length === 0, errs[0] ?? '')
  await page.close()
}
{
  const { page } = await open('/hs/851762')
  const i = page.locator('.search-hub input').first()
  await i.click(); await i.fill('/theme'); await page.waitForTimeout(400)
  await page.keyboard.press('Enter'); await page.waitForTimeout(600)
  ok('theme command flips the theme', await page.evaluate(() => document.documentElement.dataset.theme) === 'dark')
  await page.close()
}
{
  const { page } = await open('/hs/851762')
  const i = page.locator('.search-hub input').first()
  await i.click(); await i.fill('/'); await page.waitForTimeout(400)
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  ok('Escape leaves command mode', await page.locator('.command-more').count() === 0)
  await i.fill('smartphone'); await page.waitForTimeout(700)
  ok('ordinary search still works', await page.locator('.answer-card').count() === 1)
  await page.close()
}

console.log('\n=== tariff-line index ===')
{
  const { page, errs } = await open('/tariff-lines')
  ok('groups render', await page.locator('.lines-group').count() > 10)
  const head = await page.locator('.lines-group-head').first().innerText()
  ok('heading name printed once per group', /HS \d{6}/.test(head), head.split('\n')[0])
  const rows = await page.locator('.lines-group').first().locator('tbody tr').count()
  ok('rows are codes', rows >= 1)
  await page.locator('.lines-filter').fill('8517'); await page.waitForTimeout(600)
  const after = await page.locator('.lines-group').count()
  ok('filter narrows the list', after > 0 && after < 60, `${after} groups`)
  await page.locator('.lines-group .dgcis-code button').first().click(); await page.waitForTimeout(900)
  ok('clicking a code opens the line', /\/hs\/\d{8}$/.test(page.url()), page.url().replace(BASE,''))
  ok('no errors', errs.length === 0, errs[0] ?? '')
  await page.close()
}

console.log('\n=== naming: the code is the identity ===')
{
  const { page } = await open('/hs/85437099')
  const h1 = await page.locator('h1').first().innerText()
  ok('H1 is the code when we have no real name', h1.trim() === '85437099', h1)
  const sub = await page.locator('.hs8-sub').innerText()
  ok('heading is context, labelled as the heading', /one of 29 tariff lines under/i.test(sub) && /HS 854370/.test(sub), sub.slice(0,90))
  ok('caveat explains the borrowed name', /belongs to the heading, not to this line/i.test(await page.innerText('body')))
  await page.close()
}
await b.close()
const f = R.filter(r => !r.p)
console.log(`\n${R.length - f.length}/${R.length} passed`)
if (f.length) console.log('FAILED:\n  ' + f.map(x => x.n).join('\n  '))
