require('dotenv').config();
const pool = require('./pool');

// ADDITIVE — grid_rows for the ล้างย่อย (minor) and พัดลม (fan) work-order
// forms, which are multi-unit checkbox grids instead of the single-unit
// ล้างใหญ่ (major) checklist. Each row: { name, checks: [bool...], broken }.
// recommendation = ข้อแนะนำ free text. Run: node src/db/migrate_simple_wo_grid.js
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE simple_work_orders ADD COLUMN IF NOT EXISTS grid_rows JSONB DEFAULT '[]'::jsonb`);
    await client.query(`ALTER TABLE simple_work_orders ADD COLUMN IF NOT EXISTS recommendation TEXT`);
    console.log('grid_rows migration complete (no data dropped)');
  } catch (err) {
    console.error('grid_rows migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
