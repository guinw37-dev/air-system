require('dotenv').config();
const pool = require('./pool');

// ADDITIVE — wo_clients: editable, persistent list of customers (hospitals) for
// the simple-wo ลูกค้า dropdown. Was a hardcoded 12-item list; now stored so
// users can add entries that stick. Seeded with the original 12.
// Run: node src/db/migrate_wo_clients.js
const SEED = [
  'โรงพยาบาลพญาไท 1', 'โรงพยาบาลพญาไท 2', 'โรงพยาบาลพญาไท 3',
  'โรงพยาบาลพญาไท นวมินทร์', 'โรงพยาบาลพญาไท บ่อวิน', 'โรงพยาบาลพญาไท พหลโยธิน',
  'โรงพยาบาลพญาไท ศรีราชา', 'โรงพยาบาลเปาโล พระประแดง', 'โรงพยาบาลเปาโล รังสิต',
  'โรงพยาบาลเปาโล สมุทรปราการ', 'โรงพยาบาลเปาโล เกษตร', 'โรงพยาบาลเปาโล โชคชัย 4',
];

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS wo_clients (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    for (const name of SEED) {
      await client.query('INSERT INTO wo_clients (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
    }
    console.log(`wo_clients migration complete (${SEED.length} seeded, no data dropped)`);
  } catch (err) {
    console.error('wo_clients migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
