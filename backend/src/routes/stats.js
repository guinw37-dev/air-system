const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// GET /api/stats/floor-status?client_id=
// OLD: hospitals, ac_units, departments, work_order_items, ac_photos, b.site column
// NEW: clients, units, rooms, work_order_units, work_order_photos; b.site GONE — use sites.name via join
router.get('/floor-status', authMiddleware, async (req, res) => {
  const { client_id, hospital_id } = req.query;
  const effectiveClientId = client_id || hospital_id;
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id, u.asset_code, u.name unit_name, u.family, u.capacity_btu,
        r.name room_name, r.id room_id,
        f.name floor_name, f.id floor_id,
        b.name building_name, b.id building_id,
        s.name site_name,
        c.name client_name, c.id client_id,
        (
          SELECT wo.approved_at
          FROM work_order_units wou JOIN work_orders wo ON wo.id = wou.work_order_id
          WHERE wou.unit_id = u.id AND wo.status = 'approved'
          ORDER BY wo.approved_at DESC LIMIT 1
        ) AS last_cleaned_at,
        (
          SELECT wo.order_no
          FROM work_order_units wou JOIN work_orders wo ON wo.id = wou.work_order_id
          WHERE wou.unit_id = u.id AND wo.status = 'approved'
          ORDER BY wo.approved_at DESC LIMIT 1
        ) AS last_wo_no
      FROM units u
      JOIN clients c       ON u.client_id = c.id
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      LEFT JOIN sites s    ON b.site_id = s.id
      WHERE ($1::int IS NULL OR u.client_id = $1)
      ORDER BY b.name, f.name, u.asset_code
    `, [effectiveClientId || null]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/monthly-detail?client_id=
// OLD: work_order_items, hospital_id → NEW: work_order_units, client_id
router.get('/monthly-detail', authMiddleware, async (req, res) => {
  const { client_id, hospital_id } = req.query;
  const effectiveClientId = client_id || hospital_id;
  try {
    const { rows } = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', wo.approved_at), 'MM/YYYY') AS month,
        DATE_TRUNC('month', wo.approved_at) AS month_sort,
        COUNT(DISTINCT CASE WHEN wo.type = 'major' THEN wou.unit_id END)::int AS major_count,
        COUNT(DISTINCT CASE WHEN wo.type = 'minor' THEN wou.unit_id END)::int AS minor_count,
        COUNT(DISTINCT CASE WHEN wo.type = 'fan'   THEN wou.unit_id END)::int AS fan_count
      FROM work_orders wo
      JOIN work_order_units wou ON wou.work_order_id = wo.id
      WHERE wo.status = 'approved'
        AND wo.approved_at >= NOW() - INTERVAL '12 months'
        AND ($1::int IS NULL OR wo.client_id = $1)
      GROUP BY DATE_TRUNC('month', wo.approved_at)
      ORDER BY DATE_TRUNC('month', wo.approved_at)
    `, [effectiveClientId || null]);

    const { rows: repairs } = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'MM/YYYY') AS month,
        COUNT(*)::int AS repair_count
      FROM repair_logs
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at)
    `);
    const repairMap = Object.fromEntries(repairs.map((r) => [r.month, r.repair_count]));

    const result = rows.map((r) => ({
      month: r.month,
      'ล้างใหญ่': r.major_count,
      'ล้างย่อย': r.minor_count,
      'ล้างพัดลม': r.fan_count,
      'ซ่อม': repairMap[r.month] || 0,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/daily?date=YYYY-MM-DD&client_id=
// OLD: hospitals, tech1_id/tech2_id, work_order_items, ac_photos → NEW: clients, assignees, work_order_units, work_order_photos
router.get('/daily', authMiddleware, async (req, res) => {
  const { date, client_id, hospital_id } = req.query;
  const effectiveClientId = client_id || hospital_id;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    const { rows } = await pool.query(`
      SELECT w.*,
        c.name client_name,
        COUNT(DISTINCT wou.id)::int  item_count,
        COUNT(DISTINCT p.id)::int    photo_count
      FROM work_orders w
      LEFT JOIN clients c             ON w.client_id = c.id
      LEFT JOIN work_order_units wou  ON wou.work_order_id = w.id
      LEFT JOIN work_order_photos p   ON p.work_order_unit_id = wou.id
      WHERE DATE(w.created_at AT TIME ZONE 'Asia/Bangkok') = $1
        AND ($2::int IS NULL OR w.client_id = $2)
      GROUP BY w.id, c.name
      ORDER BY w.created_at DESC
    `, [date, effectiveClientId || null]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/contract-summary?client_id=&year=YYYY
// OLD: hospitals, ac_units, departments, b.site, work_order_items → NEW: clients, units, rooms, sites, work_order_units
router.get('/contract-summary', authMiddleware, async (req, res) => {
  const { client_id, hospital_id, year } = req.query;
  const effectiveClientId = client_id || hospital_id;
  if (!effectiveClientId) return res.status(400).json({ error: 'client_id required' });
  const y = year || new Date().getFullYear();
  try {
    // Plan = total unit count by site + family (equipment family replaces ac_type)
    const { rows: plan } = await pool.query(`
      SELECT COALESCE(s.name, c.name) AS site, u.family AS ac_type, COUNT(u.id)::int AS plan
      FROM units u
      JOIN clients c       ON u.client_id = c.id
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      LEFT JOIN sites s    ON b.site_id = s.id
      WHERE u.client_id = $1 AND u.family IS NOT NULL AND u.family <> ''
      GROUP BY COALESCE(s.name, c.name), u.family
      ORDER BY COALESCE(s.name, c.name), u.family
    `, [effectiveClientId]);

    // Actual = distinct units cleaned per type in year
    const { rows: actual } = await pool.query(`
      SELECT wo.type AS wo_type, COALESCE(s.name, c.name) AS site,
             u.family AS ac_type, COUNT(DISTINCT u.id)::int AS actual
      FROM work_order_units wou
      JOIN work_orders wo  ON wo.id = wou.work_order_id
      JOIN units u         ON u.id = wou.unit_id
      JOIN clients c       ON u.client_id = c.id
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      LEFT JOIN sites s    ON b.site_id = s.id
      WHERE wo.status = 'approved'
        AND EXTRACT(YEAR FROM wo.approved_at AT TIME ZONE 'Asia/Bangkok') = $2
        AND u.client_id = $1
      GROUP BY wo.type, COALESCE(s.name, c.name), u.family
    `, [effectiveClientId, y]);

    // Total unit count per family
    const { rows: totals } = await pool.query(`
      SELECT u.family AS ac_type, COUNT(u.id)::int AS total
      FROM units u
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      WHERE u.client_id = $1 AND u.family IS NOT NULL AND u.family <> ''
      GROUP BY u.family
    `, [effectiveClientId]);

    const actualMap = {};
    for (const r of actual) {
      const key = `${r.wo_type}::${r.site}::${r.ac_type}`;
      actualMap[key] = r.actual;
    }

    const breakdown = plan.map((p) => {
      const maj = actualMap[`major::${p.site}::${p.ac_type}`] || 0;
      const min = actualMap[`minor::${p.site}::${p.ac_type}`] || 0;
      const fan = actualMap[`fan::${p.site}::${p.ac_type}`]   || 0;
      return { site: p.site, ac_type: p.ac_type, plan: p.plan, major_actual: maj, minor_actual: min, fan_actual: fan };
    });

    const totalByType = Object.fromEntries(totals.map((t) => [t.ac_type, t.total]));
    const woTypeTotals = { major: 0, minor: 0, fan: 0 };
    for (const r of actual) {
      if (woTypeTotals[r.wo_type] !== undefined) woTypeTotals[r.wo_type] += r.actual;
    }

    const { rows: totalUnit } = await pool.query(
      `SELECT COUNT(u.id)::int AS cnt FROM units u WHERE u.client_id = $1`,
      [effectiveClientId]
    );
    const woPlan = { major: totalUnit[0].cnt, minor: totalUnit[0].cnt, fan: totalUnit[0].cnt };

    res.json({ year: y, breakdown, totalByType, woTypeTotals, woPlan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/daily-count?client_id=&date=YYYY-MM-DD
// OLD: hospital_id, work_order_items, ac_unit_id → NEW: client_id, work_order_units, unit_id
router.get('/daily-count', authMiddleware, async (req, res) => {
  const { client_id, hospital_id, date } = req.query;
  const effectiveClientId = client_id || hospital_id;
  if (!effectiveClientId || !date) return res.status(400).json({ error: 'client_id and date required' });
  try {
    const { rows } = await pool.query(`
      SELECT wo.type, COUNT(DISTINCT wou.unit_id)::int AS count
      FROM work_orders wo
      JOIN work_order_units wou ON wou.work_order_id = wo.id
      WHERE wo.client_id = $1 AND wo.status = 'approved'
        AND DATE(wo.approved_at AT TIME ZONE 'Asia/Bangkok') = $2
      GROUP BY wo.type
    `, [effectiveClientId, date]);
    const result = { major: 0, minor: 0, fan: 0 };
    for (const r of rows) if (result[r.type] !== undefined) result[r.type] = r.count;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Deduction notes ───────────────────────────────────────────────────────

// GET /api/stats/deductions?client_id=&month=YYYY-MM
// OLD: hospital_id → NEW: client_id
router.get('/deductions', authMiddleware, async (req, res) => {
  const { client_id, hospital_id, month } = req.query;
  const effectiveClientId = client_id || hospital_id;
  if (!effectiveClientId || !month) return res.status(400).json({ error: 'client_id and month required' });
  try {
    const { rows } = await pool.query(
      `SELECT d.*, u.name AS created_by_name FROM deduction_notes d
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.client_id=$1 AND d.month=$2 ORDER BY d.created_at`,
      [effectiveClientId, month]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stats/deductions
router.post('/deductions', authMiddleware, async (req, res) => {
  const { client_id, hospital_id, month, notes } = req.body;
  const effectiveClientId = client_id || hospital_id;
  if (!effectiveClientId || !month) return res.status(400).json({ error: 'client_id and month required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO deduction_notes (client_id, month, notes, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [effectiveClientId, month, notes || '', req.user.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/stats/deductions/:id
// NOTE: deduction_notes has no updated_at column in the new schema — removed that SET clause
router.put('/deductions/:id', authMiddleware, async (req, res) => {
  const { notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE deduction_notes SET notes=$1 WHERE id=$2 RETURNING *`,
      [notes || '', req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/stats/deductions/:id
router.delete('/deductions/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM deduction_notes WHERE id=$1', [req.params.id]);
    res.json({ message: 'deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/rejected-count
router.get('/rejected-count', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM work_orders WHERE status = 'rejected'`
    );
    res.json({ count: rows[0].count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats
// OLD: hospitals, ac_units → NEW: clients, units
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [summary, byStatus, byType, byMonth] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM clients WHERE active=true)::int              AS clients,
          (SELECT COUNT(*) FROM units)::int                                   AS units,
          (SELECT COUNT(*) FROM repair_logs WHERE status='open')::int         AS open_repairs,
          (SELECT COUNT(*) FROM work_orders WHERE status='in_progress')::int  AS in_progress,
          (SELECT COUNT(*) FROM work_orders WHERE status='pending_approval')::int AS pending,
          (SELECT COUNT(*) FROM work_orders WHERE status='approved')::int     AS approved
      `),
      pool.query(`
        SELECT status, COUNT(*)::int AS count FROM work_orders GROUP BY status
      `),
      pool.query(`
        SELECT type, COUNT(*)::int AS count FROM work_orders GROUP BY type
      `),
      pool.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YY') AS month,
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS sort,
          COUNT(*)::int AS count
        FROM work_orders
        WHERE created_at >= NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at)
      `),
    ]);

    res.json({
      ...summary.rows[0],
      by_status: byStatus.rows,
      by_type:   byType.rows,
      by_month:  byMonth.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PHASE 6: dashboard aggregates (all tenant-scoped by client_id) ──────────

// GET /api/stats/overview?client_id=
router.get('/overview', authMiddleware, async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  try {
    const wo = await pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE date_trunc('month',created_at)=date_trunc('month',CURRENT_DATE))::int AS this_month,
             COUNT(*) FILTER (WHERE status IN ('in_progress','pending_admin','pending_approval'))::int AS open
      FROM work_orders WHERE client_id = $1`, [client_id]);
    const units = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE status='active')::int AS active,
             COUNT(*) FILTER (WHERE status='broken')::int AS broken,
             COUNT(*) FILTER (WHERE status='inactive')::int AS inactive
      FROM units WHERE client_id = $1 AND active = true`, [client_id]);
    const pm = await pool.query(`
      SELECT COUNT(*)::int AS overdue FROM pm_plan
      WHERE client_id = $1 AND status='pending' AND scheduled_date < CURRENT_DATE`, [client_id]);
    const repairs = await pool.query(`
      SELECT COUNT(*)::int AS open FROM repair_logs WHERE client_id = $1 AND status='open'`, [client_id]);
    res.json({ wo: wo.rows[0], units: units.rows[0], pm_overdue: pm.rows[0].overdue, repairs_open: repairs.rows[0].open });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/stats/wo-trend?client_id=&months=6
router.get('/wo-trend', authMiddleware, async (req, res) => {
  const { client_id, months = 6 } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  try {
    const { rows } = await pool.query(`
      SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month,
             COUNT(*) FILTER (WHERE type='major')::int AS major,
             COUNT(*) FILTER (WHERE type='minor')::int AS minor,
             COUNT(*) FILTER (WHERE type='fan')::int   AS fan
      FROM work_orders
      WHERE client_id = $1 AND created_at >= date_trunc('month', CURRENT_DATE) - ($2 || ' months')::interval
      GROUP BY 1 ORDER BY 1`, [client_id, months]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/stats/unit-health?client_id=
router.get('/unit-health', authMiddleware, async (req, res) => {
  const { client_id } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const { rows } = await pool.query(`
    SELECT status, COUNT(*)::int AS n FROM units
    WHERE client_id = $1 AND active = true GROUP BY status`, [client_id]);
  res.json(rows);
});

// GET /api/stats/top-repair?client_id=&limit=10
router.get('/top-repair', authMiddleware, async (req, res) => {
  const { client_id, limit = 10 } = req.query;
  if (!client_id) return res.status(400).json({ error: 'client_id required' });
  const { rows } = await pool.query(`
    SELECT u.id AS unit_id, u.asset_code, u.name unit_name, r.name room_name,
           COUNT(rl.id)::int AS repair_count
    FROM repair_logs rl
    JOIN units u      ON rl.unit_id = u.id
    LEFT JOIN rooms r ON u.room_id = r.id
    WHERE rl.client_id = $1
    GROUP BY u.id, u.asset_code, u.name, r.name
    ORDER BY repair_count DESC LIMIT $2`, [client_id, limit]);
  res.json(rows);
});

module.exports = router;
