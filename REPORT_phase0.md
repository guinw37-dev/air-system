# REPORT — เฟส 0: วางรากข้อมูล (Schema ใหม่)

> วันที่ 2 มิ.ย. 2026 · branch `feat/phase0-schema`
> ขอบเขตรอบนี้: **ออกแบบ `schema.sql` + ER + task list แก้ route/query เท่านั้น**
> seed/import **ยังไม่รัน** — รอ `ac-data-clean.xlsx` + fresh dev DB (ดูข้อ 2)
>
> หมายเหตุ: รายงาน audit เดิมอยู่ที่ `REPORT.md` (ไม่ทับ) — ไฟล์นี้คือผลเฟส 0

---

## 1. `schema.sql` ใหม่ (source of truth เดียว)

ไฟล์: `backend/src/db/schema.sql` — เขียนใหม่ทั้งไฟล์, idempotent (`CREATE TABLE IF NOT EXISTS`), **เลิกใช้ boot-time migration**

### Tenant model
```
clients → sites → buildings → floors → rooms → units
```
ตารางที่ผูก tenant ใส่ **`client_id` ตรง ๆ** (`units`, `work_orders`, `part_requisitions`, `repair_logs`) → กรอง client ได้โดยไม่ต้อง join 6 ชั้น = กัน data leak + เร็ว

### ER ย่อ (16 ตาราง)
```
clients ─┬─< sites ─< buildings ─< floors ─< rooms ─< units
         │                                              │ (client_id ตรง)
         │                                              │
         ├─< work_orders ─┬─< work_order_assignees >─ users
         │   (client_id,  ├─< work_order_units ─┬─< inspection_values >─ inspection_template_items
         │    site_id)    │       (>─ units)    └─< work_order_photos (>─ units, uploaded_by→users)
         │                └─< signatures   (area_owner / central_admin / approver)
         │
         ├─< part_requisitions  (>─ work_orders, units, users)
         └─< repair_logs        (>─ units, work_orders, work_order_units, users)

inspection_template_items  (standalone — ค่าวัด/เช็กลิสต์ตาม equipment_type)
```

