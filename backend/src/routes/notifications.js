const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// GET /api/notifications — current user's notifications, unread first.
// notifications stays GLOBAL (public, user-scoped) — no req.db. work_order_id is
// a plain int (the work order lives in a branch schema), so no cross-schema JOIN.
// MUST scope by branch_slug too: user_id is a per-branch schema id, so the same
// id can belong to a different person in another branch. branchSlug is on the JWT
// (null for apex super-admins → only their NULL-branch notifications).
router.get('/', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT n.* FROM notifications n
    WHERE n.user_id = $1 AND n.branch_slug IS NOT DISTINCT FROM $2
    ORDER BY (n.read_at IS NOT NULL), n.created_at DESC
    LIMIT 100
  `, [req.user.id, req.user.branchSlug || null]);
  res.json(rows);
});

// GET /api/notifications/unread-count — for the bell badge
router.get('/unread-count', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND branch_slug IS NOT DISTINCT FROM $2 AND read_at IS NULL',
    [req.user.id, req.user.branchSlug || null]
  );
  res.json({ count: rows[0].count });
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND branch_slug IS NOT DISTINCT FROM $3 RETURNING *',
    [req.params.id, req.user.id, req.user.branchSlug || null]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// PUT /api/notifications/read-all
router.put('/read-all', authMiddleware, async (req, res) => {
  await pool.query(
    'UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND branch_slug IS NOT DISTINCT FROM $2 AND read_at IS NULL',
    [req.user.id, req.user.branchSlug || null]
  );
  res.json({ message: 'ok' });
});

module.exports = router;
