require('dotenv').config();
const pool = require('./pool');

// ADDITIVE migration — Simple Work Order system (phase 1).
// Creates `simple_work_orders` (one-step form → submit → PDF/Excel, no approval).
// Does NOT touch the existing 2-stage `work_orders` flow.
// Run on Coolify Terminal:  node src/db/migrate_simple_wo.js  (or npm run migrate:simple-wo)
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS simple_work_orders (
        id          SERIAL PRIMARY KEY,
        wo_number   VARCHAR(30) UNIQUE NOT NULL,   -- WO-2569-06-0001 (พ.ศ.)
        created_by  INT REFERENCES users(id),
        created_at  TIMESTAMPTZ DEFAULT NOW(),

        -- ส่วนหัว (กรอกเอง — free text, ไม่ผูก master)
        tech_name    VARCHAR(150),
        work_date    DATE,
        client_name  VARCHAR(200),
        building     VARCHAR(100),
        floor        VARCHAR(50),
        room         VARCHAR(100),
        asset_code   VARCHAR(100),
        work_type    VARCHAR(20),     -- major | minor | fan
        power_system VARCHAR(5),      -- 380 | 220

        -- ค่าตรวจเช็ค (JSONB — key = template_item_id, value = { checked, value_before, ... })
        checklist_values JSONB DEFAULT '{}'::jsonb,

        -- ผลงาน
        result     VARCHAR(20),       -- ok | not_ok
        start_time TIME,
        end_time   TIME,

        -- ความเห็นทีมช่าง (JSONB — { ac_degraded, ac_old_5_7yr, external_degraded, external_detail, ... })
        team_comment JSONB DEFAULT '{}'::jsonb,

        -- รูป (JSONB array — [{ url, phase: 'before'|'after'|'measurement', point_no, label }])
        photo_urls JSONB DEFAULT '[]'::jsonb,

        -- ลายเซ็น (base64 PNG + ชื่อ)
        sig_engineer        TEXT, sig_engineer_name   VARCHAR(150),
        sig_department      TEXT, sig_department_name VARCHAR(150),
        sig_team            TEXT, sig_team_name        VARCHAR(150),
        sig_supervisor      TEXT, sig_supervisor_name VARCHAR(150),
        sig_building        TEXT, sig_building_name    VARCHAR(150),
        grid_rows           JSONB DEFAULT '[]'::jsonb,
        recommendation      TEXT,

        status     VARCHAR(20) DEFAULT 'submitted'
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_swo_created_at ON simple_work_orders(created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_swo_created_by ON simple_work_orders(created_by)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_swo_work_type  ON simple_work_orders(work_type)`);
    console.log('simple_work_orders migration complete (no data dropped)');
  } catch (err) {
    console.error('simple_work_orders migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
