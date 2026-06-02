# REPORT — Hotfix: PDF แบบ C จบ 1 หน้า

> branch `fix/pdf-major-layout` · แก้ `services/reportTemplates.js` (template เก็บเป็น JS ไม่ใช่ .html แยก)

## ทำอะไร
- เช็กลิสต์แบบ C เปลี่ยนจาก **เต็มความกว้าง 1 ตาราง** → **2 คอลัมน์** (`checklistTwoCol`)
  - ซ้าย 55%: หมวด "ใช้งานทั้ง3" + "แอร์น้ำยา"
  - ขวา 45%: FCU / AHU / อื่นๆ
- wrap หน้าแบบ C ด้วย `.major-c` + compact CSS (scope ไม่กระทบแบบ A/B/D)
- gallery รูปก่อน-หลัง → แยกเป็นหน้า 2 (มีอยู่แล้ว: push เป็น page() แยก)
- ไม่ตัดรายการเช็กลิสต์ (แสดงครบทุกแถว แม้ไม่ได้กรอก → `—` / ช่องว่าง)

## font-size / ความสูงที่ใช้ (.major-c)
| ส่วน | ค่า |
|---|---|
| body หน้า C | 9px, line-height 1.2 |
| page padding | 8mm 10mm |
| ตารางเช็กลิสต์ | 7.5pt, td padding 0.5mm 1mm, tr 5.4mm |
| คอลัมน์ tick/ก่อน/หลัง | 9mm / 11mm / 11mm |
| ลายเซ็น | pad 14mm (img 13mm), role/nm 8.5px |
| result line | 8.5px |

## ทดสอบ
- render mock 28 รายการ (ใช้งานทั้ง3×9 + แอร์น้ำยา×10 + FCU×5 + AHU×4) → preview ใน browser
- ยืนยัน: หัวเครื่อง + เช็กลิสต์ 2 คอลัมน์ + result + ลายเซ็น 3 คน **จบในหน้า A4 เดียว** · gallery อยู่หน้า 2
- `node --check` ผ่าน

## เปิดดู: `GET /api/pdf/work-orders/:id/preview?type=major`
