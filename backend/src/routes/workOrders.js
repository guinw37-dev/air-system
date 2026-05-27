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
router.post('/', authMiddleware, async (req, res) => {
  const { hospital_id, type, tech1_id, tech2_id } = req.body;
  if (!hospital_id || !type) {
    return res.status(400).json({ error: 'hospital_id and type required' });
  }
  if (!['major', 'minor', 'fan'].includes(type)) {
    return res.status(400).json({ error: 'type must be major, minor, or fan' });
  }
  try {
    const order_no = await genOrderNo();
    const { rows } = await pool.query(`
      INSERT INTO work_orders (order_no, hospital_id, type, tech1_id, tech2_id, status, started_at)
      VALUES ($1, $2, $3, $4, $5, 'in_progress', NOW())
      RETURNING *
    `, [order_no, hospital_id, type, tech1_id || req.user.id, tech2_id || null]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/work-orders ───────────────────────────────────────────────────
// รายการใบงาน (filter by hospital_id, status, type)
router.get('/', authMiddleware, async (req, res) => {
  const { hospital_id, status, type, limit = 50, offset = 0 } = req.query;
  let where = ['1=1'];
  let params = [];
  let i = 1;

  if (hospital_id) { where.push(`w.hospital_id = $${i++}`); params.push(hospital_id); }
  if (status)      { where.push(`w.status = $${i++}`);      params.push(status); }
  if (type)        { where.push(`w.type = $${i++}`);         params.push(type); }

  params.push(limit, offset);

  const { rows } = await pool.query(`
    SELECT w.*,
      h.name hospital_name,
      t1.name tech1_name,
      t2.name tech2_name,
      o.name  owner_name,
      COUNT(DISTINCT wi.id) item_count,
      COUNT(DISTINCT p.id)  photo_count
    FROM work_orders w
    LEFT JOIN hospitals h  ON w.hospital_id = h.id
    LEFT JOIN users t1     ON w.tech1_id = t1.id
    LEFT JOIN users t2     ON w.tech2_id = t2.id
    LEFT JOIN users o      ON w.owner_id  = o.id
    LEFT JOIN work_order_items wi ON wi.work_order_id = w.id
    LEFT JOIN ac_photos p  ON p.work_order_item_id = wi.id
    WHERE ${where.join(' AND ')}
    GROUP BY w.id, h.name, t1.name, t2.name, o.name
    ORDER BY w.created_at DESC
    LIMIT $${i++} OFFSET $${i++}
  `, params);
  res.json(rows);
});

// ── GET /api/work-orders/:id ───────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT w.*,
      h.name hospital_name,
      t1.name tech1_name, t1.phone tech1_phone,
      t2.name tech2_name, t2.phone tech2_phone,
      o.name  owner_name
    FROM work_orders w
    LEFT JOIN hospitals h ON w.hospital_id = h.id
    LEFT JOIN users t1    ON w.tech1_id = t1.id
    LEFT JOIN users t2    ON w.tech2_id = t2.id
    LEFT JOIN users o     ON w.owner_id  = o.id
    WHERE w.id = $1
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });

  // items
  const { rows: items } = await pool.query(`
    SELECT wi.*,
      a.ac_code, a.name ac_name, a.type ac_type, a.capacity_btu,
      d.name dept_name, f.name floor_name, b.name building_name
    FROM work_order_items wi
    JOIN ac_units a     ON wi.ac_unit_id = a.id
    JOIN departments d  ON a.department_id = d.id
    JOIN floors f       ON d.floor_id = f.id
    JOIN buildings b    ON f.building_id = b.id
    WHERE wi.work_order_id = $1
    ORDER BY wi.id
  `, [req.params.id]);

  // photos per item
  const { rows: photos } = await pool.query(`
    SELECT p.* FROM ac_photos p
    JOIN work_order_items wi ON p.work_order_item_id = wi.id
    WHERE wi.work_order_id = $1
    ORDER BY p.work_order_item_id, p.phase, p.point_no
  `, [req.params.id]);

  // signatures
  const { rows: sigs } = await pool.query(`
    SELECT s.*, u.name user_name FROM signatures s
    LEFT JOIN users u ON s.user_id = u.id
    WHERE s.work_order_id = $1
  `, [req.params.id]);

  res.json({ ...rows[0], items, photos, signatures: sigs });
});

