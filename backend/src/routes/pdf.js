const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { getReportData } = require('../services/reportBuilder');
const { buildReportHtml } = require('../services/reportTemplates');
const { htmlToPdf, PdfUnavailableError } = require('../services/pdfRenderer');
const { serverError } = require('../utils/respond');

const PUBLIC_BASE = process.env.FRONTEND_URL || '';

// Resolve report type: explicit query wins, else fall back to the WO's own type.
function resolveType(queryType, wo) {
  const t = (queryType || wo.type || 'minor').toLowerCase();
  return ['minor', 'major', 'fan'].includes(t) ? t : 'minor';
}

// Shared loader: fetch data + enforce tenant + status. Returns { data, type } or
// sends an error response and returns null.
async function loadReport(req, res) {
  // Schema-per-tenant: read from the request's branch schema (req.db).
  const data = await getReportData(req.params.id, { db: req.db, publicBaseUrl: PUBLIC_BASE });
  if (!data) { res.status(404).json({ error: 'ไม่พบใบงาน' }); return null; }

  // approved WOs are open to all staff; earlier states only for admin/central_admin
  const previewRoles = ['admin', 'approver', 'approve_building', 'approve_engineer', 'super_admin'];
  if (data.wo.status !== 'approved' && !previewRoles.includes(req.user.role)) {
    res.status(403).json({ error: 'ออกรายงานได้เมื่อใบงานอนุมัติแล้วเท่านั้น' }); return null;
  }
  return { data, type: resolveType(req.query.type, data.wo) };
}

// ── GET /api/pdf/work-orders/:id?type=minor|major|fan ───────────────────────
router.get('/work-orders/:id', authMiddleware, async (req, res) => {
  try {
    const loaded = await loadReport(req, res);
    if (!loaded) return;
    const html = buildReportHtml(loaded.data, loaded.type);
    try {
      const pdf = await htmlToPdf(html, { landscape: loaded.type === 'major' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${loaded.data.wo.order_no}.pdf"`);
      return res.end(pdf);
    } catch (err) {
      if (err instanceof PdfUnavailableError) {
        // graceful fallback — return the HTML so the report is still viewable
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-PDF-Fallback', 'html');
        return res.send(html);
      }
      throw err;
    }
  } catch (err) {
    serverError(res, err);
  }
});

// ── GET /api/pdf/work-orders/:id/preview?type= ──────────────────────────────
// HTML preview (no puppeteer) — for dev + the fallback path
router.get('/work-orders/:id/preview', authMiddleware, async (req, res) => {
  try {
    const loaded = await loadReport(req, res);
    if (!loaded) return;
    const html = buildReportHtml(loaded.data, loaded.type);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
