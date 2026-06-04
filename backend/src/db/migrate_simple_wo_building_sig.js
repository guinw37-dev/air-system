require('dotenv').config();
const pool = require('./pool');

// ADDITIVE — adds the extra signature slots to simple_work_orders:
//   sig_supervisor (หัวหน้าช่าง, role 'supervisor') and
//   sig_building   (ช่างอาคาร,  role 'building').
// Also widens the users.role CHECK to allow both new roles.
// Run: node src/db/migrate_simple_wo_building_sig.js
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE simple_work_orders ADD COLUMN IF NOT EXISTS sig_supervisor TEXT`);
    await client.query(`ALTER TABLE simple_work_orders ADD COLUMN IF NOT EXISTS sig_supervisor_name VARCHAR(150)`);
    await client.query(`ALTER TABLE simple_work_orders ADD COLUMN IF NOT EXISTS sig_building TEXT`);
    await client.query(`ALTER TABLE simple_work_orders ADD COLUMN IF NOT EXISTS sig_building_name VARCHAR(150)`);
    // allow the new 'supervisor' / 'building' roles on users.role (rebuild CHECK)
    await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
    await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('technician','checker','central_admin','approver','admin','building','supervisor'))`);
    console.log('extra signature slots migration complete (no data dropped)');
  } catch (err) {
    console.error('extra signature migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
