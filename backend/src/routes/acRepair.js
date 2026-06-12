// /api/ac-repair/* — the air technician's view onto repair-system AC jobs.
// air-system is a REMOTE VIEW: these routes authenticate the air tech (air-system
// JWT) then proxy to the repair-system integration API for the branch's mapped
// hospital (clients.repair_slug). No repair data is stored here.
//
// Two modes:
//  • Branch context (req.branch.repair_slug)  → that one hospital.
//  • Apex Super Dev (no branch, isSuper)       → AGGREGATE across every hospital;
//    each job is tagged with _hospital + _repair_slug so per-job actions can be
//    routed to the right hospital.
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { callRepair } = require('../services/repairClient');

const canUse = requireRole('technician', 'admin', 'super_admin');
const actorOf = (req) => req.user?.name || req.user?.username || 'air';
const isAggregate = (req) => !req.branch && (req.user?.isSuper || req.user?.role === 'super_admin');

// All hospitals an air-system branch maps to (active + has repair_slug).
async function allHospitals() {
  const { rows } = await pool.query(
    'SELECT name, repair_slug FROM clients WHERE active = true AND repair_slug IS NOT NULL ORDER BY name');
  return rows;
}

// Resolve the repair hospital for a single-target action: the branch's slug, or a
// validated repair_slug from the request (apex Super Dev acting on an aggregate job).
async function targetSlug(req) {
  if (req.branch?.repair_slug) return req.branch.repair_slug;
  if (isAggregate(req)) {
    const want = String(req.body?.repairSlug || req.query.repair_slug || '');
    if (want && (await allHospitals()).some((h) => h.repair_slug === want)) return want;
  }
  return null;
}

const h = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { res.status(e.status || 500).json({ error: e.message || 'error' }); }
};

router.use(authMiddleware, canUse);

// GET /jobs[?status=] — branch hospital, or aggregate across all (apex Super Dev)
router.get('/jobs', h(async (req, res) => {
  const q = req.query.status === 'all' ? '?status=all' : '';
  if (req.branch?.repair_slug) {
    return res.json(await callRepair('GET', req.branch.repair_slug, `/ac-jobs${q}`, { actor: actorOf(req) }));
  }
  if (isAggregate(req)) {
    const hs = await allHospitals();
    const lists = await Promise.all(hs.map(async (hosp) => {
      try {
        const jobs = await callRepair('GET', hosp.repair_slug, `/ac-jobs${q}`, { actor: actorOf(req) });
        return (jobs || []).map((j) => ({ ...j, _hospital: hosp.name, _repair_slug: hosp.repair_slug }));
      } catch { return []; }  // a single hospital being down shouldn't break the whole view
    }));
    return res.json(lists.flat());
  }
  res.status(400).json({ error: 'สาขานี้ยังไม่ได้ผูกโรงพยาบาล (repair_slug)' });
}));

async function needSlug(req, res) {
  const slug = await targetSlug(req);
  if (!slug) { res.status(400).json({ error: 'ไม่พบโรงพยาบาลของงานนี้ (repair_slug)' }); return null; }
  return slug;
}

router.get('/jobs/:id', h(async (req, res) => {
  const slug = await needSlug(req, res); if (!slug) return;
  res.json(await callRepair('GET', slug, `/ac-jobs/${req.params.id}`, { actor: actorOf(req) }));
}));

router.put('/jobs/:id/status', h(async (req, res) => {
  const slug = await needSlug(req, res); if (!slug) return;
  res.json(await callRepair('PUT', slug, `/ac-jobs/${req.params.id}/status`, { actor: actorOf(req), body: req.body || {} }));
}));

router.post('/jobs/:id/evaluation', h(async (req, res) => {
  const slug = await needSlug(req, res); if (!slug) return;
  res.json(await callRepair('POST', slug, `/ac-jobs/${req.params.id}/evaluation`, { actor: actorOf(req), body: req.body || {} }));
}));

router.post('/jobs/:id/spare-parts', h(async (req, res) => {
  const slug = await needSlug(req, res); if (!slug) return;
  res.json(await callRepair('POST', slug, `/ac-jobs/${req.params.id}/spare-parts`, { actor: actorOf(req), body: req.body || {} }));
}));

router.get('/stock', h(async (req, res) => {
  const slug = await needSlug(req, res); if (!slug) return;
  res.json(await callRepair('GET', slug, '/ac-stock', { actor: actorOf(req) }));
}));

// GET /jobs/export/excel — single hospital only (branch, or ?repair_slug for apex)
router.get('/jobs/export/excel', h(async (req, res) => {
  const slug = await needSlug(req, res); if (!slug) return;
  const upstream = await callRepair('GET', slug, '/ac-jobs/export/excel', { actor: actorOf(req), expectBlob: true });
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Content-Disposition', upstream.headers.get('content-disposition') || 'attachment; filename="ac-jobs.xlsx"');
  res.end(Buffer.from(await upstream.arrayBuffer()));
}));

module.exports = router;
