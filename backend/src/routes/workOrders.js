const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db/pool');
const dayjs = require('dayjs');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { checkTransition, HTTP_FOR_CODE, logTransition, isEditable } = require('../services/woStateMachine');

// ── order_no: WO-YYYYMMDD-XXXX ──────────────────────────────────────────────
async function genOrderNo(client) {
  const date = dayjs().format('YYYYMMDD');
  const { rows } = await client.query(
    'SELECT COUNT(*) FROM work_orders WHERE order_no LIKE $1', [`WO-${date}-%`]
  );
  return `WO-${date}-${String(parseInt(rows[0].count, 10) + 1).padStart(4, '0')}`;
}

// Load a WO row or null.
async function getWO(id) {
  const { rows } = await pool.query('SELECT * FROM work_orders WHERE id = $1', [id]);
  return rows[0] || null;
}

// ── POST /api/work-orders ───────────────────────────────────────────────────
// สร้างใบงานใหม่ (draft) แบบ atomic: client_id, site_id, type, assignee_ids[], unit_ids[]
router.post('/', authMiddleware, async (req, res) => {
  const { client_id, site_id, type, assignee_ids = [], unit_ids = [] } = req.body;
  if (!client_id || !type) return res.status(400).json({ error: 'client_id and type required' });
  if (!['major', 'minor', 'fan'].includes(type)) {
    return res.status(400).json({ error: 'type must be major, minor, or fan' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order_no = await genOrderNo(client);
    const { rows } = await client.query(`
      INSERT INTO work_orders (order_no, client_id, site_id, type, created_by, status)
      VALUES ($1, $2, $3, $4, $5, 'draft')
      RETURNING *
    `, [order_no, client_id, site_id || null, type, req.user.id]);
    const wo = rows[0];

    // assignees — always include the creator
    const ids = new Set([req.user.id, ...assignee_ids.map(Number).filter(Boolean)]);
    for (const uid of ids) {
      await client.query(
        'INSERT INTO work_order_assignees (work_order_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [wo.id, uid]
      );
    }
    // units — only those that belong to the same client (tenant guard)
    for (const unitId of unit_ids.map(Number).filter(Boolean)) {
      await client.query(`
        INSERT INTO work_order_units (work_order_id, unit_id)
        SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM units WHERE id=$2 AND client_id=$3)
        ON CONFLICT DO NOTHING
      `, [wo.id, unitId, client_id]);
    }
    await logTransition(client, { workOrderId: wo.id, from: null, to: 'draft', changedBy: req.user.id });
    await client.query('COMMIT');
    res.status(201).json(wo);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── GET /api/work-orders ────────────────────────────────────────────────────
// list — filter by client_id (recommended for tenant scoping) + status/type.
// client_id is OPTIONAL: TW staff serve every client, so dashboards/recent-lists
// legitimately query across clients. When omitted, returns all (provider's own
// data — no cross-tenant leak since users aren't bound to one client).
router.get('/', authMiddleware, async (req, res) => {
  const { client_id, status, type, limit = 50, offset = 0 } = req.query;
  const where = ['1=1'];
  const params = [];
  let i = 1;
  if (client_id) { where.push(`w.client_id = $${i++}`); params.push(client_id); }
  if (status)    { where.push(`w.status = $${i++}`);     params.push(status); }
  if (type)      { where.push(`w.type = $${i++}`);       params.push(type); }
  params.push(limit, offset);
  try {
    const { rows } = await pool.query(`
      SELECT w.*, c.name client_name, s.name site_name,
        COUNT(DISTINCT wou.id) item_count,
        COUNT(DISTINCT p.id)   photo_count
      FROM work_orders w
      LEFT JOIN clients c ON w.client_id = c.id
      LEFT JOIN sites s   ON w.site_id = s.id
      LEFT JOIN work_order_units wou ON wou.work_order_id = w.id
      LEFT JOIN work_order_photos p  ON p.work_order_unit_id = wou.id
      WHERE ${where.join(' AND ')}
      GROUP BY w.id, c.name, s.name
      ORDER BY w.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/work-orders/:id ────────────────────────────────────────────────
// detail + units + inspection_values + photos + signatures
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT w.*, c.name client_name, s.name site_name
      FROM work_orders w
      LEFT JOIN clients c ON w.client_id = c.id
      LEFT JOIN sites s   ON w.site_id = s.id
      WHERE w.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const { rows: assignees } = await pool.query(`
      SELECT u.id, u.name, u.phone, u.role FROM work_order_assignees wa
      JOIN users u ON wa.user_id = u.id WHERE wa.work_order_id = $1
    `, [req.params.id]);

    const { rows: items } = await pool.query(`
      SELECT wou.*, u.asset_code, u.name unit_name, u.family, u.capacity_btu,
        u.equipment_type, r.name room_name, f.name floor_name, b.name building_name
      FROM work_order_units wou
      JOIN units u        ON wou.unit_id = u.id
      LEFT JOIN rooms r   ON u.room_id = r.id
      LEFT JOIN floors f  ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      WHERE wou.work_order_id = $1 ORDER BY wou.id
    `, [req.params.id]);

    const { rows: inspections } = await pool.query(`
      SELECT iv.* FROM inspection_values iv
      JOIN work_order_units wou ON iv.work_order_unit_id = wou.id
      WHERE wou.work_order_id = $1
    `, [req.params.id]);

    const { rows: photos } = await pool.query(`
      SELECT p.* FROM work_order_photos p
      JOIN work_order_units wou ON p.work_order_unit_id = wou.id
      WHERE wou.work_order_id = $1
      ORDER BY p.work_order_unit_id, p.phase, p.point_no
    `, [req.params.id]);

    const { rows: sigs } = await pool.query(`
      SELECT s.*, u.name user_name FROM signatures s
      LEFT JOIN users u ON s.user_id = u.id WHERE s.work_order_id = $1
    `, [req.params.id]);

    res.json({ ...rows[0], assignees, items, inspections, photos, signatures: sigs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/work-orders/:id/history ────────────────────────────────────────
router.get('/:id/history', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT h.*, u.name changed_by_name FROM work_order_status_history h
    LEFT JOIN users u ON h.changed_by = u.id
    WHERE h.work_order_id = $1 ORDER BY h.changed_at
  `, [req.params.id]);
  res.json(rows);
});

// ── PUT /api/work-orders/:id/units ──────────────────────────────────────────
// เพิ่ม/ลดเครื่อง — เฉพาะตอนยังแก้ได้ (draft/in_progress/rejected) ก่อนปิดงาน
router.put('/:id/units', authMiddleware, async (req, res) => {
  const { unit_ids = [] } = req.body;
  if (!Array.isArray(unit_ids)) return res.status(400).json({ error: 'unit_ids must be an array' });
  const wo = await getWO(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  if (!isEditable(wo.status)) return res.status(409).json({ error: 'ใบงานปิด/อยู่ระหว่างอนุมัติ แก้รายการเครื่องไม่ได้' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wanted = new Set(unit_ids.map(Number).filter(Boolean));
    const { rows: existing } = await client.query(
      'SELECT id, unit_id FROM work_order_units WHERE work_order_id = $1', [req.params.id]
    );
    const have = new Set(existing.map(r => r.unit_id));
    // add new (tenant-guarded)
    for (const unitId of wanted) {
      if (!have.has(unitId)) {
        await client.query(`
          INSERT INTO work_order_units (work_order_id, unit_id)
          SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM units WHERE id=$2 AND client_id=$3)
          ON CONFLICT DO NOTHING
        `, [req.params.id, unitId, wo.client_id]);
      }
    }
    // remove dropped (cascades inspection_values + photos via FK)
    for (const row of existing) {
      if (!wanted.has(row.unit_id)) {
        await client.query('DELETE FROM work_order_units WHERE id = $1', [row.id]);
      }
    }
    await client.query('COMMIT');
    const { rows } = await pool.query('SELECT * FROM work_order_units WHERE work_order_id = $1 ORDER BY id', [req.params.id]);
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── PUT /api/work-orders/:id/inspection ─────────────────────────────────────
// บันทึก inspection_values ต่อ unit. body: { work_order_unit_id, values: [...],
//   has_repair?, repair_notes? }  values[]: { template_item_id, value_before,
//   value_after, checked, note }
router.put('/:id/inspection', authMiddleware, async (req, res) => {
  const { work_order_unit_id, values = [], has_repair, repair_notes } = req.body;
  if (!work_order_unit_id) return res.status(400).json({ error: 'work_order_unit_id required' });
  const wo = await getWO(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  if (!isEditable(wo.status)) return res.status(409).json({ error: 'ใบงานปิด/อยู่ระหว่างอนุมัติ แก้ค่าตรวจไม่ได้' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // guard: the work_order_unit belongs to this WO
    const { rows: chk } = await client.query(
      'SELECT id FROM work_order_units WHERE id = $1 AND work_order_id = $2',
      [work_order_unit_id, req.params.id]
    );
    if (!chk.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'work_order_unit not in this WO' }); }

    for (const v of values) {
      if (!v.template_item_id) continue;
      await client.query(`
        INSERT INTO inspection_values
          (work_order_unit_id, template_item_id, value_before, value_after, checked, note)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (work_order_unit_id, template_item_id) DO UPDATE SET
          value_before = EXCLUDED.value_before,
          value_after  = EXCLUDED.value_after,
          checked      = EXCLUDED.checked,
          note         = EXCLUDED.note
      `, [work_order_unit_id, v.template_item_id, v.value_before ?? null,
          v.value_after ?? null, v.checked ?? null, v.note ?? null]);
    }
    if (has_repair !== undefined || repair_notes !== undefined) {
      await client.query(
        'UPDATE work_order_units SET has_repair = COALESCE($1, has_repair), repair_notes = COALESCE($2, repair_notes) WHERE id = $3',
        [has_repair ?? null, repair_notes ?? null, work_order_unit_id]
      );
    }
    // auto-advance draft → in_progress on first inspection write
    if (wo.status === 'draft') {
      const t = checkTransition('draft', 'in_progress', req.user.role);
      if (t.ok) {
        await client.query("UPDATE work_orders SET status='in_progress', started_at=NOW(), updated_at=NOW() WHERE id=$1", [req.params.id]);
        await logTransition(client, { workOrderId: req.params.id, from: 'draft', to: 'in_progress', changedBy: req.user.id });
      }
    }
    await client.query('COMMIT');
    const { rows } = await pool.query('SELECT * FROM inspection_values WHERE work_order_unit_id = $1', [work_order_unit_id]);
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── PATCH /api/work-orders/:id/start ────────────────────────────────────────
// draft → in_progress (explicit)
router.patch('/:id/start', authMiddleware, async (req, res) => {
  const wo = await getWO(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  const t = checkTransition(wo.status, 'in_progress', req.user.role);
  if (!t.ok) return res.status(HTTP_FOR_CODE[t.code]).json({ error: t.error });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "UPDATE work_orders SET status='in_progress', started_at=COALESCE(started_at,NOW()), updated_at=NOW() WHERE id=$1 RETURNING *",
      [req.params.id]
    );
    await logTransition(client, { workOrderId: req.params.id, from: wo.status, to: 'in_progress', changedBy: req.user.id });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── POST /api/work-orders/:id/submit ────────────────────────────────────────
// in_progress → pending_admin. กฎรูปบังคับ: ทุก unit ต้องมี ≥1 before + ≥1 after
router.post('/:id/submit', authMiddleware, async (req, res) => {
  const wo = await getWO(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  const t = checkTransition(wo.status, 'pending_admin', req.user.role);
  if (!t.ok) return res.status(HTTP_FOR_CODE[t.code]).json({ error: t.error });

  // photo gate
  const { rows: missing } = await pool.query(`
    SELECT wou.id, u.asset_code
    FROM work_order_units wou
    JOIN units u ON wou.unit_id = u.id
    WHERE wou.work_order_id = $1
      AND ( (SELECT COUNT(*) FROM work_order_photos p WHERE p.work_order_unit_id = wou.id AND p.phase='before') = 0
         OR (SELECT COUNT(*) FROM work_order_photos p WHERE p.work_order_unit_id = wou.id AND p.phase='after')  = 0 )
  `, [req.params.id]);
  if (missing.length) {
    return res.status(400).json({
      error: 'มีเครื่องที่ยังถ่ายรูปไม่ครบ (ต้องมีรูปก่อน + หลัง อย่างน้อยอย่างละ 1)',
      missing_units: missing.map(m => m.asset_code),
    });
  }
  const { rows: anyUnit } = await pool.query('SELECT 1 FROM work_order_units WHERE work_order_id=$1 LIMIT 1', [req.params.id]);
  if (!anyUnit.length) return res.status(400).json({ error: 'ใบงานยังไม่มีเครื่อง' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "UPDATE work_orders SET status='pending_admin', completed_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *",
      [req.params.id]
    );
    // NOTE: repair logging is now an explicit "ขอเปิด" action (POST
    // /:id/repair-request), not an auto-side-effect of submit. The main repair
    // workflow lives in the separate repair-report system.
    await logTransition(client, { workOrderId: req.params.id, from: wo.status, to: 'pending_admin', changedBy: req.user.id });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── POST /api/work-orders/:id/admin-approve ─────────────────────────────────
// pending_admin → pending_approval (central_admin)
router.post('/:id/admin-approve', authMiddleware, requireRole('central_admin', 'admin'), async (req, res) => {
  const wo = await getWO(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  const t = checkTransition(wo.status, 'pending_approval', req.user.role);
  if (!t.ok) return res.status(HTTP_FOR_CODE[t.code]).json({ error: t.error });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "UPDATE work_orders SET status='pending_approval', admin_checked_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *",
      [req.params.id]
    );
    await logTransition(client, { workOrderId: req.params.id, from: wo.status, to: 'pending_approval', changedBy: req.user.id });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── POST /api/work-orders/:id/final-approve ─────────────────────────────────
// pending_approval → approved (approver) + advance PM cycle per unit
router.post('/:id/final-approve', authMiddleware, requireRole('approver', 'admin'), async (req, res) => {
  const wo = await getWO(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  const t = checkTransition(wo.status, 'approved', req.user.role);
  if (!t.ok) return res.status(HTTP_FOR_CODE[t.code]).json({ error: t.error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "UPDATE work_orders SET status='approved', approver_id=$1, approved_at=NOW(), updated_at=NOW() WHERE id=$2 RETURNING *",
      [req.user.id, req.params.id]
    );
    await advancePmCycle(client, req.params.id, wo.type);
    await logTransition(client, { workOrderId: req.params.id, from: wo.status, to: 'approved', changedBy: req.user.id });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// PM cycle (spec §6). Runs inside the approve transaction.
async function advancePmCycle(client, woId, type) {
  const { rows: units } = await client.query(
    'SELECT u.id, u.last_major_clean_date, u.pm_cycle_pos FROM work_order_units wou JOIN units u ON wou.unit_id=u.id WHERE wou.work_order_id=$1',
    [woId]
  );
  const today = dayjs();
  for (const u of units) {
    let lastMajor = u.last_major_clean_date;
    let pos = u.pm_cycle_pos ?? 0;
    let next;
    if (type === 'major') {
      lastMajor = today.format('YYYY-MM-DD');
      pos = 0;
      next = today.add(2, 'month').format('YYYY-MM-DD');
    } else if (type === 'minor') {
      const base = lastMajor ? dayjs(lastMajor) : today;
      next = base.add((pos + 1) * 2, 'month').format('YYYY-MM-DD');
      pos = pos + 1;
      if (pos >= 2) {                               // minors done → next is the major
        next = base.add(6, 'month').format('YYYY-MM-DD');
      }
    } else {                                        // fan — simple 2-month interval
      next = today.add(2, 'month').format('YYYY-MM-DD');
    }
    await client.query(
      'UPDATE units SET last_major_clean_date=$1, next_pm_date=$2, pm_cycle_pos=$3, updated_at=NOW() WHERE id=$4',
      [lastMajor, next, pos, u.id]
    );
    await client.query(`
      INSERT INTO pm_plan (client_id, unit_id, planned_type, scheduled_date, actual_date, work_order_id, status)
      SELECT w.client_id, $1, $2, $3, NOW(), $4, 'done' FROM work_orders w WHERE w.id=$4
      ON CONFLICT DO NOTHING
    `, [u.id, type, next, woId]);
  }
}

// ── POST /api/work-orders/:id/reject ────────────────────────────────────────
router.post('/:id/reject', authMiddleware, requireRole('central_admin', 'approver', 'admin'), async (req, res) => {
  const { reason } = req.body;
  const wo = await getWO(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  const t = checkTransition(wo.status, 'rejected', req.user.role, { reason });
  if (!t.ok) return res.status(HTTP_FOR_CODE[t.code]).json({ error: t.error });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "UPDATE work_orders SET status='rejected', reject_reason=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [reason.trim(), req.params.id]
    );
    await logTransition(client, { workOrderId: req.params.id, from: wo.status, to: 'rejected', changedBy: req.user.id, reason: reason.trim() });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── POST /api/work-orders/:id/resubmit ──────────────────────────────────────
// rejected → in_progress (ช่างแก้แล้วส่งใหม่) — clears reject_reason + signatures
router.post('/:id/resubmit', authMiddleware, async (req, res) => {
  const wo = await getWO(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  const t = checkTransition(wo.status, 'in_progress', req.user.role);
  if (!t.ok) return res.status(HTTP_FOR_CODE[t.code]).json({ error: t.error });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM signatures WHERE work_order_id = $1', [req.params.id]);
    const { rows } = await client.query(
      "UPDATE work_orders SET status='in_progress', completed_at=NULL, reject_reason=NULL, updated_at=NOW() WHERE id=$1 RETURNING *",
      [req.params.id]
    );
    await logTransition(client, { workOrderId: req.params.id, from: 'rejected', to: 'in_progress', changedBy: req.user.id });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── POST /api/work-orders/:id/repair-request ────────────────────────────────
// "ขอเปิด" — raise an open repair request for a unit when an abnormal condition
// is found on-site. Creates a repair_logs row (status 'open'). This is the AC
// path into the separate repair-report workflow; it is explicit (a button),
// not a side-effect of submitting the work order.
router.post('/:id/repair-request', authMiddleware, async (req, res) => {
  const { work_order_unit_id, problem } = req.body;
  if (!work_order_unit_id || !problem?.trim()) {
    return res.status(400).json({ error: 'work_order_unit_id และ problem จำเป็น' });
  }
  const wo = await getWO(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  try {
    // guard: the unit belongs to this WO + fetch unit_id
    const { rows: chk } = await pool.query(
      'SELECT unit_id FROM work_order_units WHERE id=$1 AND work_order_id=$2',
      [work_order_unit_id, req.params.id]
    );
    if (!chk.length) return res.status(404).json({ error: 'work_order_unit not in this WO' });
    const { rows } = await pool.query(`
      INSERT INTO repair_logs
        (client_id, unit_id, work_order_id, work_order_unit_id, problem, status, reported_by)
      VALUES ($1, $2, $3, $4, $5, 'open', $6)
      RETURNING *
    `, [wo.client_id, chk[0].unit_id, req.params.id, work_order_unit_id, problem.trim(), req.user.id]);
    // mark the unit row as flagged (kept for the WO summary view)
    await pool.query('UPDATE work_order_units SET has_repair = true WHERE id = $1', [work_order_unit_id]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Signatures ──────────────────────────────────────────────────────────────
// POST /api/work-orders/:id/signatures — role area_owner|central_admin|approver
router.post('/:id/signatures', authMiddleware, async (req, res) => {
  const { role, signature_data, signer_name } = req.body;
  const valid = ['area_owner', 'central_admin', 'approver'];
  if (!role || !signature_data) return res.status(400).json({ error: 'role and signature_data required' });
  if (!valid.includes(role)) return res.status(400).json({ error: `role must be one of: ${valid.join(', ')}` });
  const wo = await getWO(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  if (wo.status === 'approved') return res.status(409).json({ error: 'ใบงานปิดแล้ว แก้ลายเซ็นไม่ได้' });
  try {
    const { rows } = await pool.query(`
      INSERT INTO signatures (work_order_id, user_id, role, signer_name, signature_data)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (work_order_id, role)
      DO UPDATE SET signature_data=EXCLUDED.signature_data, signer_name=EXCLUDED.signer_name, signed_at=NOW()
      RETURNING *
    `, [req.params.id, req.user.id, role, signer_name || null, signature_data]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Photos (nested under work order) ────────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, 'photos', String(req.body.work_order_unit_id || 'misc'));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${req.body.phase}_${req.body.point_no || 1}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only')),
});

// POST /api/work-orders/:id/photos — concurrent-safe (always append)
router.post('/:id/photos', authMiddleware, upload.single('photo'), async (req, res) => {
  let { work_order_unit_id, phase, point_no, label, client_token } = req.body;
  if (!work_order_unit_id || !phase || !req.file) {
    return res.status(400).json({ error: 'work_order_unit_id, phase, and photo required' });
  }
  if (phase === 'during') phase = 'measurement';
  if (!['before', 'after', 'measurement'].includes(phase)) {
    return res.status(400).json({ error: 'phase must be before, after, or measurement' });
  }
  const wo = await getWO(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  if (!isEditable(wo.status)) return res.status(409).json({ error: 'ใบงานปิด/อยู่ระหว่างอนุมัติ เพิ่มรูปไม่ได้' });
  try {
    // idempotency: an offline re-sync with the same client_token returns the
    // already-stored row instead of inserting a duplicate.
    if (client_token) {
      const { rows: dup } = await pool.query(
        'SELECT * FROM work_order_photos WHERE client_token = $1', [client_token]
      );
      if (dup.length) {
        fs.unlink(req.file.path, () => {}); // discard the redundant upload
        return res.status(200).json(dup[0]);
      }
    }
    // guard: unit belongs to this WO + fetch its unit_id
    const { rows: chk } = await pool.query(
      'SELECT unit_id FROM work_order_units WHERE id=$1 AND work_order_id=$2',
      [work_order_unit_id, req.params.id]
    );
    if (!chk.length) return res.status(404).json({ error: 'work_order_unit not in this WO' });
    const url = `/uploads/photos/${work_order_unit_id}/${req.file.filename}`;
    const { rows } = await pool.query(`
      INSERT INTO work_order_photos (work_order_unit_id, unit_id, uploaded_by, phase, point_no, label, url, filename, client_token)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (client_token) DO NOTHING
      RETURNING *
    `, [work_order_unit_id, chk[0].unit_id, req.user.id, phase, parseInt(point_no || 1, 10), label || null, url, req.file.filename, client_token || null]);
    // ON CONFLICT race: another concurrent sync won — fetch the winner
    if (!rows.length && client_token) {
      const { rows: won } = await pool.query('SELECT * FROM work_order_photos WHERE client_token = $1', [client_token]);
      return res.status(200).json(won[0]);
    }
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/work-orders/:id/photos — grouped by work_order_unit_id
router.get('/:id/photos', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT p.* FROM work_order_photos p
    JOIN work_order_units wou ON p.work_order_unit_id = wou.id
    WHERE wou.work_order_id = $1 ORDER BY p.work_order_unit_id, p.phase, p.point_no
  `, [req.params.id]);
  const grouped = {};
  for (const p of rows) (grouped[p.work_order_unit_id] ||= []).push(p);
  res.json(grouped);
});

// DELETE /api/work-orders/:id/photos/:photoId — only before submit (editable)
router.delete('/:id/photos/:photoId', authMiddleware, async (req, res) => {
  const wo = await getWO(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  if (!isEditable(wo.status)) return res.status(409).json({ error: 'ใบงานปิด/อยู่ระหว่างอนุมัติ ลบรูปไม่ได้' });
  const { rows } = await pool.query(`
    DELETE FROM work_order_photos p
    USING work_order_units wou
    WHERE p.id = $1 AND p.work_order_unit_id = wou.id AND wou.work_order_id = $2
    RETURNING p.url
  `, [req.params.photoId, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  fs.unlink(path.join(UPLOAD_DIR, rows[0].url.replace('/uploads/', '')), () => {});
  res.json({ message: 'deleted' });
});

module.exports = router;
