require('dotenv').config();
const pool = require('./pool');

// ADDITIVE — slug + subdomain on clients, so a request host like
// "phayathai-1.<domain>" can resolve to one client (สาขา). Nullable + partial
// unique so existing NULL-slug clients (e.g. dev PTS1/PTS2) don't conflict.
// Run: node src/db/migrate_client_subdomain.js
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS slug      VARCHAR(63)`);
    await client.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS subdomain VARCHAR(63)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_slug      ON clients(slug)      WHERE slug      IS NOT NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_subdomain ON clients(subdomain) WHERE subdomain IS NOT NULL`);
    console.log('client subdomain migration complete (slug + subdomain, no data dropped)');
  } catch (err) {
    console.error('client subdomain migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