// ── POST /api/work-orders/:id/items ───────────────────────────────────────
// เพิ่มแอร์ในใบงาน
router.post('/:id/items', authMiddleware, async (req, res) => {
  const { ac_unit_id } = req.body;
  if (!ac_unit_id) return res.status(400).json({ error: 'ac_unit_id required' });
  try {
    const { rows } = await pool.query(`
      INSERT INTO work_order_items (work_order_id, ac_unit_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [req.params.id, ac_unit_id]);
    res.status(201).json(rows[0] || { message: 'already exists' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/work-orders/:id/items/:itemId ─────────────────────────────────
// บันทึกค่าวัด + checklist + แจ้งซ่อม
router.put('/:id/items/:itemId', authMiddleware, async (req, res) => {
  const { measurements, checklist, has_repair, repair_notes } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE work_order_items
      SET measurements = $1,
          checklist    = $2,
          has_repair   = $3,
          repair_notes = $4,
          updated_at   = NOW()
      WHERE id = $5 AND work_order_id = $6
      RETURNING *
    `, [
      JSON.stringify(measurements || {}),
      JSON.stringify(checklist || {}),
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
    'DELETE FROM work_order_items WHERE id=$1 AND work_order_id=$2',
    [req.params.itemId, req.params.id]
  );
  res.json({ message: 'deleted' });
});

// ── POST /api/work-orders/:id/signatures ──────────────────────────────────
// บันทึกลายเซ็น (tech / area_owner / engineering)
router.post('/:id/signatures', authMiddleware, async (req, res) => {
  const { role, signature_data } = req.body;
  if (!role || !signature_data) {
    return res.status(400).json({ error: 'role and signature_data required' });
  }
  if (!['tech', 'area_owner', 'engineering'].includes(role)) {
    return res.status(400).json({ error: 'role must be tech, area_owner, or engineering' });
  }
  try {
    // upsert signature by role
    const { rows } = await pool.query(`
      INSERT INTO signatures (work_order_id, user_id, role, signature_data)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (work_order_id, role)
      DO UPDATE SET signature_data = EXCLUDED.signature_data, signed_at = NOW()
      RETURNING *
    `, [req.params.id, req.user.id, role, signature_data]);

    // Check if all 3 roles signed → auto-submit (in_progress → pending_approval)
    const { rows: sigs } = await pool.query(
      `SELECT role FROM signatures WHERE work_order_id = $1`,
      [req.params.id]
    );
    const signedRoles = new Set(sigs.map((s) => s.role));
    const allSigned = ['tech', 'area_owner', 'engineering'].every((r) => signedRoles.has(r));

    let autoSubmitted = false;
    if (allSigned) {
      const { rowCount } = await pool.query(`
        UPDATE work_orders
        SET status = 'pending_approval', completed_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'in_progress'
      `, [req.params.id]);

      if (rowCount > 0) {
        autoSubmitted = true;
        // auto-create repair_logs for items with has_repair = true
        await pool.query(`
          INSERT INTO repair_logs (ac_unit_id, work_order_id, work_order_item_id, problem, status, reported_by)
          SELECT wi.ac_unit_id, wi.work_order_id, wi.id, wi.repair_notes, 'open', $1
          FROM work_order_items wi
          WHERE wi.work_order_id = $2 AND wi.has_repair = true
          ON CONFLICT DO NOTHING
        `, [req.user.id, req.params.id]);
      }
    }

    res.status(201).json({ ...rows[0], auto_submitted: autoSubmitted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/work-orders/:id/submit ─────────────────────────────────────
// ช่างส่งงาน → pending_approval
router.patch('/:id/submit', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      UPDATE work_orders
      SET status = 'pending_approval', completed_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'in_progress'
      RETURNING *
    `, [req.params.id]);
    if (!rows.length) return res.status(400).json({ error: 'Cannot submit — check status' });

    // auto-create repair_logs for items with has_repair = true
    await pool.query(`
      INSERT INTO repair_logs (ac_unit_id, work_order_id, work_order_item_id, problem, status, reported_by)
      SELECT wi.ac_unit_id, wi.work_order_id, wi.id, wi.repair_notes, 'open', $1
      FROM work_order_items wi
      WHERE wi.work_order_id = $2 AND wi.has_repair = true
      ON CONFLICT DO NOTHING
    `, [req.user.id, req.params.id]);

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/work-orders/:id/approve ────────────────────────────────────
// Owner อนุมัติ
router.patch('/:id/approve', authMiddleware, requireRole('owner', 'admin'), async (req, res) => {
  const { notes } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE work_orders
      SET status = 'approved', owner_id = $1, owner_notes = $2,
          approved_at = NOW(), updated_at = NOW()
      WHERE id = $3 AND status = 'pending_approval'
      RETURNING *
    `, [req.user.id, notes || null, req.params.id]);
    if (!rows.length) return res.status(400).json({ error: 'Cannot approve — check status' });

    // auto reschedule PM for each AC unit in this order
    const wo = rows[0];
    const { rows: items } = await pool.query(
      'SELECT ac_unit_id FROM work_order_items WHERE work_order_id = $1',
      [req.params.id]
    );
    for (const item of items) {
      const { rows: ac } = await pool.query(
        'SELECT pm_cycle_pos FROM ac_units WHERE id = $1',
        [item.ac_unit_id]
      );
      if (ac.length) {
        const oldPos = ac[0].pm_cycle_pos ?? 0;
        const newPos = (oldPos + 1) % 3;
        const nextDate = dayjs().add(2, 'month').format('YYYY-MM-DD');
        await pool.query(
          'UPDATE ac_units SET next_pm_date=$1, pm_cycle_pos=$2, updated_at=NOW() WHERE id=$3',
          [nextDate, newPos, item.ac_unit_id]
        );
        await pool.query(`
          INSERT INTO pm_plan (ac_unit_id, planned_type, scheduled_date, actual_date, work_order_id, status)
          VALUES ($1, $2, $3, NOW(), $4, 'done')
          ON CONFLICT DO NOTHING
        `, [item.ac_unit_id, wo.type, nextDate, req.params.id]);
      }
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/work-orders/:id/reject ─────────────────────────────────────
router.patch('/:id/reject', authMiddleware, requireRole('owner', 'admin'), async (req, res) => {
  const { notes } = req.body;
  if (!notes?.trim()) return res.status(400).json({ error: 'กรุณาระบุเหตุผลในการไม่อนุมัติ' });
  const { rows } = await pool.query(`
    UPDATE work_orders
    SET status = 'rejected', owner_id = $1, owner_notes = $2, updated_at = NOW()
    WHERE id = $3 AND status = 'pending_approval'
    RETURNING *
  `, [req.user.id, notes.trim(), req.params.id]);
  if (!rows.length) return res.status(400).json({ error: 'Cannot reject — check status' });
  res.json(rows[0]);
});

// ── PATCH /api/work-orders/:id/resubmit ───────────────────────────────────
// Admin/Technician ส่งงานใหม่หลังแก้ไข (rejected → in_progress)
router.patch('/:id/resubmit', authMiddleware, async (req, res) => {
  if (!['admin', 'technician'].includes(req.user.role)) {
    return res.status(403).json({ error: 'เฉพาะ Admin / Technician เท่านั้น' });
  }
  try {
    // ลบ signatures เก่าออกเพื่อให้เซ็นใหม่
    await pool.query(`DELETE FROM signatures WHERE work_order_id = $1`, [req.params.id]);
    const { rows } = await pool.query(`
      UPDATE work_orders
      SET status = 'in_progress', completed_at = NULL, updated_at = NOW()
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
