require('dotenv').config();
const pool = require('./pool');

// ADDITIVE — read-only VIEWS that present simple_work_orders split per
// work_type (mirrors the per-sheet Excel export), so the DB / BI tools can
// query each kind cleanly without the storage being restructured:
//   vw_simple_wo_major  — one row per WO (checklist kept as JSONB)
//   vw_simple_wo_minor  — one row per unit (grid_rows unnested), 4 checks
//   vw_simple_wo_fan    — one row per unit (grid_rows unnested), 5 checks + ชำรุด
// CREATE OR REPLACE → re-runnable. Run: node src/db/migrate_simple_wo_views.js
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE OR REPLACE VIEW vw_simple_wo_major AS
      SELECT id, wo_number, created_at, updated_at, work_date,
             tech_name, client_name, building, floor, room, asset_code,
             power_system, result, start_time, end_time,
             checklist_values, ac_info, team_comment,
             sig_team_name      AS "เซ็น_ช่างแอร์",
             sig_supervisor_name AS "เซ็น_หัวหน้าช่างแอร์",
             sig_building_name   AS "เซ็น_เจ้าหน้าที่ช่างอาคาร",
             sig_engineer_name   AS "เซ็น_เจ้าหน้าวิศวกรรม"
      FROM simple_work_orders
      WHERE deleted_at IS NULL AND (work_type = 'major' OR work_type IS NULL)
    `);

    await client.query(`
      CREATE OR REPLACE VIEW vw_simple_wo_minor AS
      SELECT s.wo_number, s.work_date, s.client_name, s.building, s.floor, s.tech_name,
             g.ord AS "ลำดับ",
             g.row->>'name' AS "ชื่อเครื่อง",
             (g.row->'checks'->>0)::boolean AS "ตรวจเช็คระบบการทำงาน",
             (g.row->'checks'->>1)::boolean AS "ล้างหัวจ่าย",
             (g.row->'checks'->>2)::boolean AS "ล้างช่องรีเทิร์น",
             (g.row->'checks'->>3)::boolean AS "ล้างฟิลเตอร์",
             s.recommendation AS "ข้อแนะนำ"
      FROM simple_work_orders s
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.grid_rows, '[]'::jsonb))
        WITH ORDINALITY AS g(row, ord)
      WHERE s.deleted_at IS NULL AND s.work_type = 'minor'
    `);

    await client.query(`
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
      WHERE s.deleted_at IS NULL AND s.work_type = 'fan'
    `);

    console.log('simple-wo views migration complete (vw_simple_wo_major/minor/fan)');
  } catch (err) {
    console.error('views migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
