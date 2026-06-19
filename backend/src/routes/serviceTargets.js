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

// Inclusive list of 'YYYY-MM' from start to end (capped at 24 to bound work).
function monthSeq(start, end) {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const out = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
    if (out.length > 24) break;
  }
  return out;
}

// Carry-over walk: each month's target = base + previous month's shortfall; this
// month's done pays down the carried debt first (cumulative). Returns the values
// AT the last month in `months`. doneAt(ym) → เครื่องที่ล้างได้เดือนนั้น.
function carryForward(base, doneAt, months) {
  let carry = 0, eff = base, done = 0;
  for (let i = 0; i < months.length; i++) {
    eff = base + (i === 0 ? 0 : carry);
    done = doneAt(months[i]);
    carry = Math.max(0, eff - done);
  }
  return { carry_in: eff - base, effective_target: eff, done, remaining: carry };
}

// ── GET /progress?month=YYYY-MM — เป้า vs ล้างได้ + ยอดคงค้าง (carry-over) ─────
// "ล้างได้" = เครื่องที่ล้าง: major = 1 ใบ/เครื่อง; minor/fan = นับจำนวนแถวใน grid.
// Carry-over: เป้าเดือน M = base + คงค้างเดือนก่อน; ล้างได้ไปหักคงค้างเก่าก่อน
// (cumulative). คำนวณวนจากเดือนแรกที่มีงานถึงเดือนที่เลือก.
router.get('/progress', authMiddleware, async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month
    : new Date().toISOString().slice(0, 7);
  try {
    const { rows: targets } = await req.db('SELECT * FROM service_targets');
    // done per (zone, type, month) up to the selected month
    const { rows: actual } = await req.db(
      `SELECT to_char(COALESCE(work_date, created_at::date),'YYYY-MM') AS ym,
              pts_zone AS zone, work_type,
              SUM(CASE WHEN work_type IN ('minor','fan')
                       THEN GREATEST(jsonb_array_length(COALESCE(grid_rows,'[]'::jsonb)), 1)
                       ELSE 1 END)::int AS done
       FROM simple_work_orders
       WHERE deleted_at IS NULL
         AND to_char(COALESCE(work_date, created_at::date),'YYYY-MM') <= $1
       GROUP BY ym, pts_zone, work_type`,
      [month]
    );
    // doneMap[zone|type|ym] and doneZone[zone|ym] (for NULL-type = รวมทุกประเภท)
    const doneMap = {}, doneZone = {};
    let minM = month;
    for (const a of actual) {
      const z = a.zone || '';
      doneMap[`${z}|${a.work_type || ''}|${a.ym}`] = a.done;
      doneZone[`${z}|${a.ym}`] = (doneZone[`${z}|${a.ym}`] || 0) + a.done;
      if (a.ym < minM) minM = a.ym;
    }
    const months = monthSeq(minM, month);
    const result = targets.map((t) => {
      const z = t.zone || '';
      const doneAt = (ym) => t.work_type ? (doneMap[`${z}|${t.work_type}|${ym}`] || 0) : (doneZone[`${z}|${ym}`] || 0);
      const p = carryForward(t.monthly_target || 0, doneAt, months);
      const pct = p.effective_target > 0 ? Math.round((p.done / p.effective_target) * 100) : 0;
      return { ...t, base: t.monthly_target || 0, ...p, pct };
    });
    res.json({ month, targets: result });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
module.exports._carryForward = carryForward;   // for unit tests
module.exports._monthSeq = monthSeq;
