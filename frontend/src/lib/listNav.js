// จำตำแหน่งหน้ารายการใบงาน (URL พร้อมตัวกรอง + ระยะเลื่อน) ตอนเปิดดูใบงาน
// เพื่อให้กดย้อนกลับแล้วกลับมาที่เดิม ไม่ต้องเลื่อนหาใหม่. เก็บใน sessionStorage (ต่อแท็บ).
const KEY = 'swo:list'
const scroller = () => document.querySelector('main')   // Layout เลื่อนที่ <main> ไม่ใช่ window

export function rememberListPosition() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({
      url: window.location.pathname + window.location.search,
      y: scroller()?.scrollTop || 0,
    }))
  } catch { /* storage ปิด/เต็ม — แค่ไม่จำตำแหน่ง */ }
}

function saved() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    // รับเฉพาะ path ของหน้ารายการเอง (กันค่าแปลกปลอมพาไปที่อื่น)
    return v && typeof v.url === 'string' && /^\/simple-wo(\?|$)/.test(v.url) ? v : null
  } catch { return null }
}

// URL ที่ปุ่มย้อนกลับในหน้าใบงานควรพาไป — รายการพร้อมตัวกรองเดิม
export const listBackUrl = () => saved()?.url || '/simple-wo'

// เรียกหลังรายการโหลดเสร็จ: คืนระยะเลื่อนถ้ากลับมาที่ URL เดิม
export function restoreListScroll() {
  const v = saved()
  if (!v || v.url !== window.location.pathname + window.location.search) return
  requestAnimationFrame(() => { const m = scroller(); if (m) m.scrollTop = v.y })
}
