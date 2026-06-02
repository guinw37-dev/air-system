const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
// PM plan write access — provider admins only (not field technicians)
const canPlan = requireRole('admin', 'central_admin');
const dayjs = require('dayjs');
const { buildUnitEvents } = require('../services/pmPlanner');

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
router.post('/plan', authMiddleware, canPlan, async (req, res) => {
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
router.post('/generate-plan', authMiddleware, canPlan, async (req, res) => {
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
router.delete('/plan/:id', authMiddleware, canPlan, async (req, res) => {
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

// ── PHASE 5: PM plan generator + calendar ───────────────────────────────────

// POST /api/pm/generate?client_id=&site_id=&year=  — generate a year's plan
// (tenant-scoped; idempotent: skips a unit/date that already has a plan row)
router.post('/generate', authMiddleware, canPlan, async (req, res) => {
  const client_id = req.query.client_id || req.body.client_id;
  const site_id   = req.query.site_id   || req.body.site_id;
  const year      = parseInt(req.query.year || req.body.year || new Date().getFullYear(), 10);
  if (!client_id) return res.status(400).json({ error: 'client_id required' });

  const params = [client_id];
  let siteFilter = '';
  if (site_id) { params.push(site_id); siteFilter = ` AND b.site_id = $${params.length}`; }

  const db = await pool.connect();
  try {
    const { rows: units } = await db.query(`
      SELECT u.id, u.client_id, u.equipment_type, u.status,
             u.last_major_clean_date, u.next_pm_date, u.needs_recode
      FROM units u
      LEFT JOIN rooms r     ON u.room_id = r.id
      LEFT JOIN floors f    ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      WHERE u.client_id = $1 AND u.active = true${siteFilter}
    `, params);

    const today = dayjs();
    let inserted = 0, skipped = 0, skippedUnits = 0;
    await db.query('BEGIN');
    for (const u of units) {
      const events = buildUnitEvents(u, year, today);
      if (!events.length) { skippedUnits++; continue; }
      for (const ev of events) {
        const note = u.needs_recode ? 'unit needs_recode' : null;
        const { rowCount } = await db.query(`
          INSERT INTO pm_plan (client_id, unit_id, planned_type, scheduled_date, status, note)
          SELECT $1, $2, $3, $4, 'pending', $5
          WHERE NOT EXISTS (
            SELECT 1 FROM pm_plan WHERE unit_id = $2 AND scheduled_date = $4::date
          )
        `, [u.client_id, u.id, ev.planned_type, ev.scheduled_date, note]);
        if (rowCount) inserted++; else skipped++;
      }
    }
    await db.query('COMMIT');
    res.json({ inserted, skipped, units: units.length, skipped_units: skippedUnits, year });
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { db.release(); }
});

// GET /api/pm/plan?client_id=&site_id=&year=&month=&building_id=&type=&status=
router.get('/plan', authMiddleware, async (req, res) => {
  const { client_id, site_id, year, month, building_id, type, status } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const params = [client_id];
  const where = ['pp.client_id = $1'];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('$$', `$${params.length}`)); };
  if (site_id)     add('b.site_id = $$', site_id);
  if (building_id) add('b.id = $$', building_id);
  if (type)        add('pp.planned_type = $$', type);
  if (status)      add('pp.status = $$', status);
  if (year)        add('EXTRACT(YEAR FROM pp.scheduled_date) = $$', year);
  if (month)       add('EXTRACT(MONTH FROM pp.scheduled_date) = $$', month);
  try {
    const { rows } = await pool.query(`
      SELECT pp.*, u.asset_code, u.name unit_name, u.equipment_type,
             r.name room_name, f.name floor_name, b.name building_name
      FROM pm_plan pp
      JOIN units u         ON pp.unit_id = u.id
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      WHERE ${where.join(' AND ')}
      ORDER BY pp.scheduled_date, b.name, u.asset_code
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/pm/plan/:id — reschedule (+ reason)
router.put('/plan/:id', authMiddleware, canPlan, async (req, res) => {
  const { scheduled_date, note } = req.body;
  if (!scheduled_date) return res.status(400).json({ error: 'scheduled_date required' });
  const { rows } = await pool.query(
    `UPDATE pm_plan SET scheduled_date=$1, note=COALESCE($2, note), updated_at=NOW()
     WHERE id=$3 AND status IN ('pending','overdue') RETURNING *`,
    [scheduled_date, note || null, req.params.id]
  );
  if (!rows.length) return res.status(400).json({ error: 'Not found หรือแก้ไม่ได้ (อาจ done/skipped)' });
  res.json(rows[0]);
});

// PUT /api/pm/plan/:id/skip — skip (+ reason required)
router.put('/plan/:id/skip', authMiddleware, canPlan, async (req, res) => {
  const { note } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: 'ระบุเหตุผลการข้าม' });
  const { rows } = await pool.query(
    `UPDATE pm_plan SET status='skipped', note=$1, updated_at=NOW()
     WHERE id=$2 AND status IN ('pending','overdue') RETURNING *`,
    [note.trim(), req.params.id]
  );
  if (!rows.length) return res.status(400).json({ error: 'Not found หรือข้ามไม่ได้' });
  res.json(rows[0]);
});

// GET /api/pm/overdue?client_id= — pending plans past their date
router.get('/overdue', authMiddleware, async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const { rows } = await pool.query(`
    SELECT pp.*, u.asset_code, u.name unit_name, r.name room_name, b.name building_name,
           (CURRENT_DATE - pp.scheduled_date)::int AS days_overdue
    FROM pm_plan pp
    JOIN units u         ON pp.unit_id = u.id
    LEFT JOIN rooms r    ON u.room_id = r.id
    LEFT JOIN floors f   ON r.floor_id = f.id
    LEFT JOIN buildings b ON f.building_id = b.id
    WHERE pp.client_id = $1 AND pp.status = 'pending' AND pp.scheduled_date < CURRENT_DATE
    ORDER BY pp.scheduled_date
  `, [client_id]);
  res.json(rows);
});

// GET /api/pm/calendar?client_id=&site_id=&year=&month= — events grouped by date
router.get('/calendar', authMiddleware, async (req, res) => {
  const { client_id, site_id, year, month } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const params = [client_id];
  const where = ['pp.client_id = $1'];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('$$', `$${params.length}`)); };
  if (site_id) add('b.site_id = $$', site_id);
  if (year)    add('EXTRACT(YEAR FROM pp.scheduled_date) = $$', year);
  if (month)   add('EXTRACT(MONTH FROM pp.scheduled_date) = $$', month);
  try {
    const { rows } = await pool.query(`
      SELECT pp.scheduled_date, pp.planned_type, pp.status, pp.unit_id,
             u.asset_code, r.name room_name
      FROM pm_plan pp
      JOIN units u         ON pp.unit_id = u.id
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      WHERE ${where.join(' AND ')}
      ORDER BY pp.scheduled_date
    `, params);
    const byDate = {};
    for (const r of rows) (byDate[r.scheduled_date] ||= []).push(r);
    res.json(byDate);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/pm/plan-summary?client_id=&site_id=&year= — counts by month × status
router.get('/plan-summary', authMiddleware, async (req, res) => {
  const { client_id, site_id, year = new Date().getFullYear() } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const params = [client_id, year];
  let siteFilter = '';
  if (site_id) { params.push(site_id); siteFilter = ` AND b.site_id = $${params.length}`; }
  try {
    const { rows } = await pool.query(`
      SELECT EXTRACT(MONTH FROM pp.scheduled_date)::int AS month,
             COUNT(*) FILTER (WHERE pp.status='done')::int    AS done,
             COUNT(*) FILTER (WHERE pp.status='pending' AND pp.scheduled_date >= CURRENT_DATE)::int AS pending,
             COUNT(*) FILTER (WHERE pp.status='pending' AND pp.scheduled_date < CURRENT_DATE)::int  AS overdue,
             COUNT(*) FILTER (WHERE pp.status='skipped')::int AS skipped
      FROM pm_plan pp
      JOIN units u ON pp.unit_id = u.id
      LEFT JOIN rooms r ON u.room_id = r.id
      LEFT JOIN floors f ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      WHERE pp.client_id = $1 AND EXTRACT(YEAR FROM pp.scheduled_date) = $2${siteFilter}
      GROUP BY 1 ORDER BY 1
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
