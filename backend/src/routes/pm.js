const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const dayjs = require('dayjs');

// GET /api/pm?client_id=&filter=overdue|due_soon|ok|all
// OLD: hospital_id param, ac_units table, departments, pm_interval_months column
// NEW: client_id param, units table, rooms; next_pm_date used directly (pm_interval_months GONE)
router.get('/', authMiddleware, async (req, res) => {
  // Accept client_id; also accept old hospital_id param for compatibility
  const { client_id, hospital_id, filter = 'all' } = req.query;
  const effectiveClientId = client_id || hospital_id;

  let where = ['1=1'];
  let params = [];
  let i = 1;

  if (effectiveClientId) {
    where.push(`u.client_id = $${i++}`);
    params.push(effectiveClientId);
  }

  if (filter === 'overdue') {
    where.push(`u.next_pm_date < CURRENT_DATE`);
  } else if (filter === 'due_soon') {
    where.push(`u.next_pm_date >= CURRENT_DATE AND u.next_pm_date <= CURRENT_DATE + INTERVAL '30 days'`);
  } else if (filter === 'ok') {
    where.push(`u.next_pm_date > CURRENT_DATE + INTERVAL '30 days'`);
  } else if (filter === 'no_date') {
    where.push(`u.next_pm_date IS NULL`);
  }

  try {
    const { rows } = await pool.query(`
      SELECT
        u.id, u.asset_code, u.name unit_name, u.family,
        u.capacity_btu, u.next_pm_date, u.pm_cycle_pos, u.status unit_status,
        r.name room_name, r.id room_id,
        f.name floor_name,
        b.name building_name, b.id building_id,
        c.name client_name, c.id client_id,
        CASE
          WHEN u.next_pm_date IS NULL              THEN 'no_date'
          WHEN u.next_pm_date < CURRENT_DATE       THEN 'overdue'
          WHEN u.next_pm_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'due_soon'
          ELSE 'ok'
        END AS pm_status,
        (u.next_pm_date - CURRENT_DATE)::int AS days_left
      FROM units u
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      JOIN clients c       ON u.client_id = c.id
      WHERE ${where.join(' AND ')}
      ORDER BY u.next_pm_date ASC NULLS LAST, c.name, b.name, u.asset_code
    `, params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pm/yearly-plan?client_id=&year=&building_id=
// OLD: hospital_id, ac_units, departments, pm_interval_months
// NEW: client_id, units, rooms; pm_interval_months column GONE — use next_pm_date/pm_cycle_pos directly
router.get('/yearly-plan', authMiddleware, async (req, res) => {
  // Accept client_id; also accept old hospital_id param for compatibility
  const { client_id, hospital_id, year = new Date().getFullYear(), building_id } = req.query;
  const effectiveClientId = client_id || hospital_id;
  if (!effectiveClientId) return res.status(400).json({ error: 'client_id required' });
  if (!building_id) return res.status(400).json({ error: 'building_id required — เลือกอาคารก่อน' });
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id, u.asset_code, u.name unit_name, u.next_pm_date, u.pm_cycle_pos,
        r.name room_name, f.name floor_name, b.name building_name, b.id building_id,
        COALESCE(
          json_agg(
            json_build_object(
              'id',             pp.id,
              'planned_type',   pp.planned_type,
              'scheduled_date', pp.scheduled_date,
              'actual_date',    pp.actual_date,
              'status',         pp.status
            ) ORDER BY COALESCE(pp.actual_date, pp.scheduled_date)
          ) FILTER (WHERE pp.id IS NOT NULL),
          '[]'
        ) AS pm_entries
      FROM units u
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      LEFT JOIN pm_plan pp ON pp.unit_id = u.id
        AND EXTRACT(YEAR FROM COALESCE(pp.actual_date, pp.scheduled_date)) = $2
      WHERE u.client_id = $1 AND b.id = $3
      GROUP BY u.id, u.asset_code, u.name, u.next_pm_date, u.pm_cycle_pos,
               r.name, f.name, b.name, b.id
      ORDER BY f.name, u.asset_code
    `, [effectiveClientId, year, building_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pm/plan — create planned PM entry
// OLD: ac_unit_id → NEW: unit_id; pm_plan now requires client_id too
router.post('/plan', authMiddleware, async (req, res) => {
  const unit_id = req.body.unit_id || req.body.ac_unit_id;
  const { planned_type, scheduled_date } = req.body;
  if (!unit_id || !planned_type || !scheduled_date) {
    return res.status(400).json({ error: 'unit_id, planned_type, scheduled_date required' });
  }
  if (!['major', 'minor', 'fan'].includes(planned_type)) {
    return res.status(400).json({ error: 'planned_type must be major, minor, or fan' });
  }
  try {
    const { rows } = await pool.query(`
      INSERT INTO pm_plan (client_id, unit_id, planned_type, scheduled_date, status)
      SELECT u.client_id, $1, $2, $3, 'pending'
      FROM units u WHERE u.id = $1
      RETURNING *
    `, [unit_id, planned_type, scheduled_date]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pm/generate-plan — auto-generate planned entries for a year
// OLD: ac_units, departments → NEW: units, rooms
router.post('/generate-plan', authMiddleware, async (req, res) => {
  const { building_id, year } = req.body;
  if (!building_id || !year) return res.status(400).json({ error: 'building_id and year required' });

  try {
    const { rows: units } = await pool.query(`
      SELECT u.id, u.next_pm_date, u.pm_cycle_pos, u.client_id
      FROM units u
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      WHERE b.id = $1
    `, [building_id]);

    const yearStart = dayjs(`${year}-01-01`);
    const yearEnd   = dayjs(`${year}-12-31`);

    let inserted = 0;
    let skipped  = 0;

    for (const u of units) {
      if (!u.next_pm_date) continue;

      let date = dayjs(u.next_pm_date);
      let pos  = u.pm_cycle_pos ?? 0;

      while (date.isBefore(yearStart, 'month')) {
        date = date.add(2, 'month');
        pos  = (pos + 1) % 3;
      }

      while (!date.isAfter(yearEnd, 'month')) {
        const scheduledDate = date.format('YYYY-MM-DD');
        const plannedType   = pos === 0 ? 'major' : 'minor';

        const { rowCount } = await pool.query(`
          INSERT INTO pm_plan (client_id, unit_id, planned_type, scheduled_date, status)
          SELECT $1, $2, $3, $4, 'pending'
          WHERE NOT EXISTS (
            SELECT 1 FROM pm_plan
            WHERE unit_id = $2
              AND DATE_TRUNC('month', COALESCE(actual_date, scheduled_date)) =
                  DATE_TRUNC('month', $4::date)
          )
        `, [u.client_id, u.id, plannedType, scheduledDate]);

        if (rowCount > 0) inserted++;
        else skipped++;

        date = date.add(2, 'month');
        pos  = (pos + 1) % 3;
      }
    }

    res.json({ inserted, skipped, units: units.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pm/plan/:id — remove planned entry
router.delete('/plan/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM pm_plan WHERE id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(400).json({ error: 'Not found or already done' });
    res.json({ message: 'deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pm/summary — counts per status
// OLD: FROM ac_units → NEW: FROM units
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE next_pm_date < CURRENT_DATE)::int                                           AS overdue,
        COUNT(*) FILTER (WHERE next_pm_date >= CURRENT_DATE AND next_pm_date <= CURRENT_DATE + INTERVAL '30 days')::int AS due_soon,
        COUNT(*) FILTER (WHERE next_pm_date > CURRENT_DATE + INTERVAL '30 days')::int                     AS ok,
        COUNT(*) FILTER (WHERE next_pm_date IS NULL)::int                                                  AS no_date,
        COUNT(*)::int                                                                                       AS total
      FROM units
    `);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
