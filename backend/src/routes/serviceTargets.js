// /api/targets — เป้าหมายล้างต่อเดือน (per zone × work_type) ตามสัญญา, and the
// monthly progress (ล้างได้ / เป้า / %) that feeds the Dashboard. Per-branch.
const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');

const canEdit = requireRole('admin', 'super_admin');
const WORK_TYPES = ['major', 'minor', 'fan'];

// ── GET /?zone= — list targets ──────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const params = []; let where = '';
    if (req.query.zone) { params.push(req.query.zone); where = 'WHERE zone = $1'; }
    const { rows } = await req.db(
      `SELECT * FROM service_targets ${where}
        ORDER BY zone, month NULLS FIRST, location NULLS FIRST, ac_type NULLS FIRST, work_type NULLS FIRST`, params);
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// ── POST / — upsert one target (zone × month × location × ac_type × work_type) ─
router.post('/', authMiddleware, canEdit, async (req, res) => {
  const zone = String(req.body.zone || '').trim();
  const month = /^\d{4}-\d{2}$/.test(req.body.month || '') ? req.body.month : null;
  const location = req.body.location ? String(req.body.location).trim() : null;
  const ac_type = req.body.ac_type ? String(req.body.ac_type).trim() : null;
  let work_type = req.body.work_type || null;
  if (work_type && !WORK_TYPES.includes(work_type)) work_type = null;
  const monthly_target = Math.max(0, parseInt(req.body.monthly_target, 10) || 0);
  const note = req.body.note ? String(req.body.note) : null;
  if (!zone) return res.status(400).json({ error: 'ต้องระบุโซน (zone)' });
  try {
    const { rows } = await req.db(
      `INSERT INTO service_targets (zone, month, location, ac_type, work_type, monthly_target, note, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (zone, COALESCE(month,''), COALESCE(location,''), COALESCE(ac_type,''), COALESCE(work_type,'')) DO UPDATE
         SET monthly_target = EXCLUDED.monthly_target, note = EXCLUDED.note, updated_at = NOW()
       RETURNING *`,
      [zone, month, location, ac_type, work_type, monthly_target, note]
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
  const zone = req.query.zone ? String(req.query.zone) : null;
  try {
    // เป้าที่ใช้กับเดือนนี้: ตั้งเดือนตรง หรือ month NULL (=ทุกเดือน/ตามสัญญา)
    const params = [month]; let zw = '';
    if (zone) { params.push(zone); zw = ` AND zone = $${params.length}`; }
    const { rows: targets } = await req.db(
      `SELECT * FROM service_targets WHERE (month = $1 OR month IS NULL)${zw}`, params);
    // ล้างได้เดือนนี้ ต่อ (zone, work_type, location, ac_type)
    const { rows: actual } = await req.db(
      `SELECT pts_zone AS zone, work_type,
              COALESCE(NULLIF(location,''),'') AS location,
              COALESCE(NULLIF(ac_type,''),'')  AS ac_type,
              SUM(CASE WHEN work_type IN ('minor','fan')
                       THEN GREATEST(jsonb_array_length(COALESCE(grid_rows,'[]'::jsonb)), 1)
                       ELSE 1 END)::int AS done
       FROM simple_work_orders
       WHERE deleted_at IS NULL
         AND to_char(COALESCE(work_date, created_at::date),'YYYY-MM') = $1
       GROUP BY 1, 2, 3, 4`, [month]);
    // ปรับยอดเอง (wash_count_adjust) เดือนนี้ — เพิ่มเข้า done ระดับ zone×work_type
    const { rows: adj } = await req.db(
      `SELECT zone, work_type, SUM(delta)::int AS d FROM wash_count_adjust
        WHERE month = $1 GROUP BY zone, work_type`, [month]);
    // ยอดล้างของเป้าหนึ่ง = done จริง (ตรง dimension) + adjust (zone×work_type, เฉพาะเป้าที่ไม่ระบุสถานที่/ตระกูล)
    const doneFor = (t) => {
      let n = actual.reduce((s, a) => {
        if (a.zone !== t.zone) return s;
        if (t.work_type && a.work_type !== t.work_type) return s;
        if (t.location && a.location !== t.location) return s;
        if (t.ac_type && a.ac_type !== t.ac_type) return s;
        return s + a.done;
      }, 0);
      if (!t.location && !t.ac_type) {
        n += adj.reduce((s, a) => (a.zone === t.zone && (!t.work_type || a.work_type === t.work_type) ? s + (a.d || 0) : s), 0);
      }
      return Math.max(0, n);
    };
    const result = targets.map((t) => {
      const base = t.monthly_target || 0;
      const done = doneFor(t);
      const remaining = Math.max(0, base - done);
      const pct = base > 0 ? Math.round((done / base) * 100) : 0;
      return { ...t, base, effective_target: base, carry_in: 0, done, remaining, pct };
    });
    res.json({ month, targets: result });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
module.exports._carryForward = carryForward;   // for unit tests
module.exports._monthSeq = monthSeq;
