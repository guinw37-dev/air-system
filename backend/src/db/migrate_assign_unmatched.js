require('dotenv').config();
const pool = require('./pool');
const { slugToSchema } = require('../utils/schema');

// NON-DESTRUCTIVE — copy the public.simple_work_orders rows that did NOT match
// any branch name (free-text / blank client_name) into ONE chosen branch. Copies
// only (public originals kept); idempotent via ON CONFLICT (wo_number) DO NOTHING.
// Use after migrate:copy-simple-wo to home the leftovers.
//   npm run migrate:assign-unmatched -- --slug salawakan
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

async function columnsFor(schema) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'simple_work_orders'`, [schema]);
  return new Set(rows.map((r) => r.column_name));
}

(async () => {
  const { slug } = parseArgs(process.argv.slice(2));
  if (!slug) { console.error('usage: npm run migrate:assign-unmatched -- --slug <branchSlug>'); process.exit(1); }
  let schema;
  try { schema = slugToSchema(slug); } catch (e) { console.error(e.message); process.exit(1); }
  try {
    const { rows: br } = await pool.query(
      'SELECT name FROM clients WHERE slug = $1 AND schema_name IS NOT NULL AND active = true', [slug]);
    if (!br.length) { console.error(`ไม่พบสาขา slug=${slug} (ยัง provision?)`); process.exit(1); }

    const pubCols = await columnsFor('public');
    const brCols = await columnsFor(schema);
    const cols = [...pubCols].filter((c) => brCols.has(c) && c !== 'id');
    const colList = cols.map((c) => `"${c}"`).join(', ');

    // "unmatched" = client_name doesn't equal ANY provisioned branch's name.
    const { rowCount } = await pool.query(
      `INSERT INTO "${schema}".simple_work_orders (${colList})
       SELECT ${colList} FROM public.simple_work_orders s
       WHERE NOT EXISTS (
         SELECT 1 FROM clients c
         WHERE c.active AND c.schema_name IS NOT NULL AND TRIM(s.client_name) = c.name)
       ON CONFLICT (wo_number) DO NOTHING`, []);
    console.log(`assigned ${rowCount} unmatched ใบงาน → ${br[0].name} [${schema}]`);
    console.log('public.simple_work_orders kept intact (nothing deleted).');
  } catch (err) {
    console.error('assign-unmatched error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
