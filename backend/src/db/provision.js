const fs = require('fs');
const path = require('path');
const pool = require('./pool');
const { slugToSchema } = require('../utils/schema');
const { REMAP_CASE_SQL } = require('../utils/roles');

const BRANCH_SQL = fs.readFileSync(path.join(__dirname, 'branch_schema.sql'), 'utf8');
const PUBLIC_SQL = fs.readFileSync(path.join(__dirname, 'public_schema.sql'), 'utf8');

// Apply the GLOBAL (public) schema + idempotent ALTERs for columns added after
// an older `clients`/`users`/`notifications` already existed on a live DB.
async function migratePublic(client) {
  const c = client || (await pool.connect());
  try {
    await c.query(PUBLIC_SQL);
    // Existing DBs: CREATE TABLE IF NOT EXISTS won't add new columns — ALTER.
    await c.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS slug        VARCHAR(63)`);
    await c.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS subdomain   VARCHAR(63)`);
    await c.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS schema_name VARCHAR(63)`);
    await c.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS card_image TEXT`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_slug        ON clients(slug)        WHERE slug        IS NOT NULL`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_subdomain   ON clients(subdomain)   WHERE subdomain   IS NOT NULL`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_schema_name ON clients(schema_name) WHERE schema_name IS NOT NULL`);
    // Backfill schema_name from slug (dash→underscore) where missing.
    await c.query(`UPDATE clients SET schema_name = lower(replace(slug,'-','_')) WHERE schema_name IS NULL AND slug IS NOT NULL`);
    await c.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS branch_slug VARCHAR(63)`);
    // Recipients are per-branch users → drop the cross-schema FK to public.users
    // (an FK violation here would roll back the whole WO status transaction).
    await c.query(`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_user_id_fkey`);
    // Per-branch user binding: branch_slug NULL = global super-admin (cross-branch),
    // else the user is local to that branch.
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_slug VARCHAR(63)`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_users_branch_slug ON users(branch_slug)`);
    // 5-role model: remap any retired legacy role to the new set, THEN tighten the
    // CHECK (must remap first — adding the constraint fails on stale legacy rows).
    await c.query(`UPDATE users SET role = ${REMAP_CASE_SQL}
      WHERE role IN ('central_admin','supervisor','building','field_tech')`);
    await c.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await c.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
      'super_admin','admin','approver','checker','technician'))`);
  } finally {
    if (!client) c.release();
  }
}

// Create a branch's schema (if absent) and load/refresh all per-tenant tables
// into it. Idempotent — re-running just applies any new CREATE ... IF NOT EXISTS.
async function provisionBranchSchema(schemaName) {
  const schema = slugToSchema(schemaName);
  const c = await pool.connect();
  try {
    await c.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await c.query(`SET search_path TO "${schema}", public`);
    await c.query(BRANCH_SQL);
    // Retire legacy roles on existing branch users + tighten the CHECK (CREATE
    // TABLE IF NOT EXISTS above won't alter an already-present users table).
    await c.query(`UPDATE users SET role = ${REMAP_CASE_SQL}
      WHERE role IN ('central_admin','supervisor','building','field_tech')`);
    await c.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await c.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
      'admin','approver','checker','technician'))`);
    return schema;
  } finally {
    c.release();
  }
}

// Apply branch_schema.sql to EVERY active branch (boot-time / per-deploy
// migration so new tables/columns reach all tenants).
async function migrateBranchSchemas() {
  const { rows } = await pool.query(
    `SELECT slug, schema_name FROM clients WHERE active = true AND schema_name IS NOT NULL`
  );
  for (const r of rows) {
    const schema = await provisionBranchSchema(r.schema_name || r.slug);
    console.log(`  ✓ branch schema "${schema}" up to date`);
  }
  return rows.length;
}

module.exports = { migratePublic, provisionBranchSchema, migrateBranchSchemas };
