# REPORT — ระบบใบงานแบบง่าย (Simple Work Order) · Phase 1

Branch: `feat/simple-workorder`

## หลักการ
เปิดใบงานใหม่ → ฟอร์มโผล่ทันที → ช่างกรอก → กดส่ง → จบ (ไม่มีขั้นอนุมัติ)
อยู่ path แยก `/simple-wo` — **ไม่แตะ** flow อนุมัติ 2 ด่านเดิม (`/work-orders`)

## ไฟล์ที่เพิ่ม/แก้

### Backend
| ไฟล์ | สถานะ | หน้าที่ |
|------|-------|--------|
| `src/db/migrate_simple_wo.js` | ใหม่ | สร้างตาราง `simple_work_orders` (additive) |
| `src/services/simpleReportBuilder.js` | ใหม่ | โหลด row + template items → data shape ของ PDF |
| `src/services/reportTemplates.js` | แก้ | เพิ่ม `buildSimpleReportHtml()` (reuse TW แบบ C chrome + 3 ลายเซ็น image) |
| `src/routes/simpleWorkOrders.js` | ใหม่ | API ทั้งหมด |
| `src/app.js` | แก้ | mount `/api/simple-wo` |
| `package.json` | แก้ | script `migrate:simple-wo` |

### Frontend
| ไฟล์ | สถานะ | หน้าที่ |
|------|-------|--------|
| `src/pages/SimpleWoList.jsx` | ใหม่ | รายการใบงาน + ปุ่มเปิดใหม่ + Export Excel |
| `src/pages/SimpleWoForm.jsx` | ใหม่ | ฟอร์มกรอก (dynamic จาก form-schema) + photo + 3 SignaturePad |
| `src/pages/SimpleWoDetail.jsx` | ใหม่ | รายละเอียด + ดาวน์โหลด PDF + Excel |
| `src/App.jsx` | แก้ | 3 routes |
| `src/components/Layout.jsx` | แก้ | nav "ใบงาน (ง่าย)" |

## API
- `POST /api/simple-wo` — สร้าง + บันทึก (gen wo_number)
- `GET /api/simple-wo` — รายการ (filter date_from/date_to/created_by)
- `GET /api/simple-wo/:id` — รายละเอียด
- `GET /api/simple-wo/:id/pdf` — PDF (fallback HTML ถ้า Chrome ไม่พร้อม)
- `GET /api/simple-wo/export/excel` — Excel (filter ช่วงวันที่)
- `GET /api/simple-wo/form-schema?work_type=` — sections+fields จาก `inspection_template_items`
- `POST /api/simple-wo/upload` — อัปโหลดรูป 1 ใบ → `{ url }`

## DB — `simple_work_orders`
เลขใบงาน: `WO-{พ.ศ.}-{เดือน}-{running4}` เช่น `WO-2569-06-0001`
ค่าตรวจเช็คเก็บ `checklist_values` JSONB (key = template_item_id) — เพิ่ม field ใหม่ไม่กระทบข้อมูลเก่า

## วิธี deploy (ต้องทำบน Coolify)
1. **migrate** (Coolify Terminal, backend container):
   ```bash
   node src/db/migrate_simple_wo.js
   ```
   (additive — ไม่ลบข้อมูล) → เห็น `simple_work_orders migration complete`
2. **Redeploy** backend + frontend (ดึงโค้ด branch หลัง merge)

## วิธีทดสอบ
1. เข้า `/simple-wo` → กด "+ เปิดใบงานใหม่"
2. เลือกประเภทงาน → ฟอร์มเช็กลิสต์โผล่ตามหมวด (ทุกช่องแสดงเต็ม)
3. toggle 380/220 → rst_amp โชว์ R/S/T (380) หรือ LN/L อย่างเดียว (220)
4. กรอก + ถ่ายรูป ก่อน/หลัง + เซ็น 3 ช่อง → "ส่งใบงาน" → ได้เลข WO
5. หน้า detail → "ดาวน์โหลด PDF" (ฟอร์มเต็ม + ลายเซ็น + รูป) · "Export Excel"

## Phase 2 (ยังไม่ทำ)
Dynamic form-builder: ตาราง `simple_form_sections`/`simple_form_fields` + หน้า `/form-builder` ลาก-วาง.
ตอนนี้ฟอร์ม render จาก `inspection_template_items` (เพิ่มหมวด/ช่องผ่าน DB เดิมได้)

## ทดสอบแล้ว (local, ไม่มี DB)
- `node --check` ทุกไฟล์ backend ✅
- smoke-test `buildSimpleReportHtml` ด้วย mock → render ครบ (sign labels, 380V 3φ, R32 pressure, gallery) ✅
- `npm run build` frontend ✅
