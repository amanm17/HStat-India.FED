import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:4178'
const results = []

function ok(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch()

async function open(path) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  return { page, errors }
}

// 1 — front page
{
  const { page, errors } = await open('/')
  const text = await page.innerText('body')
  ok('home renders', text.includes('HStat') && text.length > 400, `${text.length} chars`)
  ok('home has no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

// 2 — a product page that has DGCIS data
{
  const { page, errors } = await open('/hs/851762')
  const text = await page.innerText('body')
  ok('product page renders', text.includes('851762'), '')
  ok('product page has no errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  const panel = await page.locator('section.dgcis').count()
  ok('DGCIS panel present', panel === 1, `${panel} found`)
  const panelText = panel ? await page.locator('section.dgcis').innerText() : ''
  ok('panel says exports, not imports',
     /export/i.test(panelText) && !/India’s imports|India's imports/i.test(panelText),
     panelText.split('\n')[1] ?? '')
  ok('panel shows a share column', /Share/.test(panelText) && /%/.test(panelText))
  const codes = await page.locator('section.dgcis td.dgcis-code button').count()
  ok('tariff lines are links', codes >= 2, `${codes} links`)
  await page.close()
}

// 3 — clicking through to a tariff line
{
  const { page, errors } = await open('/hs/851762')
  await page.locator('section.dgcis td.dgcis-code button').first().click()
  await page.waitForTimeout(900)
  const url = page.url()
  ok('click navigates to an HS-8 URL', /\/hs\/\d{8}$/.test(url), url.replace(BASE, ''))
  const text = await page.innerText('body')
  ok('HS-8 page shows the parent heading card', text.includes('HS 851762'))
  ok('HS-8 page shows siblings', /What else India files/.test(text))
  ok('HS-8 click-through has no errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  // back button must return to the heading
  await page.goBack(); await page.waitForTimeout(700)
  ok('back returns to the heading', page.url().endsWith('/hs/851762'), page.url().replace(BASE, ''))
  await page.close()
}

// 4 — cold deep link to a tariff line
{
  const { page, errors } = await open('/hs/85176290')
  const text = await page.innerText('body')
  ok("cold deep link to HS-8 renders", text.includes("85176290") && /Last 12 months/i.test(text))
  ok('cold deep link has no errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  ok('HS-8 page states it is not world trade', /no\s+eight-digit world figure/i.test(text))
  await page.close()
}

// 5 — an HS-8 code that is not held
{
  const { page, errors } = await open('/hs/99999999')
  const text = await page.innerText('body')
  ok('unknown HS-8 explains itself', /No DGCIS tariff-line data/.test(text))
  ok('unknown HS-8 does not error', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

// 6 — a product with NO DGCIS file must be untouched
{
  const { page, errors } = await open('/hs/320890')
  const text = await page.innerText('body')
  ok('product without DGCIS still renders', text.includes('320890') && text.length > 800)
  ok('product without DGCIS shows no panel', (await page.locator('section.dgcis').count()) === 0)
  ok('product without DGCIS has no errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

// 7 — a tariff line whose heading has no product page of its own.
//     851712 was split by HS 2022; India still files under it, so the lines
//     are real history with nothing above them in the catalogue.
{
  const { page, errors } = await open('/hs/85171211')
  const text = await page.innerText('body')
  ok('standalone HS-8 renders', text.includes('85171211') && /Last 12 months/i.test(text))
  ok('standalone HS-8 says it has no product page',
     /lineage predecessor/i.test(text), '')
  ok('standalone HS-8 shows no Comtrade card it cannot fill',
     (await page.locator('.hs8-parent-card').count()) === 0)
  ok('standalone HS-8 throws nothing', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

// 8 — the product page no longer contradicts itself
{
  const { page } = await open('/hs/851762')
  const absent = await page.locator('.tariff-absent').count()
  ok('no "detail is not held" line above a table of detail', absent === 0)
  await page.close()
}

{
  const { page } = await open('/hs/320890')
  const absent = await page.locator('.tariff-absent').count()
  ok('the absence note still appears where there is a real absence', absent === 1)
  await page.close()
}

await browser.close()

const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
