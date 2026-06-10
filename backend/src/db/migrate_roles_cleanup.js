require('dotenv').config();
const pool = require('./pool');
const { slugToSchema } = require('../utils/schema');
const { REMAP_CASE_SQL } = require('../utils/roles');

// Retire the legacy roles across the WHOLE system (public + every branch schema)
// and tighten each users.role CHECK to the 5-role model. NON-DESTRUCTIVE — it
// only remaps roles on existing users, never deletes anyone:
//   central_admin → admin · supervisor → checker · building/field_tech → technician
//   npm run migrate:roles-cleanup
const LEGACY = `('central_admin','supervisor','building','field_tech')`;

async function cleanupUsers(c, allowSuper) {
  const { rowCount } = await c.query(
    `UPDATE users SET role = ${REMAP_CASE_SQL} WHERE role IN ${LEGACY}`);
  const roles = allowSuper
    ? `'super_admin','admin','approver','checker','technician'`
    : `'admin','approver','checker','technician'`;
  await c.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await c.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (${roles}))`);
  return rowCount;
}

(async () => {
  const c = await pool.connect();
  try {
    await c.query(`SET search_path TO public`);
    const pub = await cleanupUsers(c, true);
    console.log(`public.users: remapped ${pub} legacy role(s)`);

    const { rows } = await c.query(
      `SELECT slug, schema_name FROM clients WHERE active = true AND schema_name IS NOT NULL`);
    for (const r of rows) {
      const schema = slugToSchema(r.schema_name || r.slug);
      await c.query(`SET search_path TO "${schema}", public`);
      // only touch a branch that actually has its own users table
      const { rows: has } = await c.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'users'`, [schema]);
      if (!has.length) { console.log(`  - ${schema}: no users table, skip`); continue; }
      const n = await cleanupUsers(c, false);
      console.log(`  ✓ ${schema}.users: remapped ${n} legacy role(s)`);
    }
    console.log('roles cleanup done (no users deleted).');
  } catch (err) {
    console.error('roles-cleanup error:', err.message);
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
})();
