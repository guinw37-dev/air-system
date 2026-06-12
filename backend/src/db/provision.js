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
    await c.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS repair_slug VARCHAR(63)`);
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
    // Role model: DROP the old CHECK FIRST, then remap retired legacy roles (incl.
    // single 'approver' → approve_engineer), then ADD the new CHECK. Order matters —
    // the remap produces values (approve_engineer/approve_building) the OLD CHECK
    // forbids, so updating before dropping would violate users_role_check.
    await c.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await c.query(`UPDATE users SET role = ${REMAP_CASE_SQL}
      WHERE role IN ('central_admin','supervisor','building','field_tech','approver')`);
    await c.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
      'super_admin','admin','approve_engineer','approve_building','checker','technician','approver'))`);
    // Legacy public.simple_work_orders (pre-schema-per-tenant rows still edited on
    // apex) needs the same new columns or saving an apex WO 500s with
    // 'column "location" does not exist'. IF EXISTS → skip if the table is absent.
    await c.query(`ALTER TABLE IF EXISTS simple_work_orders ADD COLUMN IF NOT EXISTS location VARCHAR(200)`);
    await c.query(`ALTER TABLE IF EXISTS simple_work_orders ADD COLUMN IF NOT EXISTS ac_type  VARCHAR(30)`);
    await c.query(`ALTER TABLE IF EXISTS simple_work_orders ADD COLUMN IF NOT EXISTS pts_zone VARCHAR(50)`);
    await c.query(`ALTER TABLE IF EXISTS simple_work_orders ALTER COLUMN ac_type TYPE VARCHAR(30)`);
    // Approval-workflow audit columns (legacy public.simple_work_orders edited on apex).
    for (const col of ['checked_by INT', 'checked_at TIMESTAMPTZ', 'approved_by INT',
                       'approved_at TIMESTAMPTZ', 'reject_reason TEXT', 'rejected_at TIMESTAMPTZ']) {
      await c.query(`ALTER TABLE IF EXISTS simple_work_orders ADD COLUMN IF NOT EXISTS ${col}`);
    }
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
    // simple_work_orders: columns added after the table first shipped — ADD them
    // BEFORE running BRANCH_SQL, because BRANCH_SQL's CREATE OR REPLACE VIEW
    // vw_simple_wo_minor references s.location/s.ac_type (would fail if absent).
    // ALTER TABLE IF EXISTS = no-op on a brand-new schema (the CREATE TABLE in
    // BRANCH_SQL then ships the columns); adds them on an existing table.
    await c.query(`ALTER TABLE IF EXISTS simple_work_orders ADD COLUMN IF NOT EXISTS location VARCHAR(200)`);
    await c.query(`ALTER TABLE IF EXISTS simple_work_orders ADD COLUMN IF NOT EXISTS ac_type  VARCHAR(30)`);
    await c.query(`ALTER TABLE IF EXISTS simple_work_orders ADD COLUMN IF NOT EXISTS pts_zone VARCHAR(50)`);
    // Approval-workflow audit columns (status already exists, default 'submitted').
    for (const col of ['checked_by INT', 'checked_at TIMESTAMPTZ', 'approved_by INT',
                       'approved_at TIMESTAMPTZ', 'reject_reason TEXT', 'rejected_at TIMESTAMPTZ']) {
      await c.query(`ALTER TABLE IF EXISTS simple_work_orders ADD COLUMN IF NOT EXISTS ${col}`);
    }
    // vw_simple_wo_minor/_fan reference ac_type AND changed column names/order
    // (added สถานที่/ประเภท, split ห้อง/เลขเครื่อง). DROP them FIRST: Postgres can't
    // ALTER a column type while a view depends on it ("cannot alter type of a
    // column used by a view"), and CREATE OR REPLACE VIEW can't rename/reorder.
    // BRANCH_SQL recreates them fresh after.
    await c.query(`DROP VIEW IF EXISTS vw_simple_wo_minor`);
    await c.query(`DROP VIEW IF EXISTS vw_simple_wo_fan`);
    // ac_type widened 10→30 for fan types (Exhaust Fan Duct Type). Widening a
    // varchar length is metadata-only (no table rewrite). Runs after the drops.
    await c.query(`ALTER TABLE IF EXISTS simple_work_orders ALTER COLUMN ac_type TYPE VARCHAR(30)`);
    await c.query(BRANCH_SQL);
    // Retire legacy roles on existing branch users (incl. single 'approver' →
    // approve_engineer). DROP the old CHECK FIRST — the remap produces values the
    // old CHECK forbids, so updating before dropping would violate users_role_check.
    await c.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await c.query(`UPDATE users SET role = ${REMAP_CASE_SQL}
      WHERE role IN ('central_admin','supervisor','building','field_tech','approver')`);
    await c.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
      'admin','approve_engineer','approve_building','checker','technician','approver'))`);
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
