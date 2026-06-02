# REPORT — เฟส 4: รายงาน PDF 4 แบบ

> วันที่ 2 มิ.ย. 2026 · branch `feat/phase4-reports`
> ตรวจ: `node --check` ทุกไฟล์ + smoke test render HTML จริง (mock data) ผ่านทั้ง 3 type + edge cases · ยังไม่ทดสอบ Puppeteer/DB จริง (รอ deploy)

---

## 1. Endpoints + วิธีทดสอบ

| Endpoint | ทำ |
|---|---|
| `GET /api/pdf/work-orders/:id?type=minor\|major\|fan` | สร้าง PDF (Puppeteer) → `application/pdf`; ถ้า type ไม่ระบุ ใช้ `wo.type` |
| `GET /api/pdf/work-orders/:id/preview?type=` | คืน HTML (ไม่ใช้ Puppeteer — dev/preview) |

- auth: ผ่าน `authMiddleware` (รับ `?token=` ได้ → เปิดใน tab ใหม่ได้)
- **status guard:** WO ต้อง `approved` ถึงออกได้ · `admin/central_admin/approver` ดูก่อน approve ได้
- **tenant:** ถ้าส่ง `?client_id=` ต้องตรงกับ WO ไม่งั้น 403
- **fallback:** ถ้า Chrome launch ไม่ได้ → คืน HTML แทน (header `X-PDF-Fallback: html`) ไม่ error

**วิธีทดสอบเร็ว (ไม่ต้อง Chrome):**
`GET /api/pdf/work-orders/<approved_wo_id>/preview?token=<jwt>&type=major` → เห็น HTML รายงานในเบราว์เซอร์
หน้า WorkOrderDetail มีปุ่ม PDF อยู่แล้ว (เปิด endpoint จริง)

---

## 2. รายงาน 4 แบบ (เขียนใน `services/reportTemplates.js`)
ทุกแบบมี **หน้าปกแบรนด์ TW** (โลโก้ wordmark teal, ชื่อบริษัท, ลูกค้า, สถานที่, วันที่) + Sarabun font + QR มุมล่างขวา

| type | แบบ | เนื้อหา |
|---|---|---|
| `minor` | **A** ล้างย่อย | ตารางเครื่อง × 4 คอลัมน์ติ๊ก (ตรวจระบบ/ล้างหัวจ่าย/ล้างรีเทิร์น/ล้างฟิลเตอร์) + ลายเซ็น area_owner |
| `major` | **B** ใบประหน้า + **C** รายเครื่อง | B: ตารางเครื่องทั้งใบงาน · C (1 หน้า/เครื่อง): เช็กลิสต์ 3 หมวด (ตรวจ/ก่อน/หลัง) + value comparison (▲/▼) + photo gallery before/after 2 คอลัมน์ + ลายเซ็น 3 จุด |
| `fan` | **D** พัดลม | ตารางพัดลม × คอลัมน์ (ล้างหน้ากาก/มอเตอร์/น้ำมัน/กระแส/เสียง/ปกติ/ชำรุด) + ผู้ปฏิบัติ/ควบคุม + TW stamp |

**ว๊าว ที่เพิ่ม:**
- หน้าปกกราฟิก teal `#0E7C86` + navy `#0B3A47`
- photo gallery before/after คู่กัน, caption (label + เวลา + ช่าง), >6 รูป/unit ขึ้นหน้าใหม่อัตโนมัติ
- value comparison ก่อน-หลัง พร้อม arrow ▲/▼ สี
- QR ทุกหน้า → ลิงก์หน้า WO online

---

## 3. โครงสร้าง code
```
backend/src/
  services/reportBuilder.js    — ดึง WO + units + inspection_values(+template meta) + photos + signatures + QR
  services/pdfRenderer.js      — HTML→PDF (Chrome auto-detect + PdfUnavailableError fallback)
  services/reportTemplates.js  — buildReportHtml(data, type) → cover + A/B/C/D + shared CSS
  routes/pdf.js                — endpoints (เขียนใหม่จาก 501)
```
dep ใหม่: `qrcode` (backend)

---

## 4. Puppeteer / font
- `nixpacks.toml` **มีอยู่แล้ว**: ติดตั้ง `google-chrome-stable` + `fonts-thai-tlwg` + `fonts-noto` → Chrome + ฟอนต์ไทยพร้อม
- `pdfRenderer` auto-detect path: `PUPPETEER_EXECUTABLE_PATH` → `which google-chrome-stable/...` → `/usr/bin/google-chrome`
- รูปในรายงาน: prefix `imageBase` = `http://localhost:PORT` (Chrome โหลดจาก static `/uploads` บน server เดียวกัน)
- **ยังไม่ได้รันบน Coolify จริง** — ถ้า Chrome มีปัญหา fallback คืน HTML อัตโนมัติ (ดู §1)

## 5. รูปตัวอย่าง
render HTML mock 3 แบบสำเร็จ (minor 10KB · major 14KB · fan 11KB) — ดูได้ที่ `/preview` endpoint หลัง deploy หรือ temp:
`%TEMP%\report-{minor,major,fan}.html`

---

## 6. เลื่อนเฟส 5 + คำถาม
**เลื่อน:**
- mini chart trend ข้ามรอบ (ค่าประวัติ WO เดิม) — ตอนนี้แสดงแค่ ก่อน-หลัง รอบเดียว
- service-type / ผลงาน ดึงจาก `has_repair` (ยังไม่มี field แยก)

**ถาม Worawit:**
1. ตั้ง env `FRONTEND_URL` ใน Coolify (backend) ให้ QR ลิงก์ถูก domain
2. layout 4 แบบตรงฟอร์มกระดาษเดิมพอไหม (ส่งตัวอย่างจริงมาเทียบ)
3. ต้องการ mini chart trend ข้ามรอบไหม (เฟส 5)
4. เฟส 5 = PM calendar — รอบ 6 เดือน + ปฏิทินวางแผน

## 7. Deploy
- ไม่มี migration (ไม่แตะ schema) — แค่ deploy code
- ตั้ง env `FRONTEND_URL=https://<frontend-domain>` (optional, สำหรับ QR)
