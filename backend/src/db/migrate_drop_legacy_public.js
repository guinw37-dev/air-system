require('dotenv').config();
const pool = require('./pool');

// DESTRUCTIVE — drop the LEGACY pre-cutover tenant tables from the `public`
// schema. After schema-per-tenant, every tenant table lives inside each branch
// schema; the old copies in public still hold the pre-cutover mixed data (all
// clients together) and must go so apex no longer shows them. This touches ONLY
// public — branch schemas (pts1/pts2/…) are untouched.
// KEPT in public: clients (registry), users (super-admins),
//   inspection_template_items, photo_point_templates, notifications.
// Run once: node src/db/migrate_drop_legacy_public.js
const VIEWS = ['vw_simple_wo_major', 'vw_simple_wo_minor', 'vw_simple_wo_fan'];
const TABLES = [
  'simple_work_orders',
  'work_order_photos', 'inspection_values', 'work_order_units', 'work_order_assignees',
  'signatures', 'sign_tokens', 'work_order_status_history', 'work_orders',
  'repair_logs', 'part_requisitions', 'pm_plan', 'deduction_notes',
  'units', 'rooms', 'floors', 'buildings', 'sites',
];

(async () => {
  const c = await pool.connect();
  try {
    for (const v of VIEWS) await c.query(`DROP VIEW IF EXISTS public.${v} CASCADE`);
    for (const t of TABLES) await c.query(`DROP TABLE IF EXISTS public.${t} CASCADE`);
    console.log(`legacy public tenant tables dropped (${TABLES.length} tables, ${VIEWS.length} views)`);
    console.log('kept in public: clients, users, inspection_template_items, photo_point_templates, notifications');
  } catch (err) {
    console.error('drop-legacy-public error:', err.message);
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
})();
