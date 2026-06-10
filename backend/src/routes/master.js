const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');
const { authMiddleware, requireRole } = require('../middleware/auth');

// Master data CRUD. Schema-per-tenant split:
//   GLOBAL (public, on pool): clients (branch registry), users (super-admins),
//     inspection_template_items, photo_point_templates.
//   PER-BRANCH (req.db): sites → buildings → floors → rooms → units (+ history).
const canEdit = requireRole('admin', 'central_admin', 'super_admin');
const canDelete = requireRole('admin', 'super_admin');
const canRegistry = requireRole('admin', 'super_admin');

// ── Clients = branch registry (GLOBAL, public) ──────────────────────────────
// NOTE: creating a branch here only adds the registry row; provisioning its
// schema is done by `npm run add-branch` (or migrate:schemas).
router.get('/clients', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM clients ORDER BY code');
  res.json(rows);
});

router.post('/clients', authMiddleware, canRegistry, async (req, res) => {
  const { code, name } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO clients (code, name) VALUES ($1,$2) RETURNING *', [code, name]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/clients/:id', authMiddleware, canRegistry, async (req, res) => {
  const { code, name, active } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE clients SET code=$1, name=$2, active=$3 WHERE id=$4 RETURNING *',
      [code, name, active !== false, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/clients/:id', authMiddleware, canRegistry, async (req, res) => {
  await pool.query('UPDATE clients SET active=false WHERE id=$1', [req.params.id]);
  res.json({ message: 'deactivated' });
});

// ── Sites (PER-BRANCH; top of the in-schema hierarchy) ──────────────────────
router.get('/sites', authMiddleware, async (req, res) => {
  const { rows } = await req.db('SELECT * FROM sites ORDER BY name');
  res.json(rows);
});

router.post('/sites', authMiddleware, canEdit, async (req, res) => {
  const { code, name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const { rows } = await req.db(
      'INSERT INTO sites (code, name) VALUES ($1,$2) RETURNING *', [code || null, name]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/sites/:id', authMiddleware, canEdit, async (req, res) => {
  const { code, name, active } = req.body;
  const { rows } = await req.db(
    'UPDATE sites SET code=$1, name=$2, active=$3 WHERE id=$4 RETURNING *',
    [code || null, name, active !== false, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.delete('/sites/:id', authMiddleware, canDelete, async (req, res) => {
  await req.db('UPDATE sites SET active=false WHERE id=$1', [req.params.id]);
  res.json({ message: 'deactivated' });
});

// ── Buildings (FK site_id) ──────────────────────────────────────────────────
router.get('/buildings', authMiddleware, async (req, res) => {
  const { site_id } = req.query;
  if (!site_id) return res.status(400).json({ error: 'site_id required' });
  const { rows } = await req.db('SELECT * FROM buildings WHERE site_id=$1 ORDER BY name', [site_id]);
  res.json(rows);
});

router.post('/buildings', authMiddleware, canEdit, async (req, res) => {
  const { site_id, name, code } = req.body;
  if (!site_id || !name) return res.status(400).json({ error: 'site_id and name required' });
  try {
    const { rows } = await req.db(
      'INSERT INTO buildings (site_id, name, code) VALUES ($1,$2,$3) RETURNING *',
      [site_id, name, code || null]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/buildings/:id', authMiddleware, canEdit, async (req, res) => {
  const { name, code } = req.body;
  const { rows } = await req.db(
    'UPDATE buildings SET name=$1, code=$2 WHERE id=$3 RETURNING *',
    [name, code || null, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.delete('/buildings/:id', authMiddleware, canDelete, async (req, res) => {
  await req.db('DELETE FROM buildings WHERE id=$1', [req.params.id]);
  res.json({ message: 'deleted' });
});

// ── Floors ──────────────────────────────────────────────────────────────────
router.get('/floors', authMiddleware, async (req, res) => {
  const { building_id } = req.query;
  if (!building_id) return res.status(400).json({ error: 'building_id required' });
  const { rows } = await req.db('SELECT * FROM floors WHERE building_id=$1 ORDER BY name', [building_id]);
  res.json(rows);
});

router.post('/floors', authMiddleware, canEdit, async (req, res) => {
  const { building_id, name } = req.body;
  if (!building_id || !name) return res.status(400).json({ error: 'building_id and name required' });
  try {
    const { rows } = await req.db('INSERT INTO floors (building_id, name) VALUES ($1,$2) RETURNING *', [building_id, name]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/floors/:id', authMiddleware, canEdit, async (req, res) => {
  const { name } = req.body;
  const { rows } = await req.db('UPDATE floors SET name=$1 WHERE id=$2 RETURNING *', [name, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.delete('/floors/:id', authMiddleware, canDelete, async (req, res) => {
  await req.db('DELETE FROM floors WHERE id=$1', [req.params.id]);
  res.json({ message: 'deleted' });
});

// ── Rooms ────────────────────────────────────────────────────────────────────
router.get('/rooms', authMiddleware, async (req, res) => {
  const { floor_id } = req.query;
  if (!floor_id) return res.status(400).json({ error: 'floor_id required' });
  const { rows } = await req.db('SELECT * FROM rooms WHERE floor_id=$1 ORDER BY name', [floor_id]);
  res.json(rows);
});

router.post('/rooms', authMiddleware, canEdit, async (req, res) => {
  const { floor_id, name } = req.body;
  if (!floor_id || !name) return res.status(400).json({ error: 'floor_id and name required' });
  try {
    const { rows } = await req.db('INSERT INTO rooms (floor_id, name) VALUES ($1,$2) RETURNING *', [floor_id, name]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/rooms/:id', authMiddleware, canEdit, async (req, res) => {
  const { name } = req.body;
  const { rows } = await req.db('UPDATE rooms SET name=$1 WHERE id=$2 RETURNING *', [name, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.delete('/rooms/:id', authMiddleware, canDelete, async (req, res) => {
  await req.db('DELETE FROM rooms WHERE id=$1', [req.params.id]);
  res.json({ message: 'deleted' });
});

// ── Units (AC + พัดลม; PER-BRANCH, no client_id) ────────────────────────────
router.get('/units', authMiddleware, async (req, res) => {
  const { room_id, equipment_type } = req.query;
  if (room_id) {
    const { rows } = await req.db(`
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
  const params = [];
  let typeFilter = '';
  if (equipment_type === 'ac' || equipment_type === 'fan') {
    params.push(equipment_type);
    typeFilter = ` WHERE u.equipment_type = $${params.length}`;
  }
  const { rows } = await req.db(`
    SELECT u.*, r.name room_name, f.name floor_name,
           b.name building_name, b.code building_code, s.name site_name
    FROM units u
    LEFT JOIN rooms r     ON u.room_id = r.id
    LEFT JOIN floors f    ON r.floor_id = f.id
    LEFT JOIN buildings b ON f.building_id = b.id
    LEFT JOIN sites s     ON b.site_id = s.id
    ${typeFilter}
    ORDER BY b.name, f.name, u.asset_code
  `, params);
  return res.json(rows);
});

router.get('/units/:id', authMiddleware, async (req, res) => {
  const { rows } = await req.db(`
    SELECT u.*, r.name room_name, f.name floor_name, b.name building_name, s.name site_name
    FROM units u
    LEFT JOIN rooms r     ON u.room_id = r.id
    LEFT JOIN floors f    ON r.floor_id = f.id
    LEFT JOIN buildings b ON f.building_id = b.id
    LEFT JOIN sites s     ON b.site_id = s.id
    WHERE u.id = $1
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

router.get('/units/:id/history', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(`
      SELECT
        wo.id, wo.order_no, wo.type, wo.status,
        wo.started_at, wo.completed_at, wo.approved_at,
        wou.has_repair, wou.repair_notes,
        COUNT(p.id)::int AS photo_count
      FROM work_order_units wou
      JOIN work_orders wo ON wo.id = wou.work_order_id
      LEFT JOIN work_order_photos p ON p.work_order_unit_id = wou.id
      WHERE wou.unit_id = $1
      GROUP BY wo.id, wou.has_repair, wou.repair_notes
      ORDER BY wo.created_at DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/units', authMiddleware, canEdit, async (req, res) => {
  const {
    room_id, asset_code, name, equipment_type, family,
    capacity_btu, refrigerant, status, last_major_clean_date,
  } = req.body;
  if (!asset_code || !equipment_type) {
    return res.status(400).json({ error: 'asset_code, equipment_type required' });
  }
  if (!['ac', 'fan'].includes(equipment_type)) {
    return res.status(400).json({ error: "equipment_type must be 'ac' or 'fan'" });
  }
  try {
    const { rows } = await req.db(`
      INSERT INTO units
        (room_id, asset_code, name, equipment_type, family,
         capacity_btu, refrigerant, status, last_major_clean_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'active'),$9)
      RETURNING *
    `, [
      room_id || null, asset_code, name || null, equipment_type,
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
    const { rows } = await req.db(`
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
  await req.db('DELETE FROM units WHERE id=$1', [req.params.id]);
  res.json({ message: 'deleted' });
});

// ── Inspection template + photo points (GLOBAL, public) ─────────────────────
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

router.get('/photo-points', authMiddleware, async (req, res) => {
  const { equipment_type, work_type } = req.query;
  if (!equipment_type || !work_type) {
    return res.status(400).json({ error: 'equipment_type และ work_type จำเป็น' });
  }
  const { rows } = await pool.query(
    'SELECT point_no, label, required FROM photo_point_templates WHERE equipment_type=$1 AND work_type=$2 ORDER BY point_no',
    [equipment_type, work_type]);
  res.json(rows);
});

// ── Users (per-branch on a subdomain via req.db → <schema>.users; super-admins
// on apex via public.users). A branch's users never interconnect with another's.
const userDb = (req) => (req.branch ? req.db : ((sql, p) => pool.query(sql, p)));
// Role model: Super Dev (super_admin, apex only) vs the 4 branch roles
// (Admin Dep./Approve Dev./Checker Dev./Technician). On apex you can only mint
// Super Devs; branch roles are created inside the branch (เข้าจัดการ → ผู้ใช้งาน).
const BRANCH_ROLES = ['admin', 'approver', 'checker', 'technician'];
const SUPER_ROLES  = ['super_admin'];
const validRolesFor = (req) => (req.branch ? BRANCH_ROLES : SUPER_ROLES);

router.get('/users', authMiddleware, requireRole('admin', 'central_admin', 'super_admin'), async (req, res) => {
  const { rows } = await userDb(req)(
    'SELECT id, name, username, role, phone, active FROM users ORDER BY name');
  res.json(rows);
});

router.post('/users', authMiddleware, requireRole('admin', 'super_admin'), async (req, res) => {
  const { name, username, password, role, phone } = req.body;
  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: 'name, username, password, role required' });
  }
  const valid = validRolesFor(req);
  if (!valid.includes(role)) {
    return res.status(400).json({ error: `role must be one of ${valid.join(', ')}` });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await userDb(req)(
      'INSERT INTO users (name, username, password_hash, role, phone) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, username, role, phone',
      [name, username, hash, role, phone || null]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:id', authMiddleware, requireRole('admin', 'super_admin'), async (req, res) => {
  const { name, role, phone, active, password } = req.body;
  const valid = validRolesFor(req);
  if (role && !valid.includes(role)) {
    return res.status(400).json({ error: `role must be one of ${valid.join(', ')}` });
  }
  const db = userDb(req);
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await db('UPDATE users SET name=$1, role=$2, phone=$3, active=$4, password_hash=$5 WHERE id=$6',
        [name, role, phone || null, active !== false, hash, req.params.id]);
    } else {
      await db('UPDATE users SET name=$1, role=$2, phone=$3, active=$4 WHERE id=$5',
        [name, role, phone || null, active !== false, req.params.id]);
    }
    const { rows } = await db('SELECT id, name, username, role, phone, active FROM users WHERE id=$1', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Unit timeline / stats (PER-BRANCH) ──────────────────────────────────────
router.get('/units/:id/timeline', authMiddleware, async (req, res) => {
  const uid = req.params.id;
  try {
    const [wos, repairs] = await Promise.all([
      req.db(`
        SELECT wo.id, wo.order_no, wo.type, wo.status,
               COALESCE(wo.approved_at, wo.completed_at, wo.created_at) AS date
        FROM work_order_units wou JOIN work_orders wo ON wou.work_order_id = wo.id
        WHERE wou.unit_id = $1`, [uid]),
      req.db(`SELECT id, problem, status, created_at AS date FROM repair_logs WHERE unit_id = $1`, [uid]),
    ]);
    const events = [
      ...wos.rows.map((r) => ({ kind: 'work_order', date: r.date, ...r })),
      ...repairs.rows.map((r) => ({ kind: 'repair', date: r.date, ...r })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(events);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/units/:id/stats', authMiddleware, async (req, res) => {
  const uid = req.params.id;
  try {
    const counts = await req.db(`
      SELECT wo.type, COUNT(*)::int AS n
      FROM work_order_units wou JOIN work_orders wo ON wou.work_order_id = wo.id
      WHERE wou.unit_id = $1 AND wo.status = 'approved'
      GROUP BY wo.type`, [uid]);
    const trend = await req.db(`
      SELECT ti.item_label, ti.unit_label, iv.value_after,
             COALESCE(wo.approved_at, wo.completed_at) AS date
      FROM inspection_values iv
      JOIN work_order_units wou ON iv.work_order_unit_id = wou.id
      JOIN work_orders wo       ON wou.work_order_id = wo.id
      JOIN inspection_template_items ti ON iv.template_item_id = ti.id
      WHERE wou.unit_id = $1 AND wo.status = 'approved'
        AND iv.value_after ~ '^[0-9.]+$' AND ti.value_type IN ('number','before_after')
      ORDER BY date`, [uid]);
    const byType = {};
    for (const r of counts.rows) byType[r.type] = r.n;
    res.json({ counts: byType, trend: trend.rows, parts: [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
