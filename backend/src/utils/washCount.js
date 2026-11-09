// นิยามกลางของ "ยอดล้าง" — ใช้ร่วมกันระหว่างรายงานล้าง/ปฏิทิน (routes/dashboard.js)
// และรายการใบงาน (routes/simpleWorkOrders.js) เพื่อให้ตัวเลขสองหน้าตรงกันเสมอ.
//
// หน่วยนับ = เครื่อง: ล้างใหญ่ 1 ใบ = 1 เครื่อง; ล้างย่อย/พัดลม = จำนวนแถวในตาราง (อย่างน้อย 1).
// ใช้ชื่อคอลัมน์ไม่ระบุ alias — ปลอดภัยเมื่อ join กับ users (users ไม่มี work_type/grid_rows).
const UNITS_EXPR = `CASE WHEN work_type IN ('minor','fan')
                         THEN GREATEST(jsonb_array_length(COALESCE(grid_rows,'[]'::jsonb)), 1)
                         ELSE 1 END`;
const DONE_EXPR = `SUM(${UNITS_EXPR})::int`;

// วันที่ของงานล้าง = work_date ถ้ามี ไม่งั้นวันที่สร้างใบ. ต้องใส่ alias เมื่อ join
// (users ก็มี created_at). ปฏิทินรายวันใช้นิยามนี้ — รายการใบงานต้องใช้ตัวเดียวกัน.
const washDateExpr = (alias) => {
  const p = alias ? `${alias}.` : '';
  return `COALESCE(${p}work_date, ${p}created_at::date)`;
};

module.exports = { UNITS_EXPR, DONE_EXPR, washDateExpr };
