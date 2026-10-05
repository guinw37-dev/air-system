# HANDOVER — เอกสารส่งมอบงาน Air System

> จัดทำ: 5 ต.ค. 2026 · ผู้ส่งมอบ: Worawit K. · สำหรับผู้ดูแลคนใหม่
> อ่านคู่กับ `README.md` (วิธีรัน/โครงสร้าง) และ `AGENTS.md` (กติกาเวลาใช้ AI agent ช่วยเขียนโค้ด)

---

## 1. ระบบนี้คืออะไร

ระบบบริหารงาน **ล้างแอร์–พัดลม + ซ่อมแอร์** ของ Technical Water Co., Ltd ใช้กับลูกค้าโรงพยาบาลหลายสาขา
ใช้งานจริง (production) ที่ `tw-carework.online` — แต่ละสาขาเข้าผ่าน subdomain ของตัวเอง

ฟีเจอร์หลักที่มีอยู่ตอนนี้ (พัฒนาครบเฟส 0–6 + งานเสริมหลังจากนั้น):

- **Master data** รายสาขา: ลูกค้า → สถานที่ → อาคาร/ชั้น/ห้อง → เครื่องแอร์/พัดลม (import จาก Excel ได้)
- **ใบงานแบบอนุมัติ 2 ด่าน** (`/work-orders`): ช่างกรอก → เจ้าของพื้นที่เซ็นหน้างานผ่าน QR (ไม่ต้อง login) → admin ตรวจ → approver เซ็นปิด · มี state machine + photo gate + offline support
- **ใบงานแบบง่าย** (`/simple-wo`): กรอกจบในขั้นเดียว + PDF + Export Excel + ลายเซ็น 3 ช่อง
- **งานซ่อมแอร์** (`/ac-repair-jobs`) — standalone แล้ว (เคยเชื่อมกับ repair-system แต่ **ถอดออกแล้ว** ส.ค. 2026)
- **ตารางล้าง/ปฏิทิน PM** (`wash-*`, รอบ 6 เดือน), **อะไหล่**, **หักเงิน**, **บันทึกเวลาทำงาน** (attendance)
- **รายงาน PDF** หลายแบบ (puppeteer) + **Dashboard** ภาพรวม/รายสาขา
- **แจ้งเตือน LINE**: webhook + daily digest (เริ่มทำงานอัตโนมัติตอน boot)

## 2. สิทธิ์ที่ผู้ดูแลคนใหม่ต้องได้รับ

| ระบบ | ใช้ทำอะไร | วิธีได้สิทธิ์ |
|------|-----------|---------------|
| GitHub `guinw37-dev/air-system` | โค้ดทั้งหมด | Worawit เพิ่มเป็น collaborator (Settings → Collaborators) |
| Coolify | ดู log, จัดการ env, redeploy, DB | Worawit เพิ่ม user / แชร์ project |
| PostgreSQL (production) | ตรวจ/แก้ข้อมูล | ขอ DB user แยกของตัวเองจาก Worawit (ไม่แชร์รหัสกัน) |
| LINE Developers / OA | จัดการ channel แจ้งเตือน | Worawit เพิ่มเป็น admin ของ channel |
| ระบบ air-system เอง | ทดสอบ/ดูแลผู้ใช้ | ขอ account role `super_admin` |

ค่า env จริงทั้งหมด (DB, JWT, LINE token) อยู่ใน Coolify — **ส่งต่อผ่านช่องทางปลอดภัยเท่านั้น ห้ามใส่ในแชท/อีเมล/ไฟล์ใน repo**

## 3. ⚠️ เรื่อง security ที่ต้องรู้ (สำคัญ)

เคยมี **secrets หลุดเข้า git history** (DB password, JWT_SECRET) — รายละเอียดและเช็กลิสต์อยู่ใน `SECURITY_NOTE.md`
สิ่งที่ต้องยืนยันกับ Worawit ว่าทำครบแล้วหรือยัง ก่อนถือว่าจบ:

- [ ] เปลี่ยน DB password บนเซิร์ฟเวอร์แล้ว
- [ ] เปลี่ยน `JWT_SECRET` ใหม่ใน Coolify แล้ว
- [ ] ตัดสินใจเรื่องล้าง git history (filter-repo/BFG) — ถ้าเปลี่ยนรหัสครบแล้วจะไม่ล้างก็ได้
- [ ] firewall/allowlist ของ DB host

กติกาถาวร: **ห้าม commit `.env` หรือค่า secret ใด ๆ** — `.gitignore` ครอบไว้แล้ว อย่าไป override

## 4. สถาปัตยกรรมที่ต้องเข้าใจก่อนแก้โค้ด

(ฉบับเต็มอยู่ใน README — นี่คือ 5 ข้อที่ถ้าไม่รู้แล้วจะพลาด)

