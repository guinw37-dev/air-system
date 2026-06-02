require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

// Clean reset migrate: DROP every table then recreate from schema.sql.
// schema.sql uses CREATE TABLE IF NOT EXISTS, so on a DB that still holds the
// OLD schema (e.g. buildings.hospital_id, users role CHECK admin/owner/...) a
// plain re-run skips the existing tables and leaves stale columns/constraints —
// exactly what caused "column site_id does not exist" and the users_role_check
// violation. Dropping first guarantees a clean 16-table schema.
//
// SAFE here because air-system has NO real data yet. DO NOT run against a DB
// that already holds production data.
async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      DROP TABLE IF EXISTS
        part_requisitions, repair_logs, inspection_values,
        work_order_photos, signatures, work_order_assignees,
        work_order_units, work_orders, inspection_template_items,
        units, rooms, floors, buildings, sites,
        deduction_notes, pm_plan, users, clients,
        ac_photos, work_order_items, ac_units, departments, hospitals
      CASCADE
    `);
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration complete — schema reset and recreated');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
