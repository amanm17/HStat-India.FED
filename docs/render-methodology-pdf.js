const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const HEAD = `
<div style="width:100%;padding:0 17mm;font-family:'IBM Plex Mono',monospace;font-size:7pt;
            letter-spacing:.1em;text-transform:uppercase;color:#6d7a88;
            display:flex;justify-content:space-between;">
  <span>HStat.India &nbsp;&middot;&nbsp; Methodology</span>
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
  // PLAYWRIGHT_CHROMIUM lets a sandbox point at a preinstalled binary;
  // a normal checkout uses whatever `npx playwright install chromium` put down.
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
  );
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(__dirname, 'methodology-print.html')).href, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.evaluate(() => document.fonts.ready);

  // Confirm Plex actually resolved rather than silently falling back.
  const used = await page.evaluate(() => {
    const probe = (fam, weight) => document.fonts.check(`${weight} 12pt "${fam}"`);
    return {
      serif: probe('IBM Plex Serif', 600),
      sans: probe('IBM Plex Sans', 400),
      mono: probe('IBM Plex Mono', 500),
    };
  });
  console.log('font check:', JSON.stringify(used));
  const missing = Object.entries(used).filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length) {
    console.error(
      `IBM Plex is not installed for: ${missing.join(', ')}. ` +
      'The PDF would render in a fallback face. Install the family and re-run.'
    );
    await browser.close();
    process.exit(1);
  }

  await page.pdf({
    path: path.join(__dirname, 'HStat-India-Methodology.pdf'),
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: HEAD,
    footerTemplate: FOOT,
    margin: { top: '20mm', bottom: '18mm', left: '17mm', right: '17mm' },
  });

  await browser.close();
  console.log('done');
})();
