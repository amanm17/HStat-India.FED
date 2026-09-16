/* R. what the browser actually fetches. */
import { chromium } from 'playwright'
const BASE = 'http://127.0.0.1:4178'
const b = await chromium.launch()

async function trace(path, act) {
  const page = await b.newPage()
  const reqs = []
  page.on('request', r => { if (/\/data\//.test(r.url())) reqs.push(r.url().replace(BASE, '')) })
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const afterLoad = reqs.length
  if (act) { await act(page); await page.waitForTimeout(900) }
  await page.close()
  return { reqs, afterLoad }
}

const home = await trace('/')
console.log('HOME data requests:', home.reqs.length)
console.log('  dgcis hs6 files fetched on the front page:',
  home.reqs.filter(u => u.includes('/dgcis/hs6/')).length, '(expect 0)')

const prod = await trace('/hs/851713')
const hs6 = prod.reqs.filter(u => u.includes('/dgcis/hs6/'))
console.log('\nHS-6 PAGE data requests:', prod.reqs.length)
console.log('  dgcis hs6 files:', hs6.length, hs6.slice(0, 4).join(' '))
console.log('  hs8-index fetched:', prod.reqs.filter(u => u.includes('hs8-index')).length, 'time(s)')

const sw = await trace('/hs/851713', async page => {
  await page.locator('[aria-label="Flow"] button').nth(1).click()
  await page.waitForTimeout(600)
  await page.locator('[aria-label="Flow"] button').nth(0).click()
})
const extra = sw.reqs.length - sw.afterLoad
console.log('\nFLOW SWITCH (imports then back): extra data requests =', extra, '(expect 0)')

const nav = await trace('/hs/851713', async page => {
  await page.locator('section.dgcis td.dgcis-code button').first().click()
  await page.waitForTimeout(900)
})
console.log('NAVIGATE HS-6 -> HS-8: extra data requests =', nav.reqs.length - nav.afterLoad,
            nav.reqs.slice(nav.afterLoad).join(' ') || '(none — parent payload reused)')

const uncov = await trace('/hs/320890')
console.log('\nPRODUCT WITHOUT DGCIS: dgcis requests =',
  uncov.reqs.filter(u => u.includes('/dgcis/')).length,
  uncov.reqs.filter(u => u.includes('/dgcis/')).join(' '))

const dupes = prod.reqs.filter((u, i) => prod.reqs.indexOf(u) !== i)
console.log('\nduplicate requests on the HS-6 page:', dupes.length, dupes.slice(0, 3).join(' '))
await b.close()
