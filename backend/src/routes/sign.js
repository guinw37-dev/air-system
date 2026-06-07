const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool, query, txClient } = require('../db');
const { slugToSchema } = require('../utils/schema');
const rateLimit = require('../middleware/rateLimit');

// PUBLIC area_owner signing — NO Authorization header. The bearer of the link
// can view minimal WO info and sign once. Schema-per-tenant: the token carries a
// `branch` claim (the schema the WO + sign_tokens live in), since the area owner
// hits this without an X-Branch header.
//  - token is a JWT (exp 30m, scope=area_owner_sign) signed with JWT_SECRET
//  - a SHA-256 hash is stored in <branch>.sign_tokens; single-use blocks replay
//  - rate-limited per IP (5/min)
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Decode + validate the JWT (no DB). Returns { woId, branch } or throws {status}.
function decodeToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    const e = new Error('ลิงก์นี้หมดอายุแล้ว'); e.status = 410; throw e;
  }
  if (payload.scope !== 'area_owner_sign') {
    const e = new Error('token ไม่ถูกต้อง'); e.status = 400; throw e;
  }
  let branch = null;
  if (payload.branch) {
    try { branch = slugToSchema(payload.branch); }
    catch { const e = new Error('token ไม่ถูกต้อง'); e.status = 400; throw e; }
  }
  return { woId: payload.work_order_id, branch };
}

// Check the DB token row (in the branch schema) via a runner (req-less). Throws
// on missing/used/expired.
async function checkTokenRow(runner, token) {
  const { rows } = await runner('SELECT * FROM sign_tokens WHERE token_hash=$1 FOR UPDATE', [sha256(token)]);
  if (!rows.length) { const e = new Error('ลิงก์ไม่ถูกต้อง'); e.status = 404; throw e; }
  const row = rows[0];
  if (row.used_at) { const e = new Error('ลิงก์นี้ถูกใช้ไปแล้ว'); e.status = 410; throw e; }
  if (new Date(row.expires_at) < new Date()) { const e = new Error('ลิงก์นี้หมดอายุแล้ว'); e.status = 410; throw e; }
  return row;
}

// Build a schema-scoped runner for the token's branch (public fallback).
function runnerFor(branch) {
  return branch ? ((sql, params) => query(branch, sql, params)) : ((sql, params) => pool.query(sql, params));
}

// GET /api/sign/:token — minimal WO info for the sign screen
router.get('/:token', rateLimit({ windowMs: 60000, max: 5 }), async (req, res) => {
  try {
    const { woId, branch } = decodeToken(req.params.token);
    const run = runnerFor(branch);
    // FOR UPDATE is harmless outside a tx here; reuse the same check.
    const { rows: tok } = await run('SELECT used_at, expires_at FROM sign_tokens WHERE token_hash=$1', [sha256(req.params.token)]);
    if (!tok.length) return res.status(404).json({ error: 'ลิงก์ไม่ถูกต้อง' });
    if (tok[0].used_at) return res.status(410).json({ error: 'ลิงก์นี้ถูกใช้ไปแล้ว' });
    if (new Date(tok[0].expires_at) < new Date()) return res.status(410).json({ error: 'ลิงก์นี้หมดอายุแล้ว' });

    const { rows: woRows } = await run(`
      SELECT w.id, w.order_no, w.type, w.created_at, s.name site_name
      FROM work_orders w
      LEFT JOIN sites s   ON w.site_id = s.id
      WHERE w.id = $1
    `, [woId]);
    if (!woRows.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    const { rows: units } = await run(`
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
  let woId, branch;
  try { ({ woId, branch } = decodeToken(req.params.token)); }
  catch (err) { return res.status(err.status || 500).json({ error: err.message }); }

  const client = branch ? await txClient(branch) : await pool.connect();
  try {
    await client.query('BEGIN');
    await checkTokenRow((sql, params) => client.query(sql, params), req.params.token); // locks the row
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
