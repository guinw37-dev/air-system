const pool = require('../db/pool');

// Composable work-order access guard: checks role AND current status, and
// (for non-admins) that the user is an assignee of the WO.
//
//   router.post('/:id/submit',
//     authMiddleware,
//     requireWoRole({ roles: ['technician', 'admin'], statuses: ['in_progress'], assigneeOnly: true }),
//     handler)
//
// On success it attaches req.wo (the loaded row) so the handler need not re-fetch.
function requireWoRole({ roles = [], statuses = null, assigneeOnly = false } = {}) {
  return async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT * FROM work_orders WHERE id = $1', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      const wo = rows[0];

      if (roles.length && !roles.includes(req.user.role)) {
        return res.status(403).json({ error: `role ${req.user.role} ไม่มีสิทธิ์ทำขั้นตอนนี้` });
      }
      if (statuses && !statuses.includes(wo.status)) {
        return res.status(409).json({ error: `ทำขั้นตอนนี้ไม่ได้ในสถานะ ${wo.status}` });
      }
      // assignee restriction — admins bypass
      if (assigneeOnly && req.user.role !== 'admin') {
        const { rows: a } = await pool.query(
          'SELECT 1 FROM work_order_assignees WHERE work_order_id = $1 AND user_id = $2',
          [req.params.id, req.user.id]
        );
        if (!a.length) return res.status(403).json({ error: 'คุณไม่ใช่ช่างผู้รับผิดชอบใบงานนี้' });
      }
      req.wo = wo;
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { requireWoRole };
