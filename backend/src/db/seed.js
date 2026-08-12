require('dotenv').config();
const pool = require('./pool');
const bcrypt = require('bcryptjs');
const { CHECKLIST_ITEMS } = require('../config/measurements');

// Seed baseline data for the NEW schema (clients → sites → … → units).
// Does NOT import equipment from Excel — that lives in import.js / a dedicated
// import step (blocked on ac-data-clean.xlsx). This only sets up the data the
// app needs to boot: users (1 per role), clients PTS1/PTS2, a main site each,
// and the inspection_template_items derived from config/measurements.js.

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Users (5-role model) ───────────────────────────────
    // Apex/public.users — Super Dev is the owner; the rest are demo accounts in
    // the valid role set. Legacy roles (central_admin/supervisor/building) retired.
    const passwordHash = await bcrypt.hash('admin1234', 10);
    await client.query(`
      INSERT INTO users (name, username, password_hash, role, phone)
      VALUES
        ('Super Dev',       'superadmin',$1, 'super_admin', ''),
        ('Administrator',   'admin',   $1, 'admin',       ''),
        ('Checker Admin',   'checker', $1, 'checker',     ''),
        ('Approver',        'approver',$1, 'approver',    ''),
        ('ช่างทดสอบ 1',     'tech1',     $1, 'technician',  ''),
        ('ช่างทดสอบ 2',     'tech2',     $1, 'technician',  '')
      ON CONFLICT (username) DO NOTHING
    `, [passwordHash]);

    // ── Clients + main site ────────────────────────────────
    const clients = [
      { code: 'PTS1', name: 'โรงพยาบาลพญาไท ศรีราชา 1' },
      { code: 'PTS2', name: 'โรงพยาบาลพญาไท ศรีราชา 2' },
    ];
    for (const c of clients) {
      const { rows } = await client.query(`
        INSERT INTO clients (code, name)
        VALUES ($1, $2)
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `, [c.code, c.name]);
      const clientId = rows[0].id;
      // main site per client (รพ.หลัก) — fan import default target (see .env.example)
      await client.query(`
        INSERT INTO sites (client_id, code, name)
        VALUES ($1, $2, $3)
        ON CONFLICT (client_id, name) DO NOTHING
      `, [clientId, `${c.code}-MAIN`, c.name]);
    }

    // ── Inspection template (TW Engineering form — EXACT order/categories) ──
    // Clean reseed of the AC template: drop old AC items (and any inspection
    // values referencing them) then insert the 27 TW items. Safe on a fresh DB;
    // re-runnable. (categories changed from Thai names → all3/refrigerant/fcu/ahu/other)
    await client.query(`DELETE FROM inspection_values WHERE template_item_id IN
      (SELECT id FROM inspection_template_items WHERE equipment_type='ac')`);
    await client.query(`DELETE FROM inspection_template_items WHERE equipment_type='ac'`);

    const TW = [
      // หมวด 1: ใช้งานทั้ง 3 ประเภท (all3) — major + minor
      { cat: 'all3', sort: 10, label: 'ตรวจสอบแรงดันไฟฟ้า และกระแสไฟฟ้าของมอเตอร์คอยล์เย็น(แอร์น้ำ) หรือมอเตอร์คอยล์ร้อน(แอร์น้ำยา)', type: 'rst_amp', minor: true },
      // baseline = ฟอร์มเดิมที่ทุกสาขาใช้. ชุด 08-11-2569 ของศรีราชา (ขนาดช่องจ่ายลม /
      // Return / ชื่อแถวแบบช่องจ่ายลม) เติมโดย migratePublic ตอน boot ในรูปแบบ
      // only_branches + branch override — seed จึงต้องไม่สร้างให้ทุกสาขา
      { cat: 'all3', sort: 20, label: 'ตรวจสอบความเร็วลมด้านหน้า Filter = (Ft/m)', type: 'number', unit: 'Ft/m', minor: true },
      { cat: 'all3', sort: 21, label: 'ตรวจวัดฝุ่น PM2.5 (µg/m³)', type: 'number', unit: 'µg/m³', minor: true },
      { cat: 'all3', sort: 22, label: 'ตรวจวัดก๊าซ CO₂ (ppm)', type: 'number', unit: 'ppm', minor: true },
      { cat: 'all3', sort: 23, label: 'ตรวจวัดระดับเสียง (dB)', type: 'number', unit: 'dB', minor: true },
      // แถวอุณหภูมิแยกของตัวเอง — คืนช่องกรอกที่หายไปตอนแถวคอยล์ร้อนเปลี่ยนเป็น check
      { cat: 'all3', sort: 24, label: 'ตรวจวัดอุณหภูมิ (°C)', type: 'number', unit: '°C', minor: true },
      // ลูกค้า 08-07: แถวนี้ไม่แบ่งก่อน-หลัง → check (เดิม number °C จากแถวตรวจวัดอุณหภูมิ)
      { cat: 'all3', sort: 30, label: 'ตรวจเช็คคอยล์ร้อน คอยล์เย็น และฉีดล้างทำความสะอาดรังผึ้งที่คอยล์ร้อน คอยล์เย็น', type: 'check', minor: true },
      { cat: 'all3', sort: 40, label: 'ฉีดล้างทำความสะอาด Fan coil โดยใช้สารเคมีทิ้งไว้ 15 นาที และใช้ Water High Pressure Jet ฉีดล้างทำความสะอาด', type: 'check', minor: true },
      { cat: 'all3', sort: 50, label: 'ตรวจสอบเสียง และการสั่นสะเทือนที่ผิดปกติของอุปกรณ์', type: 'check', minor: true },
      { cat: 'all3', sort: 60, label: 'ตรวจสอบ และทำความสะอาด Filter', type: 'check', minor: true },
      // หมวด 2: แอร์น้ำยา (refrigerant) — major only
      { cat: 'refrigerant', sort: 110, label: 'ตรวจสอบแรงดันของสารทำความเย็น (R32/R410/R22)', type: 'pressure_pair' },
      // Compressor ln_vi row removed — duplicate of the Blower แรงดัน/กระแส row above (all3 #10).
      { cat: 'refrigerant', sort: 130, label: 'ตรวจสอบการทำงานของรีโมท', type: 'check' },
      { cat: 'refrigerant', sort: 140, label: 'ตรวจสอบความหนาแน่นของสายไฟฟ้า และสายชุดควบคุม', type: 'check' },
      { cat: 'refrigerant', sort: 150, label: 'ตรวจสอบ และทำความสะอาดคอยล์เย็นด้วยสารเคมี (Cooling Coil)', type: 'check' },
      { cat: 'refrigerant', sort: 160, label: 'ตรวจสอบ และทำความสะอาดพัดลมคอยล์เย็น', type: 'check' },
      { cat: 'refrigerant', sort: 170, label: 'ตรวจสอบ และทำความสะอาดชุดระบายความร้อนด้วยสารเคมี', type: 'check' },
      // หมวด 3: FCU (fcu) — major
      { cat: 'fcu', sort: 210, label: 'ตรวจสอบการทำงานของ Room Thermostart', type: 'check' },
      { cat: 'fcu', sort: 220, label: 'ตรวจสอบ และทำความสะอาดถาด Drain และการอุดตันของท่อ Drain', type: 'check' },
      { cat: 'fcu', sort: 230, label: 'ตรวจสอบ และทำความสะอาด Blower แล้วทดลองใช้มือหมุนเพื่อฟังเสียงผิดปกติ', type: 'check' },
      { cat: 'fcu', sort: 240, label: 'ตรวจสอบการสึกหรอของโครงสร้าง, Mounting, Support, Bracket และทาสี ถ้าจำเป็น', type: 'check' },
      { cat: 'fcu', sort: 250, label: 'ตรวจสอบฉนวนหุ้มท่อให้อยู่ในสภาพพร้อมใช้งาน', type: 'check' },
      { cat: 'fcu', sort: 260, label: 'ตรวจสอบ และทำความสะอาด เก็บขยะ บริเวณบนฝ้า', type: 'check' },
      { cat: 'fcu', sort: 270, label: 'ตรวจสอบและทำความสะอาด Stainer และตรวจสอบวาล์วน้ำเย็นปิดสนิทหรือไม่', type: 'check' },
      // หมวด 4: AHU (ahu) — major
      { cat: 'ahu', sort: 305, label: 'ตรวจสอบ Pilot lamp, Selector Switch และอุปกรณ์ภายในตู้ Starter', type: 'check' },
      { cat: 'ahu', sort: 310, label: 'ตรวจสอบปรับตั้ง Pulley และสายพาน', type: 'check' },
      { cat: 'ahu', sort: 320, label: 'เติมจาระบีลูกปืนมอเตอร์ และลูกปืน Blower', type: 'check' },
      { cat: 'ahu', sort: 330, label: 'ตรวจสอบน้ำรั่วซึมตาม Fan Coil', type: 'check' },
      { cat: 'ahu', sort: 340, label: 'ตรวจสอบ และทำความสะอาดห้องเครื่อง AHU', type: 'check' },
      // หมวด 5: อื่น ๆ (other) — major, free text
      { cat: 'other', sort: 410, label: '(ช่องว่างบันทึกเพิ่มเติม 1)', type: 'text' },
      { cat: 'other', sort: 420, label: '(ช่องว่างบันทึกเพิ่มเติม 2)', type: 'text' },
    ];
    for (const it of TW) {
      await client.query(`
        INSERT INTO inspection_template_items
          (equipment_type, category, item_label, value_type, unit_label, applies_major, applies_minor, sort_order)
        VALUES ('ac', $1, $2, $3, $4, true, $5, $6)
      `, [it.cat, it.label, it.type, it.unit || null, it.minor === true, it.sort]);
    }

    // Fan checklist (kept from config — TW form is AC-only)
    for (const item of CHECKLIST_ITEMS.fan || []) {
      await client.query(`
        INSERT INTO inspection_template_items
          (equipment_type, category, item_label, value_type, applies_major, applies_minor, sort_order)
        VALUES ('fan', 'fan', $1, 'check', false, false, $2)
        ON CONFLICT (equipment_type, category, item_label) DO NOTHING
      `, [item.label, 10]);
    }

    // ── Photo point templates ──────────────────────────────
    const PHOTO_POINTS = [
      // AC ล้างใหญ่ — 7 จุด (ถ่ายคู่ ก่อน+หลัง = 14 รูป)
      ['ac', 'major', 1, 'ป้ายเครื่อง + ภาพรวมจุดติดตั้ง'],
      ['ac', 'major', 2, 'หน้ากาก/ตะแกรงลม'],
      ['ac', 'major', 3, 'แผ่นกรอง Filter'],
      ['ac', 'major', 4, 'คอยล์เย็น (Cooling Coil)'],
      ['ac', 'major', 5, 'ใบพัด/โพรงลม Blower'],
      ['ac', 'major', 6, 'ถาดรองน้ำทิ้ง + ท่อ Drain'],
      ['ac', 'major', 7, 'จุดวัดค่า (มิเตอร์/เกจ)'],
      // AC ล้างย่อย — 4 จุด
      ['ac', 'minor', 1, 'ภาพรวมเครื่อง'],
      ['ac', 'minor', 2, 'หน้ากาก/ตะแกรงลม'],
      ['ac', 'minor', 3, 'แผ่นกรอง Filter'],
      ['ac', 'minor', 4, 'หัวจ่าย/ช่องรีเทิร์น'],
      // พัดลม — 3 จุด
      ['fan', 'fan', 1, 'หน้ากาก/ตะแกรง'],
      ['fan', 'fan', 2, 'ใบพัด/มอเตอร์'],
      ['fan', 'fan', 3, 'ภาพรวมหลังประกอบ'],
    ];
    for (const [eq, wt, no, label] of PHOTO_POINTS) {
      await client.query(`
        INSERT INTO photo_point_templates (equipment_type, work_type, point_no, label, required)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (equipment_type, work_type, point_no) DO UPDATE SET label = EXCLUDED.label
      `, [eq, wt, no, label]);
    }

    await client.query('COMMIT');
    const tpl = await client.query(`SELECT category, COUNT(*)::int n FROM inspection_template_items WHERE equipment_type='ac' GROUP BY category ORDER BY MIN(sort_order)`);
    const pp = await client.query(`SELECT equipment_type, work_type, COUNT(*)::int n FROM photo_point_templates GROUP BY 1,2 ORDER BY 1,2`);
    console.log('Seed success');
    console.log('Users: superadmin / admin / checker / approver / tech1 / tech2  (password: admin1234)');
    console.log('Clients: PTS1, PTS2 (+ main site each)');
    console.log('AC template by category:', tpl.rows.map(r => `${r.category}=${r.n}`).join(', '));
    console.log('Photo points:', pp.rows.map(r => `${r.equipment_type}/${r.work_type}=${r.n}`).join(', '));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
