require('dotenv').config();
const pool = require('./pool');

// Provision a new branch (สาขา) = a clients row with a slug/subdomain, so it can
// be served on its own subdomain. Mirrors repair-system's add-hospital.
// Usage:
//   npm run add-branch -- --code PYTX --name "โรงพยาบาลพญาไท X" --slug phayathai-x
// Re-runnable: ON CONFLICT (code) DO UPDATE refreshes name/slug/subdomain.
const SLUG_RE = /^[a-z0-9-]{1,63}$/;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

async function main() {
  const { code, name, slug } = parseArgs(process.argv.slice(2));
  if (!code || !name || !slug) {
    console.error('usage: npm run add-branch -- --code <CODE> --name "<NAME>" --slug <slug>');
    process.exit(1);
  }
  if (!SLUG_RE.test(slug)) {
    console.error(`invalid slug "${slug}" — allowed: a-z 0-9 - (max 63)`);
    process.exit(1);
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO clients (code, name, slug, subdomain, active)
       VALUES ($1, $2, $3, $3, true)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, slug = EXCLUDED.slug, subdomain = EXCLUDED.subdomain, active = true
       RETURNING id, code, name, slug`,
      [code, name, slug]
    );
    const c = rows[0];
    console.log(`✓ branch ready: #${c.id} ${c.code} — ${c.name}  [${c.slug}]`);
    console.log(`\nNext (OPS):`);
    console.log(`  1. Add DNS:    ${c.slug}.<your-domain>  →  Coolify host`);
    console.log(`  2. Coolify:    add domain ${c.slug}.<your-domain> to the frontend service`);
    console.log(`  3. Verify:     GET /api/resolve-host?hostname=${c.slug}.<your-domain> → { clientId: ${c.id} }`);
  } catch (err) {
    console.error('add-branch error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
