const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const dayjs = require('dayjs');

// GET /api/repair-logs?hospital_id=&status=&ac_unit_id=
router.get('/', authMiddleware, async (req, res) => {
  const { hospital_id, status, ac_unit_id } = req.query;
  let where = ['1=1'];
  let params = [];
  let i = 1;

  if (ac_unit_id)  { where.push(`r.ac_unit_id = $${i++}`);  params.push(ac_unit_id); }
  if (status)      { where.push(`r.status = $${i++}`);       params.push(status); }
  if (hospital_id) {
    where.push(`b.hospital_id = $${i++}`);
    params.push(hospital_id);
  }

  const { rows } = await pool.query(`
    SELECT r.*,
      a.ac_code, a.name ac_name, a.type ac_type,
      d.name dept_name, f.name floor_name, b.name building_name,
      u.name reporter_name,
      w.order_no
    FROM repair_logs r
    JOIN ac_units a      ON r.ac_unit_id = a.id
    JOIN departments d   ON a.department_id = d.id
    JOIN floors f        ON d.floor_id = f.id
    JOIN buildings b     ON f.building_id = b.id
    LEFT JOIN users u    ON r.reported_by = u.id
    LEFT JOIN work_orders w ON r.work_order_id = w.id
    WHERE ${where.join(' AND ')}
    ORDER BY r.created_at DESC
    LIMIT 100
  `, params);
  res.json(rows);
});

// POST /api/repair-logs — manual create (no work order)
router.post('/', authMiddleware, async (req, res) => {
  const { ac_unit_id, problem, cleaning_type } = req.body;
  if (!ac_unit_id || !problem) {
    return res.status(400).json({ error: 'ac_unit_id and problem required' });
  }
  if (cleaning_type && !['major', 'minor', 'fan'].includes(cleaning_type)) {
    return res.status(400).json({ error: 'cleaning_type must be major, minor, or fan' });
  }
  try {
    const { rows } = await pool.query(`
      INSERT INTO repair_logs (ac_unit_id, problem, cleaning_type, status, reported_by)
      VALUES ($1, $2, $3, 'open', $4)
      RETURNING *
    `, [ac_unit_id, problem, cleaning_type || null, req.user.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/repair-logs/:id
router.get('/:id', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.*, a.ac_code, a.name ac_name, u.name reporter_name, w.order_no
    FROM repair_logs r
    JOIN ac_units a ON r.ac_unit_id = a.id
    LEFT JOIN users u ON r.reported_by = u.id
    LEFT JOIN work_orders w ON r.work_order_id = w.id
    WHERE r.id = $1
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// PATCH /api/repair-logs/:id
router.patch('/:id', authMiddleware, async (req, res) => {
  const { cause, solution, status, cleaning_type } = req.body;

  // Validate cleaning_type if provided
  if (cleaning_type && !['major', 'minor', 'fan'].includes(cleaning_type)) {
    return res.status(400).json({ error: 'cleaning_type must be major, minor, or fan' });
  }

  try {
    const { rows } = await pool.query(`
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

    // If resolved + cleaning_type → advance PM cycle
    if (status === 'done' && cleaning_type) {
      const log = rows[0];
      const { rows: ac } = await pool.query(
        'SELECT pm_cycle_pos FROM ac_units WHERE id = $1',
        [log.ac_unit_id]
      );
      if (ac.length) {
        const oldPos = ac[0].pm_cycle_pos ?? 0;
        const newPos = (oldPos + 1) % 3;
        const nextDate = dayjs().add(2, 'month').format('YYYY-MM-DD');

        await pool.query(
          'UPDATE ac_units SET next_pm_date=$1, pm_cycle_pos=$2, updated_at=NOW() WHERE id=$3',
          [nextDate, newPos, log.ac_unit_id]
        );

        await pool.query(`
          INSERT INTO pm_plan (ac_unit_id, planned_type, scheduled_date, actual_date, work_order_id, status)
          VALUES ($1, $2, $3, NOW(), NULL, 'done')
          ON CONFLICT DO NOTHING
        `, [log.ac_unit_id, cleaning_type, nextDate]);
      }
    }

    res.json({ ...rows[0], pm_updated: status === 'done' && !!cleaning_type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
