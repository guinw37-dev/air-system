// คณิตของ SignaturePad — pure ไม่ต้องมี DOM (เทส: frontend/test/signaturePad.test.mjs)
//
// canvas มี 2 ขนาด: ขนาด bitmap (canvas.width/height = จุดที่วาดจริง) กับขนาดที่โชว์บนจอ
// (CSS w-full = กว้างตามกล่อง เช่น 468px ใน modal บนคอม, ~331px บนมือถือ).
// ตำแหน่งนิ้ว/เมาส์มาเป็นพิกเซลจอ ต้องคูณอัตราส่วน bitmap/จอ ก่อนวาด
// ไม่งั้นเส้นจะไปโผล่ห่างจากปลายนิ้ว และวาดเลยขอบ bitmap ไม่ติด (บั๊กเดิม).

// ขนาดรูปลายเซ็นที่ส่งออก (PNG) — คงที่ 320×160 เท่าเดิม:
// PNG ขนาดนี้แม้แย่สุดก็ไม่ถึงเพดาน 400000 ตัวอักษรของ backend (backend/src/utils/signature.js)
export const SIG_W = 320
export const SIG_H = 160
// ความหนาเส้นในหน่วยของรูปที่ส่งออก (320 กว้าง)
export const LINE_W = 2.5
// bitmap ตอนวาดใหญ่ได้สุดกี่เท่าของรูปส่งออก — กันจอใหญ่ ๆ สร้าง canvas โตเกินจำเป็น
const MAX_SCALE = 4

// ขนาด bitmap ตอนวาด = กว้างที่เห็นบนจอ × devicePixelRatio → เส้นคมทุกจอ.
// ไม่ต่ำกว่า 320×160 (ตอนส่งออกจึงย่ออย่างเดียว ไม่ขยาย) และไม่เกิน MAX_SCALE เท่า.
// กล่องที่ยังไม่มีขนาด (ซ่อนอยู่ / วัดไม่ได้) ได้ 320×160 เหมือนเดิม.
export function padBitmapSize(cssWidth, dpr) {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  const want = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth * ratio : SIG_W
  const w = Math.round(Math.min(Math.max(want, SIG_W), SIG_W * MAX_SCALE))
  return [w, Math.round(w * (SIG_H / SIG_W))]
}

// ตำแหน่งนิ้ว/เมาส์ (clientX/Y) → พิกัดบน bitmap ของ canvas
// rect = canvas.getBoundingClientRect() ณ ตอนนั้น (กล่องอาจเปลี่ยนขนาดระหว่างเซ็น เช่น หมุนจอ)
export function toCanvasPoint(clientX, clientY, rect, bitmapW, bitmapH) {
  const sx = rect.width > 0 ? bitmapW / rect.width : 1
  const sy = rect.height > 0 ? bitmapH / rect.height : 1
  return [(clientX - rect.left) * sx, (clientY - rect.top) * sy]
}
