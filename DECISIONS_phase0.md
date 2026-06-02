# DECISIONS — ตอบคำถามเฟส 0 (§4) + แพตช์ schema เล็กน้อย

> **โมเดลแนะนำ: Claude Sonnet 4.6** (งานที่เกิดจากเอกสารนี้ = แพตช์ schema เล็ก + ตั้งค่า seed — สเปกชัด)
> ใช้ร่วมกับ `CLAUDE_phase1_master.md` สำหรับงาน refactor หลัก

ตอบ 7 คำถามใน `REPORT_phase0.md §4` ตามที่ตกลงกับ Worawit แล้ว — ใช้เป็นข้อมูลตั้งต้นก่อนรัน seed + เฟส 1

---

## คำตอบ

**1) `ac-data-clean.xlsx` — ที่วาง + โครงชีต/คอลัมน์**
ใช้ไฟล์ที่ส่งให้ (ชื่อเดิม `ข้อมูลแอร์-จัดเรียงใหม่.xlsx` — เปลี่ยนชื่อเป็น `ac-data-clean.xlsx` แล้ววางที่ path ที่ตั้งใน env `EXCEL_PATH`). โครง 3 ชีตถูกต้อง คอลัมน์จริง:
- ชีต **`แอร์ ac_units`**: ลำดับ · ลูกค้า · รหัสลูกค้า · สถานที่ · อาคาร · ชั้น · แผนก/ห้อง · เลขเครื่อง (asset_code) · ตระกูลแอร์ · BTU · แอร์น้ำเย็น · ประเภท (เดิม) · สถานะ · หมายเหตุสถานะ · ล้างใหญ่ล่าสุด · รหัสซ้ำ
- ชีต **`พัดลม fans`**: ลำดับ · อาคาร · ชั้น · ตำแหน่ง/ห้อง · ประเภทพัดลม · เลขเครื่อง
- ชีต **`ตรวจสอบ-รหัสซ้ำ`**: คอลัมน์เดียวกับชีตแอร์ (เฉพาะ 30 แถวที่รหัสชน)
- map: ลูกค้า/รหัสลูกค้า→`clients` · สถานที่→`sites` · อาคาร/ชั้น/แผนก·ห้อง→`buildings/floors/rooms` · เลขเครื่อง→`units.asset_code` · ตระกูลแอร์→`family` · BTU→`capacity_btu` · สถานะ→`status` · ล้างใหญ่ล่าสุด→`last_major_clean_date`

**2) dev DB** — ใช้ Postgres dev ชั่วคราว `docker run -e POSTGRES_PASSWORD=... -p 5432:5432 postgres:16` (หรือ Postgres ว่างตัวใหม่บน Coolify ที่ **ไม่ใช่ prod**) แล้วใส่ค่า `DB_*` + `EXCEL_PATH` ใน env ของ seed *(Worawit จะยืนยัน host/port/ชื่อ DB อีกที)*

**3) `pm_plan` — เก็บไว้** เพิ่มตารางกลับเข้า `schema.sql` (ผูก `client_id`) เพราะหน้าวางแผนรายโซน/ปฏิทิน PM (เฟส 5) ต้องใช้ — แต่ยังไม่ทำ UI ในเฟส 1

**4) `deduction_notes` — เก็บไว้** เพิ่มตารางกลับ (ผูก `client_id` แทน hospital_id) เป็นฟีเจอร์หักเงินค่าบริการรายเดือนที่ของเดิมมีจริง — ทำ UI ทีหลัง (เฟส 6) เฟสนี้แค่มีตารางรองรับ

**5) พัดลม client/site เริ่มต้น** — import พัดลมทั้งหมดผูก client = **พญาไท ศรีราชา 1 (PTS1)**, site = รพ.หลัก (พญาไท ศรีราชา 1) เป็นค่าเริ่มต้น + ตั้ง flag ให้ตรวจ site รายตัวภายหลัง *(Worawit ยืนยันก่อน import จริง)*

**6) อนุมัติ 2 ด่าน — ถูกต้องตามที่ออกแบบ:**
`area_owner` (เจ้าของพื้นที่) เซ็น **หน้างานก่อนช่างส่ง** (บนเครื่องช่าง/QR ไม่ล็อกอิน) → ช่างส่ง → `central_admin` ตรวจข้อมูล (`pending_admin`) → `approver` เซ็นปิด (`pending_approval`→`approved`)

**7) `refrigerant` — เก็บคอลัมน์ไว้แต่ปล่อยว่าง (nullable)** ค่อยกรอกทีหลัง (ไม่มีในข้อมูลต้นทาง) ไม่ต้องบังคับในเฟสนี้

---

## แพตช์ schema เล็กน้อยที่ต้องทำ (เพิ่มจาก PR #2)
- [x] เพิ่มตาราง **`pm_plan`** กลับ: id, `client_id`→clients, unit_id→units, planned_type, scheduled_date, actual_date, work_order_id, status (pending/done/overdue/skipped) — `schema.sql`
- [x] เพิ่มตาราง **`deduction_notes`** กลับ: id, `client_id`→clients, month CHAR(7), notes, created_by→users — `schema.sql`
- [x] `units.refrigerant` — คง nullable (ยืนยันมีคอลัมน์อยู่ `schema.sql:73`)
- [x] seed: param พัดลม → บันทึกใน `.env.example` (`FAN_DEFAULT_CLIENT_CODE=PTS1` / `FAN_DEFAULT_SITE_NAME` + `EXCEL_PATH`); flag ตรวจ site รายตัวใช้ `units.needs_recode` ตอน import (seed รัน blocked รอ xlsx+dev DB)

> ทำแพตช์นี้ก่อน แล้วค่อยรัน seed + งานเฟส 1 ตาม `CLAUDE_phase1_master.md`
