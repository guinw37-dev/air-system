# REPORT — Audit ระบบ air-system (โค้ด + flow)

> วันที่ 2 มิ.ย. 2026 · audit แบบ read-only ผ่าน 4 subagent ขนาน (tenant / state+RBAC / security+completeness / flows)
> **ห้ามแก้โค้ดในรอบนี้** (เน้นตรวจ+รายงาน) — ดู checklist ข้อ 6 สำหรับสิ่งที่ต้องแก้ก่อนใช้จริง

---

## 1. สรุปผู้บริหาร

**สถานะรวม: 🟡→🔴 ยังไม่พร้อมเปิดใช้จริงจนกว่าจะแก้ HIGH** — flow ใช้งานได้ครบ แต่ RBAC มีรูใหญ่ + path traversal

| มิติ | ระดับ |
|---|---|
| Tenant isolation | 🟡 YELLOW (model = staff เห็นทุก client; รูจริงอยู่ที่ write/forge) |
| State machine | 🟢 GREEN (ข้ามขั้นไม่ได้, approved ล็อก) |
| RBAC / permission | 🔴 RED (หลาย endpoint มีแค่ authMiddleware) |
| Security ทั่วไป | 🟡→🔴 (path traversal upload = สูง) |
| Code completeness | 🟡 YELLOW (dead orphan + test บาง) |
| Flows ราย role | 🟢 ใช้งานได้ (มี caveat) |

### ความเสี่ยงสูงสุด 3 อันดับ
1. **ปลอมลายเซ็น + แก้ข้ามใบงาน (RBAC)** — `POST /work-orders/:id/signatures` และ legacy `routes/photos.js` มีแค่ authMiddleware → ช่างคนใดก็ได้ปลอมลายเซ็น approver/central_admin หรือ inject/ลบรูปของใบงานลูกค้าใดก็ได้ (รวม approved)
2. **Path traversal ตอน upload รูป** — `req.body.work_order_unit_id/phase/point_no` ใส่ใน path โดยไม่ validate → เขียนไฟล์นอก uploads ได้
3. **Default password `admin1234` + JWT ใน query string** — seed ทุก user รหัสเดียว + รับ `?token=` ทุก route (token รั่วใน log/URL)

---

## 2. ตารางพบปัญหา

