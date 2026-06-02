// Mirror of backend src/config/measurements.js and src/config/photoPoints.js

export const MEASUREMENT_FIELDS = [
  { key: 'volt_cool',     label: 'แรงดันไฟมอเตอร์คอยเย็น',     unit: 'V',     acTypes: null,             afterOnly: false },
  { key: 'amp_cool',      label: 'กระแสไฟมอเตอร์คอยเย็น',      unit: 'A',     acTypes: null,             afterOnly: false },
  { key: 'airspeed_1',    label: 'ความเร็วลม จุด 1',             unit: 'm/s',   acTypes: null,             afterOnly: false },
  { key: 'airspeed_2',    label: 'ความเร็วลม จุด 2',             unit: 'm/s',   acTypes: null,             afterOnly: false },
  { key: 'airspeed_3',    label: 'ความเร็วลม จุด 3',             unit: 'm/s',   acTypes: null,             afterOnly: false },
  { key: 'airspeed_avg',  label: 'ความเร็วลมเฉลี่ย',             unit: 'm/s',   acTypes: null,             afterOnly: false },
  { key: 'temp_supply',   label: 'อุณหภูมิจ่ายลม',               unit: '°C',    acTypes: null,             afterOnly: false },
  { key: 'temp_return',   label: 'อุณหภูมิดูดกลับ',              unit: '°C',    acTypes: null,             afterOnly: false },
  { key: 'co2',           label: 'CO₂',                           unit: 'ppm',   acTypes: null,             afterOnly: false },
  { key: 'pm25',          label: 'PM2.5',                         unit: 'µg/m³', acTypes: null,             afterOnly: false },
  { key: 'noise',         label: 'ระดับเสียง',                    unit: 'dB',    acTypes: null,             afterOnly: false },
  { key: 'volt_hot',      label: 'แรงดันไฟมอเตอร์คอยร้อน',      unit: 'V',     acTypes: ['VRF', 'Split'], afterOnly: false },
  { key: 'amp_hot',       label: 'กระแสไฟมอเตอร์คอยร้อน',       unit: 'A',     acTypes: ['VRF', 'Split'], afterOnly: false },
  { key: 'pressure_high', label: 'ความดันสารทำความเย็น (High)',   unit: 'Bar',   acTypes: ['VRF', 'Split'], afterOnly: true  },
  { key: 'pressure_low',  label: 'ความดันสารทำความเย็น (Low)',    unit: 'Bar',   acTypes: ['VRF', 'Split'], afterOnly: true  },
]

export const CHECKLIST_ITEMS = {
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
}

// Status colors use the design tokens (see index.css / tailwind.config.js)
export const STATUS_LABEL = {
  draft:            { label: 'ร่าง',              color: 'bg-gray-100 text-gray-600' },
  in_progress:      { label: 'กำลังดำเนินการ',    color: 'bg-primary-soft text-primary' },
  pending_admin:    { label: 'รอ Admin ตรวจสอบ',   color: 'bg-warn-soft text-warn' },
  pending_approval: { label: 'รออนุมัติ',          color: 'bg-warn-soft text-warn' },
  approved:         { label: 'อนุมัติแล้ว',         color: 'bg-success-soft text-success' },
  rejected:         { label: 'ไม่อนุมัติ',          color: 'bg-danger-soft text-danger' },
}

export const TYPE_LABEL = {
  major: { label: 'ล้างใหญ่',   color: 'bg-primary-soft text-primary' },
  minor: { label: 'ล้างย่อย',   color: 'bg-indigo-50 text-indigo-600' },
  fan:   { label: 'ล้างพัดลม', color: 'bg-success-soft text-success' },
}
