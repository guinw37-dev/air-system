// รายการ checklist ของสาขาหนึ่ง — ที่เดียวที่ประกอบ template + override ต่อสาขา.
//
// `inspection_template_items` เป็นตาราง GLOBAL (public) ใช้ร่วมทุกสาขา แต่ศรีราชา
// ขอฟอร์มล้างใหญ่คนละแบบ (08-11-2569) จึงมีสองกลไกทับลงไป:
//   • items.only_branches — แถวที่มีเฉพาะบางสาขา (NULL = ทุกสาขา)
//   • inspection_template_branch_overrides — แถวเดิม id เดิม แต่ชื่อ/ชนิด/หน่วย
//     ต่างกันต่อสาขา (ใช้ override แทนการสร้างแถวใหม่ เพื่อให้ค่าที่เคยกรอกไว้
//     ซึ่งผูกกับ id เดิม ยังแสดงได้ตามปกติ)
//
// ฟอร์ม, PDF และ Excel ต้องอ่านผ่านฟังก์ชันนี้เท่านั้น — เขียน SQL เองแยกกันเมื่อไหร่
// สามที่จะเห็น checklist คนละชุดทันทีที่มีสาขาใดขอแก้ฟอร์ม
const WHERE_BY_WORK_TYPE = {
  fan:   `i.equipment_type = 'fan'`,
  minor: `i.equipment_type = 'ac' AND i.applies_minor = true`,
  major: `i.equipment_type = 'ac' AND i.applies_major = true`,
};

// SQL + params สำหรับ req.db(...). branchSlug = null (apex) → เห็นเฉพาะแถวกลาง
function templateItemsQuery(workType, branchSlug, extraCols = '') {
  const base = WHERE_BY_WORK_TYPE[workType] || WHERE_BY_WORK_TYPE.major;
  const sql = `
    SELECT i.id, i.category, i.sort_order,
           COALESCE(o.item_label, i.item_label) AS item_label,
           COALESCE(o.value_type, i.value_type) AS value_type,
           COALESCE(o.unit_label, i.unit_label) AS unit_label${extraCols ? `, ${extraCols}` : ''}
      FROM inspection_template_items i
      LEFT JOIN inspection_template_branch_overrides o
        ON o.item_id = i.id AND o.branch_slug = $1::varchar
     WHERE ${base}
       AND (i.only_branches IS NULL OR $1::varchar = ANY(i.only_branches))
     ORDER BY i.sort_order, i.id`;
  return { sql, params: [branchSlug || null] };
}

// อ่านรายการ checklist ผ่าน req.db (schema-scoped) — ตารางอยู่ public จึง resolve
// ผ่าน search_path fallback เหมือนเดิม
async function fetchTemplateItems(db, workType, branchSlug) {
  const { sql, params } = templateItemsQuery(workType, branchSlug);
  const { rows } = await db(sql, params);
  return rows;
}

module.exports = { templateItemsQuery, fetchTemplateItems, WHERE_BY_WORK_TYPE };
