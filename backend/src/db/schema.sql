-- ============================================================
-- airclean_db schema v2 — Technical Water Co.,Ltd
-- AC + Fan Cleaning Management System
--
-- SINGLE SOURCE OF TRUTH. Idempotent (safe to re-run on a fresh DB).
-- No boot-time migrations — everything lives here.
--
-- Tenant model: client → site → building → floor → room → unit
-- Every tenant-bound table carries client_id DIRECTLY so queries can
-- isolate by client without joining the whole hierarchy.
-- ============================================================

-- ── Tenant hierarchy ────────────────────────────────────────

-- Clients (ลูกค้า/บริษัทคู่สัญญา) — e.g. PTS1 / PTS2
CREATE TABLE IF NOT EXISTS clients (
  id         SERIAL PRIMARY KEY,
  code       VARCHAR(20) UNIQUE NOT NULL,      -- PTS1, PTS2, ...
  name       VARCHAR(150) NOT NULL,
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sites (สถานที่ภายใต้ลูกค้า) — e.g. รพ.หลัก / คลินิกบางพระ / หอพัก
CREATE TABLE IF NOT EXISTS sites (
  id         SERIAL PRIMARY KEY,
  client_id  INT NOT NULL REFERENCES clients(id),
  code       VARCHAR(30),
  name       VARCHAR(150) NOT NULL,
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, name)
);

-- Buildings (อาคาร)
CREATE TABLE IF NOT EXISTS buildings (
  id         SERIAL PRIMARY KEY,
  site_id    INT NOT NULL REFERENCES sites(id),
  code       VARCHAR(30),
  name       VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (site_id, name)
);

-- Floors (ชั้น)
CREATE TABLE IF NOT EXISTS floors (
  id          SERIAL PRIMARY KEY,
  building_id INT NOT NULL REFERENCES buildings(id),
  name        VARCHAR(50) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (building_id, name)
);

-- Rooms (แผนก/ห้อง — เดิมคือ departments)
CREATE TABLE IF NOT EXISTS rooms (
  id         SERIAL PRIMARY KEY,
  floor_id   INT NOT NULL REFERENCES floors(id),
  name       VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (floor_id, name)
);

-- ── Equipment (แอร์ + พัดลม รวมตารางเดียว) ───────────────────
CREATE TABLE IF NOT EXISTS units (
  id                    SERIAL PRIMARY KEY,
  client_id             INT NOT NULL REFERENCES clients(id),   -- direct tenant key
  room_id               INT REFERENCES rooms(id),
  asset_code            VARCHAR(50) NOT NULL,
  name                  VARCHAR(150),
  equipment_type        VARCHAR(10) NOT NULL CHECK (equipment_type IN ('ac','fan')),
  family                VARCHAR(50),            -- FCU/Split/Cassette/AHU/VRF/Ceiling หรือชนิดพัดลม
  capacity_btu          VARCHAR(50),
  refrigerant           VARCHAR(30),            -- ว่างได้
  status                VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','broken','inactive')),
  last_major_clean_date DATE,                   -- ฐานคำนวณรอบ PM รายเครื่อง
  next_pm_date          DATE,
  pm_cycle_pos          SMALLINT NOT NULL DEFAULT 0,   -- 0=major, 1/2=minor
  needs_recode          BOOLEAN DEFAULT false,  -- flag รหัสซ้ำที่ import มาด้วย suffix ชั่วคราว
  active                BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, asset_code)               -- รหัสซ้ำข้าม client ได้ แต่ห้ามซ้ำในเจ้าเดียวกัน
);

-- ── Users / roles ───────────────────────────────────────────
-- role map (เดิม → ใหม่): admin→admin, owner→approver, technician→technician
-- central_admin = Admin กลางที่ตรวจก่อนส่งอนุมัติ (ด่าน 1)
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  username      VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL CHECK (role IN ('technician','central_admin','approver','admin')),
  phone         VARCHAR(20),
  active        BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Inspection template (ค่าวัด/เช็กลิสต์ ย้ายจาก JSONB+config มาเป็นตาราง) ──
CREATE TABLE IF NOT EXISTS inspection_template_items (
  id             SERIAL PRIMARY KEY,
  equipment_type VARCHAR(10) NOT NULL CHECK (equipment_type IN ('ac','fan')),
  category       VARCHAR(50),     -- 'ใช้งานทั้ง3' / 'แอร์น้ำยา' / 'FCU' / 'AHU' / 'fan'
  item_label     VARCHAR(200) NOT NULL,
  value_type     VARCHAR(20) NOT NULL CHECK (value_type IN ('check','number','before_after','text')),
  unit_label     VARCHAR(30),     -- หน่วย เช่น °C, A, V, RPM
  applies_major  BOOLEAN DEFAULT false,
  applies_minor  BOOLEAN DEFAULT false,
  sort_order     INT DEFAULT 0
);

