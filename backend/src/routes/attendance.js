// /api/attendance — ตรวจเช็คการเข้าทำงานของช่างแต่ละวัน (daily technician
// attendance). Per-branch (schema-per-tenant). 1 แถว/ช่าง/วัน; work_date = วันนี้
// ตามเวลา server (CURRENT_DATE). ช่างเห็นของตัวเองผ่าน /me; หัวหน้า/แม่งานดู
// ภาพรวมทั้งสาขาผ่าน GET / และ /summary (role-gated).
const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');

// หัวหน้างาน/แม่งาน — ดูภาพรวมการเข้างานของช่างทุกคนในสาขาได้
const canSupervise = requireRole(
  'admin', 'super_admin', 'approve_engineer', 'approve_building', 'checker'
);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

// ── GET /me/today — แถวของวันนี้ของผู้ใช้ปัจจุบัน (หรือ null) ─────────────────
router.get('/me/today', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(
      `SELECT check_in_at, check_out_at, note
         FROM tech_attendance
        WHERE user_id = $1 AND work_date = CURRENT_DATE`,
      [req.user.id]
    );
    res.json(rows[0] || null);
  } catch (err) { serverError(res, err); }
});

// ── GET /me?days=7 — ประวัติการเข้างานของตัวเอง (ล่าสุดก่อน) ─────────────────
router.get('/me', authMiddleware, async (req, res) => {
  let days = parseInt(req.query.days, 10);
  if (!Number.isFinite(days)) days = 7;
  days = Math.min(60, Math.max(1, days));
  try {
    const { rows } = await req.db(
      `SELECT * FROM tech_attendance
        WHERE user_id = $1 AND work_date > CURRENT_DATE - ($2::int)
        ORDER BY work_date DESC`,
      [req.user.id, days]
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// ── POST /check-in — ลงเวลาเข้า (ไม่ทับเวลาเข้าเดิมถ้าลงไว้แล้ว) ──────────────
router.post('/check-in', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(
      `INSERT INTO tech_attendance (user_id, user_name, work_date, check_in_at)
       VALUES ($1, $2, CURRENT_DATE, NOW())
       ON CONFLICT (user_id, work_date) DO UPDATE
         SET check_in_at = COALESCE(tech_attendance.check_in_at, NOW()),
             user_name   = EXCLUDED.user_name,
             updated_at  = NOW()
       RETURNING *`,
      [req.user.id, req.user.name || null]
    );
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── POST /check-out — ลงเวลาออก (last one wins; สร้างแถวถ้ายังไม่มี) ──────────
router.post('/check-out', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(
      `INSERT INTO tech_attendance (user_id, user_name, work_date, check_out_at)
       VALUES ($1, $2, CURRENT_DATE, NOW())
       ON CONFLICT (user_id, work_date) DO UPDATE
         SET check_out_at = NOW(),
             user_name    = EXCLUDED.user_name,
             updated_at   = NOW()
       RETURNING *`,
      [req.user.id, req.user.name || null]
    );
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── POST /me/note — บันทึกหมายเหตุของวันนี้ (upsert วันนี้ถ้ายังไม่มี) ────────
router.post('/me/note', authMiddleware, async (req, res) => {
  const note = req.body.note != null ? String(req.body.note) : null;
  try {
    const { rows } = await req.db(
      `INSERT INTO tech_attendance (user_id, user_name, work_date, note)
       VALUES ($1, $2, CURRENT_DATE, $3)
       ON CONFLICT (user_id, work_date) DO UPDATE
         SET note       = EXCLUDED.note,
             user_name  = EXCLUDED.user_name,
             updated_at = NOW()
       RETURNING *`,
      [req.user.id, req.user.name || null, note]
    );
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── GET /?date=YYYY-MM-DD — ภาพรวมการเข้างานทุกคนของวันนั้น (หัวหน้า/แม่งาน) ──
router.get('/', authMiddleware, canSupervise, async (req, res) => {
  const date = DATE_RE.test(req.query.date || '') ? req.query.date : null;
  try {
    const { rows } = await req.db(
      `SELECT * FROM tech_attendance
        WHERE work_date = COALESCE($1::date, CURRENT_DATE)
        ORDER BY user_name NULLS LAST, user_id`,
      [date]
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// ── GET /summary?month=YYYY-MM — จำนวนวันที่มาทำงานต่อคนในเดือนนั้น ──────────
router.get('/summary', authMiddleware, canSupervise, async (req, res) => {
  const month = MONTH_RE.test(req.query.month || '')
    ? req.query.month
    : new Date().toISOString().slice(0, 7);
  try {
    const { rows } = await req.db(
      `SELECT user_id,
              MAX(user_name) AS user_name,
              COUNT(DISTINCT work_date) FILTER (WHERE check_in_at IS NOT NULL)::int AS days,
              COUNT(DISTINCT work_date) FILTER (WHERE check_in_at IS NOT NULL AND check_out_at IS NOT NULL)::int AS days_complete
         FROM tech_attendance
        WHERE to_char(work_date, 'YYYY-MM') = $1
        GROUP BY user_id
       HAVING COUNT(*) FILTER (WHERE check_in_at IS NOT NULL) > 0
        ORDER BY user_name NULLS LAST, user_id`,
      [month]
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

module.exports = router;
