# Air System — ระบบจัดการงานล้าง/ซ่อมแอร์ (Technical Water Co., Ltd)

ระบบบริหารงานล้างแอร์–พัดลม และงานซ่อมแอร์ แบบหลายสาขา (multi-branch, schema-per-tenant)
ใช้งานจริงบนโดเมน `tw-carework.online` (สาขาเข้าใช้งานผ่าน subdomain เช่น `<branch>.tw-carework.online`)

## สแต็ก

| ส่วน | เทคโนโลยี |
|------|-----------|
| Backend | Node.js (CommonJS) · Express 5 · PostgreSQL (`pg`) · JWT · Puppeteer-core (PDF) |
| Frontend | React 18 · Vite · Tailwind CSS · Zustand · React Router 6 · Recharts |
| Deploy | Coolify (nixpacks / Dockerfile) อยู่หลัง Traefik reverse proxy |
| แจ้งเตือน | LINE Messaging API (webhook + daily digest) |

## โครงสร้าง repo

```
air-system/
├── backend/
│   ├── src/
│   │   ├── app.js            # entry — mount routes, CORS allowlist, boot migration
│   │   ├── routes/           # REST API (auth, work-orders, simple-wo, ac-repair, wash-*, line, ...)
│   │   ├── services/         # business logic (woStateMachine, reportBuilder, pdfRenderer, notify, ...)
│   │   ├── middleware/       # auth (JWT), resolveBranch (X-Branch/subdomain → schema), rateLimit
│   │   ├── db/               # schema.sql / public_schema.sql / branch_schema.sql + migrate_* + seed
│   │   └── jobs/             # lineDailyDigest (scheduler เริ่มตอน boot)
│   └── test/                 # node test scripts (ไม่ใช้ framework)
├── frontend/
│   └── src/
│       ├── api/client.js     # axios instance — แนบ JWT + header X-Branch อัตโนมัติ
│       ├── pages/            # หน้าจอทั้งหมด (Dashboard, WorkOrder*, SimpleWo*, Wash*, AcRepair, ...)
│       ├── store/            # zustand (auth, tenant)
│       └── lib/              # utils + offline support
├── REPORT_*.md               # รายงานสรุปงานแต่ละรอบ/เฟส (ธรรมเนียมของโปรเจ็คนี้)
├── SECURITY_NOTE.md          # บันทึกเหตุ secrets หลุดเข้า git + เช็กลิสต์แก้ไข — อ่านก่อนทำงาน
├── HANDOVER.md               # เอกสารส่งมอบงานสำหรับผู้ดูแลคนใหม่
└── AGENTS.md                 # กติกาสำหรับ AI coding agent (Antigravity / Claude Code ฯลฯ)
```

## สถาปัตยกรรมที่ต้องรู้ก่อนแก้โค้ด

- **Schema-per-tenant**: แต่ละสาขา (branch) มี Postgres schema ของตัวเอง ข้อมูลกลาง (users, branches, LINE config) อยู่ schema `public`
  - Frontend ส่ง header `X-Branch: <slug>` (หรือเข้าผ่าน subdomain) → middleware `resolveBranch` ตั้ง `req.branch` / `req.schema` / `req.db`
  - Route ที่เป็นข้อมูลรายสาขา **ต้อง** ครอบด้วย `requireBranch` ไม่งั้นข้อมูลจะหล่นลง schema `public` (เป็น audit finding M-1 ที่เคยแก้มาแล้ว)
  - JWT ของ user รายสาขาผูก `branchSlug` — ใช้ข้ามสาขาไม่ได้
- **Migration ตอน boot**: `app.js` รัน `migratePublic()` + `migrateBranchSchemas()` ทุกครั้งที่ start (idempotent, `CREATE TABLE IF NOT EXISTS`) — `schema.sql` คือ source of truth ถ้า migration ล้มที่ `public` ขั้นต่อ ๆ ไปจะถูกข้ามทั้งหมด ดู log ให้ดี
- **ใบงาน 2 แบบ**: `/work-orders` = flow อนุมัติ 2 ด่าน (state machine ใน `woStateMachine.js`) · `/simple-wo` = ฟอร์มกรอกจบในขั้นเดียว — แยก path กันเด็ดขาด
- **หน้าเซ็นสาธารณะ**: `/api/sign` ไม่ใช้ login (guard ด้วย token ใน URL) ใช้ให้เจ้าของพื้นที่เซ็นผ่าน QR
- **PDF**: render ด้วย puppeteer-core — production ต้องตั้ง `PUPPETEER_EXECUTABLE_PATH` ชี้ Chrome/Chromium ในเครื่อง