-- ── Work orders (ใบงาน) ─────────────────────────────────────
-- อนุมัติ 2 ด่าน: in_progress → pending_admin (central_admin ตรวจ)
--                 → pending_approval (approver เซ็นปิด) → approved
CREATE TABLE IF NOT EXISTS work_orders (
  id               SERIAL PRIMARY KEY,
  order_no         VARCHAR(30) UNIQUE NOT NULL,
  client_id        INT NOT NULL REFERENCES clients(id),   -- direct tenant key
  site_id          INT REFERENCES sites(id),
  type             VARCHAR(10) NOT NULL CHECK (type IN ('major','minor','fan')),
  status           VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN (
                     'draft','in_progress','pending_admin','pending_approval',
                     'approved','rejected','closed'
                   )),
  created_by       INT REFERENCES users(id),
  area_owner_name  VARCHAR(150),   -- เจ้าของพื้นที่เซ็นหน้างาน (ไม่ล็อกอิน)
  reject_reason    TEXT,
  approver_id      INT REFERENCES users(id),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  admin_checked_at TIMESTAMPTZ,    -- ด่าน 1: central_admin ตรวจแล้ว
  approved_at      TIMESTAMPTZ,    -- ด่าน 2: approver เซ็นปิดแล้ว
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ช่างหลายคนต่อใบงาน
CREATE TABLE IF NOT EXISTS work_order_assignees (
  work_order_id INT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  user_id       INT NOT NULL REFERENCES users(id),
  PRIMARY KEY (work_order_id, user_id)
);

