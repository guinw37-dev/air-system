const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool, query } = require('../db');
const { slugToSchema } = require('../utils/schema');
const { provisionBranchSchema } = require('../db/provision');
const { invalidateBranchCache } = require('../middleware/resolveBranch');
const { authMiddleware, requireRole } = require('../middleware/auth');

// Super-admin back-office for branches (สาขา). Each branch is fully isolated:
// its own Postgres schema + its own users. Only global super-admins (apex) may
// provision branches or seed their first admin.
const superOnly = requireRole('super_admin', 'admin');

// GET /api/branches/public — PUBLIC minimal list for the apex landing page (the
// branch cards). Only name + slug of active, provisioned branches; no auth.
router.get('/public', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT slug, subdomain, name, card_image FROM clients
       WHERE active = true AND slug IS NOT NULL AND schema_name IS NOT NULL ORDER BY name`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/branches — list the registry (super-admin)
router.get('/', authMiddleware, superOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, code, name, slug, subdomain, schema_name, card_image, active, created_at FROM clients ORDER BY code');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/branches/:id/qr?url=<branchUrl> — QR code (data URI) for direct entry.
router.get('/:id/qr', authMiddleware, superOnly, async (req, res) => {
  const QRCode = require('qrcode');
  const url = req.query.url;
  if (!url || !/^https?:\/\/[^\s]+$/.test(String(url))) return res.status(400).json({ error: 'url ไม่ถูกต้อง' });
  try {
    const qr = await QRCode.toDataURL(String(url), { width: 320, margin: 1 });
    res.json({ qr });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/branches — provision a new branch (registry row + schema), and
// optionally seed its first branch-admin. Body:
//   { code, name, slug, admin_username?, admin_password?, admin_name? }
router.post('/', authMiddleware, superOnly, async (req, res) => {
  const { code, name, slug, admin_username, admin_password, admin_name } = req.body || {};
  if (!code || !name || !slug) return res.status(400).json({ error: 'code, name, slug จำเป็น' });
  let schema;
  try { schema = slugToSchema(slug); }
  catch { return res.status(400).json({ error: 'slug ไม่ถูกต้อง (a-z 0-9 -)' }); }
  try {
    const { rows } = await pool.query(
      `INSERT INTO clients (code, name, slug, subdomain, schema_name, active)
       VALUES ($1,$2,$3,$3,$4,true)
       ON CONFLICT (code) DO UPDATE
         SET name=EXCLUDED.name, slug=EXCLUDED.slug, subdomain=EXCLUDED.subdomain,
             schema_name=EXCLUDED.schema_name, active=true
       RETURNING id, code, name, slug, schema_name`,
      [code, name, slug, schema]);
    const branch = rows[0];
    await provisionBranchSchema(branch.schema_name);
    invalidateBranchCache(branch.slug);

    // Optional: seed the branch's first admin (into the branch's own users table)
    let admin = null;
    if (admin_username && admin_password) {
      const hash = await bcrypt.hash(String(admin_password), 10);
      const { rows: ar } = await query(schema,
        `INSERT INTO users (name, username, password_hash, role)
         VALUES ($1,$2,$3,'admin')
         ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, name=EXCLUDED.name
         RETURNING id, name, username, role`,
        [admin_name || admin_username, admin_username, hash]);
      admin = ar[0];
    }
    res.status(201).json({ branch, admin });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/branches/:slug/adopt-user { userId } — move a public.users account
// into a branch's own users table (so it becomes a branch-local user, not a
// global super-admin) and remove it from public. super-admin only.
const BRANCH_ROLES = ['admin', 'approver', 'checker', 'technician'];
router.post('/:slug/adopt-user', authMiddleware, superOnly, async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  let schema;
  try { schema = slugToSchema(req.params.slug); }
  catch { return res.status(400).json({ error: 'slug ไม่ถูกต้อง' }); }
  try {
    const { rows: br } = await pool.query(
      'SELECT 1 FROM clients WHERE slug = $1 AND schema_name IS NOT NULL AND active = true', [req.params.slug]);
    if (!br.length) return res.status(404).json({ error: 'ไม่พบสาขา (ยังไม่ provision)' });
    const { rows: u } = await pool.query(
      'SELECT name, username, password_hash, role, phone, active FROM users WHERE id = $1', [userId]);
    if (!u.length) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    const usr = u[0];
    const role = BRANCH_ROLES.includes(usr.role) ? usr.role : 'technician';
    await query(schema,
      `INSERT INTO users (name, username, password_hash, role, phone, active)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (username) DO UPDATE SET
         name=EXCLUDED.name, password_hash=EXCLUDED.password_hash,
         role=EXCLUDED.role, phone=EXCLUDED.phone, active=EXCLUDED.active`,
      [usr.name, usr.username, usr.password_hash, role, usr.phone, usr.active]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ ok: true, movedTo: schema });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/branches/:id — edit name/code/subdomain/card image, or toggle
// active. slug + schema_name stay fixed (changing them breaks the schema mapping).
router.patch('/:id', authMiddleware, superOnly, async (req, res) => {
  const { name, code, subdomain, card_image, active } = req.body || {};
  let sub = subdomain;
  if (sub != null && sub !== '' && !/^[a-z0-9-]{1,63}$/.test(String(sub))) {
    return res.status(400).json({ error: 'subdomain ต้องเป็น a-z 0-9 - เท่านั้น' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE clients SET
         name       = COALESCE($1, name),
         code       = COALESCE($2, code),
         subdomain  = COALESCE($3, subdomain),
         card_image = COALESCE($4, card_image),
         active     = COALESCE($5, active)
       WHERE id = $6
       RETURNING id, code, name, slug, subdomain, schema_name, card_image, active`,
      [name ?? null, code ?? null, sub ?? null, card_image ?? null,
       typeof active === 'boolean' ? active : null, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบสาขา' });
    invalidateBranchCache(rows[0].slug);
    invalidateBranchCache(rows[0].subdomain);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
