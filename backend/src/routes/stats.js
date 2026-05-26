const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

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
