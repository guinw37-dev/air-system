require('dotenv').config();
const pool = require('./pool');
const { slugToSchema } = require('../utils/schema');
const { provisionBranchSchema } = require('./provision');

// Provision a new branch (ลูกค้า/สาขา): upsert the registry row in public.clients
// AND create + load its private Postgres schema. Hard data isolation.
// Usage:
//   npm run add-branch -- --code ACME --name "Acme Co" --slug acme-co
// Re-runnable: ON CONFLICT (code) refreshes name/slug/subdomain/schema_name.
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

(async () => {
  const { code, name, slug } = parseArgs(process.argv.slice(2));
  if (!code || !name || !slug) {
    console.error('usage: npm run add-branch -- --code <CODE> --name "<NAME>" --slug <slug>');
    process.exit(1);
  }
  let schema;
  try {
    schema = slugToSchema(slug); // validates the slug → schema name
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO clients (code, name, slug, subdomain, schema_name, active)
       VALUES ($1, $2, $3, $3, $4, true)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, slug = EXCLUDED.slug,
             subdomain = EXCLUDED.subdomain, schema_name = EXCLUDED.schema_name, active = true
       RETURNING id, code, name, slug, schema_name`,
      [code, name, slug, schema]
    );
    const c = rows[0];
    await provisionBranchSchema(c.schema_name);
    console.log(`✓ branch ready: #${c.id} ${c.code} — ${c.name}  [schema ${c.schema_name}]`);
    console.log(`\nNext (OPS):`);
    console.log(`  1. DNS:     ${c.slug}.<your-domain>  →  Coolify host`);
    console.log(`  2. Coolify: add domain ${c.slug}.<your-domain> to the frontend service`);
    console.log(`  3. Verify:  GET /api/resolve-host?hostname=${c.slug}.<your-domain> → { clientId: ${c.id} }`);
  } catch (err) {
    console.error('add-branch error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
