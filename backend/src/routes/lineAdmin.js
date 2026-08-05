// /api/line-admin — ตั้งค่า LINE จากเว็บ (super-admin). เก็บ token ใน system_settings,
// group id ต่อสาขาใน clients. ไม่ผูกสาขา (apex-level).
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');
const { runDigestForBranch, getDigestTime } = require('../jobs/lineDailyDigest');

const onlySuper = requireRole('super_admin');

// GET /config — สถานะ token + รายสาขา (group id)
router.get('/config', authMiddleware, onlySuper, async (req, res) => {
  try {
    const s = await pool.query(`SELECT value FROM system_settings WHERE key = 'LINE_CHANNEL_ACCESS_TOKEN'`);
    const token = (s.rows[0] && s.rows[0].value) || '';
    const envToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
    const { rows: branches } = await pool.query(
      `SELECT id, name, slug, COALESCE(line_group_id,'') AS line_group_id
         FROM clients WHERE active = true AND schema_name IS NOT NULL ORDER BY name`);
    res.json({
      hasToken: !!(token || envToken),
      tokenSource: token ? 'db' : (envToken ? 'env' : 'none'),
      tokenPreview: token ? `${token.slice(0, 8)}…${token.slice(-4)}` : (envToken ? '(จาก env)' : ''),
      digestTime: await getDigestTime(),
      branches,
    });
  } catch (err) { serverError(res, err); }
});

// PUT /token { token } — บันทึก/ล้าง token
router.put('/token', authMiddleware, onlySuper, async (req, res) => {
  const token = String(req.body.token || '').trim();
  try {
    if (!token) {
      await pool.query(`DELETE FROM system_settings WHERE key = 'LINE_CHANNEL_ACCESS_TOKEN'`);
    } else {
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_at) VALUES ('LINE_CHANNEL_ACCESS_TOKEN', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [token]);
    }
    res.json({ ok: true });
  } catch (err) { serverError(res, err); }
});

// PUT /time { time: "HH:MM" } — ตั้งเวลาแจ้งเตือน
router.put('/time', authMiddleware, onlySuper, async (req, res) => {
  const time = String(req.body.time || '').trim();
  if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'เวลาไม่ถูกต้อง (HH:MM)' });
  try {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ('LINE_DIGEST_TIME', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [time]);
    res.json({ ok: true });
  } catch (err) { serverError(res, err); }
});

// PUT /branch/:id { line_group_id } — ตั้ง group id ของสาขา
router.put('/branch/:id', authMiddleware, onlySuper, async (req, res) => {
  const gid = String(req.body.line_group_id || '').trim() || null;
  try {
    const { rowCount } = await pool.query(
      `UPDATE clients SET line_group_id = $1 WHERE id = $2`, [gid, req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'ไม่พบสาขา' });
    res.json({ ok: true });
  } catch (err) { serverError(res, err); }
});

// POST /test/:id — ส่งแจ้งเตือนของสาขานี้ทันที
router.post('/test/:id', authMiddleware, onlySuper, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, slug, name, schema_name, line_group_id,
              COALESCE(require_department_sign, false) AS require_department_sign
         FROM clients WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบสาขา' });
    await runDigestForBranch(rows[0]);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
