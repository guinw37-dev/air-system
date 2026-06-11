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

// Render many HTML docs to PDFs in ONE browser (pages concurrently) and merge
// them into a single PDF Buffer with pdf-lib. Wall-clock ≈ the slowest single
// doc, not the sum — so a วางบิล bundle of full-photo WO reports stays well under
// the proxy timeout. Throws PdfUnavailableError if Chrome can't launch.
async function renderAndMerge(htmls, { landscape = false } = {}) {
  const { PDFDocument } = require('pdf-lib');
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      protocolTimeout: 180000,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
  } catch (err) {
    throw new PdfUnavailableError(err.message);
  }
  try {
    const buffers = await Promise.all((htmls || []).map(async (html) => {
      const page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: 'load', timeout: 120000 });
        return await page.pdf({
          format: 'A4', landscape, printBackground: true, timeout: 120000,
          margin: { top: '10mm', right: '10mm', bottom: '12mm', left: '10mm' },
        });
      } finally {
        await page.close();
      }
    }));
    const merged = await PDFDocument.create();
    for (const buf of buffers) {
      const doc = await PDFDocument.load(buf);
      const copied = await merged.copyPages(doc, doc.getPageIndices());
      copied.forEach((p) => merged.addPage(p));
    }
    return Buffer.from(await merged.save());
  } finally {
    await browser.close();
  }
}

module.exports = { htmlToPdf, renderAndMerge, PdfUnavailableError, findChrome };
