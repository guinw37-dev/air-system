// /api/attendance — ตรวจเช็คการเข้าทำงานของช่างแต่ละวัน (daily technician
// attendance). Per-branch (schema-per-tenant). 1 แถว/ช่าง/วัน; work_date = วันนี้
// ตามเวลา server (CURRENT_DATE). ช่างเห็นของตัวเองผ่าน /me; หัวหน้า/แม่งานดู
// ภาพรวมทั้งสาขาผ่าน GET / และ /summary (role-gated).
const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');

// ภาพรวม/สรุปการลงเวลา — เฉพาะ Admin (และ super_admin) เท่านั้น
const canSupervise = requireRole('admin', 'super_admin');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

// device token ส่งมาจาก frontend (localStorage UUID) ทาง body หรือ header.
const deviceOf = (req) => {
  const d = req.body?.device_id || req.get('X-Device-Id') || '';
  return String(d).trim().slice(0, 64) || null;
};

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
      `INSERT INTO tech_attendance (user_id, user_name, work_date, check_in_at, device_id)
       VALUES ($1, $2, CURRENT_DATE, NOW(), $3)
       ON CONFLICT (user_id, work_date) DO UPDATE
         SET check_in_at = COALESCE(tech_attendance.check_in_at, NOW()),
             user_name   = EXCLUDED.user_name,
             device_id   = COALESCE(EXCLUDED.device_id, tech_attendance.device_id),
             updated_at  = NOW()
       RETURNING *`,
      [req.user.id, req.user.name || null, deviceOf(req)]
    );
    // จับพฤติกรรมเครื่อง (ไม่บังคับ): นับครั้งที่ลงเวลาจากเครื่องนี้
    const dev = deviceOf(req);
    if (dev) {
      await req.db(
        `INSERT INTO user_devices (user_id, user_name, device_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, device_id) DO UPDATE
           SET last_seen = NOW(), use_count = user_devices.use_count + 1,
               user_name = EXCLUDED.user_name`,
        [req.user.id, req.user.name || null, dev]
      ).catch(() => {});   // best-effort — ไม่ให้ล้มการลงเวลา
    }
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
    // flag เครื่องที่ถูกใช้โดยช่างหลายคนในวันเดียวกัน = น่าจะลงเวลาแทน
    const byDevice = {};
    for (const r of rows) if (r.device_id) (byDevice[r.device_id] ||= new Set()).add(r.user_id);
    for (const r of rows) r.shared_device = !!(r.device_id && byDevice[r.device_id].size > 1);
    // flag เครื่องไม่ประจำ: device วันนี้ ≠ เครื่องที่ช่างคนนั้นใช้บ่อยสุด (primary)
    const uids = [...new Set(rows.map((r) => r.user_id))];
    if (uids.length) {
      const { rows: devs } = await req.db(
        `SELECT DISTINCT ON (user_id) user_id, device_id
           FROM user_devices WHERE user_id = ANY($1)
          ORDER BY user_id, use_count DESC, first_seen ASC`,
        [uids]
      );
      const primary = Object.fromEntries(devs.map((d) => [d.user_id, d.device_id]));
      for (const r of rows) {
        r.other_device = !!(r.device_id && primary[r.user_id] && r.device_id !== primary[r.user_id]);
      }
    }
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// ── GET /devices — พฤติกรรมเครื่องของช่างแต่ละคน (หัวหน้า/แม่งาน) ──────────────
// ใช้กี่เครื่อง + แต่ละเครื่องลงเวลากี่ครั้ง/ล่าสุดเมื่อไร. device_count สูง = น่าดู.
router.get('/devices', authMiddleware, canSupervise, async (req, res) => {
  try {
    const { rows } = await req.db(
      `SELECT user_id,
              MAX(user_name) AS user_name,
              COUNT(*)::int AS device_count,
              SUM(use_count)::int AS total_uses,
              MAX(last_seen) AS last_seen,
              json_agg(json_build_object(
                'device_id', device_id, 'use_count', use_count,
                'first_seen', first_seen, 'last_seen', last_seen
              ) ORDER BY use_count DESC, last_seen DESC) AS devices
         FROM user_devices
        GROUP BY user_id
        ORDER BY device_count DESC, user_name NULLS LAST`
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
