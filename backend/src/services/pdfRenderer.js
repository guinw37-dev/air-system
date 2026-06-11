const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');

// Resolve a Chrome/Chromium binary (nixpacks installs google-chrome-stable).
let cachedPath = null;
function findChrome() {
  if (cachedPath) return cachedPath;
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return (cachedPath = process.env.PUPPETEER_EXECUTABLE_PATH);
  }
  for (const c of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    try {
      const p = execSync(`which ${c}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (p) return (cachedPath = p);
    } catch { /* keep trying */ }
  }
  return (cachedPath = '/usr/bin/google-chrome');
}

// Render an HTML string to a PDF Buffer. Throws PdfUnavailableError if Chrome
// can't launch — the route then falls back to returning HTML.
class PdfUnavailableError extends Error {}

async function htmlToPdf(html, { landscape = false } = {}) {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      // protocolTimeout raised for big multi-WO batches (cover + many reports).
      protocolTimeout: 180000,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
  } catch (err) {
    throw new PdfUnavailableError(err.message);
  }
  try {
    const page = await browser.newPage();
    // Photos are inlined as base64 (no network), so 'load' is enough and avoids a
    // needless networkidle0 wait; generous timeout for large batch documents.
    await page.setContent(html, { waitUntil: 'load', timeout: 120000 });
    const pdf = await page.pdf({
      format: 'A4',
      landscape,
      printBackground: true,
      timeout: 120000,
      margin: { top: '10mm', right: '10mm', bottom: '12mm', left: '10mm' },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

module.exports = { htmlToPdf, PdfUnavailableError, findChrome };
