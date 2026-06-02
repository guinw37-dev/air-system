# REPORT — UI redesign (ธีมโรงพยาบาล ฟ้า-ขาว-เขียว)

> branch `feat/ui-redesign` · UI/CSS only (ไม่แตะ business logic) + 380/220 form logic + scroll fix

## 1. Design tokens + component กลาง
- `tailwind.config.js` — สี token: primary #1E7FC4 / primary-dark #163E5E / primary-soft / success #10A56A / warn #E8943A / danger #E8503A / page #F7FAFD / surface / line #E3EDF5 / ink + ink-muted · radius card/input/pill
- `src/index.css` — CSS vars (:root) + restyle class กลาง: `.btn-primary/.btn-secondary/.btn-danger/.btn-green`, `.card`, `.input`, `.label`, `.section-header`, `.stat-card`, `.badge` + `.badge-success/warn/primary/danger/gray`, `.tab-*` · body single-scroll (overflow hidden)
- `config.js` — STATUS/TYPE badge → token
- **ทุก component อ้าง token ชุดเดียว** ไม่ hardcode สีรายหน้า

## 2. หน้าที่ยกเครื่อง (ใช้ design system เดียวกัน)
Layout (sidebar primary-dark/active primary) · Login · SignPage (public, mobile) · Dashboard · WorkOrderList/Create/Detail/UnitDetail · MasterData · Import · Users · RepairLogs · PMSchedule · PMPlan · CleaningStatus · CleaningDashboard · Parts · Deductions · Notifications
→ swap blue/gray hardcode → token · ใช้ .card/.badge/.stat-card · chart สี palette · table header/hover ตรงกัน

## 3. แก้บั๊ก scroll (WorkOrderCreate) ✅
- App shell: scroll เดียวที่ `<main>` (body/#root overflow hidden)
- กล่องเลือก unit: **ลบ max-h/overflow ของตัวเอง** → เลื่อนผ่าน main · ปุ่ม "สร้างใบงาน" sticky bottom
- ทดสอบ: เลื่อนสุดไม่มี scrollbar เพิ่ม (เหลือเดียว)

## 4. ตัวเลือกระบบไฟ 380/220 ✅ (rst_amp ใน WorkOrderUnitDetail)
- segmented 380V (3 เฟส R/S/T) | 220V (1 เฟส L/LN)
- 380 → R/S/T ก่อน-หลัง + LN/L · 220 → ซ่อน R/S/T เหลือ LN/L + โน้ตเขียว
- บันทึก `inspection_values.power_system` ('380'|'220') · PDF: 220 ซ่อนแถว R/S/T ที่ว่าง
- backend: schema + inspection PUT + reportBuilder + reportTemplates

## 5. ยังไม่แตะ / เฟสหน้า
- virtualization (react-window) สำหรับ unit list ยาวมาก — ตอนนี้ single scroll พอ
- micro-polish เฉพาะจุด (spacing รายหน้า) ถ้าต้องการ fine-tune
- หน้าตัวอย่าง screenshot: Login ยืนยัน theme ทำงาน (primary badge + card + input + btn)

## 6. Deploy
```sql
ALTER TABLE inspection_values ADD COLUMN IF NOT EXISTS power_system VARCHAR(5);
```
> additive · ไม่ลบข้อมูล · แล้ว deploy 2 app
