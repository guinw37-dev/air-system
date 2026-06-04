require('dotenv').config();
const pool = require('./pool');

// ADDITIVE — adds a 4th signature slot to simple_work_orders for
// แผนกช่างอาคาร (building maintenance). Role 'building' signs this slot.
// Run: node src/db/migrate_simple_wo_building_sig.js
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE simple_work_orders ADD COLUMN IF NOT EXISTS sig_building TEXT`);
    await client.query(`ALTER TABLE simple_work_orders ADD COLUMN IF NOT EXISTS sig_building_name VARCHAR(150)`);
    // allow the new 'building' role on users.role (rebuild the CHECK constraint)
    await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
    await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('technician','checker','central_admin','approver','admin','building'))`);
    console.log('building signature migration complete (no data dropped)');
  } catch (err) {
    console.error('building signature migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
