const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');
const { authMiddleware, requireRole } = require('../middleware/auth');

// ── Hospitals ──────────────────────────────────────────────────────────────

router.get('/hospitals', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM hospitals ORDER BY name');
  res.json(rows);
});

router.post('/hospitals', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, slug, address, phone } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name and slug required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO hospitals (name, slug, address, phone) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, slug, address || null, phone || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/hospitals/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, slug, address, phone, active } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE hospitals SET name=$1, slug=$2, address=$3, phone=$4, active=$5, updated_at=NOW() WHERE id=$6 RETURNING *',
      [name, slug, address || null, phone || null, active !== false, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/hospitals/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.query('UPDATE hospitals SET active=false WHERE id=$1', [req.params.id]);
  res.json({ message: 'deactivated' });
});

// ── Buildings ──────────────────────────────────────────────────────────────

router.get('/buildings', authMiddleware, async (req, res) => {
  const { hospital_id } = req.query;
  const { rows } = await pool.query(
    'SELECT * FROM buildings WHERE hospital_id=$1 ORDER BY name', [hospital_id]
  );
  res.json(rows);
});

router.post('/buildings', authMiddleware, requireRole('admin', 'owner'), async (req, res) => {
  const { hospital_id, name, code } = req.body;
  if (!hospital_id || !name) return res.status(400).json({ error: 'hospital_id and name required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO buildings (hospital_id, name, code) VALUES ($1,$2,$3) RETURNING *',
      [hospital_id, name, code || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/buildings/:id', authMiddleware, requireRole('admin', 'owner'), async (req, res) => {
  const { name, code } = req.body;
  const { rows } = await pool.query(
    'UPDATE buildings SET name=$1, code=$2 WHERE id=$3 RETURNING *',
    [name, code || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.delete('/buildings/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM buildings WHERE id=$1', [req.params.id]);
  res.json({ message: 'deleted' });
});

// ── Floors ─────────────────────────────────────────────────────────────────

router.get('/floors', authMiddleware, async (req, res) => {
  const { building_id } = req.query;
  const { rows } = await pool.query(
    'SELECT * FROM floors WHERE building_id=$1 ORDER BY name', [building_id]
  );
  res.json(rows);
});

router.post('/floors', authMiddleware, requireRole('admin', 'owner'), async (req, res) => {
  const { building_id, name } = req.body;
  if (!building_id || !name) return res.status(400).json({ error: 'building_id and name required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO floors (building_id, name) VALUES ($1,$2) RETURNING *',
      [building_id, name]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/floors/:id', authMiddleware, requireRole('admin', 'owner'), async (req, res) => {
  const { name } = req.body;
  const { rows } = await pool.query(
    'UPDATE floors SET name=$1 WHERE id=$2 RETURNING *', [name, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.delete('/floors/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM floors WHERE id=$1', [req.params.id]);
  res.json({ message: 'deleted' });
});

// ── Departments ────────────────────────────────────────────────────────────

router.get('/departments', authMiddleware, async (req, res) => {
  const { floor_id } = req.query;
  const { rows } = await pool.query(
    'SELECT * FROM departments WHERE floor_id=$1 ORDER BY name', [floor_id]
  );
  res.json(rows);
});

router.post('/departments', authMiddleware, requireRole('admin', 'owner'), async (req, res) => {
  const { floor_id, name } = req.body;
  if (!floor_id || !name) return res.status(400).json({ error: 'floor_id and name required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO departments (floor_id, name) VALUES ($1,$2) RETURNING *',
      [floor_id, name]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/departments/:id', authMiddleware, requireRole('admin', 'owner'), async (req, res) => {
  const { name } = req.body;
  const { rows } = await pool.query(
    'UPDATE departments SET name=$1 WHERE id=$2 RETURNING *', [name, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.delete('/departments/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM departments WHERE id=$1', [req.params.id]);
  res.json({ message: 'deleted' });
});

// ── AC Units ───────────────────────────────────────────────────────────────

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
      WHERE a.department_id = $1 ORDER BY a.ac_code
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

// GET /api/master/ac-units/:id/history — work order history for a specific AC
router.get('/ac-units/:id/history', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        wo.id, wo.order_no, wo.type, wo.status,
        wo.started_at, wo.completed_at, wo.approved_at,
        h.name hospital_name,
        t1.name tech1_name, t2.name tech2_name,
        woi.measurements, woi.checklist, woi.has_repair, woi.repair_notes,
        COUNT(p.id)::int AS photo_count
      FROM work_order_items woi
      JOIN work_orders wo ON wo.id = woi.work_order_id
      JOIN hospitals h    ON wo.hospital_id = h.id
      LEFT JOIN users t1  ON wo.tech1_id = t1.id
      LEFT JOIN users t2  ON wo.tech2_id = t2.id
      LEFT JOIN ac_photos p ON p.work_order_item_id = woi.id
      WHERE woi.ac_unit_id = $1
      GROUP BY wo.id, h.name, t1.name, t2.name,
               woi.measurements, woi.checklist, woi.has_repair, woi.repair_notes
      ORDER BY wo.created_at DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ac-units', authMiddleware, requireRole('admin', 'owner'), async (req, res) => {
  const { department_id, ac_code, name, type, capacity_btu, pm_interval_months, notes } = req.body;
  if (!department_id || !ac_code) return res.status(400).json({ error: 'department_id and ac_code required' });
  try {
    const { rows } = await pool.query(`
      INSERT INTO ac_units (department_id, ac_code, name, type, capacity_btu, pm_interval_months, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [department_id, ac_code, name || null, type || null, capacity_btu || null, pm_interval_months || 2, notes || null]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

router.delete('/ac-units/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM ac_units WHERE id=$1', [req.params.id]);
  res.json({ message: 'deleted' });
});

// ── Users ──────────────────────────────────────────────────────────────────

router.get('/users', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, username, role, phone, active FROM users ORDER BY name'
  );
  res.json(rows);
});

router.post('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, username, password, role, phone } = req.body;
  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: 'name, username, password, role required' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (name, username, password_hash, role, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, username, role, phone',
      [name, username, hash, role, phone || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, role, phone, active, password } = req.body;
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        'UPDATE users SET name=$1, role=$2, phone=$3, active=$4, password_hash=$5, updated_at=NOW() WHERE id=$6',
        [name, role, phone || null, active !== false, hash, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE users SET name=$1, role=$2, phone=$3, active=$4, updated_at=NOW() WHERE id=$5',
        [name, role, phone || null, active !== false, req.params.id]
      );
    }
    const { rows } = await pool.query(
      'SELECT id, name, username, role, phone, active FROM users WHERE id=$1', [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
