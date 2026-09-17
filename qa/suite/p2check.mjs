import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4178'
const R = []
const ok = (n, p, d = '') => { R.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const b = await chromium.launch()

async function type(q) {
  const page = await b.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const i = page.locator('.search-hub input').first()
  await i.click(); await i.fill(q); await page.waitForTimeout(800)
  return { page, errors }
}

console.log('=== #86 search reaches tariff lines by product word ===')
for (const [q, hs6, hs8] of [['smartphone', '851713', '85171300'], ['laptop', '847130', null]]) {
  const { page, errors } = await type(q)
  const group = await page.locator('.tariff-more').count()
  const t = group ? await page.locator('.tariff-more').innerText() : ''
  ok(`"${q}" now surfaces tariff lines`, group === 1, `${await page.locator('.tariff-more .search-result').count()} lines`)
  ok(`"${q}" names the heading they came through`, t.includes(hs6), t.split('\n').find(l => /HS \d{6}/.test(l)) ?? '')
  ok(`"${q}" explains it reached them through the heading`, /reached through the heading/i.test(t))
  if (hs8) ok(`"${q}" lists ${hs8}`, t.includes(hs8))
  ok(`"${q}" still answers with the Comtrade product first`, await page.locator('.answer-card').count() === 1)
  ok(`"${q}" no errors`, errors.length === 0, errors[0] ?? '')
  await page.close()
}
{
  const { page } = await type('smartphone')
  await page.locator('.tariff-more .search-result-open').first().click()
  await page.waitForTimeout(800)
  ok('a product-word hit opens the tariff line', /\/hs\/85171300$/.test(page.url()), page.url().replace(BASE, ''))
  await page.close()
}
{ // codes and group words must still work
  const { page } = await type('85176290')
  const t = await page.locator('.tariff-more').innerText()
  ok('code search unchanged', t.includes('85176290'))
  ok('code search does not claim a product route', !/reached through the heading/i.test(t))
  await page.close()
}
{
  const { page } = await type('telecom')
  ok('DGCIS group word still works', await page.locator('.tariff-more .search-result').count() > 0)
  await page.close()
}
{
  const { page } = await type('zzzqqq')
  ok('nonsense still shows nothing', await page.locator('.tariff-more').count() === 0)
  ok('empty state still appears', await page.locator('.search-empty').count() === 1)
  await page.close()
}

console.log('\n=== #87 no refetch of the parent payload ===')
{
  const page = await b.newPage()
  const reqs = []
  page.on('request', r => { if (/dgcis\/hs6\//.test(r.url())) reqs.push(r.url().split('/').pop()) })
  await page.goto(BASE + '/hs/851762', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const afterLoad = reqs.length
  await page.locator('section.dgcis td.dgcis-code button').first().click()
  await page.waitForTimeout(1000)
  ok('HS-6 page fetches its payload once', afterLoad === 1, `${afterLoad} request(s)`)
  ok('drilling into HS-8 refetches nothing', reqs.length === afterLoad, `${reqs.length - afterLoad} extra: ${reqs.slice(afterLoad).join(',')}`)
  const t = await page.innerText('body')
  ok('the HS-8 page still renders from the memo', /Last 12 months/i.test(t) && t.includes('85176290'))
  // and back up
  await page.goBack(); await page.waitForTimeout(900)
  ok('going back up refetches nothing either', reqs.length === afterLoad, `${reqs.length} total`)
  await page.close()
}
await b.close()
const f = R.filter(r => !r.p)
console.log(`\n${R.length - f.length}/${R.length} passed`)
if (f.length) console.log('FAILED:\n  ' + f.map(x => x.n).join('\n  '))
process.exit(f.length ? 1 : 0)
