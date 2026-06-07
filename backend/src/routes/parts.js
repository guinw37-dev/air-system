const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

// Schema-per-tenant: every row already belongs to req.branch's schema, so there
// is no client_id — req.db scopes all reads/writes to the current branch.

// ── POST /api/parts — record a requisition ──────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const { unit_id, work_order_id, part_name, qty, note } = req.body;
  if (!unit_id || !part_name) return res.status(400).json({ error: 'unit_id และ part_name จำเป็น' });
  try {
    const { rows } = await req.db(`
      INSERT INTO part_requisitions (unit_id, work_order_id, part_name, qty, note, requisitioned_by)
      SELECT $1, $2, $3, $4, $5, $6
      WHERE EXISTS (SELECT 1 FROM units u WHERE u.id = $1)
      RETURNING *
    `, [unit_id, work_order_id || null, part_name, qty || 1, note || null, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบ unit' });
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/parts?unit_id=&work_order_id=&from=&to= ────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  const { unit_id, work_order_id, from, to } = req.query;
  const params = [];
  const where = ['1=1'];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('$$', `$${params.length}`)); };
  if (unit_id)       add('pr.unit_id = $$', unit_id);
  if (work_order_id) add('pr.work_order_id = $$', work_order_id);
  if (from)          add('pr.requisitioned_at >= $$', from);
  if (to)            add('pr.requisitioned_at <= $$', to);
  try {
    const { rows } = await req.db(`
      SELECT pr.*, u.asset_code, u.name unit_name, us.name requisitioned_by_name,
             w.order_no
      FROM part_requisitions pr
      JOIN units u        ON pr.unit_id = u.id
      LEFT JOIN users us  ON pr.requisitioned_by = us.id
      LEFT JOIN work_orders w ON pr.work_order_id = w.id
      WHERE ${where.join(' AND ')}
      ORDER BY pr.requisitioned_at DESC
      LIMIT 500
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/parts/summary?unit_id= — totals per part ───────────────────────
router.get('/summary', authMiddleware, async (req, res) => {
  const { unit_id } = req.query;
  const params = [];
  const where = ['1=1'];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('$$', `$${params.length}`)); };
  if (unit_id) add('unit_id = $$', unit_id);
  try {
    const { rows } = await req.db(`
      SELECT part_name, SUM(qty)::int AS total_qty, COUNT(*)::int AS times
      FROM part_requisitions
      WHERE ${where.join(' AND ')}
      GROUP BY part_name ORDER BY total_qty DESC
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
