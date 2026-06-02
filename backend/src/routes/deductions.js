const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

// Monthly service-fee deduction notes (client × month). Admin/central_admin only.
const canEdit = requireRole('admin', 'central_admin', 'approver');

// POST /api/deductions { client_id, month: 'YYYY-MM', notes }
router.post('/', authMiddleware, canEdit, async (req, res) => {
  const { client_id, month, notes } = req.body;
  if (!client_id || !month) return res.status(400).json({ error: 'client_id และ month จำเป็น' });
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month ต้องเป็น YYYY-MM' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO deduction_notes (client_id, month, notes, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [client_id, month, notes || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/deductions?client_id=&year=
router.get('/', authMiddleware, async (req, res) => {
  const { client_id, year } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const params = [client_id];
  let yearFilter = '';
  if (year) { params.push(year); yearFilter = ` AND LEFT(month,4) = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT d.*, u.name created_by_name FROM deduction_notes d
     LEFT JOIN users u ON d.created_by = u.id
     WHERE d.client_id = $1${yearFilter} ORDER BY d.month DESC`,
    params
  );
  res.json(rows);
});

// PUT /api/deductions/:id { notes }
router.put('/:id', authMiddleware, canEdit, async (req, res) => {
  const { notes } = req.body;
  const { rows } = await pool.query(
    `UPDATE deduction_notes SET notes=$1 WHERE id=$2 RETURNING *`,
    [notes || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

module.exports = router;
