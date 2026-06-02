const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const rateLimit = require('../middleware/rateLimit');

// PUBLIC area_owner signing — NO Authorization header. The bearer of the link
// can view minimal WO info and sign once. Security:
//  - token is a JWT (exp 30m, scope=area_owner_sign) signed with JWT_SECRET
//  - a SHA-256 hash is stored in sign_tokens; single-use (used_at) blocks replay
//  - rate-limited per IP (5/min)
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Verify JWT + the DB token row. Returns { wo_id } or throws {status,msg}.
async function verifyToken(token, { forUpdateClient } = {}) {
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    const e = new Error('ลิงก์นี้หมดอายุแล้ว'); e.status = 410; throw e;
  }
  if (payload.scope !== 'area_owner_sign') {
    const e = new Error('token ไม่ถูกต้อง'); e.status = 400; throw e;
  }
  const hash = sha256(token);
  const q = forUpdateClient
    ? forUpdateClient.query('SELECT * FROM sign_tokens WHERE token_hash=$1 FOR UPDATE', [hash])
    : pool.query('SELECT * FROM sign_tokens WHERE token_hash=$1', [hash]);
  const { rows } = await q;
  if (!rows.length) { const e = new Error('ลิงก์ไม่ถูกต้อง'); e.status = 404; throw e; }
  const row = rows[0];
  if (row.used_at) { const e = new Error('ลิงก์นี้ถูกใช้ไปแล้ว'); e.status = 410; throw e; }
  if (new Date(row.expires_at) < new Date()) { const e = new Error('ลิงก์นี้หมดอายุแล้ว'); e.status = 410; throw e; }
  return { woId: row.work_order_id, row };
}

// GET /api/sign/:token — minimal WO info for the sign screen
router.get('/:token', rateLimit({ windowMs: 60000, max: 5 }), async (req, res) => {
  try {
    const { woId } = await verifyToken(req.params.token);
    const { rows: woRows } = await pool.query(`
      SELECT w.id, w.order_no, w.type, w.created_at,
             c.name client_name, s.name site_name
      FROM work_orders w
      LEFT JOIN clients c ON w.client_id = c.id
      LEFT JOIN sites s   ON w.site_id = s.id
      WHERE w.id = $1
    `, [woId]);
    if (!woRows.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    const { rows: units } = await pool.query(`
      SELECT u.asset_code, u.name unit_name, r.name room_name,
             f.name floor_name, b.name building_name
      FROM work_order_units wou
      JOIN units u        ON wou.unit_id = u.id
      LEFT JOIN rooms r   ON u.room_id = r.id
      LEFT JOIN floors f  ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      WHERE wou.work_order_id = $1 ORDER BY wou.id
    `, [woId]);
    res.json({ ...woRows[0], units });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/sign/:token — save the area_owner signature, then burn the token
router.post('/:token', rateLimit({ windowMs: 60000, max: 5 }), async (req, res) => {
  const { signer_name, signature_data } = req.body;
  if (!signer_name?.trim() || !signature_data) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อและลงลายเซ็น' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // lock the token row so concurrent posts can't both succeed
    const { woId } = await verifyToken(req.params.token, { forUpdateClient: client });
    await client.query(`
      INSERT INTO signatures (work_order_id, role, signer_name, user_id, signature_data)
      VALUES ($1, 'area_owner', $2, NULL, $3)
      ON CONFLICT (work_order_id, role)
      DO UPDATE SET signer_name = EXCLUDED.signer_name,
                    signature_data = EXCLUDED.signature_data, signed_at = NOW()
    `, [woId, signer_name.trim(), signature_data]);
    await client.query('UPDATE sign_tokens SET used_at = NOW() WHERE token_hash = $1', [sha256(req.params.token)]);
    await client.query('COMMIT');
    res.json({ message: 'ลงนามเรียบร้อย' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
