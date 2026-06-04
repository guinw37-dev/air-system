const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { requireClientId } = require('../middleware/tenant');

// Master data CRUD on the new tenant hierarchy:
//   clients → sites → buildings → floors → rooms → units
// Data-entry roles: admin + central_admin. Destructive ops: admin only.
const canEdit = requireRole('admin', 'central_admin');
const canDelete = requireRole('admin');

// ── Clients (เดิม hospitals) ────────────────────────────────────────────────

router.get('/clients', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM clients ORDER BY code');
  res.json(rows);
});

router.post('/clients', authMiddleware, canEdit, async (req, res) => {
  const { code, name } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO clients (code, name) VALUES ($1,$2) RETURNING *',
      [code, name]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/clients/:id', authMiddleware, canEdit, async (req, res) => {
  const { code, name, active } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE clients SET code=$1, name=$2, active=$3 WHERE id=$4 RETURNING *',
      [code, name, active !== false, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/clients/:id', authMiddleware, canDelete, async (req, res) => {
  await pool.query('UPDATE clients SET active=false WHERE id=$1', [req.params.id]);
  res.json({ message: 'deactivated' });
});

// ── Sites (ชั้นใหม่ ระหว่าง client กับ building) ─────────────────────────────

router.get('/sites', authMiddleware, requireClientId, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM sites WHERE client_id=$1 ORDER BY name', [req.clientId]
  );
  res.json(rows);
});

