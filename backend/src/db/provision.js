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
    // force_camera = บังคับถ่ายรูปสด + timestamp (ห้ามเลือกจาก gallery). เปิดเฉพาะ
    // สาขาที่ต้องการ (เช่น ศรีราชา); สาขาอื่น false = อัปจาก gallery ได้เหมือนเดิม.
    await c.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS force_camera BOOLEAN DEFAULT false`);
    await c.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS line_group_id TEXT`);
    await c.query(`CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
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
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_prefs JSONB DEFAULT '{}'::jsonb`);
    await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS position VARCHAR(100)`);
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
    // TW checklist (ลูกค้า 08-07): แถว "ตรวจเช็คคอยล์ร้อน..." เดิมเป็น number/°C
    // (relabel มาจากแถวตรวจวัดอุณหภูมิ) → ต้องไม่แบ่งช่องก่อน-หลัง = check ธรรมดา.
    await c.query(`UPDATE inspection_template_items
      SET value_type = 'check', unit_label = NULL
      WHERE equipment_type = 'ac' AND value_type <> 'check'
        AND item_label = 'ตรวจเช็คคอยล์ร้อน คอยล์เย็น และฉีดล้างทำความสะอาดรังผึ้งที่คอยล์ร้อน คอยล์เย็น'`);
    // การเปลี่ยนแถวคอยล์ร้อนเป็น check ทำ "ช่องบันทึกอุณหภูมิ" หาย (ช่างเคยกรอก °C
    // ก่อน/หลังในแถวนั้น) → เพิ่มแถว "ตรวจวัดอุณหภูมิ (°C)" ของตัวเองกลับมา. Idempotent.
    await c.query(`INSERT INTO inspection_template_items
        (equipment_type, category, item_label, value_type, unit_label, applies_major, applies_minor, sort_order)
      SELECT 'ac', 'all3', 'ตรวจวัดอุณหภูมิ (°C)', 'number', '°C', true, true, 24
      WHERE NOT EXISTS (SELECT 1 FROM inspection_template_items
                        WHERE equipment_type = 'ac' AND item_label = 'ตรวจวัดอุณหภูมิ (°C)')`);
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
    // สภาพแอร์/แจ้งเปลี่ยนอะไหล่ assessment (added after the table shipped).
    await c.query(`ALTER TABLE IF EXISTS simple_work_orders ADD COLUMN IF NOT EXISTS condition JSONB DEFAULT '{}'::jsonb`);
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
    // service_targets: เพิ่มคอลัมน์ BEFORE BRANCH_SQL — เพราะ BRANCH_SQL สร้าง index
    // uq_service_targets_full ที่อ้าง month/location/ac_type (CREATE TABLE IF NOT
    // EXISTS ข้ามตารางเดิม → คอลัมน์ยังไม่มี → index พังถ้าไม่ ALTER ก่อน).
    await c.query(`ALTER TABLE IF EXISTS service_targets ADD COLUMN IF NOT EXISTS month VARCHAR(7)`);
    await c.query(`ALTER TABLE IF EXISTS service_targets ADD COLUMN IF NOT EXISTS location VARCHAR(200)`);
    await c.query(`ALTER TABLE IF EXISTS service_targets ADD COLUMN IF NOT EXISTS ac_type VARCHAR(30)`);
    await c.query(`DROP INDEX IF EXISTS uq_service_targets_zone_wt`);
    await c.query(BRANCH_SQL);
    // Fan checklist trimmed 5→2 (เก็บ ล้างหน้ากาก[0] + ใช้งานได้ปกติ[4]) — checks are
    // read BY INDEX everywhere (views/PDF/Excel), so old fan rows must be reindexed
    // to [checks[0], checks[4]] or ใช้งานได้ปกติ would be misread from the dropped
    // น้ำมัน slot. Guarded by EXISTS(len>=5) → no-op after the first run.
    await c.query(`
      UPDATE simple_work_orders
         SET grid_rows = (
           SELECT jsonb_agg(
                    CASE WHEN jsonb_array_length(COALESCE(t.elem->'checks','[]'::jsonb)) >= 5
                         THEN jsonb_set(t.elem, '{checks}',
                                jsonb_build_array(t.elem->'checks'->0, t.elem->'checks'->4))
                         ELSE t.elem END
                    ORDER BY t.ord)
             FROM jsonb_array_elements(grid_rows) WITH ORDINALITY AS t(elem, ord))
       WHERE work_type = 'fan'
         AND EXISTS (
           SELECT 1 FROM jsonb_array_elements(grid_rows) AS e(elem)
           WHERE jsonb_array_length(COALESCE(e.elem->'checks','[]'::jsonb)) >= 5)`);
    // ค่าอุณหภูมิเก่าที่เคยกรอกในแถวคอยล์ร้อน (ตอนยังเป็น number/°C) → คัดลอกไป
    // แถวใหม่ "ตรวจวัดอุณหภูมิ (°C)" (template สร้างใน migratePublic ซึ่งรันก่อน).
    // Idempotent: ON CONFLICT / NOT ? key. แถวคอยล์ร้อนเก็บค่าเดิมไว้แต่ไม่แสดง (check row).
    await c.query(`
      INSERT INTO inspection_values (work_order_unit_id, template_item_id, value_before, value_after)
      SELECT iv.work_order_unit_id, n.id, iv.value_before, iv.value_after
        FROM inspection_values iv
        JOIN inspection_template_items o ON o.id = iv.template_item_id
             AND o.equipment_type = 'ac'
             AND o.item_label = 'ตรวจเช็คคอยล์ร้อน คอยล์เย็น และฉีดล้างทำความสะอาดรังผึ้งที่คอยล์ร้อน คอยล์เย็น'
        CROSS JOIN (SELECT id FROM inspection_template_items
                    WHERE equipment_type = 'ac' AND item_label = 'ตรวจวัดอุณหภูมิ (°C)') n
       WHERE COALESCE(iv.value_before,'') <> '' OR COALESCE(iv.value_after,'') <> ''
       ON CONFLICT (work_order_unit_id, template_item_id) DO NOTHING`);
    await c.query(`
      UPDATE simple_work_orders s
         SET checklist_values = s.checklist_values || jsonb_build_object(n.id::text,
               jsonb_strip_nulls(jsonb_build_object(
                 'value_before', s.checklist_values -> o.id::text -> 'value_before',
                 'value_after',  s.checklist_values -> o.id::text -> 'value_after')))
        FROM (SELECT id FROM inspection_template_items
              WHERE equipment_type = 'ac'
                AND item_label = 'ตรวจเช็คคอยล์ร้อน คอยล์เย็น และฉีดล้างทำความสะอาดรังผึ้งที่คอยล์ร้อน คอยล์เย็น') o,
             (SELECT id FROM inspection_template_items
              WHERE equipment_type = 'ac' AND item_label = 'ตรวจวัดอุณหภูมิ (°C)') n
       WHERE s.checklist_values ? o.id::text
         AND NOT (s.checklist_values ? n.id::text)
         AND (COALESCE(s.checklist_values -> o.id::text ->> 'value_before','') <> ''
           OR COALESCE(s.checklist_values -> o.id::text ->> 'value_after','') <> '')`);
    // ac_repair_jobs.parts added after the table first shipped — ADD on branches
    // already provisioned (no-op on a fresh schema, BRANCH_SQL ships it there).
    await c.query(`ALTER TABLE IF EXISTS ac_repair_jobs ADD COLUMN IF NOT EXISTS parts JSONB DEFAULT '[]'::jsonb`);
    await c.query(`ALTER TABLE IF EXISTS ac_repair_jobs ADD COLUMN IF NOT EXISTS asset_code TEXT`);
    await c.query(`ALTER TABLE IF EXISTS ac_repair_jobs ADD COLUMN IF NOT EXISTS photo_urls JSONB DEFAULT '[]'::jsonb`);
    // wash_units last-wash dates (backfill ประวัติ → ปฏิทิน generate คำนวณ overdue)
    await c.query(`ALTER TABLE IF EXISTS wash_units ADD COLUMN IF NOT EXISTS last_major_at DATE`);
    await c.query(`ALTER TABLE IF EXISTS wash_units ADD COLUMN IF NOT EXISTS last_minor_at DATE`);
    // per-user UI prefs (dashboard layout) on branch users table
    await c.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS ui_prefs JSONB DEFAULT '{}'::jsonb`);
    await c.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS position VARCHAR(100)`);
    // service_targets index/columns จัดการก่อน BRANCH_SQL แล้ว (ดูด้านบน)
    await c.query(`CREATE TABLE IF NOT EXISTS wash_count_adjust (
      id SERIAL PRIMARY KEY, month VARCHAR(7) NOT NULL, zone VARCHAR(50), work_type VARCHAR(20),
      delta INT NOT NULL DEFAULT 0, note TEXT, created_by INT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_wash_adjust_month ON wash_count_adjust (month)`);
    // device_id added to tech_attendance after the table first shipped (#165 → device tracking)
    await c.query(`ALTER TABLE IF EXISTS tech_attendance ADD COLUMN IF NOT EXISTS device_id VARCHAR(64)`);
    // GPS geofence (monitor only) added to tech_attendance later — ADD on existing branches.
    await c.query(`ALTER TABLE IF EXISTS tech_attendance ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`);
    await c.query(`ALTER TABLE IF EXISTS tech_attendance ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`);
    await c.query(`ALTER TABLE IF EXISTS tech_attendance ADD COLUMN IF NOT EXISTS geo_site VARCHAR(160)`);
    await c.query(`ALTER TABLE IF EXISTS tech_attendance ADD COLUMN IF NOT EXISTS in_area BOOLEAN`);
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
