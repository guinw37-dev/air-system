// /api/wash-adjust — ปรับยอดล้างเอง (ใส่ย้อนหลัง / โยกข้ามเดือน). per-branch.
// delta บวก = เพิ่มยอดเดือนนั้น, ลบ = ลด. โยก: +X เดือนปลายทาง, -X เดือนต้นทาง.
const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');

const canEdit = requireRole('admin', 'super_admin');
const WORK_TYPES = ['major', 'minor', 'fan'];

router.get('/', authMiddleware, async (req, res) => {
  try {
    const params = []; const where = [];
    if (/^\d{4}-\d{2}$/.test(req.query.month || '')) { params.push(req.query.month); where.push(`month = $${params.length}`); }
    if (req.query.zone) { params.push(req.query.zone); where.push(`zone = $${params.length}`); }
    const { rows } = await req.db(
      `SELECT * FROM wash_count_adjust ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY month DESC, created_at DESC`, params);
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

router.post('/', authMiddleware, canEdit, async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.body.month || '') ? req.body.month : null;
  if (!month) return res.status(400).json({ error: 'ต้องระบุเดือน (YYYY-MM)' });
  const zone = req.body.zone ? String(req.body.zone).trim() : null;
  const work_type = WORK_TYPES.includes(req.body.work_type) ? req.body.work_type : null;
  const delta = parseInt(req.body.delta, 10);
  if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: 'delta ต้องเป็นจำนวน (+/-) ไม่เป็น 0' });
  const note = req.body.note ? String(req.body.note) : null;
  try {
    const { rows } = await req.db(
      `INSERT INTO wash_count_adjust (month, zone, work_type, delta, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [month, zone, work_type, delta, note, req.user?.id || null]);
    res.status(201).json(rows[0]);
  } catch (err) { serverError(res, err); }
});

router.delete('/:id', authMiddleware, canEdit, async (req, res) => {
  try { await req.db('DELETE FROM wash_count_adjust WHERE id = $1', [req.params.id]); res.json({ ok: true }); }
  catch (err) { serverError(res, err); }
});

module.exports = router;
