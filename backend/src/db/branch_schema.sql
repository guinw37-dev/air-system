-- ============================================================
-- branch_schema.sql — per-tenant (per-branch/ลูกค้า) tables.
-- Loaded INTO each branch's Postgres schema after `SET search_path TO "<schema>"`.
-- The schema IS the tenant, so:
--   • client_id columns are GONE (every row already belongs to this schema).
--   • FKs to public tables (users) are dropped — created_by/uploaded_by are
--     plain ints (a creator may be a per-schema user OR a cross-schema
--     super-admin in public.users; resolved by display name, Phase C).
--   • in-schema FKs (sites→buildings→…→units, work_orders→units) are kept.
-- Idempotent (CREATE TABLE/INDEX IF NOT EXISTS) so it doubles as the per-schema
-- migration applied to every active branch on boot.
-- ============================================================

-- ── Branch-local users (เชื่อมโยงเฉพาะภายในสาขานี้) ──────────
-- Each branch keeps its OWN users — fully decoupled from other branches and
-- from the public super-admins. With search_path "<branch>", public this table
-- shadows public.users, so every `JOIN users` in branch queries resolves here.
-- Cross-branch super-admins live in public.users (login on apex, switch in).
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  username      VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL CHECK (role IN (
                  'admin','approver','checker','technician'
                )),
  phone         VARCHAR(20),
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tenant hierarchy (site → building → floor → room) ────────
CREATE TABLE IF NOT EXISTS sites (
  id         SERIAL PRIMARY KEY,
  code       VARCHAR(30),
  name       VARCHAR(150) NOT NULL,
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS buildings (
  id         SERIAL PRIMARY KEY,
  site_id    INT NOT NULL REFERENCES sites(id),
  code       VARCHAR(30),
  name       VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (site_id, name)
);

CREATE TABLE IF NOT EXISTS floors (
  id          SERIAL PRIMARY KEY,
  building_id INT NOT NULL REFERENCES buildings(id),
  name        VARCHAR(50) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (building_id, name)
);

CREATE TABLE IF NOT EXISTS rooms (
  id         SERIAL PRIMARY KEY,
  floor_id   INT NOT NULL REFERENCES floors(id),
  name       VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (floor_id, name)
);

-- ── Equipment (แอร์ + พัดลม) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS units (
  id                    SERIAL PRIMARY KEY,
  room_id               INT REFERENCES rooms(id),
  asset_code            VARCHAR(50) NOT NULL,
  name                  VARCHAR(150),
  equipment_type        VARCHAR(10) NOT NULL CHECK (equipment_type IN ('ac','fan')),
  family                VARCHAR(50),
  capacity_btu          VARCHAR(50),
  refrigerant           VARCHAR(30),
  status                VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','broken','inactive')),
  last_major_clean_date DATE,
  next_pm_date          DATE,
  pm_cycle_pos          SMALLINT NOT NULL DEFAULT 0,
  needs_recode          BOOLEAN DEFAULT false,
  active                BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (asset_code)                          -- unique within this branch
);

-- ── Work orders (ใบงาน) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_orders (
  id               SERIAL PRIMARY KEY,
  order_no         VARCHAR(30) UNIQUE NOT NULL,
  site_id          INT REFERENCES sites(id),
  type             VARCHAR(10) NOT NULL CHECK (type IN ('major','minor','fan')),
  status           VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN (
                     'draft','in_progress','pending_admin','pending_approval',
                     'approved','rejected','closed'
                   )),
  created_by       INT,                         -- public.users.id OR branch user; no FK (Phase C)
  area_owner_name  VARCHAR(150),
  reject_reason    TEXT,
  approver_id      INT,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  admin_checked_at TIMESTAMPTZ,
  approved_at      TIMESTAMPTZ,
  cond_ac_degraded       BOOLEAN DEFAULT FALSE,
  cond_ac_old_5_7yr      BOOLEAN DEFAULT FALSE,
  cond_external_degraded BOOLEAN DEFAULT FALSE, cond_external_detail TEXT,
  cond_internal_degraded BOOLEAN DEFAULT FALSE, cond_internal_detail TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_order_assignees (
  work_order_id INT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  user_id       INT NOT NULL,
  PRIMARY KEY (work_order_id, user_id)
);

CREATE TABLE IF NOT EXISTS work_order_units (
  id            SERIAL PRIMARY KEY,
  work_order_id INT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  unit_id       INT NOT NULL REFERENCES units(id),
  has_repair    BOOLEAN DEFAULT false,
  repair_notes  TEXT,
  repair_job_id INT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inspection_values (
  id                 SERIAL PRIMARY KEY,
  work_order_unit_id INT NOT NULL REFERENCES work_order_units(id) ON DELETE CASCADE,
  template_item_id   INT NOT NULL REFERENCES inspection_template_items(id),  -- public (shared template)
  value_before       TEXT,
  value_after        TEXT,
  checked            BOOLEAN,
  note               TEXT,
  val_r_before  DECIMAL(8,2), val_s_before DECIMAL(8,2), val_t_before DECIMAL(8,2),
  val_r_after   DECIMAL(8,2), val_s_after  DECIMAL(8,2), val_t_after  DECIMAL(8,2),
  val_ln_before DECIMAL(8,2), val_l_before DECIMAL(8,2),
  val_ln_after  DECIMAL(8,2), val_l_after  DECIMAL(8,2),
  val_suction   DECIMAL(8,2), val_discharge DECIMAL(8,2),
  refrigerant_type VARCHAR(10), val_text TEXT,
  power_system     VARCHAR(5),
  UNIQUE (work_order_unit_id, template_item_id)
);

CREATE TABLE IF NOT EXISTS work_order_photos (
  id                 SERIAL PRIMARY KEY,
  work_order_unit_id INT NOT NULL REFERENCES work_order_units(id) ON DELETE CASCADE,
  unit_id            INT REFERENCES units(id),
  uploaded_by        INT,                        -- no cross-schema FK
  phase              VARCHAR(15) NOT NULL CHECK (phase IN ('before','after','measurement')),
  point_no           INT NOT NULL DEFAULT 1,
  label              VARCHAR(150),
  url                TEXT NOT NULL,
  filename           TEXT,
  client_token       VARCHAR(64) UNIQUE,
  taken_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signatures (
  id             SERIAL PRIMARY KEY,
  work_order_id  INT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  role           VARCHAR(20) NOT NULL CHECK (role IN ('area_owner','central_admin','approver')),
  signer_name    VARCHAR(150),
  user_id        INT,
  signature_data TEXT NOT NULL,
  signed_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (work_order_id, role)
);

CREATE TABLE IF NOT EXISTS work_order_status_history (
  id            SERIAL PRIMARY KEY,
  work_order_id INT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  from_status   VARCHAR(20),
  to_status     VARCHAR(20) NOT NULL,
  changed_by    INT,
  reason        TEXT,
  changed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sign_tokens (
  id            SERIAL PRIMARY KEY,
  work_order_id INT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  token_hash    VARCHAR(64) NOT NULL UNIQUE,
  used_at       TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── แจ้งซ่อม ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repair_logs (
  id                 SERIAL PRIMARY KEY,
  unit_id            INT NOT NULL REFERENCES units(id),
  work_order_id      INT REFERENCES work_orders(id),
  work_order_unit_id INT REFERENCES work_order_units(id),
  request_no         VARCHAR(50),
  problem            TEXT NOT NULL,
  cause              TEXT,
  solution           TEXT,
  cleaning_type      VARCHAR(10) CHECK (cleaning_type IN ('major','minor','fan')),
  status             VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  reported_by        INT,
  resolved_at        TIMESTAMPTZ,
  petty_cash         DECIMAL(10,2),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── หักเงินค่าบริการรายเดือน ────────────────────────────────
CREATE TABLE IF NOT EXISTS deduction_notes (
  id         SERIAL PRIMARY KEY,
  month      CHAR(7) NOT NULL,
  notes      TEXT,
  created_by INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes (no client_id ones — schema is the client) ──────
CREATE INDEX IF NOT EXISTS idx_buildings_site   ON buildings(site_id);
CREATE INDEX IF NOT EXISTS idx_floors_building  ON floors(building_id);
CREATE INDEX IF NOT EXISTS idx_rooms_floor      ON rooms(floor_id);
CREATE INDEX IF NOT EXISTS idx_units_room       ON units(room_id);
CREATE INDEX IF NOT EXISTS idx_units_status     ON units(status);
CREATE INDEX IF NOT EXISTS idx_units_next_pm    ON units(next_pm_date);
CREATE INDEX IF NOT EXISTS idx_wo_site          ON work_orders(site_id);
CREATE INDEX IF NOT EXISTS idx_wo_status        ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wou_order        ON work_order_units(work_order_id);
CREATE INDEX IF NOT EXISTS idx_wou_unit         ON work_order_units(unit_id);
CREATE INDEX IF NOT EXISTS idx_iv_wou           ON inspection_values(work_order_unit_id);
CREATE INDEX IF NOT EXISTS idx_photos_wou       ON work_order_photos(work_order_unit_id);
CREATE INDEX IF NOT EXISTS idx_repair_unit      ON repair_logs(unit_id);
CREATE INDEX IF NOT EXISTS idx_deduction_month  ON deduction_notes(month);
CREATE INDEX IF NOT EXISTS idx_wo_history_wo    ON work_order_status_history(work_order_id);
CREATE INDEX IF NOT EXISTS idx_sign_tokens_wo   ON sign_tokens(work_order_id);

-- ── Simple Work Orders (ใบงานย่อ — one-step form, no approval) ──────────────
-- Consolidated from migrate_simple_wo*.js. created_by is a plain int (creator
-- may be a per-schema user OR a public super-admin — no cross-schema FK).
CREATE TABLE IF NOT EXISTS simple_work_orders (
  id          SERIAL PRIMARY KEY,
  wo_number   VARCHAR(30) UNIQUE NOT NULL,
  created_by  INT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  tech_name    VARCHAR(150),
  work_date    DATE,
  client_name  VARCHAR(200),
  location     VARCHAR(200),    -- สถานที่ (e.g. คลินิกในเครือ); blank = same as client_name
  building     VARCHAR(100),
  floor        VARCHAR(50),
  room         VARCHAR(100),
  asset_code   VARCHAR(100),
  work_type    VARCHAR(20),     -- major | minor | fan
  ac_type      VARCHAR(10),     -- FCU | SPT | VRF | AHU | OAU (ล้างย่อย: ประเภทแอร์ทั้งใบ)
  power_system VARCHAR(5),      -- 380 | 220 (major checklist)
  checklist_values JSONB DEFAULT '{}'::jsonb,
  result     VARCHAR(20),       -- ok | not_ok
  start_time TIME,
  end_time   TIME,
  team_comment JSONB DEFAULT '{}'::jsonb,
  photo_urls   JSONB DEFAULT '[]'::jsonb,
  gallery_urls JSONB DEFAULT '[]'::jsonb,
  ac_info      JSONB DEFAULT '{}'::jsonb,
  sig_engineer        TEXT, sig_engineer_name   VARCHAR(150),
  sig_department      TEXT, sig_department_name VARCHAR(150),
  sig_team            TEXT, sig_team_name        VARCHAR(150),
  sig_supervisor      TEXT, sig_supervisor_name VARCHAR(150),
  sig_building        TEXT, sig_building_name    VARCHAR(150),
  grid_rows           JSONB DEFAULT '[]'::jsonb,
  recommendation      TEXT,
  updated_at          TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  status     VARCHAR(20) DEFAULT 'submitted'
);
CREATE INDEX IF NOT EXISTS idx_swo_created_at ON simple_work_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_swo_created_by ON simple_work_orders(created_by);
CREATE INDEX IF NOT EXISTS idx_swo_work_type  ON simple_work_orders(work_type);
CREATE INDEX IF NOT EXISTS idx_swo_deleted_at ON simple_work_orders(deleted_at);

-- Per-work_type read-only views (mirror the per-sheet Excel export).
CREATE OR REPLACE VIEW vw_simple_wo_major AS
  SELECT id, wo_number, created_at, updated_at, work_date,
         tech_name, client_name, building, floor, room, asset_code,
         power_system, result, start_time, end_time,
         checklist_values, ac_info, team_comment,
         sig_team_name       AS "เซ็น_ช่างแอร์",
         sig_supervisor_name AS "เซ็น_หัวหน้าช่างแอร์",
         sig_building_name   AS "เซ็น_เจ้าหน้าที่ช่างอาคาร",
         sig_engineer_name   AS "เซ็น_เจ้าหน้าวิศวกรรม"
  FROM simple_work_orders
  WHERE deleted_at IS NULL AND (work_type = 'major' OR work_type IS NULL);

CREATE OR REPLACE VIEW vw_simple_wo_minor AS
  SELECT s.wo_number, s.work_date, s.client_name,
         COALESCE(NULLIF(s.location,''), s.client_name) AS "สถานที่",
         s.building, s.floor, s.ac_type AS "ประเภทแอร์", s.tech_name,
         g.ord AS "ลำดับ",
         COALESCE(g.row->>'room', s.room)        AS "ห้อง_แผนก",
         COALESCE(g.row->>'machine_no', g.row->>'name') AS "เลขเครื่อง",
         (g.row->'checks'->>0)::boolean AS "ตรวจเช็คระบบการทำงาน",
         (g.row->'checks'->>1)::boolean AS "ล้างหัวจ่าย",
         (g.row->'checks'->>2)::boolean AS "ล้างช่องรีเทิร์น",
         (g.row->'checks'->>3)::boolean AS "ล้างฟิลเตอร์",
         s.recommendation AS "ข้อแนะนำ"
  FROM simple_work_orders s
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.grid_rows, '[]'::jsonb))
    WITH ORDINALITY AS g(row, ord)
  WHERE s.deleted_at IS NULL AND s.work_type = 'minor';

CREATE OR REPLACE VIEW vw_simple_wo_fan AS
  SELECT s.wo_number, s.work_date, s.client_name, s.building, s.floor, s.tech_name,
         g.ord AS "ลำดับ",
         g.row->>'name' AS "หมายเลขเครื่อง",
         (g.row->'checks'->>0)::boolean AS "ล้างหน้ากาก_มอเตอร์_ใบพัด",
         (g.row->'checks'->>1)::boolean AS "ใส่น้ำมันหล่อลื่นมอเตอร์",
         (g.row->'checks'->>2)::boolean AS "เช็คกระแสไฟฟ้า",
         (g.row->'checks'->>3)::boolean AS "เช็คความดังเสียง",
         (g.row->'checks'->>4)::boolean AS "ใช้งานได้ปกติ",
         g.row->>'broken' AS "ชำรุดเนื่องจาก",
         s.recommendation AS "ข้อแนะนำ"
  FROM simple_work_orders s
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.grid_rows, '[]'::jsonb))
    WITH ORDINALITY AS g(row, ord)
  WHERE s.deleted_at IS NULL AND s.work_type = 'fan';
