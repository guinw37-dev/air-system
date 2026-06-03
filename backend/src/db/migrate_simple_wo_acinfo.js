require('dotenv').config();
const pool = require('./pool');

// ADDITIVE — adds ac_info (รายละเอียดเครื่องปรับอากาศ) to simple_work_orders.
// ac_info JSONB = { detail, location, kind('water'|'refrigerant'|'other'), brand, model, cooling_size }
// Run: node src/db/migrate_simple_wo_acinfo.js
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(
      `ALTER TABLE simple_work_orders ADD COLUMN IF NOT EXISTS ac_info JSONB DEFAULT '{}'::jsonb`
    );
    console.log('ac_info migration complete (no data dropped)');
  } catch (err) {
    console.error('ac_info migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
