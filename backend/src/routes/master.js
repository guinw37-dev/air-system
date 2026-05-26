const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

// GET /api/master/hospitals
router.get('/hospitals', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM hospitals WHERE active=true ORDER BY name');
  res.json(rows);
});

// GET /api/master/buildings?hospital_id=
router.get('/buildings', authMiddleware, async (req, res) => {
  const { hospital_id } = req.query;
  const { rows } = await pool.query(
    'SELECT * FROM buildings WHERE hospital_id=$1 ORDER BY name',
    [hospital_id]
  );
  res.json(rows);
});

// GET /api/master/floors?building_id=
router.get('/floors', authMiddleware, async (req, res) => {
  const { building_id } = req.query;
  const { rows } = await pool.query(
    'SELECT * FROM floors WHERE building_id=$1 ORDER BY name',
    [building_id]
  );
  res.json(rows);
});

// GET /api/master/departments?floor_id=
router.get('/departments', authMiddleware, async (req, res) => {
  const { floor_id } = req.query;
  const { rows } = await pool.query(
    'SELECT * FROM departments WHERE floor_id=$1 ORDER BY name',
    [floor_id]
  );
  res.json(rows);
});

// GET /api/master/ac-units?department_id= (or ?hospital_id= for all)
router.get('/ac-units', authMiddleware, async (req, res) => {
  const { department_id, hospital_id } = req.query;
  let query, params;

  if (department_id) {
    query = `
      SELECT a.*, d.name dept_name, f.name floor_name, b.name building_name
      FROM ac_units a
      JOIN departments d ON a.department_id = d.id
      JOIN floors f ON d.floor_id = f.id
      JOIN buildings b ON f.building_id = b.id
      WHERE a.department_id = $1
      ORDER BY a.ac_code
    `;
    params = [department_id];
  } else if (hospital_id) {
    query = `
      SELECT a.*, d.name dept_name, f.name floor_name, b.name building_name, b.code building_code
      FROM ac_units a
      JOIN departments d ON a.department_id = d.id
      JOIN floors f ON d.floor_id = f.id
      JOIN buildings b ON f.building_id = b.id
      WHERE b.hospital_id = $1
      ORDER BY b.name, f.name, a.ac_code
    `;
    params = [hospital_id];
  } else {
    return res.status(400).json({ error: 'department_id or hospital_id required' });
  }

  const { rows } = await pool.query(query, params);
  res.json(rows);
});

// GET /api/master/ac-units/:id
router.get('/ac-units/:id', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT a.*, d.name dept_name, f.name floor_name, b.name building_name, h.name hospital_name
    FROM ac_units a
    JOIN departments d ON a.department_id = d.id
    JOIN floors f ON d.floor_id = f.id
    JOIN buildings b ON f.building_id = b.id
    JOIN hospitals h ON b.hospital_id = h.id
    WHERE a.id = $1
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// PUT /api/master/ac-units/:id
router.put('/ac-units/:id', authMiddleware, requireRole('admin', 'owner'), async (req, res) => {
  const { name, type, capacity_btu, status, pm_interval_months, notes } = req.body;
  const { rows } = await pool.query(`
    UPDATE ac_units SET
      name=$1, type=$2, capacity_btu=$3, status=$4,
      pm_interval_months=$5, notes=$6, updated_at=NOW()
    WHERE id=$7 RETURNING *
  `, [name, type, capacity_btu, status, pm_interval_months, notes, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// GET /api/master/users (technicians)
router.get('/users', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, username, role, phone FROM users WHERE active=true ORDER BY name"
  );
  res.json(rows);
});

module.exports = router;
