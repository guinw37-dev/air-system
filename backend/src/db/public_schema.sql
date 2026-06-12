-- ============================================================
-- public_schema.sql — GLOBAL tables shared across all branches.
-- Lives in the `public` schema; every branch schema sees these via the
-- search_path fallback (`SET search_path TO "<branch>", public`).
-- Idempotent. Run once: node src/db/migrate_public.js
-- ============================================================

-- ── Branch registry (ลูกค้า/สาขา) ───────────────────────────
-- One row per tenant. `schema_name` is the Postgres schema that holds this
-- branch's data; `subdomain` maps an incoming host to the branch.
CREATE TABLE IF NOT EXISTS clients (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(20) UNIQUE NOT NULL,
  name        VARCHAR(150) NOT NULL,
  slug        VARCHAR(63),                 -- URL key: acme-co
  subdomain   VARCHAR(63),                 -- host label resolved to this branch
  schema_name VARCHAR(63),                 -- Postgres schema: acme_co
  card_image  TEXT,                        -- logo/รูปหน้า card (URL or data URI)
  repair_slug VARCHAR(63),                 -- maps this branch → repair-system hospital slug (AC-repair bridge)
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
-- NOTE: indexes on slug/subdomain/schema_name/branch_slug are created by
-- migratePublic() in provision.js AFTER the idempotent ALTER ... ADD COLUMN, so
-- they don't fail on an existing pre-schema-per-tenant `clients`/`users` table.

-- ── Super-admin / global users ──────────────────────────────
-- Cross-schema staff (TW central + field techs who serve many branches) live
-- here and authenticate on the apex domain. Branch-local users live in each
-- branch schema's own users table (Phase C). Role CHECK widened for super_admin
-- and field_tech.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  username      VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL CHECK (role IN (
                  'super_admin','admin','approve_engineer','approve_building','checker','technician','approver'
                )),
  branch_slug   VARCHAR(63),                 -- NULL = global super-admin; else local to that branch
  phone         VARCHAR(20),
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Inspection template (shared checklist defs) ─────────────
CREATE TABLE IF NOT EXISTS inspection_template_items (
  id             SERIAL PRIMARY KEY,
  equipment_type VARCHAR(10) NOT NULL CHECK (equipment_type IN ('ac','fan')),
  category       VARCHAR(50),
  item_label     VARCHAR(200) NOT NULL,
  value_type     VARCHAR(20) NOT NULL CHECK (value_type IN ('check','number','before_after','text','rst_amp','ln_vi','pressure_pair')),
  unit_label     VARCHAR(30),
  applies_major  BOOLEAN DEFAULT false,
  applies_minor  BOOLEAN DEFAULT false,
  sort_order     INT DEFAULT 0,
  UNIQUE (equipment_type, category, item_label)
);

-- ── Mandatory photo points per equipment_type × work_type ───
CREATE TABLE IF NOT EXISTS photo_point_templates (
  id             SERIAL PRIMARY KEY,
  equipment_type VARCHAR(10) NOT NULL,
  work_type      VARCHAR(10) NOT NULL,
  point_no       INT NOT NULL,
  label          VARCHAR(120) NOT NULL,
  required       BOOLEAN DEFAULT TRUE,
  UNIQUE (equipment_type, work_type, point_no)
);

-- ── In-app notifications (user-scoped) ──────────────────────
-- user_id → public.users. work_order_id is a plain int (the work order lives in
-- a branch schema, so no cross-schema FK).
CREATE TABLE IF NOT EXISTS notifications (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL,                 -- per-branch user id (no cross-schema FK)
  work_order_id INT,
  branch_slug   VARCHAR(63),
  type          VARCHAR(30) NOT NULL,
  message       TEXT NOT NULL,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inspection_tpl_equip ON inspection_template_items(equipment_type);
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_tpl_equip            ON inspection_template_items(equipment_type);
