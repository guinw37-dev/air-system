# AGENTS.md — กติกาสำหรับ AI coding agent (Antigravity, Claude Code ฯลฯ)

โปรเจ็คนี้คือระบบจัดการงานล้าง/ซ่อมแอร์แบบหลายสาขา ใช้งาน production จริง
ภาพรวม/วิธีรันอยู่ใน `README.md` · บริบทส่งมอบงานอยู่ใน `HANDOVER.md`

## สแต็กและคำสั่ง

- Backend: `backend/` — Node.js **CommonJS**, Express **5**, PostgreSQL (`pg` ตรง ๆ ไม่มี ORM)
- Frontend: `frontend/` — React 18 + Vite (**ESM**), Tailwind, Zustand, React Router 6

```bash
cd backend  && npm run dev      # dev server :3001
cd backend  && npm test         # เทสต์ backend — ต้องผ่านก่อน commit
cd frontend && npm run dev      # vite :5173 (proxy /api → :3001)
cd frontend && npm test         # เทสต์ frontend
cd frontend && npm run build    # ต้องผ่านก่อน commit ถ้าแตะ frontend
```

## กฎเหล็ก (ห้ามละเมิด)

1. **ห้าม commit secret ทุกชนิด** — `.env`, รหัสผ่าน, token, connection string ที่มีค่าจริง แม้ในไฟล์ตัวอย่าง/เทสต์/REPORT ก็ห้าม (โปรเจ็คนี้เคยมี secret หลุดเข้า git มาแล้ว — ดู `SECURITY_NOTE.md`) ไฟล์ตัวอย่างใช้ `.env.example` ใส่ชื่อ key อย่างเดียว
2. **Route ข้อมูลรายสาขาต้องครอบ `requireBranch`** (ดู pattern ใน `backend/src/app.js`) — ไม่งั้นข้อมูลจะเขียนลง schema `public` แบบเงียบ ๆ ซึ่งเป็นบั๊กข้อมูลหายที่เคยเกิดจริง
3. **Migration ต้อง idempotent และ additive** (`CREATE TABLE/COLUMN IF NOT EXISTS`) — migration รันอัตโนมัติตอน boot ทุก deploy กับทุก branch schema · ห้ามเขียน migration ที่ DROP/ลบข้อมูล ยกเว้นอยู่หลัง guard `ALLOW_DESTRUCTIVE_MIGRATE` · อัปเดต `schema.sql`/`public_schema.sql`/`branch_schema.sql` ให้ตรงด้วยเสมอ (เป็น source of truth)
4. **อย่าลดการ์ด security ที่มีอยู่**: CORS allowlist (ห้าม reflect ทุก origin), body limit 8mb (ห้ามขยายมั่ว), JWT ผ่าน query string ยอมรับเฉพาะ GET, rate limit — ของพวกนี้มาจาก security audit (`REPORT_audit*.md`) ถ้าจะแก้ต้องมีเหตุผลและบันทึกไว้
5. **SQL ใช้ parameterized query เสมอ** (`$1, $2, ...`) — ชื่อ schema ที่ interpolate ต้องมาจาก `resolveBranch` เท่านั้น ห้ามรับจาก user input ตรง ๆ

## ข้อควรระวัง

- **Express 5**: ระวัง API ที่ต่างจาก v4 (เช่น wildcard route, error handling ของ async) — ดู pattern จาก route เดิมก่อนเขียนใหม่
- **ใบงาน 2 ระบบแยกกัน**: `/work-orders` (state machine อนุมัติ 2 ด่าน — `services/woStateMachine.js`) กับ `/simple-wo` (ขั้นเดียว) · แก้ฝั่งหนึ่งอย่าให้กระทบอีกฝั่ง
- **Endpoint สาธารณะ** (`/api/sign`, `/api/line`, `/api/resolve-host`) ไม่มี auth middleware — แก้อะไรแถวนี้ให้คิดเรื่อง security ก่อน
- **การเชื่อม repair-system ถูกถอดแล้ว** (ส.ค. 2026) — อย่า revive โค้ด/env `REPAIR_*`, `AIR_WEBHOOK_SECRET`
- PDF ใช้ puppeteer-core — โค้ด PDF ต้องมี fallback เมื่อไม่มี Chrome (ดู pattern เดิมใน `services/pdfRenderer.js`)
- UI และข้อความในระบบเป็น **ภาษาไทย** — เขียนข้อความใหม่เป็นไทยให้สอดคล้องของเดิม · วันที่แสดงผลเป็น พ.ศ.

## ธรรมเนียมของโปรเจ็ค

- แตก branch จาก `master` ชื่อ `feat/...` หรือ `fix/...` → เปิด PR (ดูสไตล์ commit message จาก `git log`)
- จบงานหนึ่งรอบ ให้เขียนสรุปเป็น `REPORT_<ชื่องาน>.md` ที่ root เป็นภาษาไทย: ไฟล์ที่แก้, endpoint/ฟีเจอร์ใหม่, migration (ถ้ามี), วิธีทดสอบ, สิ่งที่เลื่อนไป — ดูไฟล์ `REPORT_*.md` เดิมเป็นตัวอย่าง
- ก่อนบอกว่างานเสร็จ: backend `npm test` ผ่าน + ถ้าแตะ frontend `npm run build` ผ่าน + `node --check` ไฟล์ที่แก้
- comment ในโค้ดเดิมมีทั้งไทย/อังกฤษ และมักอธิบาย "ทำไม" (อ้าง audit item, เหตุการณ์ที่เคยเกิด) — รักษาสไตล์นี้ อย่าลบ comment เหตุผลเดิมทิ้ง
