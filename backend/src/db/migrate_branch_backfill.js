require('dotenv').config();
const pool = require('./pool');

// ADDITIVE — seed the 12 hospital branches into `clients` (single source of
// truth for tenants). They previously lived only in wo_clients (name only).
// name MUST match wo_clients / simple_work_orders.client_name EXACTLY so the
// simple-wo client_id backfill (migrate_simple_wo_client.js) matches by name.
// slug == subdomain == permanent DNS label. code = short uppercase key.
// Re-runnable: ON CONFLICT (code) DO UPDATE sets name/slug/subdomain.
// Run: node src/db/migrate_branch_backfill.js
const BRANCHES = [
  { code: 'PYT1',  name: 'โรงพยาบาลพญาไท 1',          slug: 'phayathai-1' },
  { code: 'PYT2',  name: 'โรงพยาบาลพญาไท 2',          slug: 'phayathai-2' },
  { code: 'PYT3',  name: 'โรงพยาบาลพญาไท 3',          slug: 'phayathai-3' },
  { code: 'PYTNM', name: 'โรงพยาบาลพญาไท นวมินทร์',    slug: 'phayathai-nawamin' },
  { code: 'PYTBW', name: 'โรงพยาบาลพญาไท บ่อวิน',      slug: 'phayathai-bowin' },
  { code: 'PYTPH', name: 'โรงพยาบาลพญาไท พหลโยธิน',    slug: 'phayathai-phaholyothin' },
  { code: 'PYTSR', name: 'โรงพยาบาลพญาไท ศรีราชา',     slug: 'phayathai-sriracha' },
  { code: 'PLPP',  name: 'โรงพยาบาลเปาโล พระประแดง',   slug: 'paolo-prapradaeng' },
  { code: 'PLRS',  name: 'โรงพยาบาลเปาโล รังสิต',      slug: 'paolo-rangsit' },
  { code: 'PLSP',  name: 'โรงพยาบาลเปาโล สมุทรปราการ', slug: 'paolo-samutprakan' },
  { code: 'PLKS',  name: 'โรงพยาบาลเปาโล เกษตร',       slug: 'paolo-kaset' },
  { code: 'PLCC4', name: 'โรงพยาบาลเปาโล โชคชัย 4',    slug: 'paolo-chokchai-4' },
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const b of BRANCHES) {
      await client.query(
        `INSERT INTO clients (code, name, slug, subdomain, active)
         VALUES ($1, $2, $3, $3, true)
         ON CONFLICT (code) DO UPDATE
           SET name = EXCLUDED.name, slug = EXCLUDED.slug, subdomain = EXCLUDED.subdomain`,
        [b.code, b.name, b.slug]
      );
    }
    console.log(`branch backfill complete (${BRANCHES.length} hospitals upserted into clients)`);
  } catch (err) {
    console.error('branch backfill error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
