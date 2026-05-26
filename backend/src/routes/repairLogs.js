const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

// GET /api/repair-logs?hospital_id=&status=&ac_unit_id=
router.get('/', authMiddleware, async (req, res) => {
  const { hospital_id, status, ac_unit_id } = req.query;
  let where = ['1=1'];
  let params = [];
  let i = 1;

  if (ac_unit_id)  { where.push(`r.ac_unit_id = $${i++}`);  params.push(ac_unit_id); }
  if (status)      { where.push(`r.status = $${i++}`);       params.push(status); }
  if (hospital_id) {
    where.push(`b.hospital_id = $${i++}`);
    params.push(hospital_id);
  }

  const { rows } = await pool.query(`
    SELECT r.*,
      a.ac_code, a.name ac_name, a.type ac_type,
      d.name dept_name, f.name floor_name, b.name building_name,
      u.name reporter_name,
      w.order_no
    FROM repair_logs r
    JOIN ac_units a      ON r.ac_unit_id = a.id
    JOIN departments d   ON a.department_id = d.id
    JOIN floors f        ON d.floor_id = f.id
    JOIN buildings b     ON f.building_id = b.id
    LEFT JOIN users u    ON r.reported_by = u.id
    LEFT JOIN work_orders w ON r.work_order_id = w.id
    WHERE ${where.join(' AND ')}
    ORDER BY r.created_at DESC
    LIMIT 100
  `, params);
  res.json(rows);
});

// GET /api/repair-logs/:id
router.get('/:id', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.*, a.ac_code, a.name ac_name, u.name reporter_name, w.order_no
    FROM repair_logs r
    JOIN ac_units a ON r.ac_unit_id = a.id
    LEFT JOIN users u ON r.reported_by = u.id
    LEFT JOIN work_orders w ON r.work_order_id = w.id
    WHERE r.id = $1
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// PATCH /api/repair-logs/:id
router.patch('/:id', authMiddleware, async (req, res) => {
  const { cause, solution, status, petty_cash } = req.body;
  const resolved_at = status === 'done' ? 'NOW()' : 'NULL';
  const { rows } = await pool.query(`
    UPDATE repair_logs
    SET cause = COALESCE($1, cause),
        solution = COALESCE($2, solution),
        status = COALESCE($3, status),
        petty_cash = COALESCE($4, petty_cash),
        resolved_at = CASE WHEN $3 = 'done' THEN NOW() ELSE resolved_at END,
        updated_at = NOW()
    WHERE id = $5
    RETURNING *
  `, [cause, solution, status, petty_cash, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

module.exports = router;
