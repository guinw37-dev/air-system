// สภาพแอร์ / แจ้งเปลี่ยนอะไหล่ — shared option lists for the form, detail page,
// and dashboard. condition = { issues:[keys], issues_other, health_pct,
// health_reason, priority }. NOT a repair job — just an assessment at clean time.
export const CONDITION_ISSUES = [
  { key: 'insulation',  label: 'ฉนวนเสื่อมสภาพ' },
  { key: 'drain_pan',   label: 'ถาดน้ำทิ้งเสื่อมสภาพ' },
  { key: 'pipe_rust',   label: 'ท่อเป็นสนิม' },
  { key: 'coil',        label: 'คอยล์ผุ/เสื่อม' },
  { key: 'fan_motor',   label: 'มอเตอร์/พัดลมเสื่อม' },
  { key: 'capacitor',   label: 'แคปาซิเตอร์เสื่อม' },
  { key: 'electrical',  label: 'แผงไฟ/สายไฟเสื่อม' },
  { key: 'compressor',  label: 'คอมเพรสเซอร์เสื่อม' },
  { key: 'refrigerant', label: 'น้ำยารั่ว/ขาด' },
  { key: 'remote',      label: 'รีโมท/คอนโทรลเสีย' },
  { key: 'age_5_7',     label: 'อายุ 5-7 ปี' },
  { key: 'age_over_7',  label: 'อายุเกิน 7 ปี' },
];
export const CONDITION_ISSUE_LABEL = Object.fromEntries(CONDITION_ISSUES.map((i) => [i.key, i.label]));

export const PRIORITIES = [
  { key: 'urgent', label: 'เร่งด่วน', color: '#dc2626' },
  { key: 'normal', label: 'ปกติ',    color: '#0ea5e9' },
  { key: 'low',    label: 'ไม่เร่ง',  color: '#94a3b8' },
];
export const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.key, p.label]));
export const PRIORITY_COLOR = Object.fromEntries(PRIORITIES.map((p) => [p.key, p.color]));
