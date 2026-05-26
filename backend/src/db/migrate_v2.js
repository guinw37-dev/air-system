require('dotenv').config();
const pool = require('./pool');

async function migrate() {
  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'signatures_order_role_unique'
        ) THEN
          ALTER TABLE signatures
          ADD CONSTRAINT signatures_order_role_unique UNIQUE (work_order_id, role);
        END IF;
      END $$;
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
