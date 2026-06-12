const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');

// Monthly service-fee deduction notes (per month, within a branch). Schema-per-
// tenant: req.db scopes every row to the current branch — no client_id.
const canEdit = requireRole('admin', 'approver', 'approve_building', 'approve_engineer', 'super_admin');

// POST /api/deductions { month: 'YYYY-MM', notes }
router.post('/', authMiddleware, canEdit, async (req, res) => {
  const { month, notes } = req.body;
  if (!month) return res.status(400).json({ error: 'month จำเป็น' });
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month ต้องเป็น YYYY-MM' });
  try {
    const { rows } = await req.db(
      `INSERT INTO deduction_notes (month, notes, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [month, notes || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/deductions?year=
router.get('/', authMiddleware, async (req, res) => {
  const { year } = req.query;
  const params = [];
  let yearFilter = '';
  if (year) { params.push(year); yearFilter = ` WHERE LEFT(month,4) = $${params.length}`; }
  try {
    const { rows } = await req.db(
      `SELECT d.*, u.name created_by_name FROM deduction_notes d
       LEFT JOIN users u ON d.created_by = u.id
       ${yearFilter} ORDER BY d.month DESC`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/deductions/:id { notes }
router.put('/:id', authMiddleware, canEdit, async (req, res) => {
  const { notes } = req.body;
  try {
    const { rows } = await req.db(
      `UPDATE deduction_notes SET notes=$1 WHERE id=$2 RETURNING *`,
      [notes || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
