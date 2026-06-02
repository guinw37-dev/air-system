# REPORT — เฟส 1: ข้อมูลหลัก + นำเข้า (Refactor สู่ schema ใหม่)

> วันที่ 2 มิ.ย. 2026 · merged ลง `main`
> ขอบเขต: ทำให้แอปรันบน schema ใหม่ได้ (master + import + roles + template) — WO lifecycle เต็ม / อนุมัติ 2 ด่าน / รายงาน 4 แบบ / offline ยังไม่ทำ (เฟส 2-4)
>
> ✅ **รันจริงบน Coolify prod-dev แล้ว** — migrate + seed + import ผ่าน ข้อมูลจริงเข้า DB แล้ว

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

### Import (`import.js` — เขียนใหม่)
| เก่า | ใหม่ |
|---|---|
| `POST /import/ac-units`, `/pts-excel` | `POST /import/ac-data` (upload) + `POST /import/ac-data/server` (อ่าน `EXCEL_PATH`) |
| template ac-units / work-history | `GET /import/template/ac-data` (3 ชีตใหม่) |
| `POST /import/work-history` | stub **501** "ทำในเฟสถัดไป" |

อ่าน 3 ชีต: `แอร์ ac_units` / `พัดลม fans` / `ตรวจสอบ-รหัสซ้ำ` (match ชื่อชีตแบบ `.includes`)
**Idempotent keys:** clients=`code` · sites=`(client_id,name)` · buildings=`(site_id,name)` · floors=`(building_id,name)` · rooms=`(floor_id,name)` · units=`(client_id,asset_code)`

### Routes ที่ "ปรับให้บูตได้" (rename ขั้นต่ำ)
| ไฟล์ | เปลี่ยน |
|---|---|
| `workOrders.js` | `hospital_id`→`client_id`(+`site_id`), `tech1/2_id`→`work_order_assignees`, items→`work_order_units` (รับ param เก่าเป็น alias) |
| `pm.js` | `ac_units`→`units`, ตัด `pm_interval_months` → ใช้ `next_pm_date`/`pm_cycle_pos` |
| `repairLogs.js` | `ac_unit_id`→`unit_id` + `client_id` ตรง |
| `stats.js` | `hospitals`→`clients`, `work_order_items`→`work_order_units`, `ac_photos`→`work_order_photos` |
| `photos.js` | `ac_photos`→`work_order_photos`, `work_order_item_id`→`work_order_unit_id`, +`uploaded_by`, phase `during`→`measurement` |
| `pdf.js` | คืน **501** (report rebuild บน `inspection_values` = เฟสถัดไป) |

### Backend อื่น
- `middleware/tenant.js` (**ใหม่**) — `getClientId()` / `requireClientId` / `assertRowClient()`
- roles: `technician/central_admin/approver/admin` (ตัด `owner`)
- `app.js` — ลบ boot-time migration หมด
- `seed.js` — users 1/role + clients PTS1/PTS2 + main site + `inspection_template_items` จาก config

### Frontend (vite build ผ่าน)
- `MasterData.jsx` — เขียนใหม่: tab Clients / Structure / Units (+filter แอร์/พัดลม)
- `ImportPage.jsx` — เขียนใหม่: upload → โชว์ผลนับ + needs_recode list
- `Users.jsx` — role ใหม่ 4 แบบ (label ไทย)
- WO/PM/dashboard pages — rename field ขั้นต่ำ

---

## 2. ผลรัน import จริง (2 มิ.ย. 2026 — บน Coolify)

### Hotfix ก่อน import
- **migrate error:** `column "site_id" does not exist` — DB ยังเป็น schema เก่า (hospitals/ac_units)
  - แก้: `migrate.js` → DROP ทุกตาราง (ใหม่ + legacy) CASCADE → apply `schema.sql` ใหม่
  - รัน inline node script ผ่าน Coolify Terminal → สำเร็จ
