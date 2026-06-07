const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

// Schema-per-tenant: every aggregate is already scoped to the current branch by
// req.db (SET search_path), so there is no client_id filter / clients JOIN.

// GET /api/stats/floor-status
router.get('/floor-status', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(`
      SELECT
        u.id, u.asset_code, u.name unit_name, u.family, u.capacity_btu,
        r.name room_name, r.id room_id,
        f.name floor_name, f.id floor_id,
        b.name building_name, b.id building_id,
        s.name site_name,
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
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      LEFT JOIN sites s    ON b.site_id = s.id
      ORDER BY b.name, f.name, u.asset_code
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/monthly-detail
router.get('/monthly-detail', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(`
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
      GROUP BY DATE_TRUNC('month', wo.approved_at)
      ORDER BY DATE_TRUNC('month', wo.approved_at)
    `);

    const { rows: repairs } = await req.db(`
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

// GET /api/stats/daily?date=YYYY-MM-DD
router.get('/daily', authMiddleware, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    const { rows } = await req.db(`
      SELECT w.*,
        COUNT(DISTINCT wou.id)::int  item_count,
        COUNT(DISTINCT p.id)::int    photo_count
      FROM work_orders w
      LEFT JOIN work_order_units wou  ON wou.work_order_id = w.id
      LEFT JOIN work_order_photos p   ON p.work_order_unit_id = wou.id
      WHERE DATE(w.created_at AT TIME ZONE 'Asia/Bangkok') = $1
      GROUP BY w.id
      ORDER BY w.created_at DESC
    `, [date]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/contract-summary?year=YYYY
router.get('/contract-summary', authMiddleware, async (req, res) => {
  const { year } = req.query;
  const y = year || new Date().getFullYear();
  try {
    const { rows: plan } = await req.db(`
      SELECT COALESCE(s.name, '-') AS site, u.family AS ac_type, COUNT(u.id)::int AS plan
      FROM units u
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      LEFT JOIN sites s    ON b.site_id = s.id
      WHERE u.family IS NOT NULL AND u.family <> ''
      GROUP BY COALESCE(s.name, '-'), u.family
      ORDER BY COALESCE(s.name, '-'), u.family
    `);

    const { rows: actual } = await req.db(`
      SELECT wo.type AS wo_type, COALESCE(s.name, '-') AS site,
             u.family AS ac_type, COUNT(DISTINCT u.id)::int AS actual
      FROM work_order_units wou
      JOIN work_orders wo  ON wo.id = wou.work_order_id
      JOIN units u         ON u.id = wou.unit_id
      LEFT JOIN rooms r    ON u.room_id = r.id
      LEFT JOIN floors f   ON r.floor_id = f.id
      LEFT JOIN buildings b ON f.building_id = b.id
      LEFT JOIN sites s    ON b.site_id = s.id
      WHERE wo.status = 'approved'
        AND EXTRACT(YEAR FROM wo.approved_at AT TIME ZONE 'Asia/Bangkok') = $1
      GROUP BY wo.type, COALESCE(s.name, '-'), u.family
    `, [y]);

    const { rows: totals } = await req.db(`
      SELECT u.family AS ac_type, COUNT(u.id)::int AS total
      FROM units u
      WHERE u.family IS NOT NULL AND u.family <> ''
      GROUP BY u.family
    `);

    const actualMap = {};
    for (const r of actual) actualMap[`${r.wo_type}::${r.site}::${r.ac_type}`] = r.actual;

    const breakdown = plan.map((p) => ({
      site: p.site, ac_type: p.ac_type, plan: p.plan,
      major_actual: actualMap[`major::${p.site}::${p.ac_type}`] || 0,
      minor_actual: actualMap[`minor::${p.site}::${p.ac_type}`] || 0,
      fan_actual:   actualMap[`fan::${p.site}::${p.ac_type}`]   || 0,
    }));

    const totalByType = Object.fromEntries(totals.map((t) => [t.ac_type, t.total]));
    const woTypeTotals = { major: 0, minor: 0, fan: 0 };
    for (const r of actual) if (woTypeTotals[r.wo_type] !== undefined) woTypeTotals[r.wo_type] += r.actual;

    const { rows: totalUnit } = await req.db(`SELECT COUNT(u.id)::int AS cnt FROM units u`);
    const woPlan = { major: totalUnit[0].cnt, minor: totalUnit[0].cnt, fan: totalUnit[0].cnt };

    res.json({ year: y, breakdown, totalByType, woTypeTotals, woPlan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/daily-count?date=YYYY-MM-DD
router.get('/daily-count', authMiddleware, async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    const { rows } = await req.db(`
      SELECT wo.type, COUNT(DISTINCT wou.unit_id)::int AS count
      FROM work_orders wo
      JOIN work_order_units wou ON wou.work_order_id = wo.id
      WHERE wo.status = 'approved'
        AND DATE(wo.approved_at AT TIME ZONE 'Asia/Bangkok') = $1
      GROUP BY wo.type
    `, [date]);
    const result = { major: 0, minor: 0, fan: 0 };
    for (const r of rows) if (result[r.type] !== undefined) result[r.type] = r.count;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Deduction notes (branch-scoped) ───────────────────────────────────────
router.get('/deductions', authMiddleware, async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month required' });
  try {
    const { rows } = await req.db(
      `SELECT d.*, u.name AS created_by_name FROM deduction_notes d
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.month=$1 ORDER BY d.created_at`, [month]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/deductions', authMiddleware, async (req, res) => {
  const { month, notes } = req.body;
  if (!month) return res.status(400).json({ error: 'month required' });
  try {
    const { rows } = await req.db(
      `INSERT INTO deduction_notes (month, notes, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [month, notes || '', req.user.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/deductions/:id', authMiddleware, async (req, res) => {
  const { notes } = req.body;
  try {
    const { rows } = await req.db(
      `UPDATE deduction_notes SET notes=$1 WHERE id=$2 RETURNING *`,
      [notes || '', req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/deductions/:id', authMiddleware, async (req, res) => {
  try {
    await req.db('DELETE FROM deduction_notes WHERE id=$1', [req.params.id]);
    res.json({ message: 'deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/rejected-count
router.get('/rejected-count', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(`SELECT COUNT(*)::int AS count FROM work_orders WHERE status = 'rejected'`);
    res.json({ count: rows[0].count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats — branch overview
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [summary, byStatus, byType, byMonth] = await Promise.all([
      req.db(`
        SELECT
          (SELECT COUNT(*) FROM units)::int                                   AS units,
          (SELECT COUNT(*) FROM repair_logs WHERE status='open')::int         AS open_repairs,
          (SELECT COUNT(*) FROM work_orders WHERE status='in_progress')::int  AS in_progress,
          (SELECT COUNT(*) FROM work_orders WHERE status='pending_approval')::int AS pending,
          (SELECT COUNT(*) FROM work_orders WHERE status='approved')::int     AS approved
      `),
      req.db(`SELECT status, COUNT(*)::int AS count FROM work_orders GROUP BY status`),
      req.db(`SELECT type, COUNT(*)::int AS count FROM work_orders GROUP BY type`),
      req.db(`
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

// ── Dashboard aggregates (branch-scoped) ────────────────────────────────────

// GET /api/stats/overview
router.get('/overview', authMiddleware, async (req, res) => {
  try {
    const wo = await req.db(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE date_trunc('month',created_at)=date_trunc('month',CURRENT_DATE))::int AS this_month,
             COUNT(*) FILTER (WHERE status IN ('in_progress','pending_admin','pending_approval'))::int AS open
      FROM work_orders`);
    const units = await req.db(`
      SELECT COUNT(*) FILTER (WHERE status='active')::int AS active,
             COUNT(*) FILTER (WHERE status='broken')::int AS broken,
             COUNT(*) FILTER (WHERE status='inactive')::int AS inactive
      FROM units WHERE active = true`);
    const pm = await req.db(`
      SELECT COUNT(*)::int AS overdue FROM pm_plan
      WHERE status='pending' AND scheduled_date < CURRENT_DATE`);
    const repairs = await req.db(`SELECT COUNT(*)::int AS open FROM repair_logs WHERE status='open'`);
    res.json({ wo: wo.rows[0], units: units.rows[0], pm_overdue: pm.rows[0].overdue, repairs_open: repairs.rows[0].open });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/stats/wo-trend?months=6
router.get('/wo-trend', authMiddleware, async (req, res) => {
  const { months = 6 } = req.query;
  try {
    const { rows } = await req.db(`
      SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month,
             COUNT(*) FILTER (WHERE type='major')::int AS major,
             COUNT(*) FILTER (WHERE type='minor')::int AS minor,
             COUNT(*) FILTER (WHERE type='fan')::int   AS fan
      FROM work_orders
      WHERE created_at >= date_trunc('month', CURRENT_DATE) - ($1 || ' months')::interval
      GROUP BY 1 ORDER BY 1`, [months]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/stats/unit-health
router.get('/unit-health', authMiddleware, async (req, res) => {
  const { rows } = await req.db(`
    SELECT status, COUNT(*)::int AS n FROM units WHERE active = true GROUP BY status`);
  res.json(rows);
});

// GET /api/stats/top-repair?limit=10
router.get('/top-repair', authMiddleware, async (req, res) => {
  const { limit = 10 } = req.query;
  const { rows } = await req.db(`
    SELECT u.id AS unit_id, u.asset_code, u.name unit_name, r.name room_name,
           COUNT(rl.id)::int AS repair_count
    FROM repair_logs rl
    JOIN units u      ON rl.unit_id = u.id
    LEFT JOIN rooms r ON u.room_id = r.id
    GROUP BY u.id, u.asset_code, u.name, r.name
    ORDER BY repair_count DESC LIMIT $1`, [limit]);
  res.json(rows);
});

module.exports = router;
