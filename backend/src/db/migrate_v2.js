require('dotenv').config();
const pool = require('./pool');

async function migrate() {
  try {
    await pool.query(`
      ALTER TABLE signatures
      ADD CONSTRAINT IF NOT EXISTS signatures_order_role_unique
      UNIQUE (work_order_id, role);
    `);
    console.log('Migration v2 success');
  } catch (err) {
    // constraint may already exist
    if (err.message.includes('already exists')) {
      console.log('Constraint already exists — OK');
    } else {
      console.error(err.message);
    }
  } finally {
    await pool.end();
  }
}
migrate();
