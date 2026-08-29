const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const HEAD = `
<div style="width:100%;padding:0 17mm;font-family:'IBM Plex Mono',monospace;font-size:7pt;
            letter-spacing:.1em;text-transform:uppercase;color:#6d7a88;
            display:flex;justify-content:space-between;">
  <span>HStat.India &nbsp;&middot;&nbsp; Calculation reference</span>
  <span>FED &middot; MeitY</span>
</div>`;

const FOOT = `
<div style="width:100%;padding:0 17mm;font-family:'IBM Plex Mono',monospace;font-size:7pt;
            letter-spacing:.08em;color:#6d7a88;
            display:flex;justify-content:space-between;">
  <span>Schema 2.0.0 &nbsp;&middot;&nbsp; August 2026</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`;

(async () => {
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
  );
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(__dirname, 'calculation-reference-print.html')).href, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.evaluate(() => document.fonts.ready);

  const used = await page.evaluate(() => ({
    serif: document.fonts.check('600 12pt "IBM Plex Serif"'),
    sans: document.fonts.check('400 12pt "IBM Plex Sans"'),
    mono: document.fonts.check('500 12pt "IBM Plex Mono"'),
  }));
  console.log('font check:', JSON.stringify(used));
  const missing = Object.entries(used).filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length) { console.error('IBM Plex missing for: ' + missing.join(', ')); await browser.close(); process.exit(1); }

  await page.pdf({
    path: path.join(__dirname, 'HStat-India-Calculation-Reference.pdf'),
    format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: HEAD, footerTemplate: FOOT,
    margin: { top: '20mm', bottom: '18mm', left: '17mm', right: '17mm' },
  });
  await browser.close();
  console.log('done');
})();
