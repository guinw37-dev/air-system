const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
// PM plan write access — provider admins only (not field technicians)
const canPlan = requireRole('admin', 'central_admin', 'super_admin');
const dayjs = require('dayjs');
const { buildUnitEvents } = require('../services/pmPlanner');

// Schema-per-tenant: req.db scopes everything to the current branch — no client_id.

// GET /api/pm?filter=overdue|due_soon|ok|all
router.get('/', authMiddleware, async (req, res) => {
  const { filter = 'all' } = req.query;
  let where = ['1=1'];
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
    const { rows } = await req.db(`
      SELECT
        u.id, u.asset_code, u.name unit_name, u.family,
        u.capacity_btu, u.next_pm_date, u.pm_cycle_pos, u.status unit_status,
        r.name room_name, r.id room_id,
        f.name floor_name,
        b.name building_name, b.id building_id,
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
      WHERE ${where.join(' AND ')}
      ORDER BY u.next_pm_date ASC NULLS LAST, b.name, u.asset_code
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pm/yearly-plan?year=&building_id=
router.get('/yearly-plan', authMiddleware, async (req, res) => {
  const { year = new Date().getFullYear(), building_id } = req.query;
  if (!building_id) return res.status(400).json({ error: 'building_id required — เลือกอาคารก่อน' });
  try {
    const { rows } = await req.db(`
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
        AND EXTRACT(YEAR FROM COALESCE(pp.actual_date, pp.scheduled_date)) = $1
      WHERE b.id = $2
      GROUP BY u.id, u.asset_code, u.name, u.next_pm_date, u.pm_cycle_pos,
               r.name, f.name, b.name, b.id
      ORDER BY f.name, u.asset_code
    `, [year, building_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pm/plan — create planned PM entry
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
    const { rows } = await req.db(`
      INSERT INTO pm_plan (unit_id, planned_type, scheduled_date, status)
      SELECT $1, $2, $3, 'pending'
      WHERE EXISTS (SELECT 1 FROM units u WHERE u.id = $1)
      RETURNING *
    `, [unit_id, planned_type, scheduled_date]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบ unit' });
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pm/generate-plan — auto-generate planned entries for a year
router.post('/generate-plan', authMiddleware, canPlan, async (req, res) => {
  const { building_id, year } = req.body;
  if (!building_id || !year) return res.status(400).json({ error: 'building_id and year required' });

  try {
    const { rows: units } = await req.db(`
      SELECT u.id, u.next_pm_date, u.pm_cycle_pos
      FROM units u
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      WHERE b.id = $1
    `, [building_id]);

    const yearStart = dayjs(`${year}-01-01`);
    const yearEnd   = dayjs(`${year}-12-31`);
    let inserted = 0, skipped = 0;

    for (const u of units) {
      if (!u.next_pm_date) continue;
      let date = dayjs(u.next_pm_date);
      let pos  = u.pm_cycle_pos ?? 0;
      while (date.isBefore(yearStart, 'month')) { date = date.add(2, 'month'); pos = (pos + 1) % 3; }
      while (!date.isAfter(yearEnd, 'month')) {
        const scheduledDate = date.format('YYYY-MM-DD');
        const plannedType   = pos === 0 ? 'major' : 'minor';
        const { rowCount } = await req.db(`
          INSERT INTO pm_plan (unit_id, planned_type, scheduled_date, status)
          SELECT $1, $2, $3, 'pending'
          WHERE NOT EXISTS (
            SELECT 1 FROM pm_plan
            WHERE unit_id = $1
              AND DATE_TRUNC('month', COALESCE(actual_date, scheduled_date)) =
                  DATE_TRUNC('month', $3::date)
          )
        `, [u.id, plannedType, scheduledDate]);
        if (rowCount > 0) inserted++; else skipped++;
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
    const { rows } = await req.db(
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
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(`
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

// POST /api/pm/generate?site_id=&year=  — generate a year's plan (idempotent)
router.post('/generate', authMiddleware, canPlan, async (req, res) => {
  const site_id = req.query.site_id || req.body.site_id;
  const year    = parseInt(req.query.year || req.body.year || new Date().getFullYear(), 10);

  const params = [];
  let siteFilter = '';
  if (site_id) { params.push(site_id); siteFilter = ` AND b.site_id = $${params.length}`; }

  const db = await req.tx();
  try {
    const { rows: units } = await db.query(`
      SELECT u.id, u.equipment_type, u.status,
             u.last_major_clean_date, u.next_pm_date, u.needs_recode
      FROM units u
      LEFT JOIN rooms r     ON u.room_id = r.id
      LEFT JOIN floors f    ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      WHERE u.active = true${siteFilter}
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
          INSERT INTO pm_plan (unit_id, planned_type, scheduled_date, status, note)
          SELECT $1, $2, $3, 'pending', $4
          WHERE NOT EXISTS (
            SELECT 1 FROM pm_plan WHERE unit_id = $1 AND scheduled_date = $3::date
          )
        `, [u.id, ev.planned_type, ev.scheduled_date, note]);
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

// GET /api/pm/plan?site_id=&year=&month=&building_id=&type=&status=
router.get('/plan', authMiddleware, async (req, res) => {
  const { site_id, year, month, building_id, type, status } = req.query;
  const params = [];
  const where = ['1=1'];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('$$', `$${params.length}`)); };
  if (site_id)     add('b.site_id = $$', site_id);
  if (building_id) add('b.id = $$', building_id);
  if (type)        add('pp.planned_type = $$', type);
  if (status)      add('pp.status = $$', status);
  if (year)        add('EXTRACT(YEAR FROM pp.scheduled_date) = $$', year);
  if (month)       add('EXTRACT(MONTH FROM pp.scheduled_date) = $$', month);
  try {
    const { rows } = await req.db(`
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
  const { rows } = await req.db(
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
  const { rows } = await req.db(
    `UPDATE pm_plan SET status='skipped', note=$1, updated_at=NOW()
     WHERE id=$2 AND status IN ('pending','overdue') RETURNING *`,
    [note.trim(), req.params.id]
  );
  if (!rows.length) return res.status(400).json({ error: 'Not found หรือข้ามไม่ได้' });
  res.json(rows[0]);
});

// GET /api/pm/overdue — pending plans past their date
router.get('/overdue', authMiddleware, async (req, res) => {
  const { rows } = await req.db(`
    SELECT pp.*, u.asset_code, u.name unit_name, r.name room_name, b.name building_name,
           (CURRENT_DATE - pp.scheduled_date)::int AS days_overdue
    FROM pm_plan pp
    JOIN units u         ON pp.unit_id = u.id
    LEFT JOIN rooms r    ON u.room_id = r.id
    LEFT JOIN floors f   ON r.floor_id = f.id
    LEFT JOIN buildings b ON f.building_id = b.id
    WHERE pp.status = 'pending' AND pp.scheduled_date < CURRENT_DATE
    ORDER BY pp.scheduled_date
  `);
  res.json(rows);
});

// GET /api/pm/calendar?site_id=&year=&month= — events grouped by date
router.get('/calendar', authMiddleware, async (req, res) => {
  const { site_id, year, month } = req.query;
  const params = [];
  const where = ['1=1'];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('$$', `$${params.length}`)); };
  if (site_id) add('b.site_id = $$', site_id);
  if (year)    add('EXTRACT(YEAR FROM pp.scheduled_date) = $$', year);
  if (month)   add('EXTRACT(MONTH FROM pp.scheduled_date) = $$', month);
  try {
    const { rows } = await req.db(`
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

// GET /api/pm/plan-summary?site_id=&year= — counts by month × status
router.get('/plan-summary', authMiddleware, async (req, res) => {
  const { site_id, year = new Date().getFullYear() } = req.query;
  const params = [year];
  let siteFilter = '';
  if (site_id) { params.push(site_id); siteFilter = ` AND b.site_id = $${params.length}`; }
  try {
    const { rows } = await req.db(`
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
      WHERE EXTRACT(YEAR FROM pp.scheduled_date) = $1${siteFilter}
      GROUP BY 1 ORDER BY 1
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
