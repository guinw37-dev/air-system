// Tests for the simple-wo PDF HTML builder (pure, no DB).
// buildSimpleReportHtml(data) → HTML string. Run: node test/simpleReport.test.js
const assert = require('assert');
const { buildSimpleReportHtml } = require('../src/services/reportTemplates');

let passed = 0;
const ok = (n) => { passed++; console.log(`  ok - ${n}`); };

const baseSigs = { team: {}, supervisor: {}, department: {}, engineer: {}, building: {} };
const baseData = (over = {}) => ({
  wo: { order_no: 'WO-T', client_name: 'รพ.ทดสอบ', tech_name: 'ช่าง', work_date: '2026-06-01', work_type: 'major', ...(over.wo || {}) },
  unit: { building_name: 'A', floor_name: '2', equipment_type: 'ล้างใหญ่', inspections: [], photos: { before: [], after: [] }, ...(over.unit || {}) },
  sigs: baseSigs, ac: {}, brand: {}, qr: '', imageBase: '', gridRows: over.gridRows || [], recommendation: over.recommendation || '',
});

// ── Grid: ล้างย่อย ──────────────────────────────────────────────
let html = buildSimpleReportHtml(baseData({
  wo: { work_type: 'minor', location: 'คลินิกบางพระ', ac_type: 'FCU' },
  gridRows: [{ room: 'ห้องลงทะเบียน', machine_no: 'AC-101', checks: [true, false, true, true],
    photos: { before: 'data:image/png;base64,B', after: 'data:image/png;base64,A', during: 'data:image/png;base64,D' } }],
  recommendation: 'ปกติดี',
}));
assert(html.includes('CUSTOMER SERVICE REPORT AIR'), 'minor letterhead title');
assert(html.includes('ห้อง/แผนก') && html.includes('เลขเครื่อง'), 'minor table headers (room + machine_no)');
assert(html.includes('ห้องลงทะเบียน') && html.includes('AC-101'), 'minor room + machine_no values');
assert(html.includes('สถานที่') && html.includes('คลินิกบางพระ'), 'minor สถานที่');
assert(html.includes('ล้างแอร์ แบบล้างย่อย (FCU)'), 'minor ประเภทงาน with ac_type');
assert(html.includes('รูปถ่ายงานล้างย่อย') && html.includes('ขณะปฏิบัติงาน'), 'minor per-machine photo section');
assert(html.includes('ข้อมูลลูกค้า') && html.includes('สำหรับพนักงานผู้ให้บริการ'), 'minor section bars');
assert(html.includes('ปกติดี'), 'minor recommendation');
assert(!html.includes('รายงานบริการ'), 'minor does NOT use major header');
ok('grid minor renders the ล้างย่อย form (room/machine_no + สถานที่ + ac_type + photos)');

// minor fallback: old rows that only have `name` still render under เลขเครื่อง
html = buildSimpleReportHtml(baseData({ wo: { work_type: 'minor' }, gridRows: [{ name: 'OLD-9', checks: [true, true, true, true] }] }));
assert(html.includes('OLD-9'), 'minor back-compat name → เลขเครื่อง');
ok('grid minor back-compat: legacy {name} row still renders');

// ── Major: header สถานที่ + ประเภทแอร์, AC block ไม่มี detail/location ───────
html = buildSimpleReportHtml(baseData({
  wo: { work_type: 'major', location: 'คลินิกบางพระ', ac_type: 'AHU' },
  unit: { building_name: 'A', floor_name: '2', room_name: 'ห้อง X', asset_code: 'AC-9' },
}));
assert(html.includes('สถานที่') && html.includes('คลินิกบางพระ'), 'major header สถานที่');
assert(html.includes('ประเภทเครื่องปรับอากาศ') && html.includes('AHU'), 'major header ประเภทแอร์');
assert(!html.includes('ตำแหน่งที่ติดตั้ง'), 'major AC block drops duplicate ตำแหน่งที่ติดตั้ง');
ok('major report: สถานที่ + ประเภทแอร์ in header, no duplicate AC fields');

