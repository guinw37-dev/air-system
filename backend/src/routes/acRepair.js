// /api/ac-repair/* — the air technician's view onto repair-system AC jobs.
// air-system is a REMOTE VIEW: these routes authenticate the air tech (air-system
// JWT) then proxy to the repair-system integration API for the branch's mapped
// hospital (clients.repair_slug). No repair data is stored here.
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { callRepair } = require('../services/repairClient');

// Air techs (technician) + branch admin/super may use the AC-repair view.
const canUse = requireRole('technician', 'admin', 'super_admin');

// Which repair-system hospital does this air-system branch map to?
async function repairSlugOf(req) {
  if (!req.branch) return null;                 // apex/super has no single hospital
  if (req.branch.repair_slug) return req.branch.repair_slug;
  const { rows } = await pool.query('SELECT repair_slug FROM clients WHERE id = $1', [req.branch.id]);
  return rows[0]?.repair_slug || null;
}
const actorOf = (req) => req.user?.name || req.user?.username || 'air';

// Resolve repair slug or 400. Sets req.repairSlug.
async function withRepairSlug(req, res, next) {
  const slug = await repairSlugOf(req);
  if (!slug) return res.status(400).json({ error: 'สาขานี้ยังไม่ได้ผูกโรงพยาบาล (repair_slug)' });
  req.repairSlug = slug;
  next();
}

// Wrap a handler so RepairError → its status, others → 500.
const h = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { res.status(e.status || 500).json({ error: e.message || 'error' }); }
};

router.use(authMiddleware, canUse, withRepairSlug);

// GET /jobs[?status=active|all]
router.get('/jobs', h(async (req, res) => {
  const q = req.query.status === 'all' ? '?status=all' : '';
  res.json(await callRepair('GET', req.repairSlug, `/ac-jobs${q}`, { actor: actorOf(req) }));
}));

// GET /jobs/:id
router.get('/jobs/:id', h(async (req, res) => {
  res.json(await callRepair('GET', req.repairSlug, `/ac-jobs/${req.params.id}`, { actor: actorOf(req) }));
}));

// PUT /jobs/:id/status — START_WORK | CLEAR
router.put('/jobs/:id/status', h(async (req, res) => {
  res.json(await callRepair('PUT', req.repairSlug, `/ac-jobs/${req.params.id}/status`, { actor: actorOf(req), body: req.body || {} }));
}));

// POST /jobs/:id/spare-parts — close with AC parts
router.post('/jobs/:id/spare-parts', h(async (req, res) => {
  res.json(await callRepair('POST', req.repairSlug, `/ac-jobs/${req.params.id}/spare-parts`, { actor: actorOf(req), body: req.body || {} }));
}));

// GET /stock — AC-prefixed parts
router.get('/stock', h(async (req, res) => {
  res.json(await callRepair('GET', req.repairSlug, '/ac-stock', { actor: actorOf(req) }));
}));

// GET /jobs/export/excel — stream the repair-system xlsx through
router.get('/jobs/export/excel', h(async (req, res) => {
  const upstream = await callRepair('GET', req.repairSlug, '/ac-jobs/export/excel', { actor: actorOf(req), expectBlob: true });
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Content-Disposition', upstream.headers.get('content-disposition') || 'attachment; filename="ac-jobs.xlsx"');
  res.end(Buffer.from(await upstream.arrayBuffer()));
}));

module.exports = router;
