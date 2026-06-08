const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const dayjs = require('dayjs');

// Schema-per-tenant: req.db scopes every row to the current branch — no client_id.

// GET /api/repair-logs?status=&unit_id=
router.get('/', authMiddleware, async (req, res) => {
  const { status, unit_id, ac_unit_id } = req.query;
  const effectiveUnitId = unit_id || ac_unit_id;

  let where = ['1=1'];
  let params = [];
  let i = 1;
  if (effectiveUnitId) { where.push(`r.unit_id = $${i++}`); params.push(effectiveUnitId); }
  if (status)          { where.push(`r.status = $${i++}`);  params.push(status); }

  try {
    const { rows } = await req.db(`
      SELECT r.*,
        u.asset_code, u.name unit_name, u.family,
        ro.name room_name, f.name floor_name, b.name building_name,
        usr.name reporter_name,
        w.order_no
      FROM repair_logs r
      JOIN units u         ON r.unit_id = u.id
      LEFT JOIN rooms ro   ON u.room_id = ro.id
      LEFT JOIN floors f   ON ro.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      LEFT JOIN users usr  ON r.reported_by = usr.id
      LEFT JOIN work_orders w ON r.work_order_id = w.id
      WHERE ${where.join(' AND ')}
      ORDER BY r.created_at DESC
      LIMIT 100
    `, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/repair-logs — manual create (no work order)
router.post('/', authMiddleware, async (req, res) => {
  const unit_id = req.body.unit_id || req.body.ac_unit_id;
  const { problem, cleaning_type } = req.body;
  if (!unit_id || !problem) {
    return res.status(400).json({ error: 'unit_id and problem required' });
  }
  if (cleaning_type && !['major', 'minor', 'fan'].includes(cleaning_type)) {
    return res.status(400).json({ error: 'cleaning_type must be major, minor, or fan' });
  }
  try {
    const { rows } = await req.db(`
      INSERT INTO repair_logs (unit_id, problem, cleaning_type, status, reported_by)
      SELECT $1, $2, $3, 'open', $4
      WHERE EXISTS (SELECT 1 FROM units u WHERE u.id = $1)
      RETURNING *
    `, [unit_id, problem, cleaning_type || null, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบ unit' });
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/repair-logs/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(`
      SELECT r.*, u.asset_code, u.name unit_name, usr.name reporter_name, w.order_no
      FROM repair_logs r
      JOIN units u ON r.unit_id = u.id
      LEFT JOIN users usr ON r.reported_by = usr.id
      LEFT JOIN work_orders w ON r.work_order_id = w.id
      WHERE r.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/repair-logs/:id
router.patch('/:id', authMiddleware, async (req, res) => {
  const { cause, solution, status, cleaning_type } = req.body;

  if (cleaning_type && !['major', 'minor', 'fan'].includes(cleaning_type)) {
    return res.status(400).json({ error: 'cleaning_type must be major, minor, or fan' });
  }

  try {
    const { rows } = await req.db(`
      UPDATE repair_logs
      SET cause         = COALESCE($1, cause),
          solution      = COALESCE($2, solution),
          status        = COALESCE($3, status),
          cleaning_type = $4,
          resolved_at   = CASE WHEN $3 = 'done' THEN NOW() ELSE resolved_at END,
          updated_at    = NOW()
      WHERE id = $5
      RETURNING *
    `, [cause || null, solution || null, status || null, cleaning_type || null, req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    // If resolved + cleaning_type → advance PM cycle on the unit
    if (status === 'done' && cleaning_type) {
      const log = rows[0];
      const { rows: u } = await req.db('SELECT pm_cycle_pos FROM units WHERE id = $1', [log.unit_id]);
      if (u.length) {
        const newPos = ((u[0].pm_cycle_pos ?? 0) + 1) % 3;
        const nextDate = dayjs().add(2, 'month').format('YYYY-MM-DD');

        await req.db('UPDATE units SET next_pm_date=$1, pm_cycle_pos=$2, updated_at=NOW() WHERE id=$3',
          [nextDate, newPos, log.unit_id]);
      }
    }

    res.json({ ...rows[0], pm_updated: status === 'done' && !!cleaning_type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
