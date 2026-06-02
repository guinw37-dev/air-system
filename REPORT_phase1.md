# REPORT — เฟส 1: ข้อมูลหลัก + นำเข้า (Refactor สู่ schema ใหม่)

> วันที่ 2 มิ.ย. 2026 · branch `feat/phase1-master`
> ขอบเขต: ทำให้แอปรันบน schema ใหม่ได้ (master + import + roles + template) — WO lifecycle เต็ม / อนุมัติ 2 ด่าน / รายงาน 4 แบบ / offline ยังไม่ทำ (เฟส 2-4)
>
> ⚠️ **ข้อจำกัดการทดสอบ:** เครื่อง dev ไม่มี Postgres/Docker/psql → **ยังไม่ได้รัน migrate/seed/import จริง** ตรวจด้วย `node --check` ทุกไฟล์ backend + `npm run build` ผ่าน (frontend) + unit test tenant helper ผ่าน 7/7. ต้องรันจริงบน dev DB ก่อนปิดเฟส (ดูข้อ 4)

---

## 1. ตารางสรุป endpoint เก่า → ใหม่

### Master (`master.js` — เขียนใหม่ทั้งไฟล์)
| เก่า | ใหม่ | หมายเหตุ |
|---|---|---|
| `GET/POST/PUT/DELETE /master/hospitals` | `…/clients` | คอลัมน์ `code,name,active` (ตัด slug/address/phone) |
| — | `GET …/sites?client_id=` + POST/PUT/DELETE | **ชั้นใหม่** ระหว่าง client กับ building |
| `/buildings?hospital_id=` | `/buildings?site_id=` | FK `site_id` |
| `/floors?building_id=` | เหมือนเดิม | — |
| `/departments?floor_id=` | `/rooms?floor_id=` | rename |
| `/ac-units?hospital_id=\|department_id=` | `/units?client_id=[&equipment_type=]\|room_id=` | filter แอร์/พัดลม; `client_id` ตรง |
| `/ac-units/:id/history` | `/units/:id/history` | join `work_order_units` ใหม่ |
| — | `GET /inspection-template?equipment_type=&type=` | **ใหม่** ดึง checklist/ค่าวัดจาก DB |
| `/users` (role admin/owner/tech) | `/users` | role ใหม่ 4 แบบ; ตัด `updated_at` (ไม่มีใน schema) |

### Import (`import.js` — เขียนใหม่, Opus)
| เก่า | ใหม่ |
|---|---|
| `POST /import/ac-units`, `/pts-excel` (อ่าน hospitals/departments/ac_units) | `POST /import/ac-data` (upload) + `POST /import/ac-data/server` (อ่าน `EXCEL_PATH`) |
| template ac-units / work-history | `GET /import/template/ac-data` (3 ชีตใหม่) |
| `POST /import/work-history` | stub **501** "ทำในเฟสถัดไป" (WO import เลื่อน) |

อ่าน 3 ชีต: `แอร์ ac_units` / `พัดลม fans` / `ตรวจสอบ-รหัสซ้ำ` (match ชื่อชีตแบบ `.includes`)
**Idempotent keys:** clients=`code` · sites=`(client_id,name)` · buildings=`(site_id,name)` · floors=`(building_id,name)` · rooms=`(floor_id,name)` · units=`(client_id,asset_code)`
**พัดลม:** ผูก `FAN_DEFAULT_CLIENT_CODE` (PTS1) + main site `FAN_DEFAULT_SITE_NAME`, ตั้ง `needs_recode=true` ให้ตรวจ site ภายหลัง
**รหัสซ้ำ:** ต่อ suffix `__DUP<row>` + `needs_recode=true`

### Routes ที่ "ปรับให้บูตได้" (rename ขั้นต่ำ ไม่เปลี่ยน behavior)
| ไฟล์ | เปลี่ยน |
|---|---|
| `workOrders.js` | `hospital_id`→`client_id`(+`site_id`), `tech1/2_id`→`work_order_assignees`, items→`work_order_units`, `ac_unit_id`→`unit_id` (รับ param เก่าเป็น alias) |
| `pm.js` | `ac_units`→`units`, `departments`→`rooms`, ตัด `pm_interval_months` → ใช้ `next_pm_date`/`pm_cycle_pos` (รอบ 6 เดือนเต็ม = เฟสถัดไป) |
| `repairLogs.js` | `ac_unit_id`→`unit_id` + `client_id` ตรง |
| `stats.js` | `hospitals`→`clients`, `work_order_items`→`work_order_units`, `ac_photos`→`work_order_photos`, `deduction_notes` ใช้ `client_id` |
| `photos.js` | `ac_photos`→`work_order_photos`, `work_order_item_id`→`work_order_unit_id`, +`uploaded_by`, phase `during`→`measurement` |
| `pdf.js` | report เต็มผูก JSONB เดิม → **501** "rebuild เฟสถัดไป" (ใช้ `inspection_values`) |

