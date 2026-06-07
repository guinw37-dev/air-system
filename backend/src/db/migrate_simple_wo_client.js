require('dotenv').config();
const pool = require('./pool');

// ADDITIVE — give simple_work_orders a real tenant key (client_id → clients),
// so per-branch subdomains can scope them. Was FLAT: only free-text client_name.
// Backfill matches existing rows to clients by exact name (the 12 hospitals are
// seeded into clients by migrate_branch_backfill.js first). Rows whose
// client_name matches nothing stay client_id IS NULL = "unassigned" (visible on
// apex/admin only). Run AFTER migrate:branch-backfill, BEFORE migrate:views.
// Run: node src/db/migrate_simple_wo_client.js
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE simple_work_orders ADD COLUMN IF NOT EXISTS client_id INT REFERENCES clients(id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_simple_wo_client ON simple_work_orders(client_id)`);
    const r = await client.query(`
      UPDATE simple_work_orders s SET client_id = c.id
        FROM clients c
       WHERE s.client_id IS NULL AND TRIM(s.client_name) = c.name
    `);
    const { rows: [{ unmatched }] } = await client.query(
      `SELECT COUNT(*) AS unmatched FROM simple_work_orders WHERE client_id IS NULL AND deleted_at IS NULL`
    );
    console.log(`simple-wo client_id migration complete (backfilled ${r.rowCount}, still unassigned ${unmatched})`);
  } catch (err) {
    console.error('simple-wo client_id migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