// ── Grid: พัดลม ─────────────────────────────────────────────────
html = buildSimpleReportHtml(baseData({
  wo: { work_type: 'fan', location: 'คลินิกบางพระ', ac_type: 'Exhaust Fan Duct Type' },
  gridRows: [{ room: 'ห้องแอร์', machine_no: 'FAN-1', checks: [true, true, false, true, true], broken: 'มอเตอร์ดัง',
    photos: { before: 'data:image/png;base64,B', during: 'data:image/png;base64,D' } }],
}));
assert(html.includes('ใบบันทึกการบำรุงรักษาระบบปรับอากาศ'), 'fan title');
assert(html.includes('ชำรุดเนื่องจาก') && html.includes('มอเตอร์ดัง'), 'fan broken column');
assert(html.includes('ห้อง/แผนก') && html.includes('ห้องแอร์') && html.includes('FAN-1'), 'fan room + machine_no');
assert(html.includes('สถานที่') && html.includes('คลินิกบางพระ'), 'fan สถานที่');
assert(html.includes('ประเภทพัดลม') && html.includes('Exhaust Fan Duct Type'), 'fan ประเภทพัดลม');
assert(html.includes('ล้างพัดลมดูดอากาศ'), 'fan ประเภทงาน label');
assert(html.includes('รูปถ่ายงานล้างพัดลม'), 'fan per-machine photo section');
ok('grid fan: room/machine_no + สถานที่ + ประเภทพัดลม + ชำรุด + photos');

// ── ln_vi (Compressor): 1 เฟส vs 3 เฟส ──────────────────────────
const lnvi = (ps, v) => baseData({ unit: { inspections: [{ category: 'refrigerant', item_label: 'Compressor', value_type: 'ln_vi', power_system: ps, ...v }] } });
html = buildSimpleReportHtml(lnvi('220', { val_ln_after: '220', val_l_after: '6.1' }));
assert(html.includes('1 เฟส') && !html.includes('3 เฟส'), '1φ shows 1 เฟส only');
ok('ln_vi 1 เฟส renders LN/L (not 3 เฟส)');
html = buildSimpleReportHtml(lnvi('380', { val_r_v_after: '220', val_r_after: '10', val_s_v_after: '221', val_s_after: '10', val_t_v_after: '219', val_t_after: '10' }));
assert(html.includes('3 เฟส') && html.includes('220V/10A'), '3φ shows R/S/T V/A');
ok('ln_vi 3 เฟส renders R/S/T V/A');

// ── rst_amp (Blower): phase sets are mutually exclusive ─────────
const rst = (ps) => baseData({ unit: { inspections: [{ category: 'all3', item_label: 'Blower', value_type: 'rst_amp', power_system: ps,
  val_r_before: '5', val_s_before: '5', val_t_before: '5', val_r_after: '4', val_s_after: '4', val_t_after: '4',
  val_ln_before: '380', val_l_before: '6', val_ln_after: '380', val_l_after: '5' }] } });
html = buildSimpleReportHtml(rst('380'));
assert(html.includes('380V 3φ') && html.includes('R=5'), '380V shows R/S/T');
ok('rst_amp 380V shows R/S/T (3φ)');
html = buildSimpleReportHtml(rst('220'));
assert(html.includes('220V 1φ') && html.includes('LN=380'), '220V shows LN/L');
ok('rst_amp 220V shows LN/L (1φ)');

// ── checklist ชุด 08-11-2569: ขนาดช่องจ่ายลม + อุณหภูมิ/ความชื้น ──────────────
const insp = (over) => baseData({ unit: { inspections: [{ category: 'all3', ...over }] } });

