# REPORT — เฟส 2: ใบงาน + หน้างานมือถือ

> วันที่ 2 มิ.ย. 2026 · branch `feat/phase2-workorder`
> ขอบเขต: WO state machine + ใบงาน + กรอกหน้างาน + อนุมัติ 2 ด่าน + PM cycle
>
> สถานะ: **backend + frontend (online) เสร็จ** · **offline-first ยังไม่ทำ** (ดูข้อ 4)
> ⚠️ ยังไม่ deploy/รันจริง — ตรวจด้วย `node --check` + `npm test` (24/24) + `npm run build` ผ่าน

---

## 1. Endpoints ที่สร้าง (workOrders.js — เขียนใหม่ทั้งไฟล์)

State machine: `services/woStateMachine.js` คุม transition + role + เหตุผล + editability ทุก transition log ลง `work_order_status_history`

```
draft → in_progress → pending_admin → pending_approval → approved
                                    ↘ rejected → in_progress (resubmit)
```

| Endpoint | ทำ | role | สถานะ |
|---|---|---|---|
| `POST /work-orders` | สร้าง draft (atomic: assignee_ids[] + unit_ids[]) | ทุกคน | ✅ |
| `GET /work-orders?client_id=&status=&type=` | list (client_id บังคับ — tenant) | ทุกคน | ✅ |
| `GET /work-orders/:id` | detail + units + inspections + photos + signatures | ทุกคน | ✅ |
| `GET /work-orders/:id/history` | ประวัติเปลี่ยนสถานะ | ทุกคน | ✅ |
| `PUT /work-orders/:id/units` | เพิ่ม/ลดเครื่อง (เฉพาะ editable) | ทุกคน | ✅ |
| `PUT /work-orders/:id/inspection` | upsert inspection_values + auto draft→in_progress | ทุกคน | ✅ |
| `PATCH /work-orders/:id/start` | draft→in_progress | tech/cadmin/admin | ✅ |
| `POST /work-orders/:id/submit` | in_progress→pending_admin (**photo gate**) | tech/cadmin/admin | ✅ |
| `POST /work-orders/:id/admin-approve` | pending_admin→pending_approval | central_admin | ✅ |
| `POST /work-orders/:id/final-approve` | pending_approval→approved (+PM cycle) | approver | ✅ |
| `POST /work-orders/:id/reject` | →rejected (+reason บังคับ) | cadmin/approver | ✅ |
| `POST /work-orders/:id/resubmit` | rejected→in_progress (ล้าง signatures) | tech/cadmin/admin | ✅ |
| `POST /work-orders/:id/signatures` | area_owner/central_admin/approver | login | ✅ |
| `POST /work-orders/:id/photos` | upload (concurrent-append, +uploaded_by, server timestamp) | login | ✅ |
| `GET /work-orders/:id/photos` | grouped by unit | login | ✅ |
| `DELETE /work-orders/:id/photos/:photoId` | ลบ (เฉพาะก่อน submit) | login | ✅ |

**กฎรูปบังคับ:** submit ไม่ได้ถ้ามี unit ที่ขาดรูป before หรือ after → คืน 400 + `missing_units[]`
**Tenant:** ทุก query กรอง `client_id`; create/edit units guard ว่า unit เป็นของ client เดียวกัน
**PM cycle (§6):** major→last_major=today/next=+2เดือน/pos=0 · minor→next=last_major+(pos+1)*2เดือน/pos+1 (ครบ 2 รอบ→next major+6เดือน) · fan→+2เดือน

## 2. Frontend (vite build ผ่าน)
| หน้า | route | ทำ |
|---|---|---|
| WorkOrderList | `/work-orders` | list ตาม client + filter status/type + badge สี |
| WorkOrderCreate | `/work-orders/new` | client→site→type, unit picker (ค้นหา+filter อาคาร, multi-check), assignees |
| WorkOrderDetail | `/work-orders/:id` | mobile-first, ปุ่มตาม role+status, progress รูป/เช็กลิสต์, history |
| WorkOrderUnitDetail | `/work-orders/:id/units/:unitId` | เช็กลิสต์ตาม template/category, before/after, ถ่ายรูป/phase, **auto-save** (debounce 1.5s) |
| Signature (area_owner) | ในหน้า detail | SignaturePad + ชื่อ + เซ็น |
| อนุมัติ | ในหน้า detail | central_admin/approver ผ่าน/ส่งคืน + ดูรูป/ค่าวัด |

## 3. Test
- `services/woStateMachine.js` — unit test 12/12 ผ่าน (transition/role/reason/editable)
- รวม `npm test` = tenant 7 + state machine 12 = **24/24** ผ่าน (ไม่ต้อง DB)
- `node --check` ทุกไฟล์ backend · `npm run build` frontend ผ่าน

## 4. ยังไม่ทำ / เลื่อนเฟสถัดไป
- **Offline-first (§5)** — IndexedDB queue + auto-sync + indicator ยังไม่ทำ (ส่วนซับซ้อนสุด ทำเป็น chunk แยก) ตอนนี้เป็น online-only
- **area_owner no-login token** — ตอนนี้เซ็นผ่านหน้า detail (ต้อง login) flow QR/token สั้นยังไม่ทำ
- **camera capture จริงบนมือถือ** — ใช้ `<input capture>` พื้นฐาน ยังไม่ทำ live camera preview
- **รายงาน PDF 4 แบบ** — ยัง 501 (เฟส report)

## 5. ต้อง deploy ก่อนใช้ (สำคัญ)
```bash
# หลัง merge phase2 → main → redeploy
# Coolify Terminal (รันครั้งเดียว — additive ไม่ล้างข้อมูล):
npm run migrate:phase2   # สร้าง work_order_status_history
```
> ⚠️ **ห้ามรัน `npm run migrate`** (ตัวนั้น drop ทุกตาราง = ล้าง 1,231 แอร์!) ใช้ `migrate:phase2` เท่านั้น

## 6. คำถามก่อนเฟส 3
1. Offline-first — ทำต่อเลย หรือเก็บเฟส 3? (ใช้งานหน้างานจริงต้องมีถ้าเน็ตไม่เสถียร)
2. area_owner เซ็นยังไง — QR ที่เครื่อง? link ส่ง? ต้องการ flow ไม่ login จริงไหม
3. assignee — ใครเลือกช่างเข้าใบงาน (central_admin หรือช่างเลือกเอง)?
4. รูปบังคับ — before+after พอ หรือต้องมี measurement/name plate ด้วย (ดู photoPoints เดิม)
