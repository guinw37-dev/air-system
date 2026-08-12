// checklist ต่อสาขา — ฟอร์ม / PDF / Excel ต้องอ่านชุดเดียวกันเสมอ
// (ศรีราชาใช้ฟอร์มล้างใหญ่ชุด 08-11-2569 สาขาอื่นคงของเดิม)
const assert = require('assert');
const { templateItemsQuery, fetchTemplateItems } = require('../src/utils/templateItems');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok - ${name}`); };

t('query ผูกสาขาเป็น parameter ไม่ interpolate เข้า SQL', () => {
  const { sql, params } = templateItemsQuery('major', "phayathai-sriracha'; DROP TABLE users;--");
  assert.deepStrictEqual(params, ["phayathai-sriracha'; DROP TABLE users;--"]);
  assert.ok(!sql.includes('DROP TABLE'), 'slug ต้องไม่หลุดเข้าไปใน SQL');
});

t('แถวเฉพาะสาขา: only_branches ถูกกรองเสมอ', () => {
  const { sql } = templateItemsQuery('major', 'paolo-kaset');
  // สาขาที่ไม่ได้อยู่ใน only_branches ต้องไม่เห็นแถวนั้น — ถ้าเงื่อนไขนี้หลุด
  // ทุกสาขาจะเห็นแถวขนาดช่องจ่ายลม/Return ของศรีราชา
  assert.ok(/only_branches IS NULL OR .*= ANY\(i\.only_branches\)/.test(sql.replace(/\s+/g, ' ')),
    'ขาดเงื่อนไข only_branches');
});

t('ชื่อ/ชนิด/หน่วย อ่านจาก override ของสาขาก่อนค่ากลาง', () => {
  const flat = templateItemsQuery('major', 'phayathai-sriracha').sql.replace(/\s+/g, ' ');
  for (const col of ['item_label', 'value_type', 'unit_label']) {
    assert.ok(flat.includes(`COALESCE(o.${col}, i.${col}) AS ${col}`), `${col} ไม่ได้ COALESCE กับ override`);
  }
  assert.ok(/LEFT JOIN inspection_template_branch_overrides o ON o\.item_id = i\.id AND o\.branch_slug =/.test(flat),
    'override ต้อง join ด้วย branch_slug ของ request');
});

t('work_type map ถูกชุด (fan / minor / major)', () => {
  assert.ok(templateItemsQuery('fan', null).sql.includes("i.equipment_type = 'fan'"));
  assert.ok(templateItemsQuery('minor', null).sql.includes('i.applies_minor = true'));
  assert.ok(templateItemsQuery('major', null).sql.includes('i.applies_major = true'));
  // ค่าที่ไม่รู้จัก → ตกมาที่ major ไม่ใช่ query เปล่าที่คืนทุกแถว
  assert.ok(templateItemsQuery('เละ', null).sql.includes('i.applies_major = true'));
});

t('apex (ไม่มีสาขา) เห็นเฉพาะแถวกลาง ไม่ระเบิด', async () => {
  const seen = [];
  const fakeDb = async (sql, params) => { seen.push(params); return { rows: [{ id: 1 }] }; };
  const rows = await fetchTemplateItems(fakeDb, 'major', undefined);
  assert.deepStrictEqual(rows, [{ id: 1 }]);
  assert.deepStrictEqual(seen[0], [null], 'branch ที่ไม่มีค่า ต้องส่ง null ไม่ใช่ undefined');
});

console.log(`\n${pass} passed`);