| # | รุนแรง | จุด (file:line) | ปัญหา | ผลกระทบ | วิธีแก้ |
|---|---|---|---|---|---|
| H-1 | 🔴 สูง | `routes/photos.js:44,77` (legacy `/api/photos`) | POST/DELETE รูปไม่เช็ค WO/role/state/owner เลย | inject/ลบรูปใบงานลูกค้าใดก็ได้ รวม approved | retire router นี้ (ซ้ำกับ workOrders.js ที่ guard แล้ว) หรือใส่ requireWoRole + isEditable |
| H-2 | 🔴 สูง | `routes/workOrders.js:602` `POST /:id/signatures` | ไม่เช็คว่า req.user.role ตรงกับ signature role | ช่างปลอมลายเซ็น approver/central_admin บนใบงานใดก็ได้ | gate ตาม role: central_admin/approver ต้องตรง role จริง |
| A5 | 🔴 สูง | `routes/workOrders.js:626,632` + `routes/photos.js:15,21` | multer dest/filename ใช้ body/param ไม่ validate (`../`) | เขียนไฟล์นอก UPLOAD_DIR (arbitrary write) | validate int/enum ก่อนสร้าง path หรือ path.basename ทุก component |
| F-7 | 🟠 กลาง | `routes/pm.js:111,135,196,232,310,323` | PM write ทั้งหมดมีแค่ authMiddleware | ช่างคนเดียวลบ/รื้อแผน PM ทุก client ได้ | requireRole('admin','central_admin') ทุก POST/PUT/DELETE |
| F-1 | 🟠 กลาง | `routes/workOrders.js:574` `repair-request` | ไม่เช็ค status/assignee | สร้าง repair + flip has_repair บน WO ที่ approved (ล็อก) แล้ว | requireWoRole({statuses:[in_progress,rejected],assigneeOnly}) |
| F-6 | 🟠 กลาง | `routes/workOrders.js:177,293` `/units`,`/condition` | มีแค่ authMiddleware + isEditable | ช่างที่ไม่ใช่ assignee แก้รายการเครื่อง/ความเห็นใบงานใครก็ได้ | requireWoRole assigneeOnly |
| M-1 | 🟠 กลาง | `routes/pdf.js:22` | tenant check ทำงานเฉพาะถ้าส่ง client_id → ละไว้ = ผ่าน | ดาวน์โหลดรายงาน approved ของลูกค้าใดก็ได้ด้วย id | derive client จาก context หรือถอด check ที่หลอกตา |
| M-2 | 🟠 กลาง | `routes/parts.js:8` | work_order_id ไม่เช็คว่า client ตรง unit | requisition ข้าม client ปนกัน | validate WO.client_id == unit.client_id |
| M-3 | 🟠 กลาง | `routes/master.js:88,126,163,204` | buildings/floors/rooms/units list ไม่กรอง client_id | enumerate master data ข้าม client | กรอง client_id (units มี client_id ตรง) |
| A3 | 🟠 กลาง | `middleware/auth.js:8` | รับ JWT ผ่าน `?token=` ทุก route | token 12h รั่วใน URL/log/referer | จำกัด ?token= เฉพาะ PDF หรือออก token แยก scope |
| A4 | 🟠 กลาง | `db/seed.js:18` | default `admin1234` ทุก user + print console | ถ้าไม่เปลี่ยน = เข้าได้ทันที | บังคับเปลี่ยนรหัสครั้งแรก / fail boot ถ้ายัง default |
| F5-B | 🟠 กลาง | `lib/offline/sync.js:113-119` | retry 4xx 8 ครั้งแล้ว deleteItem เงียบ | รูป/ค่าตรวจที่ queue หาย ถ้า WO เปลี่ยน status ระหว่าง offline | แยก transient vs permanent + ไม่ลบเงียบ (dead-letter + แจ้ง user) |
| Q-A | 🟠 กลาง | `pages/WorkOrderDetail.jsx:177` | sign modal interval ไม่ cleanup ตอน unmount | timer/poll รั่วเมื่อ navigate ออกขณะ modal เปิด | useEffect cleanup clearInterval |
| F4-A | 🟠 กลาง | `workOrders.js:466` vs `pmPlanner.js:44` | next_pm_date คำนวณ 2 ที่ คนละวิธี | desync เงียบได้ (ตอนนี้ตรงโดยบังเอิญ) | ให้ buildUnitEvents เป็น source เดียว + test ครอบรอบ |
| B3 | 🟠 กลาง | `db/migrate.js:20` | DROP ทุกตาราง ไม่มี guard | รัน `npm run migrate` ผิด = ล้างข้อมูลหมด | guard ด้วย env flag / เช็ค DB ว่าง ก่อน DROP |
| F-5 | 🟡 ต่ำ | `routes/master.js:369` GET /users | ทุก role เห็น user directory (username/role) | enumerate username | requireRole('admin','central_admin') |
| F-2 | 🟡 ต่ำ | `workOrders.js:339,316,513` submit/start/resubmit | ไม่มี assigneeOnly | ช่างที่ไม่ใช่ assignee push state ใบงานคนอื่น | requireWoRole assigneeOnly |
| L-IDOR | 🟡 ต่ำ | `workOrders.js:116` GET /:id family | ช่างอ่าน detail/photos/history ใบงานใดก็ได้ (list กรองแต่ :id ไม่กรอง) | อ่านข้าม assignee | ใส่ assignee gate ถ้าต้องการ |
| F8 | 🟡 ต่ำ | `middleware/rateLimit.js:9`, `sign.js:39,68` | IP จาก x-forwarded-for (spoof ได้) + limiter แยก GET/POST | bypass rate-limit หน้า sign | trust proxy + ใช้ limiter instance เดียว |
| F5-C | 🟡 ต่ำ | `sync.js:65`, `WorkOrderUnitDetail.jsx:73` | createObjectURL ไม่ revoke | memory leak ตอน offline นาน | revokeObjectURL |
| F2-A | 🟡 ต่ำ | `api/client.js:20` + SignPage | 401 interceptor redirect /login กับ public page | เปราะ (ถ้า sign route คืน 401 จะเด้ง) | ใช้ axios เปล่าใน SignPage |
| Policy | 🟡 ต่ำ | `workOrders.js:426` | admin คนเดียวทำครบ submit→admin-approve→final-approve | ไม่มี 4-eyes (approver≠submitter) | เช็ค approver_id ≠ created_by ถ้าต้องการ |

**ที่ guard ถูกต้องแล้ว (ยืนยัน):** child injection บน WO (work_order_units/inspection_values/photos/repair-request เช็ค EXISTS client_id) · sign.js public flow (JWT scope + sha256 single-use + FOR UPDATE + rate-limit) · notifications scoped req.user.id · state machine ปิดทุกทาง · admin-approve/final-approve แยก role ถูก · ไม่มี secret hardcode / ไม่มี SQLi / .env ไม่ commit · bcrypt ถูก

---

## 3. ตาราง endpoint × role × status (ย่อ)

