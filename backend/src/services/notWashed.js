// "ยังไม่ล้าง" — เครื่องในทะเบียนที่ยังไม่มีใบงานประเภทนั้นในเดือนนั้น. ใช้ร่วมกันระหว่าง
// GET /api/wash-units/not-washed (หน้าเป้าหมายล้างวันถัดไป) และ MCP tool wash_plan
// เพื่อให้สองทางนับเหมือนกันเสมอ (ย้ายมาจาก routes/washUnits.js ไม่ได้เปลี่ยน SQL).
//
// ฐาน = ทะเบียน active ที่อุปกรณ์ตรงประเภท (พัดลม → fan, ล้างใหญ่/ย่อย → ac).
// "ล้างแล้ว" = มีใบงานประเภทนั้นในเดือนนั้น จับคู่แบบเดียวกับ /coverage (asset_code ของใบ หรือ
// เลขเครื่องในตาราง) แต่ไม่นับใบที่ส่งกลับ — เหมือนยอดล้างในรายงาน (#261).
// ใบเก่าที่ work_type ว่าง = ล้างใหญ่ (เหมือน vw_simple_wo_major).
const NW_TYPES = ['major', 'minor', 'fan'];

function notWashedQuery(q) {
  const wt = q.work_type || 'major';
  if (!NW_TYPES.includes(wt)) return { error: 'work_type ต้องเป็น major | minor | fan' };
  const month = String(q.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: 'month ต้องเป็น YYYY-MM' };
  const params = [wt === 'fan' ? 'fan' : 'ac', wt, month];
  const where = ['u.active = true', 'u.equipment = $1::text'];
  for (const [k, col] of [['zone', 'u.pts_zone'], ['location', 'u.location'], ['ac_type', 'u.ac_type']]) {
    if (q[k]) { params.push(String(q[k])); where.push(`${col} = $${params.length}::text`); }
  }
  const sql = `
    WITH washed AS (
      SELECT x.code, x.d FROM (
        SELECT s.asset_code AS code, COALESCE(s.work_date, s.created_at::date) AS d
          FROM simple_work_orders s
         WHERE s.deleted_at IS NULL AND s.status <> 'rejected' AND COALESCE(s.work_type, 'major') = $2::text
        UNION ALL
        SELECT g->>'machine_no', COALESCE(s.work_date, s.created_at::date)
          FROM simple_work_orders s, jsonb_array_elements(COALESCE(s.grid_rows, '[]'::jsonb)) g
         WHERE s.deleted_at IS NULL AND s.status <> 'rejected' AND COALESCE(s.work_type, 'major') = $2::text
      ) x WHERE COALESCE(x.code, '') <> ''
    ), last AS (
      SELECT code, MAX(d) AS last_d, BOOL_OR(to_char(d, 'YYYY-MM') = $3::text) AS in_month
        FROM washed GROUP BY code
    ), plan AS (
      SELECT asset_code, MIN(planned_date) AS next_plan
        FROM wash_schedule
       WHERE status = 'planned' AND work_type = $2::text AND planned_date >= CURRENT_DATE
       GROUP BY asset_code
    )
    SELECT u.asset_code, u.pts_zone, u.location, u.building, u.floor, u.room, u.ac_type,
           CASE $2::text WHEN 'major' THEN u.freq_major WHEN 'minor' THEN u.freq_minor ELSE u.freq_fan END AS freq,
           l.last_d::text AS last_washed, COALESCE(l.in_month, false) AS washed_in_month,
           p.next_plan::text AS next_plan
      FROM wash_units u
      LEFT JOIN last l ON l.code = u.asset_code
      LEFT JOIN plan p ON p.asset_code = u.asset_code
     WHERE ${where.join(' AND ')}
     ORDER BY u.pts_zone NULLS LAST, u.location NULLS LAST, u.building NULLS LAST,
              u.floor NULLS LAST, u.room NULLS LAST, u.asset_code`;
  return { sql, params, wt, month };
}

module.exports = { notWashedQuery, NW_TYPES };
