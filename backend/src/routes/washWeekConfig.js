// /api/week-config — ช่วงสัปดาห์กำหนดเอง + เป้าต่อสัปดาห์ต่อประเภท (per zone × month).
// ป้อนใน dashboard/หน้า admin แล้ว Weekly card ใช้แทน bucket ตายตัว. Per-branch.
const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');

const canEdit = requireRole('admin', 'super_admin');
const ZONES = ['PTS1', 'PTS2'];
const clampDay = (v) => Math.min(31, Math.max(1, parseInt(v, 10) || 1));
const nonNeg = (v) => Math.max(0, parseInt(v, 10) || 0);

// ── GET /?zone=&month= — list week configs ──────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const params = []; const cond = [];
    if (req.query.zone) { params.push(req.query.zone); cond.push(`zone = $${params.length}`); }
    if (/^\d{4}-\d{2}$/.test(req.query.month || '')) { params.push(req.query.month); cond.push(`month = $${params.length}`); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await req.db(
      `SELECT * FROM wash_week_config ${where}
        ORDER BY month, zone NULLS FIRST, week_no`, params);
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// ── POST / — upsert one week (zone × month × week_no) ───────────────────────
router.post('/', authMiddleware, canEdit, async (req, res) => {
  const zone = ZONES.includes(req.body.zone) ? req.body.zone : null;   // NULL = ทุกโซน
  const month = /^\d{4}-\d{2}$/.test(req.body.month || '') ? req.body.month : null;
  const week_no = Math.max(1, parseInt(req.body.week_no, 10) || 1);
  const day_from = clampDay(req.body.day_from);
  const day_to = Math.max(day_from, clampDay(req.body.day_to));
  const target_major = nonNeg(req.body.target_major);
  const target_minor = nonNeg(req.body.target_minor);
  const target_fan = nonNeg(req.body.target_fan);
  const note = req.body.note ? String(req.body.note) : null;
  if (!month) return res.status(400).json({ error: 'ต้องระบุเดือน (YYYY-MM)' });
  try {
    const { rows } = await req.db(
      `INSERT INTO wash_week_config
         (zone, month, week_no, day_from, day_to, target_major, target_minor, target_fan, note, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (COALESCE(zone,''), month, week_no) DO UPDATE
         SET day_from = EXCLUDED.day_from, day_to = EXCLUDED.day_to,
             target_major = EXCLUDED.target_major, target_minor = EXCLUDED.target_minor,
             target_fan = EXCLUDED.target_fan, note = EXCLUDED.note, updated_at = NOW()
       RETURNING *`,
      [zone, month, week_no, day_from, day_to, target_major, target_minor, target_fan, note]);
    res.status(201).json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── DELETE /:id ─────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, canEdit, async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'bad id' });
  try {
    await req.db('DELETE FROM wash_week_config WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
