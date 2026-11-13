// URL รูปที่เก็บใน DB เป็น path ของ backend ("/uploads/photos/…") — หน้าเว็บอยู่คนละโดเมน
// กับ API บน prod (สาขา.tw-carework.online vs api.tw-carework.online) และโดเมนหน้าเว็บตอบ
// ทุก path ที่ไม่ใช่ไฟล์ของ dist เป็น index.html (serve -s) → <img src="/uploads/…"> ได้ HTML
// ไม่ใช่รูป. ต้องต่อด้วย uploadsBase (= VITE_BACKEND_URL) ก่อนเสมอ.
// URL เต็ม (http/https) และ data: ปล่อยตามเดิม. pure — ส่ง base เข้ามาเอง (test ได้ไม่ต้องมี Vite).
export function photoSrc(url, base = '') {
  if (!url) return ''
  if (/^https?:|^data:/.test(url)) return url
  return `${base || ''}${url.startsWith('/') ? '' : '/'}${url}`
}
