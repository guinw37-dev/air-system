// ป้ายสถานะ "ใบงานนี้ค้างรอใครเซ็น" — ใช้ร่วมกันระหว่างหน้ารายการใบงานกับหน้าใบงาน
// เพื่อไม่ให้สองหน้าตอบคนละอย่างเหมือนที่เคยเกิดกับการ์ดหน้าภาพรวม.
//
// ช่องอาคาร / เจ้าของพื้นที่ / วิศวกรรม เซ็นขนานกัน ใบเดียวจึงค้างได้หลายช่องพร้อมกัน
// → ป้ายแสดง "ทุกช่องที่ค้าง" ไม่ใช่ช่องแรกช่องเดียว (ลูกค้า PTN ขอ 5 ส.ค. 2026).
//
// WAIT_PREREQ ต้องตรงกับ backend/src/utils/roles.js — engineer รออาคารเซ็นก่อน
// แต่ไม่รอเจ้าของพื้นที่ (เจ้าหน้าที่ ward ไม่ว่าง ต้องไม่บล็อกวิศวกรรม).
export const WAIT_PREREQ = {
  team: [],
  supervisor: ['team'],
  building: ['team', 'supervisor'],
  department: ['team', 'supervisor'],
  engineer: ['team', 'supervisor', 'building'],
}

// ลำดับที่อ่านแล้วเข้าใจตามสายงาน — เจ้าของพื้นที่ท้ายสุด (ตรงกับลำดับการ์ดหน้าภาพรวม)
export const STAGE_ORDER = ['team', 'supervisor', 'building', 'engineer', 'department']

const SHORT = {
  team: 'ช่างแอร์',
  supervisor: 'หัวหน้าช่าง',
  building: 'ช่างอาคาร',
  engineer: 'วิศวกรรม',
  department: 'เจ้าของพื้นที่',
}
const TONE = {
  team: 'badge-warn',
  supervisor: 'badge-warn',
  building: 'bg-indigo-50 text-indigo-600',
  engineer: 'bg-blue-50 text-blue-600',
  department: 'bg-amber-50 text-amber-700',
}

// ช่องที่ยังค้างอยู่จริง (prerequisite ครบแล้วแต่ยังไม่เซ็น).
// แถวจาก /simple-wo ส่ง wait_<slot> มาให้แล้ว (และส่งเฉพาะช่องที่สาขานั้นใช้จริง);
// หน้าใบงานมี sig_<slot> เต็ม → คำนวณเอง โดยส่ง slots ที่สาขานั้นต้องมีเข้ามา
export function waitingSlots(wo, slots) {
  if (!wo) return []
  const list = slots || STAGE_ORDER
  // เลือกโหมดครั้งเดียวจากทั้งแถว: แถวที่มา from /simple-wo มี wait_* (แต่มีเฉพาะช่องที่
  // สาขานั้นใช้) — ถ้าไล่ fallback ทีละช่อง ช่องที่ API ไม่ได้ส่งมาจะไปอ่าน sig_* ที่ไม่มี
  // ในแถวนั้นเลย แล้วรายงานว่า "ค้าง" ทั้งที่เซ็นไปแล้ว
  const fromApi = STAGE_ORDER.some((s) => wo[`wait_${s}`] !== undefined)
  return STAGE_ORDER.filter((s) => list.includes(s)).filter((s) => (
    fromApi
      ? !!wo[`wait_${s}`]
      : (WAIT_PREREQ[s] || []).every((p) => wo[`sig_${p}`]) && !wo[`sig_${s}`]
  ))
}

// { label, color } สำหรับป้ายสถานะ — รวมทุกช่องที่ค้างไว้ในป้ายเดียว
// เช่น "รอวิศวกรรม + เจ้าของพื้นที่". ไม่มีช่องค้าง = null (ผู้เรียกใช้ป้าย "เสร็จสิ้น" เอง)
export function waitingBadge(wo, slots) {
  const waiting = waitingSlots(wo, slots)
  if (!waiting.length) return null
  // ยังไม่เริ่มเซ็นเลย = งานยังไม่เสร็จ ไม่ใช่ "รอช่างแอร์" (ช่างคือคนกรอกใบเอง)
  if (waiting[0] === 'team') return { label: 'ยังไม่เสร็จ', color: TONE.team }
  return { label: `รอ${waiting.map((s) => SHORT[s]).join(' + ')}`, color: TONE[waiting[0]] }
}
