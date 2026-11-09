// ลายเซ็นที่รับจากหน้าเว็บ = รูปจาก SignaturePad (canvas.toDataURL) เท่านั้น.
// ตรวจก่อนเก็บ เพราะค่านี้ไปอยู่ใน <img src> ของ PDF ที่ Chromium ฝั่งเซิร์ฟเวอร์ render —
// ถ้ารับ URL อื่น (http://…, file://…) Chromium จะไปดึงให้ (ใช้ยิงเข้าเครือข่ายภายในได้).
const SIG_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const SIG_MAX_CHARS = 400000;   // ≈ 300 KB รูปจริง — ลายเซ็นจาก canvas ปกติไม่ถึง 60 KB

function isSignatureImage(s) {
  return typeof s === 'string' && s.length <= SIG_MAX_CHARS && SIG_RE.test(s);
}

module.exports = { isSignatureImage, SIG_MAX_CHARS };
