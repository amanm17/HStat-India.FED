import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4178'
const results = []
const ok = (n, p, d = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const browser = await chromium.launch()

async function type(path, q) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const input = page.locator('.search-hub input').first()
  await input.click()
  await input.fill(q)
  await page.waitForTimeout(700)
  return { page, errors }
}

// an eight-digit code typed straight in
{
  const { page, errors } = await type('/hs/851762', '85176290')
  const group = await page.locator('.tariff-more').count()
  ok('HS-8 code finds the tariff line', group === 1)
  const text = group ? await page.locator('.tariff-more').innerText() : ''
  ok('result names its parent heading', /851762/.test(text), text.split('\n').slice(0,3).join(' / '))
  ok('group says it is not world trade', /not world trade/i.test(text))
  await page.locator('.tariff-more .search-result-open').first().click()
  await page.waitForTimeout(800)
  ok('opening from search navigates', page.url().endsWith('/hs/85176290'), page.url().replace(BASE, ''))
  ok('no errors from tariff search', errors.length === 0, errors[0] ?? '')
  await page.close()
}

// a word
{
  const { page, errors } = await type('/', 'telecom')
  const n = await page.locator('.tariff-more .search-result').count()
  ok('a commodity word finds tariff lines', n > 0, `${n} results`)
  ok('product answer is still on top',
     (await page.locator('.answer-card, .search-results-large').count()) > 0)
  ok('no errors from word search', errors.length === 0, errors[0] ?? '')
  await page.close()
}

// a query that matches nothing anywhere
{
  const { page } = await type('/', 'zzzzqqq')
  ok('empty state still appears', (await page.locator('.search-empty').count()) === 1)
  ok('no tariff group when nothing matches', (await page.locator('.tariff-more').count()) === 0)
  await page.close()
}

// a product search must be unchanged by any of this
{
  const { page, errors } = await type('/', 'laptop')
  const answer = await page.locator('.answer-card').count()
  ok('product search unchanged', answer === 1)
  ok('no errors', errors.length === 0, errors[0] ?? '')
  await page.close()
}

await browser.close()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
