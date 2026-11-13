// หน้า /deductions: role ที่หน้าเว็บให้เข้า ต้องบันทึกได้จริงที่ backend (ไม่งั้นเปิดหน้าได้
// แต่กดบันทึกแล้ว 403). อ่านรายชื่อ role จาก canEdit ของ backend ตัวจริง. รัน: npm run test
import assert from 'assert';
import { readFileSync } from 'fs';
import { DEDUCTIONS_ROLES } from '../src/lib/pageRoles.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok - ${name}`); };

const src = readFileSync(new URL('../../backend/src/routes/deductions.js', import.meta.url), 'utf8');
const m = /const canEdit = requireRole\(([^)]*)\)/.exec(src);
const BACKEND = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];

t('อ่าน canEdit ของ backend ได้ (ถ้าเปลี่ยนรูปแบบ ต้องแก้ test นี้ ไม่ใช่ผ่านเงียบ)', () => {
  assert.ok(BACKEND.length >= 3, `parsed ${JSON.stringify(BACKEND)}`);
  assert.ok(BACKEND.includes('admin'));
});

t('ทุก role ที่หน้าเว็บให้เข้า /deductions บันทึกได้ที่ backend', () => {
  const extra = DEDUCTIONS_ROLES.filter((r) => !BACKEND.includes(r));
  assert.deepStrictEqual(extra, [], `หน้าเว็บให้เข้าแต่ backend ตอบ 403: ${extra.join(', ')}`);
});

t('หัวหน้าช่าง (checker) และช่าง ไม่เข้าหน้ารายการหัก (ป้อม 13 พ.ย. 69)', () => {
  assert.ok(!DEDUCTIONS_ROLES.includes('checker'));
  assert.ok(!DEDUCTIONS_ROLES.includes('technician'));
});

t('ผู้ที่ต้องยังเข้าได้: แอดมิน + ช่างอาคาร + วิศวกรรม', () => {
  for (const r of ['admin', 'approve_building', 'approve_engineer']) assert.ok(DEDUCTIONS_ROLES.includes(r), r);
});

console.log(`\n${pass} passed`);
