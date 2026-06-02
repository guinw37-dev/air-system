# REPORT — เฟส 6: อะไหล่ + ประวัติรายเครื่อง + แดชบอร์ด

> วันที่ 2 มิ.ย. 2026 · branch `feat/phase6-parts-dashboard`
> ตรวจ: `node --check` + require ทุกไฟล์ + `npm run build` ผ่าน · **ไม่มี migration** (ใช้ตารางเดิม part_requisitions/deduction_notes/repair_logs)

## 1. Endpoints + วิธีทดสอบ
**อะไหล่ (parts.js)**
- `POST /parts {unit_id, work_order_id?, part_name, qty, note}` — client_id derive จาก unit
- `GET /parts?client_id=&unit_id=&work_order_id=&from=&to=` — list + filter
- `GET /parts/summary?client_id=&unit_id=` — รวมต่อ part_name

**ประวัติรายเครื่อง (master.js)**
- `GET /master/units/:id/timeline` — รวม WO + repair_logs + part_requisitions เรียง date desc (มี `kind`)
- `GET /master/units/:id/stats` — counts (major/minor/fan), measurement trend (value_after numeric ข้ามรอบ), parts

**หักเงิน (deductions.js)** — admin/central_admin/approver
- `POST /deductions {client_id, month:'YYYY-MM', notes}` · `GET ?client_id=&year=` · `PUT /:id`

**Dashboard aggregates (stats.js)** — ทุกตัวกรอง client_id
- `GET /stats/overview` — wo(total/this_month/open) + units(active/broken/inactive) + pm_overdue + repairs_open
- `GET /stats/wo-trend?months=6` — WO รายเดือนแยก major/minor/fan
- `GET /stats/unit-health` — สัดส่วนสถานะ
- `GET /stats/top-repair?limit=10` — เครื่องขอเปิดซ่อมบ่อยสุด

**ทดสอบ:** เลือก client → ดู /stats/overview, /stats/wo-trend ฯลฯ ; เบิกอะไหล่ผ่าน /parts ; ดู /master/units/:id/timeline

## 2. Frontend
- **Parts** (`/parts`) — ตารางเบิก + filter + modal เบิก (search unit)
- **UnitDetail** (`/units/:id`) — header + timeline (WO/repair/part สี) + trend LineChart (เลือก item) + parts tab; MasterData row → link มาที่นี่
- **Deductions** (`/deductions`) — client+ปี, grid 12 เดือน inline edit
- **Dashboard** — client dropdown คุมทุก widget: 4 การ์ดสรุป + WO-trend BarChart + unit-health donut + top-repair list + recent WO feed
- nav เพิ่ม: อะไหล่ / หักเงิน

## 3. เลื่อนได้ (เฟสถัดไป ถ้าต้องการ)
- stock/ราคา/อนุมัติการเบิกอะไหล่
- push/email/LINE notification
- mini chart trend ใน PDF (เฟส 4)

## 4. สรุปภาพรวมระบบทั้งหมด (เฟส 0-6)
ระบบ AC/fan cleaning ครบ flow: master data (client-tenant) → import → ใบงาน (state machine + อนุมัติ 2 ด่าน + offline + photo gate) → เซ็น area_owner QR (ไม่ login) → role hardening + notifications → รายงาน PDF 4 แบบ → PM calendar (รอบ 6 เดือน) → อะไหล่ + ประวัติรายเครื่อง + dashboard เต็ม

**Next step แนะนำ:**
1. แก้ข้อมูลต้นทาง: พัดลม asset_code + needs_recode 30 ตัว → re-import
2. ตั้ง role ผู้ใช้จริง (central_admin/approver)
3. ทดสอบ flow จริงหน้างาน (มือถือ + offline + เซ็น QR)
4. ตั้ง env FRONTEND_URL ให้ QR
5. (ถ้าต้องการ) push/email notification, stock อะไหล่

## 5. Deploy
- ไม่มี migration · deploy code อย่างเดียว
