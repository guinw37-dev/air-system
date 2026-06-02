# REPORT — เฟส 5: รอบบำรุงรักษา + ปฏิทิน PM

> วันที่ 2 มิ.ย. 2026 · branch `feat/phase5-pm`
> ตรวจ: `node --check` + `npm test` (24/24 รวม pmPlanner 5) + `npm run build` ผ่าน

## 1. Logic คำนวณ schedule + edge cases (`services/pmPlanner.js`)
- รอบ AC 6 เดือน = ใหญ่1 + ย่อย2 (ทุก 2 เดือน) คำนวณ **รายเครื่อง** จาก `last_major_clean_date`
- `buildUnitEvents(unit, year, today)` → list {scheduled_date, planned_type} ในปีนั้น
- **edge cases:**
  - `last_major_clean_date = null` → major ครั้งแรก = เดือนถัดไป แล้วเข้ารอบ
  - fan → type `fan` ทุก 2 เดือน จาก `next_pm_date`
  - status ≠ active (รื้อถอน/เสีย) → ข้าม ไม่สร้าง plan
  - `needs_recode = true` → สร้าง plan ได้ + ใส่ note "unit needs_recode"
  - reset รายเครื่อง: คำนวณจาก LM ของตัวเอง (เครื่องล้างใหญ่กลางรอบ → รอบใหม่อิสระ)
- unit test 5/5 ผ่าน (ไม่ต้อง DB)

## 2. Endpoints
| Endpoint | ทำ |
|---|---|
| `POST /pm/generate?client_id=&site_id=&year=` | สร้างแผนรายปี (tenant-scoped, idempotent: ข้าม unit+date ที่มีแล้ว) → {inserted,skipped,units,skipped_units} |
| `GET /pm/plan?client_id=&site_id=&year=&month=&building_id=&type=&status=` | list plan + filter |
| `PUT /pm/plan/:id` | เลื่อนวันนัด (+note) |
| `PUT /pm/plan/:id/skip` | ข้าม (note บังคับ) |
| `GET /pm/overdue?client_id=` | เลยกำหนดยังไม่ทำ (+days_overdue) |
| `GET /pm/calendar?client_id=&site_id=&year=&month=` | events grouped by date (calendar UI) |
| `GET /pm/plan-summary?client_id=&site_id=&year=` | นับ done/pending/overdue/skipped ต่อเดือน |

**วิธีทดสอบ:** เลือก client+ปี → POST generate → ดู /pm/plan + /pm/calendar
**Tenant:** ทุก endpoint กรอง client_id

## 3. Frontend
- **PMSchedule** (`/pm`) — client/site/year, ปุ่มสร้างแผน, summary strip (filter ได้), ตาราง plan (filter เดือน/อาคาร/ประเภท/สถานะ), modal reschedule/skip
- **PMPlan** (`/pm-plan`) — ปฏิทินเดือน (dayjs), แต่ละวันโชว์ count แยกสี major/minor/fan, คลิกวัน→popup units→/work-orders/new
- **Dashboard** — PM widget (ครบกำหนดเดือนนี้/เลยกำหนด/ทำแล้ว) → /pm

## 4. คำถามก่อนเฟส 6
1. fan PM interval — ตอนนี้ตั้งทุก 2 เดือน ถูกไหม (หรือควรเป็น 3/6 เดือน)
2. ตอน WO approve ควร mark pm_plan ตรงนั้นเป็น done อัตโนมัติไหม (ตอนนี้ generate สร้าง pending แยก)
3. เฟส 6 = อะไหล่ + ประวัติรายเครื่อง + dashboard เต็ม

## 5. Deploy
```bash
npm run migrate:phase5   # additive: pm_plan.note + idx_pmplan_status
```
