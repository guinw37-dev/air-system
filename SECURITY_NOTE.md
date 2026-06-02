# SECURITY_NOTE — เฟส S: แก้ความลับหลุดใน git

วันที่: 2 มิ.ย. 2026 · branch: `fix/security-secrets-untrack`

## สรุปปัญหา
ความลับถูก commit เข้า git แล้ว → **ต้องถือว่ารั่วทั้งหมด** แม้ลบตอนนี้ก็ยังอยู่ใน history
- `backend/.env` ถูก track (มี key `DB_PASS`, `JWT_SECRET` — ค่าใน HEAD เป็น placeholder แต่ไม่ควร track)
- `backend/src/db/import_excel.py` ฝัง DB password + remote host/IP/port จริงในซอร์ส (track)
- `import_pts_excel.py` (root) ฝัง DB password จริง (ไม่ track แต่อยู่บนเครื่อง)

> รหัสผ่าน DB ตัวเดียวกันถูกใช้ในทั้ง 2 สคริปต์ → ถือว่ารหัสนี้หลุดแน่นอน

## สิ่งที่แก้แล้วใน commit นี้ (ฝั่งโค้ด/repo)
1. **Untrack** `backend/.env` ด้วย `git rm --cached` (ไฟล์ยังอยู่บนเครื่อง ไม่ถูกลบ)
2. แก้ `.gitignore` (root) + เพิ่ม `backend/.gitignore` ให้ครอบ `.env`, `*.env` และยกเว้น `*.env.example`
3. รีแฟกเตอร์ `backend/src/db/import_excel.py` + `import_pts_excel.py` → อ่าน DB config/secret + EXCEL_PATH จาก **environment variable** (`os.environ`, รองรับ `.env` ผ่าน python-dotenv ถ้ามี). **ลบ password/host/IP จริงออกจากซอร์สทั้งหมด** + exit พร้อมข้อความถ้า `DB_PASS`/`EXCEL_PATH` ไม่ถูกตั้ง
4. เพิ่ม `.env.example` (root) สำหรับสคริปต์ import — ใส่ชื่อ key อย่างเดียว ไม่มีค่าจริง

## ⚠️ สิ่งที่ Worawit ต้องทำเอง (Claude Code ทำแทนไม่ได้ / ไม่ได้รับอนุญาต)
เช็กลิสต์ — ทำให้ครบ เพราะค่าเก่าถือว่าหลุดแล้ว:

- [ ] **เปลี่ยน DB password บนเซิร์ฟเวอร์** (รหัสที่อยู่ในสคริปต์ Python หลุดแน่นอน) — ทั้ง DB user ที่ใช้กับ remote host เดิม
- [ ] **สร้าง `JWT_SECRET` ใหม่** แล้วอัปเดตใน Coolify env ของ air-system (token เก่าจะใช้ไม่ได้ = ทุกคน login ใหม่ — คาดไว้)
- [ ] อัปเดตค่า DB ใหม่ใน Coolify env + ในไฟล์ `.env` บนเครื่อง local (ไม่ commit)
- [ ] **ล้าง git history** (ถ้าต้องการให้ค่าเก่าหายจริง ไม่ใช่แค่ untrack): ใช้ `git filter-repo` หรือ BFG ลบ `backend/.env` + ค่าใน `import_excel.py` ออกจากทุก commit แล้ว **force-push**
  - งานนี้เขียน history ใหม่ + กระทบ clone ทุกตัว → **Claude Code ไม่ทำให้ ต้อง Worawit ตัดสินใจ/ลงมือเอง**
- [ ] ตรวจว่า remote host/IP เดิมยังเปิดให้เข้าถึงจากภายนอกไหม — ถ้าใช่ จำกัด firewall/allowlist

## หมายเหตุ
- ยังไม่ได้รวมสคริปต์ import 2 ตัวให้เหลือตัวเดียว (task item 5) — **เลื่อนไปเฟส 0** เพราะเฟส 0 จะ rewrite schema (`units` แทน `ac_units`) + เขียน seed ใหม่ทั้งหมด การ merge ตอนนี้จะถูกทิ้งทันที. เฟสนี้ทำให้ทั้งสองชี้ env เดียวกันแล้ว (ไม่มี DB hardcode ต่างกันอีก)
- commit นี้ **ไม่มีค่า secret จริง** — มีแต่การ untrack + แก้โค้ดให้อ่าน env
