# REPORT — เพิ่ม role Checker + เอา admin ออกจาก workflow

> branch `feat/role-checker`

## โครง role ใหม่ (5)
| role | หน้าที่ | workflow |
|---|---|---|
| technician | ช่าง: สร้าง/กรอก/ถ่ายรูป/ส่ง | start/submit/resubmit |
| **checker** (ใหม่) | ตรวจเอกสาร ด่าน 1 | admin-approve / reject |
| approver | อนุมัติปิด ด่าน 2 | final-approve / reject |
| central_admin | ลงข้อมูล (master, สร้าง WO) | ไม่อยู่ใน approval |
| admin | ผู้ดูแลระบบ (users/master/system) | **OUT — ทำ workflow ไม่ได้** |

flow: ช่าง → checker (ตรวจ) → approver (อนุมัติ)

## Backend
- `woStateMachine.js` — pending_admin→pending_approval = `checker` · pending_approval→approved = `approver` · เอา admin/central_admin ออกทุก transition
- `workOrders.js` — admin-approve=requireRole('checker') · final-approve=('approver') · reject=('checker','approver') · requireWoRole roles → technician/checker · allowedSigners: central_admin slot→checker, approver→approver
- `schema.sql` users CHECK + `'checker'` · `migrate_role_checker.js` (additive: ALTER constraint + seed checker user pw admin1234)
- `seed.js` + checker user · test 24/24 (woStateMachine ใช้ checker)

## Frontend
- Users.jsx role dropdown/label/color + checker
- WorkOrderDetail ปุ่ม: ผ่าน/ส่งคืน(pending_admin)=checker · อนุมัติ(pending_approval)=approver · admin ไม่มีปุ่ม approval · ลายเซ็น Checker
- Layout nav / App RequireRole: checker เห็นหน้า oversight (สรุปยอดล้าง/งานตีกลับ)

## Deploy
```bash
npm run migrate:role   # additive: เพิ่ม 'checker' ใน constraint + seed user checker
```
login ใหม่: **checker / admin1234**
