require('dotenv').config();
const pool = require('./pool');

// ADDITIVE — soft-delete + edit audit for simple_work_orders.
// deleted_at: set instead of hard-deleting (recoverable). updated_at: bumped on
// every edit. Run: node src/db/migrate_soft_delete.js
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE simple_work_orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE simple_work_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_swo_deleted_at ON simple_work_orders(deleted_at)`);
    console.log('soft-delete migration complete (no data dropped)');
  } catch (err) {
    console.error('soft-delete migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