router.post('/sites', authMiddleware, canEdit, async (req, res) => {
  const { client_id, code, name } = req.body;
  if (!client_id || !name) return res.status(400).json({ error: 'client_id and name required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO sites (client_id, code, name) VALUES ($1,$2,$3) RETURNING *',
      [client_id, code || null, name]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/sites/:id', authMiddleware, canEdit, async (req, res) => {
  const { code, name, active } = req.body;
  const { rows } = await pool.query(
    'UPDATE sites SET code=$1, name=$2, active=$3 WHERE id=$4 RETURNING *',
    [code || null, name, active !== false, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.delete('/sites/:id', authMiddleware, canDelete, async (req, res) => {
  await pool.query('UPDATE sites SET active=false WHERE id=$1', [req.params.id]);
  res.json({ message: 'deactivated' });
});

// ── Buildings (FK site_id) ──────────────────────────────────────────────────

router.get('/buildings', authMiddleware, async (req, res) => {
  const { site_id } = req.query;
  if (!site_id) return res.status(400).json({ error: 'site_id required' });
  const { rows } = await pool.query(
    'SELECT * FROM buildings WHERE site_id=$1 ORDER BY name', [site_id]
  );
  res.json(rows);
});

router.post('/buildings', authMiddleware, canEdit, async (req, res) => {
  const { site_id, name, code } = req.body;
  if (!site_id || !name) return res.status(400).json({ error: 'site_id and name required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO buildings (site_id, name, code) VALUES ($1,$2,$3) RETURNING *',
      [site_id, name, code || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/buildings/:id', authMiddleware, canEdit, async (req, res) => {
  const { name, code } = req.body;
  const { rows } = await pool.query(
    'UPDATE buildings SET name=$1, code=$2 WHERE id=$3 RETURNING *',
    [name, code || null, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.delete('/buildings/:id', authMiddleware, canDelete, async (req, res) => {
  await pool.query('DELETE FROM buildings WHERE id=$1', [req.params.id]);
  res.json({ message: 'deleted' });
});

// ── Floors ──────────────────────────────────────────────────────────────────

router.get('/floors', authMiddleware, async (req, res) => {
  const { building_id } = req.query;
  if (!building_id) return res.status(400).json({ error: 'building_id required' });
  const { rows } = await pool.query(
    'SELECT * FROM floors WHERE building_id=$1 ORDER BY name', [building_id]
  );
  res.json(rows);
});

router.post('/floors', authMiddleware, canEdit, async (req, res) => {
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

router.put('/floors/:id', authMiddleware, canEdit, async (req, res) => {
  const { name } = req.body;
  const { rows } = await pool.query(
    'UPDATE floors SET name=$1 WHERE id=$2 RETURNING *', [name, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.delete('/floors/:id', authMiddleware, canDelete, async (req, res) => {
  await pool.query('DELETE FROM floors WHERE id=$1', [req.params.id]);
  res.json({ message: 'deleted' });
});

// ── Rooms (เดิม departments) ────────────────────────────────────────────────

router.get('/rooms', authMiddleware, async (req, res) => {
  const { floor_id } = req.query;
  if (!floor_id) return res.status(400).json({ error: 'floor_id required' });
  const { rows } = await pool.query(
    'SELECT * FROM rooms WHERE floor_id=$1 ORDER BY name', [floor_id]
  );
  res.json(rows);
});

router.post('/rooms', authMiddleware, canEdit, async (req, res) => {
  const { floor_id, name } = req.body;
  if (!floor_id || !name) return res.status(400).json({ error: 'floor_id and name required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO rooms (floor_id, name) VALUES ($1,$2) RETURNING *',
      [floor_id, name]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/rooms/:id', authMiddleware, canEdit, async (req, res) => {
  const { name } = req.body;
  const { rows } = await pool.query(
    'UPDATE rooms SET name=$1 WHERE id=$2 RETURNING *', [name, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.delete('/rooms/:id', authMiddleware, canDelete, async (req, res) => {
  await pool.query('DELETE FROM rooms WHERE id=$1', [req.params.id]);
  res.json({ message: 'deleted' });
});

// ── Units (เดิม ac_units; รวม AC+พัดลม) ─────────────────────────────────────
// Tenant-scoped. List by room_id, or by client_id (with optional equipment_type
// filter). Always carries client_id directly so isolation never needs a 6-join.

router.get('/units', authMiddleware, async (req, res) => {
  const { room_id, client_id, equipment_type } = req.query;
  if (room_id) {
    const { rows } = await pool.query(`
      SELECT u.*, r.name room_name, f.name floor_name, b.name building_name
      FROM units u
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      WHERE u.room_id = $1
      ORDER BY u.asset_code
    `, [room_id]);
    return res.json(rows);
  }
  if (client_id) {
    const params = [client_id];
    let typeFilter = '';
    if (equipment_type === 'ac' || equipment_type === 'fan') {
      params.push(equipment_type);
      typeFilter = ' AND u.equipment_type = $2';
    }
    const { rows } = await pool.query(`
      SELECT u.*, r.name room_name, f.name floor_name,
             b.name building_name, b.code building_code, s.name site_name
      FROM units u
      LEFT JOIN rooms r     ON u.room_id = r.id
      LEFT JOIN floors f    ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      LEFT JOIN sites s     ON b.site_id = s.id
      WHERE u.client_id = $1${typeFilter}
      ORDER BY b.name, f.name, u.asset_code
    `, params);
    return res.json(rows);
  }
  return res.status(400).json({ error: 'room_id or client_id required' });
});

router.get('/units/:id', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.*, r.name room_name, f.name floor_name, b.name building_name,
           s.name site_name, c.name client_name, c.code client_code
    FROM units u
    LEFT JOIN rooms r     ON u.room_id = r.id
    LEFT JOIN floors f    ON r.floor_id = f.id
    LEFT JOIN buildings b ON f.building_id = b.id
    LEFT JOIN sites s     ON b.site_id = s.id
    JOIN clients c        ON u.client_id = c.id
    WHERE u.id = $1
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// Work-order history for one unit (minimal — full WO lifecycle is a later phase)
router.get('/units/:id/history', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        wo.id, wo.order_no, wo.type, wo.status,
        wo.started_at, wo.completed_at, wo.approved_at,
        c.name client_name,
        wou.has_repair, wou.repair_notes,
        COUNT(p.id)::int AS photo_count
      FROM work_order_units wou
      JOIN work_orders wo ON wo.id = wou.work_order_id
      JOIN clients c      ON wo.client_id = c.id
      LEFT JOIN work_order_photos p ON p.work_order_unit_id = wou.id
      WHERE wou.unit_id = $1
      GROUP BY wo.id, c.name, wou.has_repair, wou.repair_notes
      ORDER BY wo.created_at DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/units', authMiddleware, canEdit, async (req, res) => {
  const {
    client_id, room_id, asset_code, name, equipment_type, family,
    capacity_btu, refrigerant, status, last_major_clean_date,
  } = req.body;
  if (!client_id || !asset_code || !equipment_type) {
    return res.status(400).json({ error: 'client_id, asset_code, equipment_type required' });
  }
  if (!['ac', 'fan'].includes(equipment_type)) {
    return res.status(400).json({ error: "equipment_type must be 'ac' or 'fan'" });
  }
  try {
    const { rows } = await pool.query(`
      INSERT INTO units
        (client_id, room_id, asset_code, name, equipment_type, family,
         capacity_btu, refrigerant, status, last_major_clean_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'active'),$10)
      RETURNING *
    `, [
      client_id, room_id || null, asset_code, name || null, equipment_type,
      family || null, capacity_btu || null, refrigerant || null,
      status || null, last_major_clean_date || null,
    ]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/units/:id', authMiddleware, canEdit, async (req, res) => {
  const {
    room_id, name, equipment_type, family, capacity_btu, refrigerant,
    status, last_major_clean_date, needs_recode, active,
  } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE units SET
        room_id=$1, name=$2, equipment_type=COALESCE($3, equipment_type),
        family=$4, capacity_btu=$5, refrigerant=$6, status=COALESCE($7, status),
        last_major_clean_date=$8, needs_recode=COALESCE($9, needs_recode),
        active=COALESCE($10, active), updated_at=NOW()
      WHERE id=$11 RETURNING *
    `, [
      room_id || null, name || null, equipment_type || null, family || null,
      capacity_btu || null, refrigerant || null, status || null,
      last_major_clean_date || null, needs_recode, active, req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/units/:id', authMiddleware, canDelete, async (req, res) => {
  await pool.query('DELETE FROM units WHERE id=$1', [req.params.id]);
  res.json({ message: 'deleted' });
});

// ── Inspection template (config moved to DB) ────────────────────────────────
// GET /api/master/inspection-template?equipment_type=ac&type=major
// Returns the checklist/measurement items for an equipment type + work type.
router.get('/inspection-template', authMiddleware, async (req, res) => {
  const { equipment_type, type } = req.query;
  if (!['ac', 'fan'].includes(equipment_type)) {
    return res.status(400).json({ error: "equipment_type must be 'ac' or 'fan'" });
  }
  const params = [equipment_type];
  let appliesFilter = '';
  if (type === 'major') appliesFilter = ' AND applies_major = true';
  else if (type === 'minor') appliesFilter = ' AND applies_minor = true';
  const { rows } = await pool.query(`
    SELECT * FROM inspection_template_items
    WHERE equipment_type = $1${appliesFilter}
    ORDER BY sort_order, id
  `, params);
  res.json(rows);
});

// GET /api/master/photo-points?equipment_type=ac|fan&work_type=major|minor|fan
router.get('/photo-points', authMiddleware, async (req, res) => {
  const { equipment_type, work_type } = req.query;
  if (!equipment_type || !work_type) {
    return res.status(400).json({ error: 'equipment_type และ work_type จำเป็น' });
  }
  const { rows } = await pool.query(
    'SELECT point_no, label, required FROM photo_point_templates WHERE equipment_type=$1 AND work_type=$2 ORDER BY point_no',
    [equipment_type, work_type]
  );
  res.json(rows);
});

// ── Users (role ใหม่ 4 แบบ; ตาราง users ไม่มี updated_at) ────────────────────

// NOTE: kept accessible to all authenticated staff — the WO-create assignee
// picker (technicians) needs id/name/role. Returns no password_hash. (audit F-5)
router.get('/users', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, username, role, phone, active FROM users ORDER BY name'
  );
  res.json(rows);
});

const VALID_ROLES = ['technician', 'central_admin', 'approver', 'admin', 'checker', 'building', 'supervisor'];

router.post('/users', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, username, password, role, phone } = req.body;
  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: 'name, username, password, role required' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of ${VALID_ROLES.join(', ')}` });
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
  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of ${VALID_ROLES.join(', ')}` });
  }
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        'UPDATE users SET name=$1, role=$2, phone=$3, active=$4, password_hash=$5 WHERE id=$6',
        [name, role, phone || null, active !== false, hash, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE users SET name=$1, role=$2, phone=$3, active=$4 WHERE id=$5',
        [name, role, phone || null, active !== false, req.params.id]
      );
    }
    const { rows } = await pool.query(
      'SELECT id, name, username, role, phone, active FROM users WHERE id=$1', [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/master/units/:id/timeline — merged history (WO + repair + parts) ─
router.get('/units/:id/timeline', authMiddleware, async (req, res) => {
  const uid = req.params.id;
  try {
    const [wos, repairs, parts] = await Promise.all([
      pool.query(`
        SELECT wo.id, wo.order_no, wo.type, wo.status,
               COALESCE(wo.approved_at, wo.completed_at, wo.created_at) AS date
        FROM work_order_units wou JOIN work_orders wo ON wou.work_order_id = wo.id
        WHERE wou.unit_id = $1`, [uid]),
      pool.query(`SELECT id, problem, status, created_at AS date FROM repair_logs WHERE unit_id = $1`, [uid]),
      pool.query(`SELECT id, part_name, qty, requisitioned_at AS date FROM part_requisitions WHERE unit_id = $1`, [uid]),
    ]);
    const events = [
      ...wos.rows.map((r) => ({ kind: 'work_order', date: r.date, ...r })),
      ...repairs.rows.map((r) => ({ kind: 'repair', date: r.date, ...r })),
      ...parts.rows.map((r) => ({ kind: 'part', date: r.date, ...r })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(events);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/master/units/:id/stats — clean counts + measurement trend + parts ─
router.get('/units/:id/stats', authMiddleware, async (req, res) => {
  const uid = req.params.id;
  try {
    const counts = await pool.query(`
      SELECT wo.type, COUNT(*)::int AS n
      FROM work_order_units wou JOIN work_orders wo ON wou.work_order_id = wo.id
      WHERE wou.unit_id = $1 AND wo.status = 'approved'
      GROUP BY wo.type`, [uid]);
    // measurement trend: value_after per template item across approved WOs over time
    const trend = await pool.query(`
      SELECT ti.item_label, ti.unit_label, iv.value_after,
             COALESCE(wo.approved_at, wo.completed_at) AS date
      FROM inspection_values iv
      JOIN work_order_units wou ON iv.work_order_unit_id = wou.id
      JOIN work_orders wo       ON wou.work_order_id = wo.id
      JOIN inspection_template_items ti ON iv.template_item_id = ti.id
      WHERE wou.unit_id = $1 AND wo.status = 'approved'
        AND iv.value_after ~ '^[0-9.]+$' AND ti.value_type IN ('number','before_after')
      ORDER BY date`, [uid]);
    const parts = await pool.query(`
      SELECT part_name, SUM(qty)::int AS total_qty FROM part_requisitions
      WHERE unit_id = $1 GROUP BY part_name ORDER BY total_qty DESC`, [uid]);
    const byType = {};
    for (const r of counts.rows) byType[r.type] = r.n;
    res.json({ counts: byType, trend: trend.rows, parts: parts.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