## รันบนเครื่อง (development)

ต้องมี Node.js 18+ และ PostgreSQL (ใช้ docker ก็ได้: `docker run -e POSTGRES_PASSWORD=yourpassword -p 5432:5432 postgres:16`)

```bash
# 1. Backend
cd backend
cp .env.example .env        # แล้วแก้ค่า DB_* และ JWT_SECRET
npm install
npm run migrate             # สร้าง schema (idempotent)
node src/db/seed.js         # seed roles + user ทดสอบ + template (ครั้งแรกครั้งเดียว)
npm run dev                 # nodemon → http://localhost:3001

# 2. Frontend (terminal ใหม่)
cd frontend
npm install
npm run dev                 # vite → http://localhost:5173 (proxy /api → :3001)
```

User ทดสอบจาก seed: `superadmin` / `admin` / `approver` / `tech1` / `tech2` (รหัสผ่านดูใน `backend/src/db/seed.js`)

## เทสต์

```bash
cd backend  && npm test     # schema / woStateMachine / simpleReport / roles / provisionSql / templateItems
cd frontend && npm test     # signStage
cd frontend && npm run build  # ตรวจ build ก่อน push เสมอ
```

## Environment variables (backend)

| ตัวแปร | ความหมาย |
|--------|----------|
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASS` | การเชื่อมต่อ PostgreSQL |
| `JWT_SECRET` | secret สำหรับเซ็น JWT — เปลี่ยนแล้วทุกคนต้อง login ใหม่ |
| `PORT` | พอร์ต API (default 3001) |
| `CORS_ORIGINS` | origin เพิ่มเติม (comma-separated) นอกเหนือ `*.tw-carework.online` / localhost |
| `FRONTEND_URL` | base URL ของ frontend — ใช้สร้างลิงก์ QR เซ็นงาน |
| `UPLOAD_DIR` | โฟลเดอร์เก็บรูปอัปโหลด (production ต้องเป็น persistent volume) |
| `LINE_CHANNEL_ACCESS_TOKEN` | token ของ LINE Official Account |
| `PUPPETEER_EXECUTABLE_PATH` | path ไป Chrome/Chromium สำหรับ render PDF |
| `FAN_DEFAULT_SITE_NAME` | site เริ่มต้นตอน import พัดลม |
| `ALLOW_DESTRUCTIVE_MIGRATE` | ต้องตั้งเองถึงจะรัน migration ที่ลบข้อมูลได้ — ปกติอย่าตั้ง |
| `AIR_WEBHOOK_SECRET` `REPAIR_API_URL` `REPAIR_SERVICE_KEY` | legacy — การเชื่อม repair-system ถูกถอดแล้ว (ส.ค. 2026) คงไว้เผื่ออ้างอิง |

Frontend มีตัวเดียว: `VITE_BACKEND_URL` (ว่าง = same-origin `/api`)

**ห้าม commit ไฟล์ `.env` หรือค่า secret ใด ๆ ลง git** — เคยหลุดมาแล้ว ดูรายละเอียดใน `SECURITY_NOTE.md`

## Deploy

- Push ขึ้น `master` → Coolify build + deploy อัตโนมัติ (backend + frontend แยก service)
- Migration รันเองตอน boot — deploy โค้ดอย่างเดียวพอ ยกเว้นงานที่ REPORT ระบุว่าต้องรันสคริปต์เพิ่ม
- เพิ่มสาขาใหม่: `npm run add-branch` (ดู `backend/src/db/add_branch.js`) + ตั้ง subdomain ใน Coolify/DNS
- ดูสถานะ: `GET /api/health` และ log ใน Coolify

## เอกสารเพิ่มเติม

- `HANDOVER.md` — ภาพรวมระบบ สิทธิ์ที่ต้องมี งานค้าง และจุดที่พังง่าย สำหรับผู้ดูแลคนใหม่
- `REPORT_phase0.md` … `REPORT_phase6.md` — ประวัติการพัฒนารายเฟส
- `REPORT_audit.md` / `REPORT_audit_fixes.md` — ผล security audit และการแก้
- `SECURITY_NOTE.md` — เหตุการณ์ secrets หลุด + เช็กลิสต์ที่ต้องทำให้ครบ
