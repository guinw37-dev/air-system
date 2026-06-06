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
  wo: { work_type: 'minor' },
  gridRows: [{ name: 'AC-101', checks: [true, false, true, true] }],
  recommendation: 'ปกติดี',
}));
assert(html.includes('CUSTOMER SERVICE REPORT AIR'), 'minor letterhead title');
assert(html.includes('รายการเครื่องที่ล้างย่อย'), 'minor table header');
assert(html.includes('AC-101'), 'minor unit name');
assert(html.includes('ข้อมูลลูกค้า') && html.includes('สำหรับพนักงานผู้ให้บริการ'), 'minor section bars');
assert(html.includes('ปกติดี'), 'minor recommendation');
assert(!html.includes('รายงานบริการ'), 'minor does NOT use major header');
ok('grid minor renders the ล้างย่อย form (not the major checklist)');

// ── Grid: พัดลม ─────────────────────────────────────────────────
html = buildSimpleReportHtml(baseData({
  wo: { work_type: 'fan' },
  gridRows: [{ name: 'FAN-1', checks: [true, true, false, true, true], broken: 'มอเตอร์ดัง' }],
}));
assert(html.includes('ใบบันทึกการบำรุงรักษาระบบปรับอากาศ'), 'fan title');
assert(html.includes('ชำรุดเนื่องจาก') && html.includes('มอเตอร์ดัง'), 'fan broken column');
ok('grid fan renders the พัดลม form with the ชำรุด column');

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

console.log(`\n${passed} passed`);
