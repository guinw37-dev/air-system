// ป้ายสถานะ "ค้างรอใครเซ็น" — pure, ไม่ต้องมี DOM. รัน: npm run test
import assert from 'assert';
import { waitingBadge, waitingSlots } from '../src/lib/signStage.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok - ${name}`); };

const FOUR = ['team', 'supervisor', 'building', 'engineer'];
const ts = { sig_team: 'a', sig_supervisor: 'b' };

t('จาก sig_*: ช่องคู่ขนานรวมอยู่ป้ายเดียว', () => {
  assert.strictEqual(waitingBadge({}).label, 'ยังไม่เสร็จ');
  assert.strictEqual(waitingBadge({ sig_team: 'a' }).label, 'รอหัวหน้าช่าง');
  assert.strictEqual(waitingBadge(ts).label, 'รอช่างอาคาร + เจ้าของพื้นที่');
  assert.strictEqual(waitingBadge({ ...ts, sig_building: 'c' }).label, 'รอวิศวกรรม + เจ้าของพื้นที่');
  assert.strictEqual(waitingBadge({ ...ts, sig_building: 'c', sig_engineer: 'd' }).label, 'รอเจ้าของพื้นที่');
  assert.strictEqual(waitingBadge({ ...ts, sig_building: 'c', sig_engineer: 'd', sig_department: 'e' }), null);
});

t('สาขาที่ไม่เปิดกติกา: ไม่มีคำว่าเจ้าของพื้นที่โผล่เลย', () => {
  assert.strictEqual(waitingBadge(ts, FOUR).label, 'รอช่างอาคาร');
  assert.strictEqual(waitingBadge({ ...ts, sig_building: 'c' }, FOUR).label, 'รอวิศวกรรม');
  assert.strictEqual(waitingBadge({ ...ts, sig_building: 'c', sig_engineer: 'd' }, FOUR), null);
});

t('จาก wait_* (แถวจาก API) ต้องไม่ผสมกับ sig_*', () => {
  // แถวจาก /simple-wo ไม่มี sig_* ติดมาด้วย — ถ้า fallback ทีละช่อง ช่องที่ API
  // ไม่ได้ส่ง (สาขาไม่เปิดกติกา) จะถูกอ่านเป็น "ค้าง" ทั้งที่เซ็นครบแล้ว
  const row = { wait_team: false, wait_supervisor: false, wait_building: false, wait_engineer: true, wait_department: true };
  assert.strictEqual(waitingBadge(row).label, 'รอวิศวกรรม + เจ้าของพื้นที่');
  assert.strictEqual(waitingBadge({ wait_team: false, wait_supervisor: false, wait_building: false, wait_engineer: false }), null);
  // แถวที่ส่งมาเฉพาะช่องที่ค้างจริง ก็ต้องไม่เดา team ว่าค้าง
  assert.strictEqual(waitingBadge({ wait_engineer: true }).label, 'รอวิศวกรรม');
  assert.deepStrictEqual(waitingSlots({ wait_building: true, wait_department: true }), ['building', 'department']);
});

t('ป้ายเรียงตามสายงาน — เจ้าของพื้นที่ท้ายสุดเสมอ', () => {
  assert.deepStrictEqual(waitingSlots(ts), ['building', 'department']);
  assert.deepStrictEqual(waitingSlots({ ...ts, sig_building: 'c' }), ['engineer', 'department']);
});

console.log(`\n${pass} passed`);