### Backend อื่น
- `middleware/tenant.js` (**ใหม่**) — `getClientId()` / `requireClientId` / `assertRowClient()`; ทุก query tenant กรอง `client_id`
- `auth`/roles — role ใหม่ `technician/central_admin/approver/admin` (ตัด `owner`→map เป็น `approver`); `requireRole('admin','owner')` → `('admin','central_admin')`
- `app.js` — ลบ boot-time migration หมด (จาก PR#4); `npm run migrate` apply `schema.sql`
- `seed.js` — users 1/role + clients PTS1/PTS2 + main site + `inspection_template_items` จาก config (จาก PR#4)

### Frontend (build ผ่าน)
- `MasterData.jsx` — เขียนใหม่: tab Clients / Structure (site→building→floor→room) / Units (+filter แอร์/พัดลม, fields asset_code/family/refrigerant/status/last_major_clean_date)
- `ImportPage.jsx` — เขียนใหม่: upload → โชว์ผลนับ + needs_recode list + fans_unassigned + ปุ่ม server import + template
- `Users.jsx` — role ใหม่ 4 แบบ (label ไทย)
- `App.jsx`/`Layout.jsx` — RequireRole/nav role ใหม่
- WO/PM/dashboard/repair pages — rename field ขั้นต่ำให้ build ผ่าน (อ่าน `asset_code\|ac_code` ฯลฯ), ยังไม่ rebuild

---

## 2. ผลรัน import จริง

**ยังไม่ได้รัน** — ไม่มี dev DB + ยังไม่มีไฟล์ `ac-data-clean.xlsx` ในเครื่อง
ต้อง: วาง xlsx ที่ `EXCEL_PATH` + ตั้ง `DB_*` → `npm run migrate && npm run seed` → `POST /import/ac-data/server` → ค่อยกรอกตัวเลข clients/sites/buildings/units(ac/fan)/needs_recode/fans_unassigned ที่นี่

---

## 3. Feature ที่ "ปรับให้บูตได้แต่ยังไม่ทำเต็ม" (ส่งต่อเฟสถัดไป)
- **WO lifecycle + อนุมัติ 2 ด่าน** — `workOrders.js` rename ให้รันได้ ยังไม่ทำ flow `pending_admin→pending_approval→approved` + signatures 3 role เต็ม
- **PM รอบ 6 เดือน** — `pm.js` ใช้ `next_pm_date` ตรง ยังไม่คำนวณ major/minor จาก `last_major_clean_date`+`pm_cycle_pos`
- **รายงาน PDF 4 แบบ** — `pdf.js` คืน 501 รอ rebuild บน `inspection_values`
- **WO history import** — `/import/work-history` คืน 501
- **inspection_values UI** — มี endpoint template แล้ว แต่หน้ากรอกค่า before/after ยังไม่ทำ (AcItemDetail ยังอ่าน JSONB เดิมบางส่วน)
- **PMPlan buildings** — frontend ยังเรียก `?hospital_id=` (deferred page) จะได้ผลว่างจนกว่าจะ rebuild

---

## 4. ต้องให้ Worawit ตัดสิน/เตรียม ก่อนเฟส 2
1. **dev DB + xlsx** — เตรียม Postgres dev (ห้าม prod) + วาง `ac-data-clean.xlsx` → จะได้รัน migrate/seed/import จริง + verify tenant isolation/idempotent กับข้อมูลจริง
2. **ยืนยันชื่อคอลัมน์จริง** ใน 3 ชีต (import match แบบ `.includes` + candidate หลายชื่อไว้แล้ว แต่ควร verify กับไฟล์จริง)
3. **พัดลม → site จริง** — ตอนนี้ผูก PTS1/main + `needs_recode=true` ทั้งหมด ต้องมีรอบแก้ site รายตัว (UI เฟสถัดไป)
4. **role mapping ผู้ใช้เดิม** — ใครเป็น `central_admin` / `approver` (เดิมมีแค่ admin/owner/technician)
5. **เฟส 2 = ใบงาน + หน้างานมือถือ** — ยืนยัน flow อนุมัติ 2 ด่าน + จุดเซ็น area_owner (ไม่ล็อกอิน) ตาม DECISIONS ข้อ 6

---

## 5. วิธีทดสอบ (เมื่อมี dev DB)
```bash
# backend/.env: ตั้ง DB_* + EXCEL_PATH
cd backend
npm run migrate     # apply schema.sql
npm run seed        # users + clients + template
npm test            # tenant helper unit test (รันได้เลย ไม่ต้อง DB) → 7 passed
npm start
# POST /api/import/ac-data/server  (อ่าน EXCEL_PATH) → ดู summary
# login: admin / admin1234
cd ../frontend && npm run build   # ผ่านแล้ว
```
