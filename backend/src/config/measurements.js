// Measurement field definitions per work order type
// Structure stored in work_order_items.measurements JSONB:
// { before: { volt_cool: 220, ... }, after: { volt_cool: 220, pressure_high: 17, ... } }

const MAJOR_FIELDS = [
  { key: 'volt_cool',      label: 'แรงดันไฟมอเตอร์คอยเย็น',     unit: 'V',     acTypes: null,               afterOnly: false },
  { key: 'amp_cool',       label: 'กระแสไฟมอเตอร์คอยเย็น',      unit: 'A',     acTypes: null,               afterOnly: false },
  { key: 'airspeed_1',     label: 'ความเร็วลม จุด 1',             unit: 'm/s',   acTypes: null,               afterOnly: false },
  { key: 'airspeed_2',     label: 'ความเร็วลม จุด 2',             unit: 'm/s',   acTypes: null,               afterOnly: false },
  { key: 'airspeed_3',     label: 'ความเร็วลม จุด 3',             unit: 'm/s',   acTypes: null,               afterOnly: false },
  { key: 'airspeed_avg',   label: 'ความเร็วลมเฉลี่ย',             unit: 'm/s',   acTypes: null,               afterOnly: false },
  { key: 'temp_supply',    label: 'อุณหภูมิจ่ายลม',               unit: '°C',    acTypes: null,               afterOnly: false },
  { key: 'temp_return',    label: 'อุณหภูมิดูดกลับ',              unit: '°C',    acTypes: null,               afterOnly: false },
  { key: 'co2',            label: 'CO₂',                           unit: 'ppm',   acTypes: null,               afterOnly: false },
  { key: 'pm25',           label: 'PM2.5',                         unit: 'µg/m³', acTypes: null,               afterOnly: false },
  { key: 'noise',          label: 'ระดับเสียง',                    unit: 'dB',    acTypes: null,               afterOnly: false },
  { key: 'volt_hot',       label: 'แรงดันไฟมอเตอร์คอยร้อน',      unit: 'V',     acTypes: ['VRF', 'Split'],   afterOnly: false },
  { key: 'amp_hot',        label: 'กระแสไฟมอเตอร์คอยร้อน',       unit: 'A',     acTypes: ['VRF', 'Split'],   afterOnly: false },
  { key: 'pressure_high',  label: 'ความดันสารทำความเย็น (High)',   unit: 'Bar',   acTypes: ['VRF', 'Split'],   afterOnly: true  },
  { key: 'pressure_low',   label: 'ความดันสารทำความเย็น (Low)',    unit: 'Bar',   acTypes: ['VRF', 'Split'],   afterOnly: true  },
];

const MEASUREMENT_FIELDS = {
  major: MAJOR_FIELDS,
  minor: [],
  fan:   [],
};

const CHECKLIST_ITEMS = {
  major: [
    { key: 'filter',     label: 'ทำความสะอาดแผ่นกรองอากาศ' },
    { key: 'coil_cool',  label: 'ล้างคอยล์เย็น' },
    { key: 'drain_pan',  label: 'ทำความสะอาดถาดรองน้ำ' },
    { key: 'drain_pipe', label: 'ตรวจสอบท่อระบายน้ำ' },
    { key: 'fan_blade',  label: 'ทำความสะอาดใบพัดลม' },
    { key: 'belt',       label: 'ตรวจสอบสายพาน' },
    { key: 'electrical', label: 'ตรวจสอบการต่อสายไฟ' },
    { key: 'coil_hot',   label: 'ล้างคอยล์ร้อน (VRF/Split)' },
    { key: 'motor_cool', label: 'ตรวจสอบมอเตอร์คอยเย็น' },
    { key: 'motor_hot',  label: 'ตรวจสอบมอเตอร์คอยร้อน (VRF/Split)' },
    { key: 'test_run',   label: 'เปิดเครื่องทดสอบการทำงาน' },
  ],
  minor: [
    { key: 'filter',   label: 'ทำความสะอาดแผ่นกรองอากาศ' },
    { key: 'test_run', label: 'เปิดเครื่องทดสอบการทำงาน' },
  ],
  fan: [
    { key: 'fan_blade', label: 'ทำความสะอาดใบพัดลม' },
    { key: 'belt',      label: 'ตรวจสอบสายพาน' },
    { key: 'test_run',  label: 'เปิดเครื่องทดสอบการทำงาน' },
  ],
};

module.exports = { MEASUREMENT_FIELDS, CHECKLIST_ITEMS };
