# REPORT — เฟส 3: อนุมัติ + บทบาท + แจ้งเตือน

> วันที่ 2 มิ.ย. 2026 · branch `feat/phase3-approval`
> ตรวจด้วย `node --check` + `npm test` (24/24) + `npm run build` ผ่าน · ยังไม่รัน DB จริง (รอ deploy + migrate:phase3)

---

## 1. Endpoints ที่สร้าง + วิธีทดสอบ sign flow

### area_owner เซ็นโดยไม่ login
| Endpoint | auth | ทำ |
|---|---|---|
| `POST /work-orders/:id/sign-token` | ✅ assignee+in_progress | สร้าง JWT 30 นาที (scope=area_owner_sign) + เก็บ sha256 hash ใน `sign_tokens` → คืน token + sign_path |
| `GET /api/sign/:token` | ❌ public | verify token → คืนข้อมูลใบงานขั้นต่ำ (client/site/units) |
| `POST /api/sign/:token` | ❌ public | บันทึก signature (role=area_owner, user_id=null) → burn token |
| `GET /work-orders/:id/sign-status` | ✅ | poll ว่าเซ็นแล้วยัง (สำหรับหน้า QR) |

**วิธีทดสอบ sign flow:**
1. login ช่าง → เปิดใบงาน in_progress → กด "ขอลายเซ็นเจ้าของพื้นที่"
2. ได้ QR + ลิงก์ → เปิดลิงก์ใน browser อื่น (ไม่ login) → เห็นหน้าเซ็น
3. กรอกชื่อ + เซ็น → ยืนยัน → "ขอบคุณ ลงนามเรียบร้อย"
4. หน้าช่าง poll 10 วิ → ขึ้น "เซ็นแล้ว ✓"

## 2. Role hardening
- middleware `requireWoRole({ roles, statuses, assigneeOnly })` — compose ได้, admin bypass assignee

| Action | Role | Status | บังคับ |
|---|---|---|---|
| กรอก inspection | technician(assignee), admin | draft/in_progress/rejected | ✅ requireWoRole |
| upload/ลบ รูป | technician(assignee), admin | draft/in_progress/rejected | ✅ requireWoRole |
| ขอ sign-token | technician(assignee), admin | in_progress | ✅ requireWoRole |
| submit | technician/central_admin/admin | in_progress | state machine |
| admin-approve | central_admin, admin | pending_admin | requireRole + state machine |
| final-approve | approver, admin | pending_approval | requireRole + state machine |
| reject | central_admin/approver/admin | pending_admin/pending_approval | requireRole + state machine |
| ดู list | ทุก role | — | **ช่างเห็นแค่ WO ตัวเอง** (assignee filter), admin เห็นหมด |

## 3. ทดสอบ token expiry + replay
- **expiry:** JWT exp 30 นาที + `sign_tokens.expires_at` → เกิน → 410 "ลิงก์นี้หมดอายุแล้ว"
- **replay/single-use:** POST สำเร็จ → `used_at` ตั้งค่า → ใช้ซ้ำ → 410 "ลิงก์นี้ถูกใช้ไปแล้ว"
- **GET ไม่ invalidate:** เปิดดูกี่ครั้งก็ได้ token ยังใช้ได้จนกว่า POST สำเร็จ (ตามกติกา)
- **concurrent:** POST ใช้ `SELECT ... FOR UPDATE` lock row → 2 คนกดพร้อมกันได้แค่คนเดียว
- **rate-limit:** `/api/sign/:token` 5 req/นาที/IP → เกิน → 429
- **token hash:** เก็บแค่ sha256 ใน DB (raw token อยู่แค่ใน QR/ลิงก์)

## 4. Frontend
- **SignPage** (`/sign/:token`, public ไม่ login) — ข้อมูลใบงาน + SignaturePad + success/expired screen
- **WorkOrderDetail** — ปุ่มขอลายเซ็น → QR modal (countdown 30 นาที + poll สถานะ 10 วิ + copy ลิงก์); timeline สถานะ; reject_reason; assignees + ผู้อนุมัติ; รูปลายเซ็น area_owner
- **Layout** — bell icon + unread badge (poll 30 วิ)
- **Notifications** (`/notifications`) — list, คลิก→อ่าน+ไป WO, อ่านทั้งหมด
- dep ใหม่: `qrcode`

### In-app notification (auto ตอน status เปลี่ยน)
- → pending_admin: แจ้ง central_admin ทุกคน
- → pending_approval: แจ้ง approver ทุกคน
- → approved: แจ้ง assignees
- → rejected: แจ้ง assignees + reject_reason

## 5. เลื่อนเฟสถัดไป + คำถาม
**เลื่อน:**
- push/email notification (ตอนนี้ in-app badge อย่างเดียว)
- live camera preview
- รายงาน PDF 4 แบบ (เฟส 4)

**ถาม Worawit ก่อนเฟส 4 (รายงาน PDF):**
1. รายงาน 4 แบบ มีอะไรบ้าง + layout (ใช้ inspection_values + photos + signatures)
2. ตำแหน่ง area_owner ใน sign — เก็บแยก field ไหม (ตอนนี้รวมในชื่อ)
3. notification — ต้องการ email/LINE ไหม หรือ in-app พอ

## 6. Deploy
```bash
# หลัง merge → deploy → Coolify Terminal (ครั้งเดียว, additive):
npm run migrate:phase3   # สร้าง sign_tokens + notifications
# ⚠️ ห้ามรัน npm run migrate (drop ทุกตาราง)
```
