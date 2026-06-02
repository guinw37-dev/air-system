const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// ── POST /api/parts — record a requisition ──────────────────────────────────
// client_id is derived from the unit so it always matches (tenant integrity).
router.post('/', authMiddleware, async (req, res) => {
  const { unit_id, work_order_id, part_name, qty, note } = req.body;
  if (!unit_id || !part_name) return res.status(400).json({ error: 'unit_id และ part_name จำเป็น' });
  try {
    const { rows } = await pool.query(`
      INSERT INTO part_requisitions (client_id, unit_id, work_order_id, part_name, qty, note, requisitioned_by)
      SELECT u.client_id, $1,
             (SELECT w.id FROM work_orders w WHERE w.id = $2 AND w.client_id = u.client_id),
             $3, $4, $5, $6
      FROM units u WHERE u.id = $1
      RETURNING *
    `, [unit_id, work_order_id || null, part_name, qty || 1, note || null, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบ unit' });
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/parts?client_id=&unit_id=&work_order_id=&from=&to= ──────────────
router.get('/', authMiddleware, async (req, res) => {
  const { client_id, unit_id, work_order_id, from, to } = req.query;
  const params = [];
  const where = ['1=1'];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('$$', `$${params.length}`)); };
  if (client_id)     add('pr.client_id = $$', client_id);
  if (unit_id)       add('pr.unit_id = $$', unit_id);
  if (work_order_id) add('pr.work_order_id = $$', work_order_id);
  if (from)          add('pr.requisitioned_at >= $$', from);
  if (to)            add('pr.requisitioned_at <= $$', to);
  try {
    const { rows } = await pool.query(`
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

// ── GET /api/parts/summary?client_id=&unit_id= — totals per part ─────────────
router.get('/summary', authMiddleware, async (req, res) => {
  const { client_id, unit_id } = req.query;
  const params = [];
  const where = ['1=1'];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('$$', `$${params.length}`)); };
  if (client_id) add('client_id = $$', client_id);
  if (unit_id)   add('unit_id = $$', unit_id);
  try {
    const { rows } = await pool.query(`
      SELECT part_name, SUM(qty)::int AS total_qty, COUNT(*)::int AS times
      FROM part_requisitions
      WHERE ${where.join(' AND ')}
      GROUP BY part_name ORDER BY total_qty DESC
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
