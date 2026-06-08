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
      `SELECT slug, name FROM clients WHERE active = true AND slug IS NOT NULL AND schema_name IS NOT NULL ORDER BY name`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/branches — list the registry (super-admin)
router.get('/', authMiddleware, superOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, code, name, slug, subdomain, schema_name, active, created_at FROM clients ORDER BY code');
    res.json(rows);
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

// PATCH /api/branches/:id — activate/deactivate a branch (registry only)
router.patch('/:id', authMiddleware, superOnly, async (req, res) => {
  const { active } = req.body || {};
  try {
    const { rows } = await pool.query(
      'UPDATE clients SET active=$1 WHERE id=$2 RETURNING id, code, name, slug, active',
      [active !== false, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบสาขา' });
    invalidateBranchCache(rows[0].slug);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
