require('dotenv').config();
const pool = require('./pool');

// ADDITIVE migration for phase 2 — runs on a DB that ALREADY holds real data
// (1,231 units etc.). Unlike migrate.js this does NOT drop anything; it only
// CREATE TABLE IF NOT EXISTS the new phase-2 table(s). Safe + idempotent.
//
// Run on Coolify Terminal:  node src/db/migrate_phase2.js
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS work_order_status_history (
        id            SERIAL PRIMARY KEY,
        work_order_id INT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
        from_status   VARCHAR(20),
        to_status     VARCHAR(20) NOT NULL,
        changed_by    INT REFERENCES users(id),
        reason        TEXT,
        changed_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_wo_history_wo ON work_order_status_history(work_order_id)'
    );
    console.log('Phase-2 migration complete — work_order_status_history ready (no data dropped)');
  } catch (err) {
    console.error('Phase-2 migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
