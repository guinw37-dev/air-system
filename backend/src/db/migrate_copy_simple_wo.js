require('dotenv').config();
const pool = require('./pool');
const { slugToSchema } = require('../utils/schema');

// NON-DESTRUCTIVE — distribute the legacy public.simple_work_orders rows into
// each branch's own schema, matched by client_name = the branch's name. Copies
// (never deletes) so the public originals stay until you verify. Idempotent:
// ON CONFLICT (wo_number) DO NOTHING, so re-running won't duplicate.
// Run AFTER migrate:schemas (branch simple_work_orders table must exist).
// Run: node src/db/migrate_copy_simple_wo.js
async function columnsFor(schema) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'simple_work_orders'`, [schema]);
  return new Set(rows.map((r) => r.column_name));
}

(async () => {
  try {
    const pubCols = await columnsFor('public');
    if (!pubCols.size) { console.log('no public.simple_work_orders — nothing to copy'); process.exit(0); }

    const { rows: branches } = await pool.query(
      `SELECT name, schema_name, slug FROM clients
       WHERE active = true AND schema_name IS NOT NULL ORDER BY name`);

    let totalCopied = 0;
    for (const b of branches) {
      const schema = slugToSchema(b.schema_name || b.slug);
      const brCols = await columnsFor(schema);
      // common columns minus id (let SERIAL assign); keep wo_number for conflict.
      const cols = [...pubCols].filter((c) => brCols.has(c) && c !== 'id');
      const colList = cols.map((c) => `"${c}"`).join(', ');
      const { rowCount } = await pool.query(
        `INSERT INTO "${schema}".simple_work_orders (${colList})
         SELECT ${colList} FROM public.simple_work_orders
         WHERE TRIM(client_name) = $1
         ON CONFLICT (wo_number) DO NOTHING`, [b.name]);
      totalCopied += rowCount;
      console.log(`  ✓ ${b.name} [${schema}] — copied ${rowCount}`);
    }

    const { rows: [{ unmatched }] } = await pool.query(
      `SELECT COUNT(*) AS unmatched FROM public.simple_work_orders s
       WHERE NOT EXISTS (SELECT 1 FROM clients c
         WHERE c.active AND c.schema_name IS NOT NULL AND TRIM(s.client_name) = c.name)`);
    console.log(`\ncopy complete — ${totalCopied} ใบงาน distributed; ${unmatched} still unmatched (client_name ไม่ตรงสาขา — ยังอยู่ public)`);
    console.log('public.simple_work_orders kept intact (nothing deleted).');
  } catch (err) {
    console.error('copy-simple-wo error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
