/*
 * Run any suite in the secret look:
 *
 *   LOOK=aman node --import ./qa/suite/look-env.mjs qa/suite/mobile.mjs
 *
 * Wraps playwright's chromium so every new context/page starts with the
 * look stored, exactly as a reader who typed ~AM1708 would have it. Also
 * honours PW_CHROME for the browser binary.
 */
import { chromium } from 'playwright'

const look = process.env.LOOK
const launch = chromium.launch.bind(chromium)

const seed = () => {
  try { localStorage.setItem('hstat-look', 'aman') } catch {}
}

chromium.launch = async (options = {}) => {
  const browser = await launch({
    ...(process.env.PW_CHROME && !options.executablePath ? { executablePath: process.env.PW_CHROME } : {}),
    ...options,
  })

  if (look !== 'aman') return browser

  const newContext = browser.newContext.bind(browser)
  const newPage = browser.newPage.bind(browser)

  browser.newContext = async (...args) => {
    const ctx = await newContext(...args)
    await ctx.addInitScript(seed)
    return ctx
  }

  browser.newPage = async (...args) => {
    const page = await newPage(...args)
    await page.context().addInitScript(seed)
    return page
  }

  return browser
}
