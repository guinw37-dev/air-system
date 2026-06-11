require('dotenv').config();
const pool = require('./pool');
const { slugToSchema } = require('../utils/schema');

// ONE-TIME — when the approval workflow ships, every pre-existing ใบงาน should
// count as already approved (no back-filling a Checker/Approver step on history).
// Flips status='submitted' → 'approved' (stamping approved_at) on public + every
// branch schema. Idempotent: only touches rows still 'submitted'. Run ONCE right
// after deploy; new ใบงาน created afterwards correctly start at 'submitted'.
//   npm run migrate:wo-approve-legacy
async function approveIn(c, label) {
  const { rows: has } = await c.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'simple_work_orders'`);
  if (!has.length) { console.log(`  - ${label}: no simple_work_orders, skip`); return; }
  const { rowCount } = await c.query(
    `UPDATE simple_work_orders
     SET status = 'approved', approved_at = COALESCE(approved_at, updated_at, created_at)
     WHERE status = 'submitted' AND deleted_at IS NULL`);
  console.log(`  ✓ ${label}: approved ${rowCount} legacy ใบงาน`);
}

(async () => {
  const c = await pool.connect();
  try {
    await c.query(`SET search_path TO public`);
    await approveIn(c, 'public');
    const { rows } = await c.query(
      `SELECT slug, schema_name FROM clients WHERE active = true AND schema_name IS NOT NULL`);
    for (const r of rows) {
      const schema = slugToSchema(r.schema_name || r.slug);
      await c.query(`SET search_path TO "${schema}", public`);
      await approveIn(c, schema);
    }
    console.log('legacy approve done.');
  } catch (err) {
    console.error('wo-approve-legacy error:', err.message);
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
})();