-- เครื่องแต่ละตัวในใบงาน
CREATE TABLE IF NOT EXISTS work_order_units (
  id            SERIAL PRIMARY KEY,
  work_order_id INT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  unit_id       INT NOT NULL REFERENCES units(id),
  has_repair    BOOLEAN DEFAULT false,
  repair_notes  TEXT,
  repair_job_id INT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ค่าตรวจวัด/เช็กลิสต์ ก่อน-หลัง (1 แถวต่อ 1 template item ต่อ 1 เครื่องในใบงาน)
CREATE TABLE IF NOT EXISTS inspection_values (
  id                 SERIAL PRIMARY KEY,
  work_order_unit_id INT NOT NULL REFERENCES work_order_units(id) ON DELETE CASCADE,
  template_item_id   INT NOT NULL REFERENCES inspection_template_items(id),
  value_before       TEXT,
  value_after        TEXT,
  checked            BOOLEAN,
  note               TEXT,
  UNIQUE (work_order_unit_id, template_item_id)
);

-- รูปภาพ (ผูกคนถ่าย uploaded_by)
CREATE TABLE IF NOT EXISTS work_order_photos (
  id                 SERIAL PRIMARY KEY,
  work_order_unit_id INT NOT NULL REFERENCES work_order_units(id) ON DELETE CASCADE,
  unit_id            INT REFERENCES units(id),
  uploaded_by        INT REFERENCES users(id),
  phase              VARCHAR(15) NOT NULL CHECK (phase IN ('before','after','measurement')),
  point_no           INT NOT NULL DEFAULT 1,
  label              VARCHAR(150),
  url                TEXT NOT NULL,
  filename           TEXT,
  taken_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ลายเซ็น — area_owner ไม่ล็อกอิน (user_id NULL ได้, ใช้ signer_name)
CREATE TABLE IF NOT EXISTS signatures (
  id             SERIAL PRIMARY KEY,
  work_order_id  INT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  role           VARCHAR(20) NOT NULL CHECK (role IN ('area_owner','central_admin','approver')),
  signer_name    VARCHAR(150),
  user_id        INT REFERENCES users(id),       -- NULLABLE
  signature_data TEXT NOT NULL,
  signed_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (work_order_id, role)
);

-- ── เบิกอะไหล่ ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS part_requisitions (
  id               SERIAL PRIMARY KEY,
  client_id        INT NOT NULL REFERENCES clients(id),   -- direct tenant key
  work_order_id    INT REFERENCES work_orders(id),
  unit_id          INT REFERENCES units(id),
  requisitioned_by INT REFERENCES users(id),
  part_name        VARCHAR(200) NOT NULL,
  qty              INT DEFAULT 1,
  note             TEXT,
  requisitioned_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── แจ้งซ่อม ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repair_logs (
  id                 SERIAL PRIMARY KEY,
  client_id          INT NOT NULL REFERENCES clients(id),   -- direct tenant key
  unit_id            INT NOT NULL REFERENCES units(id),
  work_order_id      INT REFERENCES work_orders(id),
  work_order_unit_id INT REFERENCES work_order_units(id),
  request_no         VARCHAR(50),
  problem            TEXT NOT NULL,
  cause              TEXT,
  solution           TEXT,
  cleaning_type      VARCHAR(10) CHECK (cleaning_type IN ('major','minor','fan')),
  status             VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  reported_by        INT REFERENCES users(id),
  resolved_at        TIMESTAMPTZ,
  petty_cash         DECIMAL(10,2),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── แผน PM รายปี (ปฏิทินวางแผนล้างรายเครื่อง) ────────────────
-- เก็บกลับตามมติเฟส 0: หน้าวางแผน PM (เฟส 5) ต้องใช้ — ผูก client_id ตรง
CREATE TABLE IF NOT EXISTS pm_plan (
  id             SERIAL PRIMARY KEY,
  client_id      INT NOT NULL REFERENCES clients(id),   -- direct tenant key
  unit_id        INT NOT NULL REFERENCES units(id),
  planned_type   VARCHAR(10) NOT NULL CHECK (planned_type IN ('major','minor','fan')),
  scheduled_date DATE NOT NULL,
  actual_date    DATE,
  work_order_id  INT REFERENCES work_orders(id),
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','done','overdue','skipped')),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── บันทึกหักเงินค่าบริการรายเดือน ──────────────────────────
-- เก็บกลับตามมติเฟส 0: ฟีเจอร์หักเงินรายเดือน (UI เฟส 6) — ผูก client_id ตรง
CREATE TABLE IF NOT EXISTS deduction_notes (
  id         SERIAL PRIMARY KEY,
  client_id  INT NOT NULL REFERENCES clients(id),   -- direct tenant key
  month      CHAR(7) NOT NULL,                       -- 'YYYY-MM'
  notes      TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes — tenant key + FK ที่ query บ่อย
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sites_client            ON sites(client_id);
CREATE INDEX IF NOT EXISTS idx_buildings_site          ON buildings(site_id);
CREATE INDEX IF NOT EXISTS idx_floors_building         ON floors(building_id);
CREATE INDEX IF NOT EXISTS idx_rooms_floor             ON rooms(floor_id);

CREATE INDEX IF NOT EXISTS idx_units_client            ON units(client_id);
CREATE INDEX IF NOT EXISTS idx_units_room              ON units(room_id);
CREATE INDEX IF NOT EXISTS idx_units_status            ON units(status);
CREATE INDEX IF NOT EXISTS idx_units_next_pm           ON units(next_pm_date);

CREATE INDEX IF NOT EXISTS idx_wo_client               ON work_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_wo_site                 ON work_orders(site_id);
CREATE INDEX IF NOT EXISTS idx_wo_status               ON work_orders(status);

CREATE INDEX IF NOT EXISTS idx_wou_order               ON work_order_units(work_order_id);
CREATE INDEX IF NOT EXISTS idx_wou_unit                ON work_order_units(unit_id);
CREATE INDEX IF NOT EXISTS idx_iv_wou                  ON inspection_values(work_order_unit_id);
CREATE INDEX IF NOT EXISTS idx_photos_wou              ON work_order_photos(work_order_unit_id);

CREATE INDEX IF NOT EXISTS idx_partreq_client          ON part_requisitions(client_id);
CREATE INDEX IF NOT EXISTS idx_partreq_wo              ON part_requisitions(work_order_id);

CREATE INDEX IF NOT EXISTS idx_repair_client           ON repair_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_repair_unit             ON repair_logs(unit_id);
CREATE INDEX IF NOT EXISTS idx_tpl_equip               ON inspection_template_items(equipment_type);

CREATE INDEX IF NOT EXISTS idx_pmplan_client           ON pm_plan(client_id);
CREATE INDEX IF NOT EXISTS idx_pmplan_unit             ON pm_plan(unit_id);
CREATE INDEX IF NOT EXISTS idx_pmplan_scheduled        ON pm_plan(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_deduction_client        ON deduction_notes(client_id);
CREATE INDEX IF NOT EXISTS idx_deduction_month         ON deduction_notes(month);
