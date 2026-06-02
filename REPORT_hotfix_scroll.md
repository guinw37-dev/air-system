# REPORT — Hotfix: scrollbar ซ้อนหน้าเปิดใบงานใหม่

> branch `fix/wo-create-scroll` · CSS-only

## สาเหตุจริง
`frontend/src/pages/WorkOrderCreate.jsx:278` — กล่อง unit picker ตั้ง `max-h-80` (ตายตัว 320px) + `overflow-y-auto`
- กล่องเล็กตายตัว → ฟอร์มสั้น → พื้นที่ว่างล่างเยอะ (Layout main สูงกว่า)
- รายการยาว → inner scroll + page (main) scroll = 2 scrollbar

## แก้
`max-h-80` → `max-h-[50vh]` (responsive)
- กล่องโตตามจอ (≤ ครึ่งจอ) → เติมพื้นที่ ลดที่ว่างล่าง
- `overflow-y-auto` คงไว้ → scrollbar inner โผล่เฉพาะตอนรายการล้นจริง
- รายการน้อย (5 ตัว) → กล่องหดตามเนื้อหา ไม่มี inner scroll
- รายการเยอะ (100+) → inner scroll ในกล่อง, page ส่วนใหญ่พอดีจอ

## หน้าอื่น (ตรวจแล้ว — ไม่มีปัญหาเดียวกัน)
- `MasterData.jsx:24` — `max-h-[90vh]` เป็น modal (pattern ถูก)
- `ImportPage.jsx:205,228` — result list เล็ก (max-h-32/40) overflow-y-auto ปกติ
- `WorkOrderList` — ตารางใน card ไม่มี nested fixed-height scroll
