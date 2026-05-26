-- ============================================================
-- airclean_db schema — Technical Water Co.,Ltd
-- AC Cleaning Management System
-- ============================================================

-- Users (ช่าง + Owner + Admin)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin','owner','technician')),
  phone VARCHAR(20),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Hospitals (โรงพยาบาลที่รับงาน)
CREATE TABLE IF NOT EXISTS hospitals (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(50) UNIQUE NOT NULL,
  address TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Buildings (อาคาร)
CREATE TABLE IF NOT EXISTS buildings (
  id SERIAL PRIMARY KEY,
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  name VARCHAR(50) NOT NULL,
  code VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Floors (ชั้น)
CREATE TABLE IF NOT EXISTS floors (
  id SERIAL PRIMARY KEY,
  building_id INT NOT NULL REFERENCES buildings(id),
  name VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Departments (สถานที่/แผนก)
CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  floor_id INT NOT NULL REFERENCES floors(id),
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- AC Units (รายการแอร์)
CREATE TABLE IF NOT EXISTS ac_units (
  id SERIAL PRIMARY KEY,
  department_id INT NOT NULL REFERENCES departments(id),
  ac_code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(30) NOT NULL CHECK (type IN ('FCU','Split','AHU','VRF','Fan')),
  capacity_btu VARCHAR(50),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','broken','inactive')),
  pm_interval_months INT DEFAULT 2,
  next_pm_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Work Orders (ใบงานล้าง)
CREATE TABLE IF NOT EXISTS work_orders (
  id SERIAL PRIMARY KEY,
  order_no VARCHAR(30) UNIQUE NOT NULL,
  hospital_id INT NOT NULL REFERENCES hospitals(id),
  type VARCHAR(20) NOT NULL CHECK (type IN ('major','minor','fan')),
  status VARCHAR(30) DEFAULT 'draft' CHECK (status IN (
    'draft','in_progress','pending_approval','approved','rejected'
  )),
  tech1_id INT REFERENCES users(id),
  tech2_id INT REFERENCES users(id),
  owner_id INT REFERENCES users(id),
  owner_notes TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Work Order Items (แอร์แต่ละตัวในใบงาน)
CREATE TABLE IF NOT EXISTS work_order_items (
  id SERIAL PRIMARY KEY,
  work_order_id INT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  ac_unit_id INT NOT NULL REFERENCES ac_units(id),
  measurements JSONB DEFAULT '{}',
  checklist JSONB DEFAULT '{}',
  has_repair BOOLEAN DEFAULT false,
  repair_notes TEXT,
  repair_job_id INT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Photos (รูปภาพก่อน/หลัง)
CREATE TABLE IF NOT EXISTS ac_photos (
  id SERIAL PRIMARY KEY,
  work_order_item_id INT NOT NULL REFERENCES work_order_items(id) ON DELETE CASCADE,
  phase VARCHAR(10) NOT NULL CHECK (phase IN ('before','after')),
  point_no INT NOT NULL DEFAULT 1,
  url TEXT NOT NULL,
  filename TEXT,
  taken_at TIMESTAMP DEFAULT NOW()
);

-- Signatures (ลายเซ็น)
CREATE TABLE IF NOT EXISTS signatures (
  id SERIAL PRIMARY KEY,
  work_order_id INT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id),
  role VARCHAR(20) NOT NULL CHECK (role IN ('tech1','tech2','owner')),
  signature_data TEXT NOT NULL,
  signed_at TIMESTAMP DEFAULT NOW()
);

-- Repair Logs (แจ้งซ่อม — standalone ไม่ผูก repair_db)
CREATE TABLE IF NOT EXISTS repair_logs (
  id SERIAL PRIMARY KEY,
  ac_unit_id INT NOT NULL REFERENCES ac_units(id),
  work_order_id INT REFERENCES work_orders(id),
  work_order_item_id INT REFERENCES work_order_items(id),
  request_no VARCHAR(50),
  problem TEXT NOT NULL,
  cause TEXT,
  solution TEXT,
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  reported_by INT REFERENCES users(id),
  resolved_at TIMESTAMP,
  petty_cash DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- PM Plan (แผน PM อัตโนมัติ)
CREATE TABLE IF NOT EXISTS pm_plan (
  id SERIAL PRIMARY KEY,
  ac_unit_id INT NOT NULL REFERENCES ac_units(id),
  planned_type VARCHAR(20) NOT NULL CHECK (planned_type IN ('major','minor','fan')),
  scheduled_date DATE NOT NULL,
  actual_date DATE,
  work_order_id INT REFERENCES work_orders(id),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','done','overdue','skipped')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ac_units_department ON ac_units(department_id);
CREATE INDEX IF NOT EXISTS idx_ac_units_status ON ac_units(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_hospital ON work_orders(hospital_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_order_items_order ON work_order_items(work_order_id);
CREATE INDEX IF NOT EXISTS idx_ac_photos_item ON ac_photos(work_order_item_id);
CREATE INDEX IF NOT EXISTS idx_repair_logs_ac ON repair_logs(ac_unit_id);
CREATE INDEX IF NOT EXISTS idx_pm_plan_ac ON pm_plan(ac_unit_id);
CREATE INDEX IF NOT EXISTS idx_pm_plan_date ON pm_plan(scheduled_date);
