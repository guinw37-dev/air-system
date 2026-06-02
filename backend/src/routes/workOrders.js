const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const dayjs = require('dayjs');

// generate order_no: WO-YYYYMMDD-XXXX
async function genOrderNo() {
  const date = dayjs().format('YYYYMMDD');
  const { rows } = await pool.query(
    "SELECT COUNT(*) FROM work_orders WHERE order_no LIKE $1",
    [`WO-${date}-%`]
  );
  const seq = String(parseInt(rows[0].count) + 1).padStart(4, '0');
  return `WO-${date}-${seq}`;
}

// ── POST /api/work-orders ──────────────────────────────────────────────────
// เปิดใบงานใหม่
// OLD: hospital_id, tech1_id/tech2_id → NEW: client_id, created_by; assignees via work_order_assignees
router.post('/', authMiddleware, async (req, res) => {
  const { client_id, type } = req.body;
  if (!client_id || !type) {
    return res.status(400).json({ error: 'client_id and type required' });
  }
  if (!['major', 'minor', 'fan'].includes(type)) {
    return res.status(400).json({ error: 'type must be major, minor, or fan' });
  }
  try {
    const order_no = await genOrderNo();
    const { rows } = await pool.query(`
      INSERT INTO work_orders (order_no, client_id, type, created_by, status, started_at)
      VALUES ($1, $2, $3, $4, 'in_progress', NOW())
      RETURNING *
    `, [order_no, client_id, type, req.user.id]);

    // Add creator as first assignee
    await pool.query(
      `INSERT INTO work_order_assignees (work_order_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [rows[0].id, req.user.id]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/work-orders ───────────────────────────────────────────────────
// รายการใบงาน (filter by client_id, status, type)
router.get('/', authMiddleware, async (req, res) => {
  // Accept client_id; also accept old hospital_id param for compatibility
  const { client_id, hospital_id, status, type, limit = 50, offset = 0 } = req.query;
  const effectiveClientId = client_id || hospital_id;

  let where = ['1=1'];
  let params = [];
  let i = 1;

  if (effectiveClientId) { where.push(`w.client_id = $${i++}`); params.push(effectiveClientId); }
  if (status)            { where.push(`w.status = $${i++}`);    params.push(status); }
  if (type)              { where.push(`w.type = $${i++}`);       params.push(type); }

  params.push(limit, offset);

  try {
    const { rows } = await pool.query(`
      SELECT w.*,
        c.name client_name,
        COUNT(DISTINCT wou.id) item_count,
        COUNT(DISTINCT p.id)   photo_count
      FROM work_orders w
      LEFT JOIN clients c         ON w.client_id = c.id
      LEFT JOIN work_order_units wou ON wou.work_order_id = w.id
      LEFT JOIN work_order_photos p  ON p.work_order_unit_id = wou.id
      WHERE ${where.join(' AND ')}
      GROUP BY w.id, c.name
      ORDER BY w.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/work-orders/:id ───────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT w.*,
        c.name client_name
      FROM work_orders w
      LEFT JOIN clients c ON w.client_id = c.id
      WHERE w.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    // assignees
    const { rows: assignees } = await pool.query(`
      SELECT u.id, u.name, u.phone FROM work_order_assignees wa
      JOIN users u ON wa.user_id = u.id
      WHERE wa.work_order_id = $1
    `, [req.params.id]);

    // units in this work order
    const { rows: items } = await pool.query(`
      SELECT wou.*,
        u.asset_code, u.name unit_name, u.family, u.capacity_btu,
        r.name room_name, f.name floor_name, b.name building_name
      FROM work_order_units wou
      JOIN units u       ON wou.unit_id = u.id
      LEFT JOIN rooms r  ON u.room_id = r.id
      LEFT JOIN floors f ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      WHERE wou.work_order_id = $1
      ORDER BY wou.id
    `, [req.params.id]);

    // photos per work_order_unit
    const { rows: photos } = await pool.query(`
      SELECT p.* FROM work_order_photos p
      JOIN work_order_units wou ON p.work_order_unit_id = wou.id
      WHERE wou.work_order_id = $1
      ORDER BY p.work_order_unit_id, p.phase, p.point_no
    `, [req.params.id]);

    // signatures
    const { rows: sigs } = await pool.query(`
      SELECT s.*, u.name user_name FROM signatures s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.work_order_id = $1
    `, [req.params.id]);

    res.json({ ...rows[0], assignees, items, photos, signatures: sigs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/work-orders/:id/items ───────────────────────────────────────
// เพิ่มเครื่องในใบงาน  (OLD: ac_unit_id → NEW: unit_id)
router.post('/:id/items', authMiddleware, async (req, res) => {
  const unit_id = req.body.unit_id || req.body.ac_unit_id; // accept both during transition
  if (!unit_id) return res.status(400).json({ error: 'unit_id required' });
  try {
    const { rows } = await pool.query(`
      INSERT INTO work_order_units (work_order_id, unit_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [req.params.id, unit_id]);
    res.status(201).json(rows[0] || { message: 'already exists' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/work-orders/:id/items/:itemId ─────────────────────────────────
// บันทึก has_repair / repair_notes
// NOTE: measurements/checklist JSONB columns are GONE in v2 schema.
//       Per-item readings now live in inspection_values (later phase).
//       We keep has_repair and repair_notes which ARE on work_order_units.
router.put('/:id/items/:itemId', authMiddleware, async (req, res) => {
  const { has_repair, repair_notes } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE work_order_units
      SET has_repair   = $1,
          repair_notes = $2
      WHERE id = $3 AND work_order_id = $4
      RETURNING *
    `, [
      has_repair || false,
      repair_notes || null,
      req.params.itemId,
      req.params.id
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/work-orders/:id/items/:itemId ──────────────────────────────
router.delete('/:id/items/:itemId', authMiddleware, async (req, res) => {
  await pool.query(
    'DELETE FROM work_order_units WHERE id=$1 AND work_order_id=$2',
    [req.params.itemId, req.params.id]
  );
  res.json({ message: 'deleted' });
});

// ── POST /api/work-orders/:id/signatures ──────────────────────────────────
// บันทึกลายเซ็น
// NEW roles: area_owner | central_admin | approver  (OLD: tech/engineering removed)
router.post('/:id/signatures', authMiddleware, async (req, res) => {
  const { role, signature_data, signer_name } = req.body;
  if (!role || !signature_data) {
    return res.status(400).json({ error: 'role and signature_data required' });
  }
  const validRoles = ['area_owner', 'central_admin', 'approver'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
  }
  try {
    const { rows } = await pool.query(`
      INSERT INTO signatures (work_order_id, user_id, role, signer_name, signature_data)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (work_order_id, role)
      DO UPDATE SET signature_data = EXCLUDED.signature_data,
                    signer_name    = EXCLUDED.signer_name,
                    signed_at      = NOW()
      RETURNING *
    `, [req.params.id, req.user.id, role, signer_name || null, signature_data]);

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/work-orders/:id/submit ─────────────────────────────────────
// ช่างส่งงาน → pending_admin (ด่าน 1)
router.patch('/:id/submit', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      UPDATE work_orders
      SET status = 'pending_admin', completed_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'in_progress'
      RETURNING *
    `, [req.params.id]);
    if (!rows.length) return res.status(400).json({ error: 'Cannot submit — check status' });

    // auto-create repair_logs for units with has_repair = true
    const { rows: woRow } = await pool.query('SELECT client_id FROM work_orders WHERE id=$1', [req.params.id]);
    if (woRow.length) {
      await pool.query(`
        INSERT INTO repair_logs (client_id, unit_id, work_order_id, work_order_unit_id, problem, status, reported_by)
        SELECT $1, wou.unit_id, wou.work_order_id, wou.id, wou.repair_notes, 'open', $2
        FROM work_order_units wou
        WHERE wou.work_order_id = $3 AND wou.has_repair = true AND wou.repair_notes IS NOT NULL
        ON CONFLICT DO NOTHING
      `, [woRow[0].client_id, req.user.id, req.params.id]);
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/work-orders/:id/admin-check ────────────────────────────────
// central_admin ตรวจแล้ว → pending_approval (ด่าน 2)
router.patch('/:id/admin-check', authMiddleware, requireRole('central_admin', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      UPDATE work_orders
      SET status = 'pending_approval', admin_checked_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'pending_admin'
      RETURNING *
    `, [req.params.id]);
    if (!rows.length) return res.status(400).json({ error: 'Cannot admin-check — check status' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/work-orders/:id/approve ────────────────────────────────────
// approver อนุมัติ  (OLD role: owner → NEW: approver)
router.patch('/:id/approve', authMiddleware, requireRole('approver', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      UPDATE work_orders
      SET status = 'approved', approver_id = $1,
          approved_at = NOW(), updated_at = NOW()
      WHERE id = $2 AND status = 'pending_approval'
      RETURNING *
    `, [req.user.id, req.params.id]);
    if (!rows.length) return res.status(400).json({ error: 'Cannot approve — check status' });

    // advance PM cycle for each unit in this work order
    const wo = rows[0];
    const { rows: unitRows } = await pool.query(
      'SELECT unit_id FROM work_order_units WHERE work_order_id = $1',
      [req.params.id]
    );
    for (const item of unitRows) {
      const { rows: u } = await pool.query(
        'SELECT pm_cycle_pos FROM units WHERE id = $1',
        [item.unit_id]
      );
      if (u.length) {
        const newPos = ((u[0].pm_cycle_pos ?? 0) + 1) % 3;
        const nextDate = dayjs().add(2, 'month').format('YYYY-MM-DD');
        await pool.query(
          'UPDATE units SET next_pm_date=$1, pm_cycle_pos=$2, updated_at=NOW() WHERE id=$3',
          [nextDate, newPos, item.unit_id]
        );
        await pool.query(`
          INSERT INTO pm_plan (client_id, unit_id, planned_type, scheduled_date, actual_date, work_order_id, status)
          SELECT w.client_id, $1, $2, $3, NOW(), $4, 'done'
          FROM work_orders w WHERE w.id = $4
          ON CONFLICT DO NOTHING
        `, [item.unit_id, wo.type, nextDate, req.params.id]);
      }
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/work-orders/:id/reject ─────────────────────────────────────
router.patch('/:id/reject', authMiddleware, requireRole('approver', 'admin', 'central_admin'), async (req, res) => {
  const { notes } = req.body;
  if (!notes?.trim()) return res.status(400).json({ error: 'กรุณาระบุเหตุผลในการไม่อนุมัติ' });
  try {
    const { rows } = await pool.query(`
      UPDATE work_orders
      SET status = 'rejected', reject_reason = $1, updated_at = NOW()
      WHERE id = $2 AND status IN ('in_progress', 'pending_admin', 'pending_approval')
      RETURNING *
    `, [notes.trim(), req.params.id]);
    if (!rows.length) return res.status(400).json({ error: 'Cannot reject — check status' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/work-orders/:id/resubmit ───────────────────────────────────
// Admin/Technician ส่งงานใหม่หลังแก้ไข (rejected → in_progress)
router.patch('/:id/resubmit', authMiddleware, async (req, res) => {
  if (!['admin', 'technician', 'central_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'เฉพาะ Admin / Technician / Central Admin เท่านั้น' });
  }
  try {
    await pool.query(`DELETE FROM signatures WHERE work_order_id = $1`, [req.params.id]);
    const { rows } = await pool.query(`
      UPDATE work_orders
      SET status = 'in_progress', completed_at = NULL, reject_reason = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'rejected'
      RETURNING *
    `, [req.params.id]);
    if (!rows.length) return res.status(400).json({ error: 'Cannot resubmit — check status' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
