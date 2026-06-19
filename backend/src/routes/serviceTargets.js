// /api/targets — เป้าหมายล้างต่อเดือน (per zone × work_type) ตามสัญญา, and the
// monthly progress (ล้างได้ / เป้า / %) that feeds the Dashboard. Per-branch.
const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');

const canEdit = requireRole('admin', 'super_admin');
const WORK_TYPES = ['major', 'minor', 'fan'];

// ── GET / — list targets ───────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db('SELECT * FROM service_targets ORDER BY zone, work_type NULLS FIRST');
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// ── POST / — upsert one target (zone + work_type unique) ────────────────────
router.post('/', authMiddleware, canEdit, async (req, res) => {
  const zone = String(req.body.zone || '').trim();
  let work_type = req.body.work_type || null;
  if (work_type && !WORK_TYPES.includes(work_type)) work_type = null;
  const monthly_target = Math.max(0, parseInt(req.body.monthly_target, 10) || 0);
  const note = req.body.note ? String(req.body.note) : null;
  if (!zone) return res.status(400).json({ error: 'ต้องระบุโซน (zone)' });
  try {
    const { rows } = await req.db(
      `INSERT INTO service_targets (zone, work_type, monthly_target, note, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (zone, COALESCE(work_type,'')) DO UPDATE
         SET monthly_target = EXCLUDED.monthly_target, note = EXCLUDED.note, updated_at = NOW()
       RETURNING *`,
      [zone, work_type, monthly_target, note]
    );
    res.status(201).json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── DELETE /:id ─────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, canEdit, async (req, res) => {
  try {
    await req.db('DELETE FROM service_targets WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { serverError(res, err); }
});

// ── GET /progress?month=YYYY-MM — เป้า vs ล้างได้จริง per zone×work_type ──────
// "ล้างได้" = เครื่องที่ล้าง: major = 1 ใบ/เครื่อง; minor/fan = นับจำนวนแถวใน grid.
router.get('/progress', authMiddleware, async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : null;
  try {
    const { rows: targets } = await req.db('SELECT * FROM service_targets');
    const params = [];
    let monthFilter = '';
    if (month) { params.push(month); monthFilter = `AND to_char(COALESCE(work_date, created_at::date),'YYYY-MM') = $1`; }
    const { rows: actual } = await req.db(
      `SELECT pts_zone AS zone, work_type,
              SUM(CASE WHEN work_type IN ('minor','fan')
                       THEN GREATEST(jsonb_array_length(COALESCE(grid_rows,'[]'::jsonb)), 1)
                       ELSE 1 END)::int AS done
       FROM simple_work_orders
       WHERE deleted_at IS NULL ${monthFilter}
       GROUP BY pts_zone, work_type`,
      params
    );
    // index actual by zone|type and by zone (for NULL-type targets = รวม)
    const byKey = {}, byZone = {};
    for (const a of actual) {
      const z = a.zone || '';
      byKey[`${z}|${a.work_type || ''}`] = a.done;
      byZone[z] = (byZone[z] || 0) + a.done;
    }
    const result = targets.map((t) => {
      const z = t.zone || '';
      const done = t.work_type ? (byKey[`${z}|${t.work_type}`] || 0) : (byZone[z] || 0);
      const target = t.monthly_target || 0;
      const remaining = Math.max(0, target - done);
      const pct = target > 0 ? Math.round((done / target) * 100) : 0;
      return { ...t, done, remaining, pct };
    });
    res.json({ month, targets: result });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
