const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// GET /api/stats/floor-status?hospital_id=
router.get('/floor-status', authMiddleware, async (req, res) => {
  const { hospital_id } = req.query;
  try {
    const { rows } = await pool.query(`
      SELECT
        a.id, a.ac_code, a.name ac_name, a.type ac_type, a.capacity_btu,
        d.name dept_name, d.id dept_id,
        f.name floor_name, f.id floor_id,
        b.name building_name, b.id building_id, COALESCE(b.site, h.name) AS site,
        h.name hospital_name, h.id hospital_id,
        (
          SELECT wo.approved_at
          FROM work_order_items woi JOIN work_orders wo ON wo.id = woi.work_order_id
          WHERE woi.ac_unit_id = a.id AND wo.status = 'approved'
          ORDER BY wo.approved_at DESC LIMIT 1
        ) AS last_cleaned_at,
        (
          SELECT wo.order_no
          FROM work_order_items woi JOIN work_orders wo ON wo.id = woi.work_order_id
          WHERE woi.ac_unit_id = a.id AND wo.status = 'approved'
          ORDER BY wo.approved_at DESC LIMIT 1
        ) AS last_wo_no
      FROM ac_units a
      JOIN departments d ON a.department_id = d.id
      JOIN floors f      ON d.floor_id = f.id
      JOIN buildings b   ON f.building_id = b.id
      JOIN hospitals h   ON b.hospital_id = h.id
      WHERE ($1::int IS NULL OR h.id = $1)
      ORDER BY b.name, f.name, a.ac_code
    `, [hospital_id || null]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/monthly-detail?hospital_id=
router.get('/monthly-detail', authMiddleware, async (req, res) => {
  const { hospital_id } = req.query;
  try {
    const { rows } = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', wo.approved_at), 'MM/YYYY') AS month,
        DATE_TRUNC('month', wo.approved_at) AS month_sort,
        COUNT(DISTINCT CASE WHEN wo.type = 'major' THEN woi.ac_unit_id END)::int AS major_count,
        COUNT(DISTINCT CASE WHEN wo.type = 'minor' THEN woi.ac_unit_id END)::int AS minor_count,
        COUNT(DISTINCT CASE WHEN wo.type = 'fan'   THEN woi.ac_unit_id END)::int AS fan_count
      FROM work_orders wo
      JOIN work_order_items woi ON woi.work_order_id = wo.id
      WHERE wo.status = 'approved'
        AND wo.approved_at >= NOW() - INTERVAL '12 months'
        AND ($1::int IS NULL OR wo.hospital_id = $1)
      GROUP BY DATE_TRUNC('month', wo.approved_at)
      ORDER BY DATE_TRUNC('month', wo.approved_at)
    `, [hospital_id || null]);

    // Also count repair_logs created per month
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

// GET /api/stats/daily?date=YYYY-MM-DD&hospital_id=
router.get('/daily', authMiddleware, async (req, res) => {
  const { date, hospital_id } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  try {
    const { rows } = await pool.query(`
      SELECT w.*,
        h.name hospital_name,
        t1.name tech1_name, t2.name tech2_name,
        COUNT(DISTINCT wi.id)::int  item_count,
        COUNT(DISTINCT p.id)::int   photo_count
      FROM work_orders w
      LEFT JOIN hospitals h  ON w.hospital_id = h.id
      LEFT JOIN users t1     ON w.tech1_id = t1.id
      LEFT JOIN users t2     ON w.tech2_id = t2.id
      LEFT JOIN work_order_items wi ON wi.work_order_id = w.id
      LEFT JOIN ac_photos p  ON p.work_order_item_id = wi.id
      WHERE DATE(w.created_at AT TIME ZONE 'Asia/Bangkok') = $1
        AND ($2::int IS NULL OR w.hospital_id = $2)
      GROUP BY w.id, h.name, t1.name, t2.name
      ORDER BY w.created_at DESC
    `, [date, hospital_id || null]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/contract-summary?hospital_id=&year=YYYY
router.get('/contract-summary', authMiddleware, async (req, res) => {
  const { hospital_id, year } = req.query;
  if (!hospital_id) return res.status(400).json({ error: 'hospital_id required' });
  const y = year || new Date().getFullYear();
  try {
    // Plan = total AC count by site + ac_type
    const { rows: plan } = await pool.query(`
      SELECT COALESCE(b.site, h.name) AS site, a.type AS ac_type, COUNT(a.id)::int AS plan
      FROM ac_units a
      JOIN departments d ON a.department_id = d.id
      JOIN floors f ON d.floor_id = f.id
      JOIN buildings b ON f.building_id = b.id
      JOIN hospitals h ON b.hospital_id = h.id
      WHERE h.id = $1 AND a.type IS NOT NULL AND a.type <> ''
      GROUP BY COALESCE(b.site, h.name), a.type
      ORDER BY COALESCE(b.site, h.name), a.type
    `, [hospital_id]);

    // Actual = distinct ACs cleaned per type in year (cumulative)
    const { rows: actual } = await pool.query(`
      SELECT wo.type AS wo_type, COALESCE(b.site, h.name) AS site,
             a.type AS ac_type, COUNT(DISTINCT a.id)::int AS actual
      FROM work_order_items woi
      JOIN work_orders wo ON wo.id = woi.work_order_id
      JOIN ac_units a ON a.id = woi.ac_unit_id
      JOIN departments d ON a.department_id = d.id
      JOIN floors f ON d.floor_id = f.id
      JOIN buildings b ON f.building_id = b.id
      JOIN hospitals h ON b.hospital_id = h.id
      WHERE wo.status = 'approved'
        AND EXTRACT(YEAR FROM wo.approved_at AT TIME ZONE 'Asia/Bangkok') = $2
        AND h.id = $1
      GROUP BY wo.type, COALESCE(b.site, h.name), a.type
    `, [hospital_id, y]);

    // Total AC count per type (for bar chart %)
    const { rows: totals } = await pool.query(`
      SELECT a.type AS ac_type, COUNT(a.id)::int AS total
      FROM ac_units a
      JOIN departments d ON a.department_id = d.id
      JOIN floors f ON d.floor_id = f.id
      JOIN buildings b ON f.building_id = b.id
      WHERE b.hospital_id = $1 AND a.type IS NOT NULL AND a.type <> ''
      GROUP BY a.type
    `, [hospital_id]);

    const actualMap = {};
    for (const r of actual) {
      const key = `${r.wo_type}::${r.site}::${r.ac_type}`;
      actualMap[key] = r.actual;
    }

    const breakdown = plan.map((p) => {
      const maj = actualMap[`major::${p.site}::${p.ac_type}`] || 0;
      const min = actualMap[`minor::${p.site}::${p.ac_type}`] || 0;
      const fan = actualMap[`fan::${p.site}::${p.ac_type}`] || 0;
      return { site: p.site, ac_type: p.ac_type, plan: p.plan, major_actual: maj, minor_actual: min, fan_actual: fan };
    });

    const totalByType = Object.fromEntries(totals.map((t) => [t.ac_type, t.total]));
    const woTypeTotals = { major: 0, minor: 0, fan: 0 };
    const woPlan = { major: 0, minor: 0, fan: 0 };
    for (const r of actual) {
      if (woTypeTotals[r.wo_type] !== undefined) woTypeTotals[r.wo_type] += r.actual;
    }
    // plan for each wo_type = total distinct ACs in hospital
    const { rows: totalAc } = await pool.query(
      `SELECT COUNT(a.id)::int AS cnt FROM ac_units a
       JOIN departments d ON a.department_id=d.id JOIN floors f ON d.floor_id=f.id
       JOIN buildings b ON f.building_id=b.id WHERE b.hospital_id=$1`, [hospital_id]);
    woPlan.major = totalAc[0].cnt;
    woPlan.minor = totalAc[0].cnt;
    woPlan.fan   = totalAc[0].cnt;

    res.json({ year: y, breakdown, totalByType, woTypeTotals, woPlan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/daily-count?hospital_id=&date=YYYY-MM-DD
router.get('/daily-count', authMiddleware, async (req, res) => {
  const { hospital_id, date } = req.query;
  if (!hospital_id || !date) return res.status(400).json({ error: 'hospital_id and date required' });
  try {
    const { rows } = await pool.query(`
      SELECT wo.type, COUNT(DISTINCT woi.ac_unit_id)::int AS count
      FROM work_orders wo
      JOIN work_order_items woi ON woi.work_order_id = wo.id
      WHERE wo.hospital_id = $1 AND wo.status = 'approved'
        AND DATE(wo.approved_at AT TIME ZONE 'Asia/Bangkok') = $2
      GROUP BY wo.type
    `, [hospital_id, date]);
    const result = { major: 0, minor: 0, fan: 0 };
    for (const r of rows) if (result[r.type] !== undefined) result[r.type] = r.count;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Deduction notes ───────────────────────────────────────────────────────

// GET /api/stats/deductions?hospital_id=&month=YYYY-MM
router.get('/deductions', authMiddleware, async (req, res) => {
  const { hospital_id, month } = req.query;
  if (!hospital_id || !month) return res.status(400).json({ error: 'hospital_id and month required' });
  try {
    const { rows } = await pool.query(
      `SELECT d.*, u.name AS created_by_name FROM deduction_notes d
       LEFT JOIN users u ON u.id = d.created_by
       WHERE d.hospital_id=$1 AND d.month=$2 ORDER BY d.created_at`,
      [hospital_id, month]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stats/deductions
router.post('/deductions', authMiddleware, async (req, res) => {
  const { hospital_id, month, notes } = req.body;
  if (!hospital_id || !month) return res.status(400).json({ error: 'hospital_id and month required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO deduction_notes (hospital_id, month, notes, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [hospital_id, month, notes || '', req.user.id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/stats/deductions/:id
router.put('/deductions/:id', authMiddleware, async (req, res) => {
  const { notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE deduction_notes SET notes=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
      [notes || '', req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/stats/deductions/:id
router.delete('/deductions/:id', authMiddleware, async (req, res) => {
  await pool.query('DELETE FROM deduction_notes WHERE id=$1', [req.params.id]);
  res.json({ message: 'deleted' });
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
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [summary, byStatus, byType, byMonth] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM hospitals WHERE active=true)::int             AS hospitals,
          (SELECT COUNT(*) FROM ac_units)::int                                AS ac_units,
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

module.exports = router;
