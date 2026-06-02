# REPORT — แก้ตาม audit (security hardening)

> branch `fix/audit-security` · node --check + npm test (24/24) + vite build ผ่าน

## แก้แล้ว
| # | รุนแรง | แก้ |
|---|---|---|
| H-1 | สูง | retire legacy `/api/photos` (unmount + ลบ `routes/photos.js`) + ลบหน้า dead `AcItemDetail.jsx` ที่เป็น consumer เดียว → ใช้ `/work-orders/:id/photos` ที่ guard แล้ว |
| H-2 | สูง | `POST /:id/signatures` gate ตาม role: central_admin/approver ต้องตรง role จริง (admin bypass), area_owner = assignee/admin |
| A5 | สูง | multer sanitize path component (safeInt/safePhase/safeExt) กัน traversal |
| F-7 | กลาง | `pm.js` write ทั้งหมด + `requireRole('admin','central_admin')` |
| F-1 | กลาง | `repair-request` + requireWoRole (assignee+editable) |
| F-6 | กลาง | `PUT /:id/units`,`/condition` + requireWoRole (assignee+editable) |
| M-2 | กลาง | `parts.js` work_order_id ต้องตรง client ของ unit (subquery กรอง) |
| B3 | กลาง | `migrate.js` guard: ปฏิเสธถ้า work_orders มี data (ต้อง `ALLOW_DESTRUCTIVE_MIGRATE=yes`) |
| F5-B | กลาง | offline sync: เกิน 8 retry → mark `failed` + skip (ไม่ลบของ user เงียบ) |
| Q-A | กลาง | WorkOrderDetail: useEffect cleanup clear sign-modal interval ตอน unmount |
| — | — | ลบ orphan: `migrate_v2.js`, `migrate_v3.js`, `import_excel.py` |

## ยังไม่แก้ (จงใจ — ดูเหตุผล)
- **F-5** GET /users: คงเปิด (technician ต้องใช้ assignee picker ตอนสร้าง WO) — ไม่คืน password_hash
- **A4** default admin1234: เป็น operational — ต้องเปลี่ยนรหัสจริงหลัง go-live
- **A3** `?token=` JWT: PDF download ต้องใช้ (เปิดใน tab) — คงไว้
- **M-1/M-3/IDOR reads**: by-design (staff เห็นทุก client)
- **F-2** submit/start/resubmit assigneeOnly: LOW + state machine guard อยู่แล้ว
- **F4-A** PM dual-source next_pm_date: ตอนนี้คำนวณตรง — เก็บไว้ refactor ทีหลัง
- **F8** rate-limit spoof: LOW

อัปเดต checklist ใน REPORT_audit.md §6 ตามนี้
