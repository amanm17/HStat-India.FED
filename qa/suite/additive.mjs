/*
 * The integration must be an addition, never a subtraction.
 *
 * Three ways the DGCIS layer can be wrong in production, and in all three the
 * Comtrade dashboard that worked before it existed must keep working:
 *
 *   1. the data is not deployed at all
 *   2. the data is the previous shape, because assets and code shipped apart
 *   3. the data is corrupt
 *
 * Each case is set up for real against the built bundle, not simulated.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://127.0.0.1:4179'
const results = []

function ok(name, pass, detail = '') {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

async function open(path) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  return { page, errors }
}

const scenario = process.argv[2]

// The product page must be whole: headline, tiles, charts - the things that
// existed before any of this.
{
  const { page, errors } = await open('/hs/851762')
  const text = await page.innerText('body')
  const tiles = await page.locator('.tile, section.release-section').count()
  ok(`[${scenario}] product page renders`, text.includes('851762') && text.length > 1500,
     `${text.length} chars, ${tiles} sections`)
  ok(`[${scenario}] product page throws nothing`, errors.length === 0, errors[0] ?? '')
  ok(`[${scenario}] DGCIS panel is absent, not broken`,
     (await page.locator('section.dgcis').count()) === 0)
  ok(`[${scenario}] world trade figure still shown`, /world|global/i.test(text))
  await page.close()
}

// The front page and a second product, to be sure it is not one lucky page.
{
  const { page, errors } = await open('/')
  ok(`[${scenario}] home renders`, (await page.innerText('body')).length > 400)
  ok(`[${scenario}] home throws nothing`, errors.length === 0, errors[0] ?? '')
  await page.close()
}

// A tariff-line URL with no data behind it must explain itself, not blank.
{
  const { page, errors } = await open('/hs/85176290')
  const text = await page.innerText('body')
  ok(`[${scenario}] HS-8 URL degrades to an explanation`,
     /No DGCIS tariff-line data|could not be shown/i.test(text))
  ok(`[${scenario}] HS-8 URL throws nothing`, errors.length === 0, errors[0] ?? '')
  await page.close()
}

await browser.close()
const failed = results.filter(r => !r.pass).length
console.log(`\n[${scenario}] ${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