// ขนาดช่องจ่ายลม — ค่าเดียว ไม่มีคอลัมน์ "ก่อน" ให้กรอก
html = buildSimpleReportHtml(insp({
  item_label: 'ขนาดช่องจ่ายลม', value_type: 'single_number', unit_label: 'ตร.นิ้ว', value_after: '144',
}));
assert(html.includes('ขนาดช่องจ่ายลม'), 'single_number row label');
assert(html.includes('144'), 'single_number value rendered');
assert(html.includes('colspan="2"'), 'single_number spans both ก่อน/หลัง columns');
ok('single_number (ขนาดช่องจ่ายลม) renders one value across both columns');

// ช่องจ่ายลม — อุณหภูมิ ก่อน/หลัง + ความชื้นหลัง
html = buildSimpleReportHtml(insp({
  item_label: 'ตรวจวัดอุณหภูมิ (°C) และความชื้น (%RH) ด้านหน้าช่องจ่ายลม',
  value_type: 'temp_rh', unit_label: '°C / %RH', value_before: '28', value_after: '22', rh_after: '55',
}));
assert(html.includes('28') && html.includes('22'), 'temp_rh before + after temperature');
assert(html.includes('55') && html.includes('%RH'), 'temp_rh humidity rendered with unit');
ok('temp_rh renders อุณหภูมิ ก่อน/หลัง + ความชื้นหลัง');

// Return — วัดหลังล้างอย่างเดียว: คอลัมน์ "ก่อน" ต้องว่าง ไม่ใช่เอาค่าหลังมาโชว์ซ้ำ
html = buildSimpleReportHtml(insp({
  item_label: 'ตรวจสอบอุณหภูมิ (°C) และความชื้น (%RH) ด้านหน้าช่อง Return',
  value_type: 'temp_rh_after', unit_label: '°C / %RH', value_after: '25', rh_after: '60',
}));
assert(html.includes('25') && html.includes('60'), 'temp_rh_after values rendered');
assert(/class="ba bval">—</.test(html), 'temp_rh_after leaves the ก่อน column empty');
ok('temp_rh_after (Return) renders after-only readings');

// ── ช่องเซ็นที่ 5 "เจ้าหน้าที่เจ้าของพื้นที่" — เฉพาะสาขาที่เปิดกติกา ──────────
const OWNER_LABEL = 'ลงชื่อเจ้าหน้าที่เจ้าของพื้นที่';
const ownerSigs = { ...baseSigs, department: { signer_name: 'พว.สมศรี', position: 'หัวหน้าห้อง LR', signature_data: 'data:image/png;base64,S' } };

// สาขาที่ไม่เปิด (ค่า default) — ฟอร์มเดิม 4 ช่อง แม้ในใบจะมีลายเซ็นค้างอยู่ก็ไม่โผล่
for (const wt of ['major', 'minor']) {
  const d = baseData({ wo: { work_type: wt }, gridRows: wt === 'minor' ? [{ room: 'R', machine_no: 'M', checks: [true] }] : [] });
  const off = buildSimpleReportHtml({ ...d, sigs: ownerSigs });
  assert(!off.includes(OWNER_LABEL), `${wt}: owner box hidden when the branch has not opted in`);
  const on = buildSimpleReportHtml({ ...d, sigs: ownerSigs, require_department_sign: true });
  assert(on.includes(OWNER_LABEL), `${wt}: owner box rendered when opted in`);
  assert(on.includes('พว.สมศรี') && on.includes('หัวหน้าห้อง LR'), `${wt}: owner name + typed position`);
  assert(on.includes('ลงชื่อเจ้าหน้าวิศวกรรม'), `${wt}: วิศวกรรม box still last`);
  assert(on.indexOf(OWNER_LABEL) < on.indexOf('ลงชื่อเจ้าหน้าวิศวกรรม'), `${wt}: owner box sits before วิศวกรรม`);
}
ok('signature box 5 (เจ้าของพื้นที่) renders only for opted-in branches, before วิศวกรรม');

console.log(`\n${passed} passed`);