- **seed error:** `users_role_check` violation (`owner` role) → แก้แล้วใน seed.js (PR#4)
- **import error:** แอร์ = 0 (ข้าม 2180 แถว) → header จริง `เลขเครื่อง (asset_code)` แต่ `strVal` exact match หา `เลขเครื่อง` ไม่เจอ
  - แก้: เพิ่ม partial-match fallback ใน `strVal` → deploy → import ใหม่

### ผลลัพธ์ import จริง (`ac-data-clean.xlsx` 138KB)

| รายการ | จำนวน |
|---|---|
| Clients | **2** (PTS1, PTS2) |
| Sites | **9** |
| อาคาร | **18** |
| ชั้น | **71** |
| ห้อง | **1,456** |
| **แอร์ (units ac)** | **1,231** ✅ |
| พัดลม | **0** ⚠️ (ดูหมายเหตุ) |
| ข้าม (skipped) | **933** |
| needs_recode (รหัสซ้ำ __DUP) | **30 รายการ** |

**หมายเหตุพัดลม:** ชีต "พัดลม fans" ใน xlsx ไม่มีค่าในคอลัมน์ `เลขเครื่อง` → asset_code ว่าง → skip ทั้งหมด ต้องให้ Worawit ตรวจสอบข้อมูลพัดลมในไฟล์

**หมายเหตุ needs_recode 30 รายการ:** รหัสซ้ำจากชีต `ตรวจสอบ-รหัสซ้ำ` ได้รับ suffix `__DUP<row>` ชั่วคราว รอให้ Worawit แก้รหัสจริง

---

## 3. Feature ที่ "ปรับให้บูตได้แต่ยังไม่ทำเต็ม" (ส่งต่อเฟสถัดไป)
- **WO lifecycle + อนุมัติ 2 ด่าน** — rename ให้รันได้ ยังไม่ทำ flow `pending_admin→pending_approval→approved` + signatures 3 role
- **PM รอบ 6 เดือน** — ใช้ `next_pm_date` ตรง ยังไม่คำนวณจาก `last_major_clean_date`+`pm_cycle_pos`
- **รายงาน PDF 4 แบบ** — คืน 501 รอ rebuild บน `inspection_values`
- **WO history import** — คืน 501
- **inspection_values UI** — endpoint template พร้อม แต่หน้ากรอกค่า before/after ยังไม่ทำ
- **พัดลม import** — asset_code ว่างในไฟล์ต้นทาง รอ Worawit แก้ข้อมูล
- **needs_recode 30 ตัว** — รอแก้รหัสจริงแล้ว re-import

---

## 4. ต้องให้ Worawit ตัดสิน/เตรียม ก่อนเฟส 2

1. **พัดลม** — ตรวจสอบว่า `เลขเครื่อง` ในชีต "พัดลม fans" ว่างทั้งหมดจริงไหม หรือ column ชื่อต่าง → แก้ไฟล์แล้ว re-import
2. **needs_recode 30 ตัว** — ดูรายการ (AC-PTB-รถMOBILE 1__DUP2, AC-PTS1-A-ฟลาดฟ้า-010__DUP5 ฯลฯ) แล้วกำหนดรหัสถาวรที่ถูกต้อง
3. **role mapping** — ใครเป็น `central_admin` / `approver` (เดิมมีแค่ admin/owner/technician)
4. **เฟส 2 = ใบงาน + หน้างานมือถือ** — ยืนยัน flow อนุมัติ 2 ด่าน + จุดเซ็น area_owner ตาม DECISIONS ข้อ 6
5. **Coolify branch** — ตรวจสอบ frontend app (y5hu7) ว่า branch ตั้งเป็น `main` แล้วหรือยัง

---

## 5. PR ทั้งหมดในเฟสนี้
| PR | Branch | สถานะ | เนื้อหา |
|---|---|---|---|
| [#3](https://github.com/guinw37-dev/air-system/pull/3) | `feat/phase0-schema` | MERGED | schema patch (pm_plan + deduction_notes + fan seed params) |
| [#4](https://github.com/guinw37-dev/air-system/pull/4) | `feat/phase1-backend-foundation` | MERGED | ลบ boot migrations + seed.js ใหม่ |
| [#5](https://github.com/guinw37-dev/air-system/pull/5) | `feat/phase1-master` | MERGED | phase 1 routes + frontend refactor |
| [#6](https://github.com/guinw37-dev/air-system/pull/6) | `fix/migrate-reset` | MERGED | migrate hotfix (drop+recreate) |
| commit `5ba2db3` | `main` (direct) | PUSHED | fix import strVal partial match (แอร์ = 0 → 1,231) |

---

## 6. วิธีทดสอบ (reference)
```bash
# Coolify Terminal
npm run migrate   # → Migration complete — schema reset and recreated
npm run seed      # → Seed success; Users: admin/cadmin/approver/tech1/tech2 (admin1234)
npm test          # → tenant helper 7/7 passed (no DB needed)

# หน้า /import → upload ac-data-clean.xlsx → Import ไฟล์
# ผล: 2 clients · 9 sites · 18 อาคาร · 71 ชั้น · 1,456 ห้อง · 1,231 แอร์ · 30 needs_recode

# login: admin / admin1234
```
