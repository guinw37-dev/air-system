require('dotenv').config();
const pool = require('./pool');
const bcrypt = require('bcryptjs');

// ADDITIVE migration — add the 'checker' role to users.role CHECK + seed a
// checker test user. No data dropped. Run: node src/db/migrate_role_checker.js
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
    await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('technician','checker','central_admin','approver','admin'))`);
    const hash = await bcrypt.hash('admin1234', 10);
    await client.query(`
      INSERT INTO users (name, username, password_hash, role, phone)
      VALUES ('Checker Admin', 'checker', $1, 'checker', '')
      ON CONFLICT (username) DO NOTHING
    `, [hash]);
    console.log('Role migration complete — checker role enabled + checker user seeded (pw admin1234)');
  } catch (err) {
    console.error('Role migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