1. **Schema-per-tenant**: ข้อมูลแต่ละสาขาอยู่คนละ Postgres schema · frontend ส่ง header `X-Branch` อัตโนมัติ · route ข้อมูลรายสาขาต้องครอบ `requireBranch` เสมอ ไม่งั้นข้อมูลไหลลง schema `public` แบบเงียบ ๆ
2. **Migration รันตอน boot** (idempotent) — `schema.sql`/`public_schema.sql`/`branch_schema.sql` คือ source of truth · ถ้า boot log ขึ้น `boot migration FAILED at "public"` แปลว่า **ทุกสาขาไม่ได้ migrate เลย** ไม่ใช่แค่บางส่วน
3. **ใบงาน 2 ระบบแยกกัน**: `/work-orders` (อนุมัติ 2 ด่าน) กับ `/simple-wo` (ขั้นเดียว) — แก้ฝั่งหนึ่งอย่าให้กระทบอีกฝั่ง
4. **Endpoint สาธารณะมี 3 ตัว**: `/api/sign` (เซ็น QR), `/api/line` (LINE webhook), `/api/resolve-host` — แก้อะไรแถวนี้ให้คิดเรื่อง security ก่อนเสมอ
5. **PDF ใช้ puppeteer-core** — ต้องมี Chrome ใน container และตั้ง `PUPPETEER_EXECUTABLE_PATH` · ถ้า PDF เสียให้เช็คตรงนี้ก่อน

## 5. งานค้าง / known issues (ณ วันส่งมอบ)

- **พัดลม ~30 เครื่อง flag `needs_recode`** — import มาโดยผูก client/site เริ่มต้น (PTS1) ต้องตรวจ site จริงรายตัวแล้วแก้ข้อมูล
- **ตั้ง role ผู้ใช้จริง** ให้ครบทุกสาขา (admin / approver / technician) — ตอนนี้บางส่วนยังเป็น user ทดสอบ
- **เช็กลิสต์ security** ในข้อ 3 — ยืนยันสถานะกับ Worawit
- การเชื่อม **repair-system ถูกถอดแล้ว** — env `AIR_WEBHOOK_SECRET` / `REPAIR_*` เป็น legacy ถ้าเจอโค้ดอ้างถึงให้ถือว่าไม่ใช้งาน
- ฟีเจอร์ที่เคยคุยไว้แต่ยังไม่ทำ: stock/ราคา/อนุมัติการเบิกอะไหล่ · push/email notification · mini chart ใน PDF

## 6. งานดูแลประจำ (operations)

- **Deploy**: push `master` → Coolify ทำให้เอง · ตรวจ log หลัง deploy ทุกครั้งว่า boot migration ผ่าน (`✓ boot migration done`)
- **เพิ่มสาขาใหม่**: `npm run add-branch` + ตั้ง subdomain/DNS + เพิ่ม user สาขา
- **ตรวจสุขภาพระบบ**: `GET https://<host>/api/health` · LINE daily digest ควรมาตามเวลา — ถ้าไม่มาให้ดู log scheduler
- **รูปอัปโหลด** อยู่ใน `UPLOAD_DIR` (persistent volume บน Coolify) — ย้าย/ลบ volume = รูปหายทั้งระบบ
- **Backup DB**: ตรวจว่า Coolify ตั้ง backup Postgres ไว้หรือยัง ถ้ายัง ให้ตั้งเป็นงานแรก ๆ

## 7. เวลามีปัญหา production — ไล่ตามนี้

1. `GET /api/health` ตอบไหม → ไม่ตอบ = ดู log container ใน Coolify (backend ล่ม/boot ค้าง)
2. ตอบแต่ feature พัง → ดู log ช่วง boot ว่า migration ล้มไหม + error ล่าสุด
3. ข้อมูล "หาย" หรือไปโผล่ผิดสาขา → เช็คว่า route นั้นมี `requireBranch` และ frontend ส่ง `X-Branch` ถูก
4. PDF พัง → `PUPPETEER_EXECUTABLE_PATH` + Chrome ใน image
5. Login พังทั้งระบบ → มีคนเปลี่ยน `JWT_SECRET` (ตั้งใจหรือไม่ตั้งใจ) — ทุกคนต้อง login ใหม่เป็นเรื่องปกติ
6. แจ้งเตือน LINE เงียบ → token หมดอายุ/ถูกเปลี่ยน ดู `LINE_CHANNEL_ACCESS_TOKEN` + log webhook

## 8. ธรรมเนียมการทำงานของโปรเจ็คนี้

- จบงานแต่ละรอบ เขียนสรุปเป็น `REPORT_<ชื่องาน>.md` ไว้ที่ root (ดูตัวอย่างเก่า ๆ ได้เลย) — เป็นบันทึกประวัติที่ช่วยคนถัดไปมาก
- ก่อน push: `npm test` (backend) + `npm run build` (frontend) ต้องผ่าน
- แตก branch จาก `master` ตั้งชื่อ `feat/...` หรือ `fix/...` แล้วเปิด PR (ดูประวัติ PR เก่าเป็นแนว)
- ใช้ AI coding agent ได้เต็มที่ (น้องใช้ Antigravity) — กติกาสำหรับ agent อยู่ใน `AGENTS.md` ซึ่ง Antigravity อ่านเองอัตโนมัติ

## 9. เช็กลิสต์วันส่งมอบ

- [ ] ได้สิทธิ์ครบตามตารางข้อ 2 และ**ทดลอง login/เข้าใช้จริงทุกระบบ**แล้ว
- [ ] Clone repo + รันระบบบนเครื่องตัวเองได้ (ตาม README) + เทสต์ผ่าน
- [ ] อ่าน `SECURITY_NOTE.md` + ยืนยันสถานะเช็กลิสต์ security กับ Worawit
- [ ] รู้ว่า production อยู่ไหน ดู log ยังไง deploy ยังไง
- [ ] ลอง deploy งานเล็ก ๆ 1 ชิ้น (เช่นแก้ข้อความ) จนจบ loop: branch → PR → merge → ตรวจบน production
- [ ] ได้เบอร์/ช่องทางติดต่อ Worawit และผู้ประสานงานฝั่งลูกค้าแต่ละสาขา
