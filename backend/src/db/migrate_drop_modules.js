require('dotenv').config();
const pool = require('./pool');
const { slugToSchema } = require('../utils/schema');

// DESTRUCTIVE — drop the removed modules' tables (pm_plan, part_requisitions)
// from every active branch schema and from public. Run once after deploying the
// module removal. Run: node src/db/migrate_drop_modules.js
const DROP = ['pm_plan', 'part_requisitions'];

(async () => {
  const c = await pool.connect();
  try {
    // public (legacy single-schema tables, if any remained)
    for (const t of DROP) await c.query(`DROP TABLE IF EXISTS public.${t} CASCADE`);
    console.log('dropped from public:', DROP.join(', '));

    const { rows } = await pool.query(
      `SELECT slug, schema_name FROM clients WHERE active = true AND schema_name IS NOT NULL`);
    for (const r of rows) {
      const schema = slugToSchema(r.schema_name || r.slug);
      for (const t of DROP) await c.query(`DROP TABLE IF EXISTS "${schema}".${t} CASCADE`);
      console.log(`  ✓ dropped from ${schema}`);
    }
    console.log(`drop-modules complete (${rows.length} branches)`);
  } catch (err) {
    console.error('drop-modules error:', err.message);
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
})();
