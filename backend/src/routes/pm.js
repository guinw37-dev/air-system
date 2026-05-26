const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// GET /api/pm?hospital_id=&filter=overdue|due_soon|ok|all
router.get('/', authMiddleware, async (req, res) => {
  const { hospital_id, filter = 'all' } = req.query;

  let where = ['1=1'];
  let params = [];
  let i = 1;

  if (hospital_id) {
    where.push(`h.id = $${i++}`);
    params.push(hospital_id);
  }

  // filter by pm status
  if (filter === 'overdue') {
    where.push(`a.next_pm_date < CURRENT_DATE`);
  } else if (filter === 'due_soon') {
    where.push(`a.next_pm_date >= CURRENT_DATE AND a.next_pm_date <= CURRENT_DATE + INTERVAL '30 days'`);
  } else if (filter === 'ok') {
    where.push(`a.next_pm_date > CURRENT_DATE + INTERVAL '30 days'`);
  } else if (filter === 'no_date') {
    where.push(`a.next_pm_date IS NULL`);
  }

  const { rows } = await pool.query(`
    SELECT
      a.id, a.ac_code, a.name ac_name, a.type ac_type,
      a.capacity_btu, a.pm_interval_months, a.next_pm_date, a.status ac_status,
      d.name dept_name, d.id dept_id,
      f.name floor_name,
      b.name building_name, b.id building_id,
      h.name hospital_name, h.id hospital_id,
      CASE
        WHEN a.next_pm_date IS NULL              THEN 'no_date'
        WHEN a.next_pm_date < CURRENT_DATE       THEN 'overdue'
        WHEN a.next_pm_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'due_soon'
        ELSE 'ok'
      END AS pm_status,
      (a.next_pm_date - CURRENT_DATE)::int AS days_left
    FROM ac_units a
    JOIN departments d ON a.department_id = d.id
    JOIN floors f      ON d.floor_id = f.id
    JOIN buildings b   ON f.building_id = b.id
    JOIN hospitals h   ON b.hospital_id = h.id
    WHERE ${where.join(' AND ')}
    ORDER BY a.next_pm_date ASC NULLS LAST, h.name, b.name, a.ac_code
  `, params);

  res.json(rows);
});

// GET /api/pm/summary — counts per status
router.get('/summary', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE next_pm_date < CURRENT_DATE)::int                                          AS overdue,
      COUNT(*) FILTER (WHERE next_pm_date >= CURRENT_DATE AND next_pm_date <= CURRENT_DATE + INTERVAL '30 days')::int AS due_soon,
      COUNT(*) FILTER (WHERE next_pm_date > CURRENT_DATE + INTERVAL '30 days')::int                    AS ok,
      COUNT(*) FILTER (WHERE next_pm_date IS NULL)::int                                                 AS no_date,
      COUNT(*)::int                                                                                      AS total
    FROM ac_units
  `);
  res.json(rows[0]);
});

module.exports = router;
