const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { serverError } = require('../utils/respond');

// POST /api/auth/login
// Per-branch auth (fully decoupled): on a branch subdomain (req.branch set) the
// user is authenticated against THAT branch's own users table (req.db →
// <schema>.users). On apex the user is a global super-admin from public.users.
// A branch's users and another branch's users never interconnect.
// Throttle login to blunt brute-force / credential stuffing (audit H-2): 10
// attempts / IP / minute. Successful logins are rare, so this never bites users.
router.post('/login', rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'username and password required' });

  try {
    const runner = req.branch ? req.db : ((sql, p) => pool.query(sql, p));
    const { rows } = await runner(
      'SELECT * FROM users WHERE username = $1 AND active = true',
      [username]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const isSuper = !req.branch;                       // apex login = super-admin
    const branchSlug = req.branch ? req.branch.slug : null;

    const token = jwt.sign(
      { id: user.id, username: user.username, name: user.name, role: user.role, branchSlug, isSuper },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, user: { id: user.id, name: user.name, role: user.role, branchSlug, isSuper } });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const runner = req.branch ? req.db : ((sql, p) => pool.query(sql, p));
    const { rows } = await runner(
      'SELECT id, name, username, role, phone FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ ...rows[0], branchSlug: req.user.branchSlug || null, isSuper: !!req.user.isSuper });
  } catch (err) {
    serverError(res, err);
  }
});

// ── per-user UI prefs (dashboard layout ฯลฯ) — เก็บใน users.ui_prefs ───────────
// ใช้ runner เดียวกับ /me: บน branch → req.db (users ใน schema สาขา), apex → public.
const PREF_KEY_OK = /^[a-z0-9_]{1,40}$/;

// GET /api/auth/prefs/:key → คืน value (หรือ null ถ้ายังไม่ตั้ง)
router.get('/prefs/:key', authMiddleware, async (req, res) => {
  if (!PREF_KEY_OK.test(req.params.key)) return res.status(400).json({ error: 'key ไม่ถูกต้อง' });
  try {
    const runner = req.branch ? req.db : ((sql, p) => pool.query(sql, p));
    const { rows } = await runner('SELECT ui_prefs -> $1 AS value FROM users WHERE id = $2', [req.params.key, req.user.id]);
    res.json({ value: rows[0]?.value ?? null });
  } catch (err) { serverError(res, err); }
});

// PUT /api/auth/prefs/:key  { value } → set users.ui_prefs[key]
router.put('/prefs/:key', authMiddleware, async (req, res) => {
  if (!PREF_KEY_OK.test(req.params.key)) return res.status(400).json({ error: 'key ไม่ถูกต้อง' });
  try {
    const runner = req.branch ? req.db : ((sql, p) => pool.query(sql, p));
    await runner(
      `UPDATE users SET ui_prefs = jsonb_set(COALESCE(ui_prefs,'{}'::jsonb), ARRAY[$1], $2::jsonb, true) WHERE id = $3`,
      [req.params.key, JSON.stringify(req.body.value ?? null), req.user.id]);
    res.json({ ok: true });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
