const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

// ── GET /api/pdf/work-orders/:id ───────────────────────────────────────────
// The work-order PDF report depended on the old work_order_items.measurements/
// checklist JSONB columns, which the new schema replaces with inspection_values
// (1 row per template item). Rebuilding the 4 report layouts on top of
// inspection_values is its own later phase (see REPORT_phase0.md §3 / phase-1
// scope item 6 — reports deferred). Until then this returns a clear 501 instead
// of crashing on dropped tables.
router.get('/work-orders/:id', authMiddleware, (req, res) => {
  res.status(501).json({ error: 'รายงาน PDF จะ rebuild ในเฟสถัดไป (ใช้ inspection_values แทน JSONB เดิม)' });
});

module.exports = router;
