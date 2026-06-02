require('dotenv').config();
const pool = require('./pool');

// ADDITIVE phase-5 migration — adds pm_plan.note (reschedule/skip reason).
// Run on Coolify Terminal:  node src/db/migrate_phase5.js  (or npm run migrate:phase5)
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE pm_plan ADD COLUMN IF NOT EXISTS note TEXT');
    await client.query('CREATE INDEX IF NOT EXISTS idx_pmplan_status ON pm_plan(status)');
    console.log('Phase-5 migration complete — pm_plan.note ready (no data dropped)');
  } catch (err) {
    console.error('Phase-5 migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
