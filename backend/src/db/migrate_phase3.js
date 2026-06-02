require('dotenv').config();
const pool = require('./pool');

// ADDITIVE phase-3 migration — runs on the live DB without dropping anything.
// Adds sign_tokens (area_owner no-login signing) + notifications.
// Run on Coolify Terminal:  node src/db/migrate_phase3.js   (or npm run migrate:phase3)
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS sign_tokens (
        id            SERIAL PRIMARY KEY,
        work_order_id INT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
        token_hash    VARCHAR(64) NOT NULL UNIQUE,
        used_at       TIMESTAMPTZ,
        expires_at    TIMESTAMPTZ NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id            SERIAL PRIMARY KEY,
        user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        work_order_id INT REFERENCES work_orders(id) ON DELETE CASCADE,
        type          VARCHAR(30) NOT NULL,
        message       TEXT NOT NULL,
        read_at       TIMESTAMPTZ,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_sign_tokens_wo ON sign_tokens(work_order_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at)');
    console.log('Phase-3 migration complete — sign_tokens + notifications ready (no data dropped)');
  } catch (err) {
    console.error('Phase-3 migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
