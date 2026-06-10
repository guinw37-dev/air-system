const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { requireWoRole } = require('../middleware/woAccess');
const { checkTransition, HTTP_FOR_CODE, logTransition, isEditable } = require('../services/woStateMachine');
const { notifyTransition } = require('../services/notify');

// Schema-per-tenant: work_orders + children live in the request's branch schema,
// reached via req.db (reads) / req.tx (transactions). No client_id columns.

// ── order_no: WO-YYYYMMDD-XXXX (unique within the branch) ───────────────────
async function genOrderNo(client) {
  const date = dayjs().format('YYYYMMDD');
  const { rows } = await client.query(
    'SELECT COUNT(*) FROM work_orders WHERE order_no LIKE $1', [`WO-${date}-%`]
  );
  return `WO-${date}-${String(parseInt(rows[0].count, 10) + 1).padStart(4, '0')}`;
}

// Load a WO row or null (within the branch schema).
async function getWO(db, id) {
  const { rows } = await db('SELECT * FROM work_orders WHERE id = $1', [id]);
  return rows[0] || null;
}

// ── POST /api/work-orders — create a draft (atomic) ─────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const { site_id, type, assignee_ids = [], unit_ids = [] } = req.body;
  if (!type) return res.status(400).json({ error: 'type required' });
  if (!['major', 'minor', 'fan'].includes(type)) {
    return res.status(400).json({ error: 'type must be major, minor, or fan' });
  }
  const client = await req.tx();
  try {
    await client.query('BEGIN');
    const order_no = await genOrderNo(client);
    const { rows } = await client.query(`
      INSERT INTO work_orders (order_no, site_id, type, created_by, status)
      VALUES ($1, $2, $3, $4, 'draft')
      RETURNING *
    `, [order_no, site_id || null, type, req.user.id]);
    const wo = rows[0];

    const ids = new Set([req.user.id, ...assignee_ids.map(Number).filter(Boolean)]);
    for (const uid of ids) {
      await client.query(
        'INSERT INTO work_order_assignees (work_order_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [wo.id, uid]
      );
    }
    // units — only those that exist in this branch schema
    for (const unitId of unit_ids.map(Number).filter(Boolean)) {
      await client.query(`
        INSERT INTO work_order_units (work_order_id, unit_id)
        SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM units WHERE id=$2)
        ON CONFLICT DO NOTHING
      `, [wo.id, unitId]);
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

// ── GET /api/work-orders — list (status/type; technicians see only theirs) ──
router.get('/', authMiddleware, async (req, res) => {
  const { status, type, limit = 50, offset = 0 } = req.query;
  const where = ['1=1'];
  const params = [];
  let i = 1;
  if (status) { where.push(`w.status = $${i++}`); params.push(status); }
  if (type)   { where.push(`w.type = $${i++}`);   params.push(type); }
  if (req.user.role === 'technician') {
    where.push(`EXISTS (SELECT 1 FROM work_order_assignees wa WHERE wa.work_order_id = w.id AND wa.user_id = $${i++})`);
    params.push(req.user.id);
  }
  params.push(limit, offset);
  try {
    const { rows } = await req.db(`
      SELECT w.*, s.name site_name,
        COUNT(DISTINCT wou.id) item_count,
        COUNT(DISTINCT p.id)   photo_count
      FROM work_orders w
      LEFT JOIN sites s   ON w.site_id = s.id
      LEFT JOIN work_order_units wou ON wou.work_order_id = w.id
      LEFT JOIN work_order_photos p  ON p.work_order_unit_id = wou.id
      WHERE ${where.join(' AND ')}
      GROUP BY w.id, s.name
      ORDER BY w.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/work-orders/:id — detail + children ────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(`
      SELECT w.*, s.name site_name
      FROM work_orders w
      LEFT JOIN sites s   ON w.site_id = s.id
      WHERE w.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    const { rows: assignees } = await req.db(`
      SELECT u.id, u.name, u.phone, u.role FROM work_order_assignees wa
      JOIN users u ON wa.user_id = u.id WHERE wa.work_order_id = $1
    `, [req.params.id]);

    const { rows: items } = await req.db(`
      SELECT wou.*, u.asset_code, u.name unit_name, u.family, u.capacity_btu,
        u.equipment_type, r.name room_name, f.name floor_name, b.name building_name
      FROM work_order_units wou
      JOIN units u        ON wou.unit_id = u.id
      LEFT JOIN rooms r   ON u.room_id = r.id
      LEFT JOIN floors f  ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      WHERE wou.work_order_id = $1 ORDER BY wou.id
    `, [req.params.id]);

    const { rows: inspections } = await req.db(`
      SELECT iv.* FROM inspection_values iv
      JOIN work_order_units wou ON iv.work_order_unit_id = wou.id
      WHERE wou.work_order_id = $1
    `, [req.params.id]);

    const { rows: photos } = await req.db(`
      SELECT p.* FROM work_order_photos p
      JOIN work_order_units wou ON p.work_order_unit_id = wou.id
      WHERE wou.work_order_id = $1
      ORDER BY p.work_order_unit_id, p.phase, p.point_no
    `, [req.params.id]);

    const { rows: sigs } = await req.db(`
      SELECT s.*, u.name user_name FROM signatures s
      LEFT JOIN users u ON s.user_id = u.id WHERE s.work_order_id = $1
    `, [req.params.id]);

    res.json({ ...rows[0], assignees, items, inspections, photos, signatures: sigs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/work-orders/:id/history ────────────────────────────────────────
router.get('/:id/history', authMiddleware, async (req, res) => {
  const { rows } = await req.db(`
    SELECT h.*, u.name changed_by_name FROM work_order_status_history h
    LEFT JOIN users u ON h.changed_by = u.id
    WHERE h.work_order_id = $1 ORDER BY h.changed_at
  `, [req.params.id]);
  res.json(rows);
});

// ── PUT /api/work-orders/:id/units ──────────────────────────────────────────
router.put('/:id/units', authMiddleware,
  requireWoRole({ roles: ['technician', 'checker'], statuses: ['draft', 'in_progress', 'rejected'], assigneeOnly: true }),
  async (req, res) => {
  const { unit_ids = [] } = req.body;
  if (!Array.isArray(unit_ids)) return res.status(400).json({ error: 'unit_ids must be an array' });
  const wo = req.wo;
  if (!isEditable(wo.status)) return res.status(409).json({ error: 'ใบงานปิด/อยู่ระหว่างอนุมัติ แก้รายการเครื่องไม่ได้' });

  const client = await req.tx();
  try {
    await client.query('BEGIN');
    const wanted = new Set(unit_ids.map(Number).filter(Boolean));
    const { rows: existing } = await client.query(
      'SELECT id, unit_id FROM work_order_units WHERE work_order_id = $1', [req.params.id]
    );
    const have = new Set(existing.map(r => r.unit_id));
    for (const unitId of wanted) {
      if (!have.has(unitId)) {
        await client.query(`
          INSERT INTO work_order_units (work_order_id, unit_id)
          SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM units WHERE id=$2)
          ON CONFLICT DO NOTHING
        `, [req.params.id, unitId]);
      }
    }
    for (const row of existing) {
      if (!wanted.has(row.unit_id)) {
        await client.query('DELETE FROM work_order_units WHERE id = $1', [row.id]);
      }
    }
    await client.query('COMMIT');
    const { rows } = await req.db('SELECT * FROM work_order_units WHERE work_order_id = $1 ORDER BY id', [req.params.id]);
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── PUT /api/work-orders/:id/inspection ─────────────────────────────────────
router.put('/:id/inspection', authMiddleware,
  requireWoRole({ roles: ['technician', 'checker'], statuses: ['draft', 'in_progress', 'rejected'], assigneeOnly: true }),
  async (req, res) => {
  const { work_order_unit_id, values = [], has_repair, repair_notes } = req.body;
  if (!work_order_unit_id) return res.status(400).json({ error: 'work_order_unit_id required' });
  const wo = req.wo;
  if (!isEditable(wo.status)) return res.status(409).json({ error: 'ใบงานปิด/อยู่ระหว่างอนุมัติ แก้ค่าตรวจไม่ได้' });

  const client = await req.tx();
  try {
    await client.query('BEGIN');
    const { rows: chk } = await client.query(
      'SELECT id FROM work_order_units WHERE id = $1 AND work_order_id = $2',
      [work_order_unit_id, req.params.id]
    );
    if (!chk.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'work_order_unit not in this WO' }); }

    for (const v of values) {
      if (!v.template_item_id) continue;
      await client.query(`
        INSERT INTO inspection_values
          (work_order_unit_id, template_item_id, value_before, value_after, checked, note,
           val_r_before, val_s_before, val_t_before, val_r_after, val_s_after, val_t_after,
           val_ln_before, val_l_before, val_ln_after, val_l_after,
           val_suction, val_discharge, refrigerant_type, val_text, power_system)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        ON CONFLICT (work_order_unit_id, template_item_id) DO UPDATE SET
          value_before=EXCLUDED.value_before, value_after=EXCLUDED.value_after,
          checked=EXCLUDED.checked, note=EXCLUDED.note,
          val_r_before=EXCLUDED.val_r_before, val_s_before=EXCLUDED.val_s_before, val_t_before=EXCLUDED.val_t_before,
          val_r_after=EXCLUDED.val_r_after, val_s_after=EXCLUDED.val_s_after, val_t_after=EXCLUDED.val_t_after,
          val_ln_before=EXCLUDED.val_ln_before, val_l_before=EXCLUDED.val_l_before,
          val_ln_after=EXCLUDED.val_ln_after, val_l_after=EXCLUDED.val_l_after,
          val_suction=EXCLUDED.val_suction, val_discharge=EXCLUDED.val_discharge,
          refrigerant_type=EXCLUDED.refrigerant_type, val_text=EXCLUDED.val_text,
          power_system=EXCLUDED.power_system
      `, [work_order_unit_id, v.template_item_id, v.value_before ?? null, v.value_after ?? null,
          v.checked ?? null, v.note ?? null,
          v.val_r_before ?? null, v.val_s_before ?? null, v.val_t_before ?? null,
          v.val_r_after ?? null, v.val_s_after ?? null, v.val_t_after ?? null,
          v.val_ln_before ?? null, v.val_l_before ?? null, v.val_ln_after ?? null, v.val_l_after ?? null,
          v.val_suction ?? null, v.val_discharge ?? null, v.refrigerant_type ?? null, v.val_text ?? null,
          v.power_system ?? null]);
    }
    if (has_repair !== undefined || repair_notes !== undefined) {
      await client.query(
        'UPDATE work_order_units SET has_repair = COALESCE($1, has_repair), repair_notes = COALESCE($2, repair_notes) WHERE id = $3',
        [has_repair ?? null, repair_notes ?? null, work_order_unit_id]
      );
    }
    if (wo.status === 'draft') {
      const t = checkTransition('draft', 'in_progress', req.user.role);
      if (t.ok) {
        await client.query("UPDATE work_orders SET status='in_progress', started_at=NOW(), updated_at=NOW() WHERE id=$1", [req.params.id]);
        await logTransition(client, { workOrderId: req.params.id, from: 'draft', to: 'in_progress', changedBy: req.user.id });
      }
    }
    await client.query('COMMIT');
    const { rows } = await req.db('SELECT * FROM inspection_values WHERE work_order_unit_id = $1', [work_order_unit_id]);
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── PUT /api/work-orders/:id/condition — team condition assessment (TW) ─────
router.put('/:id/condition', authMiddleware,
  requireWoRole({ roles: ['technician', 'checker'], statuses: ['draft', 'in_progress', 'rejected'], assigneeOnly: true }),
  async (req, res) => {
  const wo = req.wo;
  if (!isEditable(wo.status)) return res.status(409).json({ error: 'ใบงานปิด/อยู่ระหว่างอนุมัติ แก้ไม่ได้' });
  const b = req.body || {};
  const { rows } = await req.db(`
    UPDATE work_orders SET
      cond_ac_degraded = COALESCE($1, cond_ac_degraded),
      cond_ac_old_5_7yr = COALESCE($2, cond_ac_old_5_7yr),
      cond_external_degraded = COALESCE($3, cond_external_degraded),
      cond_external_detail = COALESCE($4, cond_external_detail),
      cond_internal_degraded = COALESCE($5, cond_internal_degraded),
      cond_internal_detail = COALESCE($6, cond_internal_detail),
      updated_at = NOW()
    WHERE id = $7 RETURNING *
  `, [b.cond_ac_degraded ?? null, b.cond_ac_old_5_7yr ?? null,
      b.cond_external_degraded ?? null, b.cond_external_detail ?? null,
      b.cond_internal_degraded ?? null, b.cond_internal_detail ?? null, req.params.id]);
  res.json(rows[0]);
});

// ── PATCH /api/work-orders/:id/start — draft → in_progress ──────────────────
router.patch('/:id/start', authMiddleware, async (req, res) => {
  const wo = await getWO(req.db, req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  const t = checkTransition(wo.status, 'in_progress', req.user.role);
  if (!t.ok) return res.status(HTTP_FOR_CODE[t.code]).json({ error: t.error });
  const client = await req.tx();
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

// ── POST /api/work-orders/:id/submit — in_progress → pending_admin ──────────
router.post('/:id/submit', authMiddleware, async (req, res) => {
  const wo = await getWO(req.db, req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  const t = checkTransition(wo.status, 'pending_admin', req.user.role);
  if (!t.ok) return res.status(HTTP_FOR_CODE[t.code]).json({ error: t.error });

  const { rows: units } = await req.db(`
    SELECT wou.id AS wou_id, u.asset_code, u.equipment_type
    FROM work_order_units wou JOIN units u ON wou.unit_id = u.id
    WHERE wou.work_order_id = $1`, [req.params.id]);
  if (!units.length) return res.status(400).json({ error: 'ใบงานยังไม่มีเครื่อง' });

  const missing = [];
  for (const u of units) {
    const { rows: pts } = await req.db(
      'SELECT point_no FROM photo_point_templates WHERE equipment_type=$1 AND work_type=$2 AND required=true ORDER BY point_no',
      [u.equipment_type, wo.type]
    );
    const { rows: photos } = await req.db(
      'SELECT phase, point_no FROM work_order_photos WHERE work_order_unit_id=$1', [u.wou_id]
    );
    const have = new Set(photos.map((p) => `${p.phase}:${p.point_no}`));
    if (pts.length) {
      const lack = pts.filter((p) => !have.has(`before:${p.point_no}`) || !have.has(`after:${p.point_no}`));
      if (lack.length) missing.push(`${u.asset_code} (ขาด ${lack.length}/${pts.length} จุด)`);
    } else {
      const anyBefore = photos.some((p) => p.phase === 'before');
      const anyAfter = photos.some((p) => p.phase === 'after');
      if (!anyBefore || !anyAfter) missing.push(`${u.asset_code} (ก่อน/หลัง)`);
    }
  }
  if (missing.length) {
    return res.status(400).json({
      error: 'มีเครื่องที่ยังถ่ายรูปไม่ครบทุกจุด (ต้องครบทั้งก่อน + หลัง)',
      missing_units: missing,
    });
  }

  const client = await req.tx();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "UPDATE work_orders SET status='pending_admin', completed_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *",
      [req.params.id]
    );
    await logTransition(client, { workOrderId: req.params.id, from: wo.status, to: 'pending_admin', changedBy: req.user.id });
    await notifyTransition(client, wo, 'pending_admin', { branchSlug: req.branch?.slug });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── POST /api/work-orders/:id/admin-approve — pending_admin → pending_approval
router.post('/:id/admin-approve', authMiddleware, requireRole('checker'), async (req, res) => {
  const wo = await getWO(req.db, req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  const t = checkTransition(wo.status, 'pending_approval', req.user.role);
  if (!t.ok) return res.status(HTTP_FOR_CODE[t.code]).json({ error: t.error });
  const client = await req.tx();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "UPDATE work_orders SET status='pending_approval', admin_checked_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *",
      [req.params.id]
    );
    await logTransition(client, { workOrderId: req.params.id, from: wo.status, to: 'pending_approval', changedBy: req.user.id });
    await notifyTransition(client, wo, 'pending_approval', { branchSlug: req.branch?.slug });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── POST /api/work-orders/:id/final-approve — pending_approval → approved ───
router.post('/:id/final-approve', authMiddleware, requireRole('approver'), async (req, res) => {
  const wo = await getWO(req.db, req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  const t = checkTransition(wo.status, 'approved', req.user.role);
  if (!t.ok) return res.status(HTTP_FOR_CODE[t.code]).json({ error: t.error });

  const client = await req.tx();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "UPDATE work_orders SET status='approved', approver_id=$1, approved_at=NOW(), updated_at=NOW() WHERE id=$2 RETURNING *",
      [req.user.id, req.params.id]
    );
    await advancePmCycle(client, req.params.id, wo.type);
    await logTransition(client, { workOrderId: req.params.id, from: wo.status, to: 'approved', changedBy: req.user.id });
    await notifyTransition(client, wo, 'approved', { branchSlug: req.branch?.slug });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// PM cycle (spec §6). Runs inside the approve transaction (schema-pinned client).
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
      if (pos >= 2) next = base.add(6, 'month').format('YYYY-MM-DD');
    } else {
      next = today.add(2, 'month').format('YYYY-MM-DD');
    }
    await client.query(
      'UPDATE units SET last_major_clean_date=$1, next_pm_date=$2, pm_cycle_pos=$3, updated_at=NOW() WHERE id=$4',
      [lastMajor, next, pos, u.id]
    );
  }
}

// ── POST /api/work-orders/:id/reject ────────────────────────────────────────
router.post('/:id/reject', authMiddleware, requireRole('checker', 'approver'), async (req, res) => {
  const { reason } = req.body;
  const wo = await getWO(req.db, req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  const t = checkTransition(wo.status, 'rejected', req.user.role, { reason });
  if (!t.ok) return res.status(HTTP_FOR_CODE[t.code]).json({ error: t.error });
  const client = await req.tx();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "UPDATE work_orders SET status='rejected', reject_reason=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [reason.trim(), req.params.id]
    );
    await logTransition(client, { workOrderId: req.params.id, from: wo.status, to: 'rejected', changedBy: req.user.id, reason: reason.trim() });
    await notifyTransition(client, wo, 'rejected', { reason: reason.trim(), branchSlug: req.branch?.slug });
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── POST /api/work-orders/:id/resubmit — rejected → in_progress ─────────────
router.post('/:id/resubmit', authMiddleware, async (req, res) => {
  const wo = await getWO(req.db, req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  const t = checkTransition(wo.status, 'in_progress', req.user.role);
  if (!t.ok) return res.status(HTTP_FOR_CODE[t.code]).json({ error: t.error });
  const client = await req.tx();
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

// ── POST /api/work-orders/:id/sign-token ────────────────────────────────────
router.post('/:id/sign-token', authMiddleware,
  requireWoRole({ roles: ['technician', 'checker'], statuses: ['in_progress'], assigneeOnly: true }),
  async (req, res) => {
    try {
      const token = jwt.sign(
        { work_order_id: Number(req.params.id), scope: 'area_owner_sign', branch: req.schema || null },
        process.env.JWT_SECRET,
        { expiresIn: '30m' }
      );
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await req.db(
        'INSERT INTO sign_tokens (work_order_id, token_hash, expires_at) VALUES ($1,$2,$3)',
        [req.params.id, tokenHash, expiresAt]
      );
      res.status(201).json({ token, sign_path: `/sign/${token}`, expires_at: expiresAt });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// ── GET /api/work-orders/:id/sign-status ────────────────────────────────────
router.get('/:id/sign-status', authMiddleware, async (req, res) => {
  const { rows } = await req.db(
    "SELECT signer_name, signed_at FROM signatures WHERE work_order_id=$1 AND role='area_owner'",
    [req.params.id]
  );
  res.json(rows.length ? { signed: true, ...rows[0] } : { signed: false });
});

// ── POST /api/work-orders/:id/repair-request ────────────────────────────────
router.post('/:id/repair-request', authMiddleware,
  requireWoRole({ roles: ['technician', 'checker'], statuses: ['draft', 'in_progress', 'rejected'], assigneeOnly: true }),
  async (req, res) => {
  const { work_order_unit_id, problem } = req.body;
  if (!work_order_unit_id || !problem?.trim()) {
    return res.status(400).json({ error: 'work_order_unit_id และ problem จำเป็น' });
  }
  try {
    const { rows: chk } = await req.db(
      'SELECT unit_id FROM work_order_units WHERE id=$1 AND work_order_id=$2',
      [work_order_unit_id, req.params.id]
    );
    if (!chk.length) return res.status(404).json({ error: 'work_order_unit not in this WO' });
    const { rows } = await req.db(`
      INSERT INTO repair_logs
        (unit_id, work_order_id, work_order_unit_id, problem, status, reported_by)
      VALUES ($1, $2, $3, $4, 'open', $5)
      RETURNING *
    `, [chk[0].unit_id, req.params.id, work_order_unit_id, problem.trim(), req.user.id]);
    await req.db('UPDATE work_order_units SET has_repair = true WHERE id = $1', [work_order_unit_id]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Signatures ──────────────────────────────────────────────────────────────
router.post('/:id/signatures', authMiddleware, async (req, res) => {
  const { role, signature_data, signer_name } = req.body;
  const valid = ['area_owner', 'central_admin', 'approver'];
  if (!role || !signature_data) return res.status(400).json({ error: 'role and signature_data required' });
  if (!valid.includes(role)) return res.status(400).json({ error: `role must be one of: ${valid.join(', ')}` });
  const allowedSigners = {
    area_owner:    ['technician', 'checker'],
    central_admin: ['checker'],
    approver:      ['approver'],
  };
  if (!allowedSigners[role].includes(req.user.role)) {
    return res.status(403).json({ error: `role ${req.user.role} ลงลายเซ็น ${role} ไม่ได้` });
  }
  const wo = await getWO(req.db, req.params.id);
  if (!wo) return res.status(404).json({ error: 'Not found' });
  if (wo.status === 'approved') return res.status(409).json({ error: 'ใบงานปิดแล้ว แก้ลายเซ็นไม่ได้' });
  try {
    const { rows } = await req.db(`
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
const safeInt = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? String(n) : 'misc'; };
const safePhase = (v) => (['before', 'after', 'measurement', 'during'].includes(v) ? v : 'x');
const safeExt = (name) => { const e = path.extname(String(name || '')).toLowerCase(); return /^\.[a-z0-9]{1,5}$/.test(e) ? e : '.jpg'; };
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, 'photos', safeInt(req.body.work_order_unit_id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${safePhase(req.body.phase)}_${safeInt(req.body.point_no)}_${Date.now()}${safeExt(file.originalname)}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only')),
});

// POST /api/work-orders/:id/photos — concurrent-safe (always append)
router.post('/:id/photos', authMiddleware,
  requireWoRole({ roles: ['technician', 'checker'], statuses: ['draft', 'in_progress', 'rejected'], assigneeOnly: true }),
  upload.single('photo'), async (req, res) => {
  let { work_order_unit_id, phase, point_no, label, client_token } = req.body;
  if (!work_order_unit_id || !phase || !req.file) {
    return res.status(400).json({ error: 'work_order_unit_id, phase, and photo required' });
  }
  if (phase === 'during') phase = 'measurement';
  if (!['before', 'after', 'measurement'].includes(phase)) {
    return res.status(400).json({ error: 'phase must be before, after, or measurement' });
  }
  const wo = req.wo;
  if (!isEditable(wo.status)) return res.status(409).json({ error: 'ใบงานปิด/อยู่ระหว่างอนุมัติ เพิ่มรูปไม่ได้' });
  try {
    if (client_token) {
      const { rows: dup } = await req.db(
        'SELECT * FROM work_order_photos WHERE client_token = $1', [client_token]
      );
      if (dup.length) {
        fs.unlink(req.file.path, () => {});
        return res.status(200).json(dup[0]);
      }
    }
    const { rows: chk } = await req.db(
      'SELECT unit_id FROM work_order_units WHERE id=$1 AND work_order_id=$2',
      [work_order_unit_id, req.params.id]
    );
    if (!chk.length) return res.status(404).json({ error: 'work_order_unit not in this WO' });
    const url = '/uploads/' + path.relative(UPLOAD_DIR, req.file.path).split(path.sep).join('/');
    const { rows } = await req.db(`
      INSERT INTO work_order_photos (work_order_unit_id, unit_id, uploaded_by, phase, point_no, label, url, filename, client_token)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (client_token) WHERE client_token IS NOT NULL DO NOTHING
      RETURNING *
    `, [work_order_unit_id, chk[0].unit_id, req.user.id, phase, parseInt(point_no || 1, 10), label || null, url, req.file.filename, client_token || null]);
    if (!rows.length && client_token) {
      const { rows: won } = await req.db('SELECT * FROM work_order_photos WHERE client_token = $1', [client_token]);
      return res.status(200).json(won[0]);
    }
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/work-orders/:id/photos — grouped by work_order_unit_id
router.get('/:id/photos', authMiddleware, async (req, res) => {
  const { rows } = await req.db(`
    SELECT p.* FROM work_order_photos p
    JOIN work_order_units wou ON p.work_order_unit_id = wou.id
    WHERE wou.work_order_id = $1 ORDER BY p.work_order_unit_id, p.phase, p.point_no
  `, [req.params.id]);
  const grouped = {};
  for (const p of rows) (grouped[p.work_order_unit_id] ||= []).push(p);
  res.json(grouped);
});

// DELETE /api/work-orders/:id/photos/:photoId — only before submit (editable)
router.delete('/:id/photos/:photoId', authMiddleware,
  requireWoRole({ roles: ['technician', 'checker'], statuses: ['draft', 'in_progress', 'rejected'], assigneeOnly: true }),
  async (req, res) => {
  const { rows } = await req.db(`
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