| endpoint | method | role ที่ทำได้ | status | guard |
|---|---|---|---|---|
| /work-orders | POST | auth-only ⚠ | — | authMiddleware |
| /work-orders | GET | auth (tech→assigned) | — | authMiddleware |
| /:id, /:id/history, /:id/photos(GET), /:id/sign-status | GET | auth-only | — | authMiddleware |
| /:id/units, /:id/condition | PUT | auth-only ⚠ | editable | isEditable |
| /:id/inspection, /:id/photos(POST), /:id/photos/:pid(DELETE) | PUT/POST/DELETE | technician,admin (assignee) | draft/in_progress/rejected | requireWoRole ✓ |
| /:id/start, /:id/submit, /:id/resubmit | PATCH/POST | tech,central_admin,admin | per-state | checkTransition (ไม่มี assignee) ⚠ |
| /:id/admin-approve | POST | central_admin,admin | pending_admin | requireRole+checkTransition ✓ |
| /:id/final-approve | POST | approver,admin | pending_approval | requireRole+checkTransition ✓ |
| /:id/reject | POST | central_admin,approver,admin | pending_admin/approval | requireRole+checkTransition ✓ |
| /:id/sign-token | POST | tech,central_admin,admin (assignee) | in_progress | requireWoRole ✓ |
| /:id/signatures | POST | **auth-only** ❌ | ≠approved | authMiddleware (H-2) |
| /:id/repair-request | POST | **auth-only** ❌ | none | authMiddleware (F-1) |
| /api/sign/:token | GET/POST | public (token) | — | token + rate-limit ✓ |
| master /*(GET) | GET | auth-only | — | authMiddleware |
| master /*(POST/PUT) | POST/PUT | admin,central_admin | — | canEdit ✓ |
| master /*(DELETE) | DELETE | admin | — | canDelete ✓ |
| master /users (GET) | GET | auth-only ⚠ | — | authMiddleware (F-5) |
| parts /* | POST/GET | auth-only | — | authMiddleware |
| deductions POST/PUT | POST/PUT | admin,central_admin,approver | — | canEdit ✓ |
| pm write (generate/plan/skip/delete) | POST/PUT/DELETE | **auth-only** ❌ | — | authMiddleware (F-7) |
| notifications /* | GET/PUT | auth (scoped user_id) | — | authMiddleware ✓ |

---

## 4. Flow ราย role
- **technician** 🟢 (caveat): create→inspect(auto in_progress)→photo→sign-token→submit ใช้ได้ · F1-A: ถ้ากรอก inspection ตอน offline แล้ว flush ยังไม่รัน → WO ยัง draft → ปุ่มส่งงานไม่ขึ้น (กด "เริ่มงาน" เองได้)
- **area_owner** 🟢: token→QR→เซ็น→burn single-use ครบ · expired/used render ถูก
- **central_admin** 🟢: pending_admin→ผ่าน/ตีกลับ + notify approver/assignee + reject_reason กลับถึง
- **approver** 🟢 (caveat): final-approve→PM advance · PM math major ถูก (ใหญ่+2minor ทุก 2 เดือน) · F4-A: next_pm_date 2 source เสี่ยง desync
- **offline sync** 🟢 (caveat): idempotent ดี (inspection upsert + photo client_token) · F5-B: drop ของ user เงียบหลัง 8 retry

---

## 5. Stub 501 + dead code
- **501 stub:** `routes/import.js:377` `POST /import/work-history` (เลื่อน)
- **dead/orphan (ลบได้ ปลอดภัย — ไม่ถูก require/script):** `db/migrate_v2.js`, `db/migrate_v3.js` (อ้าง ac_photos), `db/import_excel.py` (schema เก่า hospitals/ac_units)
- **ไม่มี stale table ใน executable SQL ของ route จริง** (เหลือแค่ comment + param alias hospital_id ที่รับ input)

---

## 6. Checklist ต้องแก้ก่อนเปิดใช้จริง (เรียงความสำคัญ)

**ต้องแก้ (HIGH — บล็อกการเปิดใช้):**
- [ ] H-1: retire/guard `routes/photos.js` legacy router
- [ ] H-2: gate `POST /:id/signatures` ตาม role
- [ ] A5: validate path component ตอน upload (กัน traversal)

**ควรแก้ (MEDIUM — ก่อน production):**
- [ ] F-7: requireRole ทุก pm.js write
- [ ] F-1, F-6: assigneeOnly + status ที่ repair-request/units/condition
- [ ] M-1: pdf.js tenant check ให้บังคับจริง
- [ ] A4: เปลี่ยน default admin1234 (บังคับเปลี่ยนครั้งแรก)
- [ ] A3: จำกัด ?token= เฉพาะ PDF
- [ ] B3: guard `migrate.js` (env flag กัน DROP ผิด)
- [ ] F5-B: offline ไม่ drop ของ user เงียบ
- [ ] Q-A: cleanup sign-poll timer
- [ ] M-2/M-3: เช็ค client ใน parts/master list

**เก็บกวาด (LOW):**
- [ ] F-5: จำกัด GET /users · F-2/IDOR: assignee gate ส่วน read · F8: rate-limit · ลบ orphan files · เพิ่ม test (photo gate/sign/role/PM)
