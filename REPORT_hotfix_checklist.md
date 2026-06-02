# REPORT — Hotfix: inspection template + PDF ตรงฟอร์ม LMT

> branch `feat/hotfix-lmt-checklist` · ตรวจ node --check + npm test + vite build + render screenshot

## template_items ต่อหมวด (AC) — ตรงสเปกเป๊ะ
| category | จำนวน |
|---|---|
| all3 (ใช้งานทั้ง 3 ประเภท) | 6 |
| refrigerant (แอร์น้ำยา) | 7 |
| fcu | 8 |
| ahu | 4 |
| other | 2 |
| **รวม** | **27** |
ลำดับ sort 10..420 ตามฟอร์ม LMT · all3 = major+minor, ที่เหลือ major

## photo_point_templates
- AC major = 7 จุด (ป้ายเครื่อง/หน้ากาก/Filter/คอยล์เย็น/Blower/Drain/จุดวัด) → ถ่ายคู่ = 14 รูป
- AC minor = 4 จุด · fan = 3 จุด

## value_type ใหม่
- `rst_amp` — R/S/T แอมป์ ก่อน-หลัง (6) + LN(V)/L(A) ก่อน-หลัง (4)
- `ln_vi` — LN(V)+L(A) ขณะ Compressor
- `pressure_pair` — Suction+Discharge PSI + สาร R32/R410/R22
- (+ check/number/before_after/text เดิม)

## ไฟล์/ส่วนที่แก้
- `migrate_phase4.js` (additive): value_type CHECK + inspection_values structured cols + work_orders cond_* + photo_point_templates
- `seed.js`: clean-reseed AC template 27 รายการ + photo points
- `schema.sql`: mirror สำหรับ fresh DB
- backend logic: inspection PUT รับ field ใหม่ · photo gate ครบทุก required point (before+after) · `GET /master/photo-points` · `PUT /work-orders/:id/condition`
- `reportTemplates.js` แบบ C: คอลัมน์เดียวเต็มหน้า + **ป้ายหมวดแนวตั้ง** + sub-box rst_amp/ln_vi/pressure_pair + ก่อน=navy/หลัง=teal + ความเห็นทีมช่าง + ลายเซ็น 3 คน (หน้า 1) · หน้า 2 รูปจับคู่ตาม point (ก่อน-หลัง)
- `WorkOrderUnitDetail.jsx`: input ตาม value_type + photo-point slots + progress + tab ความเห็นทีมช่าง (ผ่าน offline queue เดิม)

## ยืนยัน PDF (render mock 17 รายการ)
- ป้ายหมวดแนวตั้ง 5 หมวดถูก · rst_amp/pressure_pair/ln_vi sub-box แสดงค่าถูก · AHU (ไม่ตรง FCU) เทา + "—" · ก่อน/หลัง สีถูก · ความเห็นทีมช่าง + ผลงาน + ลายเซ็น จบหน้า 1 · gallery หน้า 2

## Deploy
```bash
npm run migrate:phase4   # additive
npm run seed             # reseed template (27) + photo points
```
> ⚠️ seed จะลบ AC template เดิม + inspection_values ของ AC (clean reseed) — prod ยังไม่มี WO จริง ปลอดภัย
