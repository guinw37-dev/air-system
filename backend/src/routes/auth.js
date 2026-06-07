const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// POST /api/auth/login
// Schema-per-tenant auth: users live in public.users with a branch_slug. A user
// with branch_slug = NULL is a global super-admin (login anywhere, cross-branch);
// otherwise the user is local to that branch and may only log in on it. The
// branch comes from resolveBranch (X-Branch header / subdomain) → req.branch.
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'username and password required' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND active = true',
      [username]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const isSuper = user.branch_slug == null;
    // A branch-local user can only sign in on their own branch.
    if (req.branch && !isSuper && user.branch_slug !== req.branch.slug) {
      return res.status(403).json({ error: 'บัญชีนี้ไม่ได้อยู่สาขานี้' });
    }
    const branchSlug = isSuper ? null : user.branch_slug;

    const token = jwt.sign(
      { id: user.id, username: user.username, name: user.name, role: user.role, branchSlug, isSuper },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, user: { id: user.id, name: user.name, role: user.role, branchSlug, isSuper } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, username, role, phone, branch_slug FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ ...rows[0], isSuper: rows[0].branch_slug == null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