### ตารางหลัก (เทียบของเดิม)
| ใหม่ | เดิม | เปลี่ยนสำคัญ |
|---|---|---|
| `clients` | `hospitals` | rename + เพิ่ม `code` (PTS1/PTS2) |
| `sites` | — | **ชั้นใหม่** ระหว่าง client กับ building |
| `buildings` | `buildings` | FK `site_id` (เดิม `hospital_id`) |
| `floors` | `floors` | + UNIQUE(building_id,name) |
| `rooms` | `departments` | rename |
| `units` | `ac_units` | **รวม AC+พัดลม**: `equipment_type`, `family`, `asset_code`, **`client_id` ตรง**, `last_major_clean_date`, `needs_recode`, UNIQUE(client_id, asset_code) |
| `users` | `users` | role: `technician/central_admin/approver/admin` (เดิม admin/owner/technician) |
| `inspection_template_items` | config `measurements.js`/`photoPoints.js` | **ย้าย config → ตาราง DB** |
| `work_orders` | `work_orders` | `client_id`+`site_id`, `created_by`+`approver_id`, `area_owner_name`, `admin_checked_at`, status เพิ่ม `pending_admin`/`closed` |
| `work_order_assignees` | `tech1_id`/`tech2_id` | **ช่างหลายคน** (M:N) |
| `work_order_units` | `work_order_items` | `unit_id`; **ตัด JSONB** measurements/checklist ออก |
| `inspection_values` | (JSONB ใน items) | **แตกเป็นแถว** ผูก template_item ค่า before/after |
| `work_order_photos` | `ac_photos` | + **`uploaded_by`** (คนถ่าย), + `unit_id`, phase: before/after/**measurement** |
| `signatures` | `signatures` | role `area_owner/central_admin/approver`, + `signer_name`, `user_id` **NULLABLE** (เจ้าของพื้นที่ไม่ล็อกอิน) |
| `part_requisitions` | — | **ใหม่** (เบิกอะไหล่) |
| `repair_logs` | `repair_logs` | + `client_id` ตรง, `ac_unit_id`→`unit_id` |

### รอบ PM (logic/field — ยังไม่ทำ UI)
- รอบ 6 เดือน = ใหญ่1 + ย่อย2 (ทุก 2 เดือน) คำนวณ `next_pm_date` **จาก `units.last_major_clean_date` รายเครื่อง**
- ล้างใหญ่ใหม่ → ตั้ง `last_major_clean_date` ใหม่ → รอบรีเซ็ตเองรายตัว
- `pm_cycle_pos` (0=major,1/2=minor) เก็บตำแหน่งรอบ

---

## 2. สถานะ seed/import — **ยังไม่รัน (blocked)**
- ❌ ไม่พบ `ac-data-clean.xlsx` ในเครื่อง (ค้น root + ทั้ง repo แล้ว)
- ❓ ยังไม่มี fresh dev DB ที่ยืนยันได้ (กติกาห้ามแตะ prod)

**ต้องการก่อนรัน seed:** (1) วาง `ac-data-clean.xlsx` ที่สคริปต์อ่านได้ (2) Postgres dev ว่าง 1 ตัว + env (`DB_*`, `EXCEL_PATH`)
จากนั้นจะเขียน seed script (อ่าน 3 ชีต: `แอร์ ac_units` / `พัดลม fans` / `ตรวจสอบ-รหัสซ้ำ`) + seed `inspection_template_items` จาก config เดิม + ผู้ใช้ทดสอบ 1 คน/role แล้วรายงานจำนวน clients/sites/units(ac/fan) + รหัสซ้ำที่ flag

---

## 3. Route/query เดิมที่ต้องแก้ (task list เฟส 1)

> ของเดิม query ด้วย `hospital_id` + ชื่อตาราง `ac_units`/`departments`/`work_order_items`/`ac_photos` ทั้งหมดต้องเปลี่ยน

**Backend (`backend/src/`)**
- [ ] `db/pool.js` — ไม่กระทบ schema (แค่ต่อ DB)
- [ ] **`app.js`** — **ลบ boot-time migration ทั้งหมด** (schema.sql เป็น source of truth แล้ว) + เปลี่ยน health/route mount ถ้าจำเป็น
- [ ] `routes/master.js` — แยกเป็น clients + **sites (ใหม่)** + buildings(site_id) + floors + **rooms** (เดิม departments) + **units** (เดิม ac-units: asset_code/equipment_type/family/client_id)
- [ ] `routes/workOrders.js` — `hospital_id`→`client_id`+`site_id`; `tech1/tech2/owner`→`created_by`+`work_order_assignees`+`approver_id`; items→`work_order_units`; **measurements/checklist JSONB → `inspection_values`**; signature 3 role ใหม่; **flow อนุมัติ 2 ด่าน** (in_progress→pending_admin→pending_approval→approved)
- [ ] `routes/photos.js` — `ac_photos`→`work_order_photos`; `work_order_item_id`→`work_order_unit_id`; เพิ่มบันทึก `uploaded_by`; phase ใหม่ (ตัด during เพิ่ม measurement)
- [ ] `routes/pm.js` — query `ac_units`→`units`; คำนวณ next PM จาก `last_major_clean_date`; **`pm_plan` ถูกตัดออกจาก schema** → ต้องตัดสินใจ (ดูข้อ 4)
- [ ] `routes/repairLogs.js` — `ac_unit_id`→`unit_id` + ใส่ `client_id`
- [ ] `routes/stats.js` — ทุก query เปลี่ยน `hospital_id`→`client_id`, ชื่อตาราง; **`deduction_notes` ไม่อยู่ใน schema ใหม่** → ตัดสินใจ (ข้อ 4)
- [ ] `routes/pdf.js` — query เปลี่ยนชื่อตาราง + ดึง inspection_values แทน JSONB; (รายงาน 4 แบบ = เฟสถัดไป)
- [ ] `routes/import.js` — endpoint upload เปลี่ยนปลายทางเป็น schema ใหม่
- [ ] `config/measurements.js`, `config/photoPoints.js` — **เลิก hardcode** → อ่านจาก `inspection_template_items` (route ที่เคยส่ง config ให้ FE ต้องดึงจาก DB)
- [ ] `db/seed.js` — เขียนใหม่ให้ seed roles/template ตาม schema ใหม่

**Frontend (`frontend/src/`)** — ทุกหน้าที่ส่ง `hospital_id` / อ่าน `ac_code`/`department`/`measurements` ต้องปรับ field
- [ ] `pages/MasterData.jsx` — เพิ่ม tab/ชั้น sites; ac-units→units (asset_code, equipment_type, family)
- [ ] `pages/WorkOrderCreate.jsx`, `WorkOrderDetail.jsx` — client/site selector; assignees หลายคน; signature 3 role ใหม่; ปุ่มอนุมัติ 2 ด่าน
- [ ] `pages/AcItemDetail.jsx` — measurements/checklist อ่านจาก template + เขียน `inspection_values` (ไม่ใช่ JSONB)
- [ ] `pages/PMSchedule.jsx`, `PMPlan.jsx` — `units` + คำนวณรอบใหม่ (PMPlan ขึ้นกับการตัดสิน pm_plan)
- [ ] `pages/RepairLogs.jsx`, `CleaningStatus.jsx`, `CleaningDashboard.jsx`, `Dashboard.jsx` — client_id + ชื่อตาราง/field
- [ ] `pages/Users.jsx` — role ใหม่ (central_admin/approver)
- [ ] `store/auth.js`, `components/Layout.jsx` — nav ตาม role ใหม่

---

## 4. คำถามที่ต้องถาม Worawit (ก่อนเฟส 1 / seed)
1. **`ac-data-clean.xlsx`** — วางที่ไหน? โครง 3 ชีตตรงตามที่ระบุไหม (`แอร์ ac_units` / `พัดลม fans` / `ตรวจสอบ-รหัสซ้ำ`) + ชื่อคอลัมน์จริงในแต่ละชีต
2. **dev DB** — ให้ Postgres dev ตัวไหน (host/port/ชื่อ DB) ที่ล้างได้?
3. **`pm_plan` (แผน PM ปฏิทินรายปี)** — schema ใหม่ตัดออก (ใช้ field บน `units` แทน). หน้า `PMPlan.jsx` เดิมใช้ pm_plan — จะ **ตัดทิ้ง** หรือ **เก็บไว้** (ถ้าเก็บต้องเพิ่มตารางกลับ + ผูก client_id)?
4. **`deduction_notes` (บันทึกหักเงินรายเดือน)** — ไม่อยู่ใน schema ใหม่. หน้า `CleaningDashboard` ใช้อยู่ — ตัดหรือเก็บ?
5. **พัดลมยังไม่มี client/site ในไฟล์** — ผูกกับ client เริ่มต้นตัวไหน (param)? ยืนยันก่อน import
6. **อนุมัติ 2 ด่าน** — ลำดับที่ออกแบบไว้: ช่างส่ง → `central_admin` ตรวจ (pending_admin) → `approver` เซ็นปิด (pending_approval→approved). ถูกตามที่ต้องการไหม? และ `area_owner` (เจ้าของพื้นที่) เซ็นตอนไหน (หน้างานก่อนส่ง?)
7. **`refrigerant`** — ต้องเก็บจริงไหม หรือ defer

---

## 5. หมายเหตุ
- ยังไม่แตะ route/UI/app.js ในเฟสนี้ (ตามขอบเขต) — list ข้างบนคืองานเฟส 1
- security fix (untrack .env + ลบ hardcoded creds) อยู่คนละ branch/PR (`fix/security-secrets-untrack`)
- schema เดิม v1 ดูได้จาก git history ของไฟล์ `backend/src/db/schema.sql`
