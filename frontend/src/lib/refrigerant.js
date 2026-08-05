// ค่ามาตรฐานแรงดันสารทำความเย็น (PSIG) — Requirement พญาไท นวมินทร์ (5 ส.ค. 2026).
// ใช้เป็น "ค่าอ้างอิง" ให้ช่างเทียบกับค่าที่วัดได้เท่านั้น — ระบบไม่กรอกให้ ไม่บล็อก
// การบันทึก และไม่ตัดสินว่าผ่าน/ไม่ผ่าน (สภาพหน้างานต่างกันได้ตามอากาศ/โหลด).
//
// key = ค่าที่ระบบเก็บจริงใน refrigerant_type (R410 ไม่มี A — อย่าเปลี่ยน ไม่งั้น
// ใบงานเก่าอ่านไม่เจอ); label = ชื่อที่แสดงให้ช่างอ่าน.
export const REFRIGERANT_REF = {
  R22:  { label: 'R22',   suction: [60, 80],   discharge: [200, 275] },
  R410: { label: 'R410A', suction: [110, 145], discharge: [360, 450] },
  R32:  { label: 'R32',   suction: [120, 150], discharge: [380, 450] },
}

// 'R32' → 'เกณฑ์อ้างอิง R32 · Suction 120–150 · Discharge 380–450 PSIG'
// ชนิดที่ไม่รู้จัก / ยังไม่ได้เลือก → '' (ผู้เรียกไม่ต้องแสดงอะไร)
export function refrigerantRefText(type) {
  const r = REFRIGERANT_REF[String(type || '').toUpperCase()]
  if (!r) return ''
  return `เกณฑ์อ้างอิง ${r.label} · Suction ${r.suction[0]}–${r.suction[1]} · Discharge ${r.discharge[0]}–${r.discharge[1]} PSIG`
}
