const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// GET /api/notifications — current user's notifications, unread first.
// notifications stays GLOBAL (public, user-scoped) — no req.db. work_order_id is
// a plain int (the work order lives in a branch schema), so no cross-schema JOIN.
router.get('/', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT n.* FROM notifications n
    WHERE n.user_id = $1
    ORDER BY (n.read_at IS NOT NULL), n.created_at DESC
    LIMIT 100
  `, [req.user.id]);
  res.json(rows);
});

// GET /api/notifications/unread-count — for the bell badge
router.get('/unread-count', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [req.user.id]
  );
  res.json({ count: rows[0].count });
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *',
    [req.params.id, req.user.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// PUT /api/notifications/read-all
router.put('/read-all', authMiddleware, async (req, res) => {
  await pool.query('UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({ message: 'ok' });
});

module.exports = router;
