// ลายเซ็นที่เซ็นในฟอร์มใบงาน (simple-wo) ตอนสร้าง (POST /) และแก้ (PUT /:id):
//  • ฟอร์มให้เซ็นต่อกันได้ในหน้าเดียว (เช่น หัวหน้าช่างเซ็นช่องช่างแอร์แล้วเซ็นช่องตัวเอง)
//    → ลำดับการเซ็นต้องนับลายเซ็นที่มากับ body เดียวกันด้วย ไม่ใช่ทิ้งช่องที่ 2 เงียบ ๆ
//  • ช่องที่ยังไม่ถึงคิวจริง ๆ ต้องตอบ error ให้ผู้ใช้เห็น — ห้ามบันทึกโดยทิ้งลายเซ็น
//  • ชื่อผู้ลงนามที่ว่าง เติมชื่อผู้ใช้ (เหมือน /:id/sign และหน้าใบงาน) ยกเว้นช่องคนนอก
// ยิงผ่าน express + authMiddleware + router ตัวจริง. DB เป็นตัวปลอมที่จด SQL และ
// แยกค่าตามชื่อคอลัมน์จาก INSERT (cols) VALUES ($n) / UPDATE SET col=$n ของ query จริง.
// Run: node test/simpleWoFormSigs.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'simple-wo-form-sigs-test-secret';
const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');
const router = require('../src/routes/simpleWorkOrders');

// ภาพลายเซ็นจริงคนละภาพ (PNG/JPEG 1×1) — ใช้แยกว่าช่องไหนได้ภาพไหน
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const ME = 'สมชาย ใจดี';   // ชื่อใน token ของผู้ใช้ที่ล็อกอิน

// ── fake branch DB ──────────────────────────────────────────────────────────────
function fakeBranch(cur = {}) {
  const log = [];
  const row = {
    created_by: 7, status: 'submitted',
    sig_team: null, sig_team_name: null, sig_supervisor: null, sig_supervisor_name: null,
    sig_building: null, sig_building_name: null, sig_engineer: null, sig_engineer_name: null,
    sig_department: null, sig_department_name: null,
    ...cur,
  };
  const answer = async (sql, params = []) => {
    log.push({ sql, params });
    if (/SELECT position FROM users/.test(sql)) return { rows: [{ position: 'ตำแหน่งทดสอบ' }] };
    if (/FROM simple_work_orders WHERE id = \$1/.test(sql)) return { rows: [{ id: Number(params[0]), ...row }] };
    if (/MAX\(CAST/.test(sql)) return { rows: [{ maxn: 0 }] };
    if (/INSERT INTO simple_work_orders/.test(sql)) return { rows: [{ id: 99, wo_number: 'WO-TEST-0001' }] };
    if (/UPDATE simple_work_orders/.test(sql)) return { rows: [{ id: 1, wo_number: 'WO-TEST-0001' }], rowCount: 1 };
    return { rows: [] };
  };
  return { log, db: answer, tx: async () => ({ query: answer, release() {} }) };
}

// Column → value of the write that reached the DB, read off the SQL the route sent.
function written(log) {
  const q = log.find((x) => /^\s*(INSERT INTO|UPDATE)\s+simple_work_orders\b/i.test(x.sql) && !/wash_/.test(x.sql));
  if (!q) return null;
  const sql = q.sql.replace(/\s+/g, ' ');
  const pick = (tok) => { const m = /^\$(\d+)$/.exec(tok.trim()); return m ? q.params[Number(m[1]) - 1] : tok.trim(); };
  const out = {};
  let m;
  if ((m = /INSERT INTO simple_work_orders \(([^)]+)\) VALUES \(([^)]+)\)/i.exec(sql))) {
    const cols = m[1].split(',').map((c) => c.trim());
    const vals = m[2].split(',');
    cols.forEach((c, i) => { out[c] = pick(vals[i]); });
  } else if ((m = /UPDATE simple_work_orders SET (.+?) WHERE/i.exec(sql))) {
    for (const part of m[1].split(',')) {
      const [c, v] = part.split('=');
      if (c && v) out[c.trim()] = pick(v);
    }
  }
  return out;
}

// ── app: real router + real authMiddleware ──────────────────────────────────────
let current = fakeBranch();
const app = express();
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => {
  req.branch = { slug: 'test-branch', name: 'สาขาทดสอบ', require_department_sign: true };
  req.db = current.db;
  req.tx = current.tx;
  next();
});
app.use('/api/simple-wo', router);
const token = (role) => jwt.sign({ id: 7, role, name: ME, branchSlug: 'test-branch' }, process.env.JWT_SECRET);
let base;
async function call(role, method, path, body, cur) {
  current = fakeBranch(cur);
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token(role)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json, row: written(current.log) };
}

// What SimpleWoForm.jsx submit() posts for the five slots: every slot, '' when empty.
function form(sigs = {}) {
  const b = { work_type: 'major', result: 'ok' };
  for (const s of ['team', 'supervisor', 'building', 'engineer', 'department']) {
    b[`sig_${s}`] = (sigs[s] && sigs[s].data) || '';
    b[`sig_${s}_name`] = (sigs[s] && sigs[s].name) || '';
  }
  b.sig_department_position = (sigs.department && sigs.department.position) || '';
  return b;
}

const results = [];
async function t(kind, name, fn) {
  try { await fn(); results.push({ kind, ok: true }); console.log(`  ok - [${kind}] ${name}`); }
  catch (e) { results.push({ kind, ok: false }); console.log(`  FAIL - [${kind}] ${name}\n      ${e.message.split('\n')[0]}`); }
}

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    // ── fix: signatures signed one after another in the same form are all kept ─────
    await t('fix', 'create: หัวหน้าช่าง signs ช่างแอร์ + หัวหน้าช่าง in the form → both saved', async () => {
      const r = await call('checker', 'POST', '/api/simple-wo',
        form({ team: { data: PNG, name: 'ช่างเอ' }, supervisor: { data: JPEG, name: 'หัวหน้าบี' } }));
      assert.strictEqual(r.status, 201, `status ${r.status} ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.row.sig_team, PNG, 'ช่างแอร์ signature lost');
      assert.strictEqual(r.row.sig_supervisor, JPEG, 'หัวหน้าช่าง signature dropped silently');
      assert.strictEqual(r.row.sig_supervisor_name, 'หัวหน้าบี');
    });

    await t('fix', 'create: หัวหน้าช่าง signs ช่างแอร์ + หัวหน้า + เจ้าของพื้นที่ → all three saved', async () => {
      const r = await call('checker', 'POST', '/api/simple-wo', form({
        team: { data: PNG, name: 'ช่างเอ' }, supervisor: { data: JPEG, name: 'หัวหน้าบี' },
        department: { data: PNG2, name: 'พว.สมศรี', position: 'หัวหน้าห้อง LR' } }));
      assert.strictEqual(r.status, 201, `status ${r.status} ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.row.sig_supervisor, JPEG, 'หัวหน้าช่าง signature dropped');
      assert.strictEqual(r.row.sig_department, PNG2, 'เจ้าของพื้นที่ signature dropped');
      assert.strictEqual(r.row.sig_department_name, 'พว.สมศรี');
      assert.strictEqual(r.row.sig_department_position, 'หัวหน้าห้อง LR');
    });

    await t('fix', 'edit: the creator (หัวหน้าช่าง) adds ช่างแอร์ + หัวหน้า on an unsigned ใบงาน → both saved', async () => {
      const r = await call('checker', 'PUT', '/api/simple-wo/1',
        form({ team: { data: PNG, name: 'ช่างเอ' }, supervisor: { data: JPEG, name: 'หัวหน้าบี' } }));
      assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.row.sig_team, PNG);
      assert.strictEqual(r.row.sig_supervisor, JPEG, 'หัวหน้าช่าง signature dropped silently');
    });

    await t('fix', 'create: a slot that is still not in turn is refused with a message, never saved without it', async () => {
      // ช่างแอร์เซ็นเจ้าของพื้นที่ แต่หัวหน้าช่างยังไม่เซ็น (ช่างแอร์เซ็นแทนหัวหน้าไม่ได้)
      const r = await call('technician', 'POST', '/api/simple-wo', form({
        team: { data: PNG, name: 'ช่างเอ' }, department: { data: PNG2, name: 'พว.สมศรี' } }));
      assert.strictEqual(r.status, 409, `expected 409, got ${r.status} — ใบงานถูกบันทึกโดยทิ้งลายเซ็น?`);
      assert.ok(/หัวหน้าช่างแอร์/.test(r.body && r.body.error), `message must name the slot it waits for: ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.row, null, 'wrote the ใบงาน anyway');
    });

    await t('fix', 'edit: a slot not in turn is refused too (409), nothing written', async () => {
      const r = await call('technician', 'PUT', '/api/simple-wo/1', form({
        team: { data: PNG, name: 'ช่างเอ' }, department: { data: PNG2, name: 'พว.สมศรี' } }),
        { sig_team: PNG, sig_team_name: 'ช่างเอ' });
      assert.strictEqual(r.status, 409, `expected 409, got ${r.status}`);
      assert.strictEqual(r.row, null, 'wrote the ใบงาน anyway');
    });

    await t('fix', 'a blank ชื่อผู้ลงนาม on the signer\'s own slot is filled with the user\'s name (like /:id/sign)', async () => {
      const r = await call('technician', 'POST', '/api/simple-wo', form({ team: { data: PNG, name: '' } }));
      assert.strictEqual(r.status, 201, `status ${r.status} ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.row.sig_team_name, ME, `name stored as ${JSON.stringify(r.row.sig_team_name)}`);
      const e = await call('checker', 'PUT', '/api/simple-wo/1',
        form({ team: { data: PNG, name: 'ช่างเอ' }, supervisor: { data: JPEG, name: '' } }));
      assert.strictEqual(e.status, 200, `status ${e.status}`);
      assert.strictEqual(e.row.sig_supervisor_name, ME, `name stored as ${JSON.stringify(e.row.sig_supervisor_name)}`);
    });

    // ── controls: green before AND after ──────────────────────────────────────────
    await t('control', 'create: ช่างแอร์ signs own slot with a typed name → saved as typed', async () => {
      const r = await call('technician', 'POST', '/api/simple-wo', form({ team: { data: PNG, name: 'ช่างเอ' } }));
      assert.strictEqual(r.status, 201, `status ${r.status}`);
      assert.strictEqual(r.row.sig_team, PNG);
      assert.strictEqual(r.row.sig_team_name, 'ช่างเอ');
      assert.strictEqual(r.row.sig_team_position, 'ตำแหน่งทดสอบ');
    });

    await t('control', 'another role\'s slot in the body is ignored, not written and not an error', async () => {
      const r = await call('technician', 'POST', '/api/simple-wo', form({
        team: { data: PNG, name: 'ช่างเอ' }, supervisor: { data: JPEG, name: 'ปลอม' }, engineer: { data: PNG2, name: 'ปลอม' } }));
      assert.strictEqual(r.status, 201, `status ${r.status}`);
      assert.strictEqual(r.row.sig_supervisor, null, 'forged หัวหน้าช่าง signature written');
      assert.strictEqual(r.row.sig_engineer, null, 'forged วิศวกรรม signature written');
    });

    await t('control', 'a forged หัวหน้าช่าง in the body does not unlock เจ้าของพื้นที่ for ช่างแอร์', async () => {
      const r = await call('technician', 'POST', '/api/simple-wo', form({
        team: { data: PNG, name: 'ช่างเอ' }, supervisor: { data: JPEG, name: 'ปลอม' },
        department: { data: PNG2, name: 'พว.สมศรี' } }));
      assert.notStrictEqual(r.row && r.row.sig_department, PNG2, 'เจ้าของพื้นที่ signed past an unsigned หัวหน้าช่าง');
      assert.notStrictEqual(r.row && r.row.sig_supervisor, JPEG, 'forged หัวหน้าช่าง signature written');
    });

    await t('control', 'edit: posting every slot back unchanged (as the form does) still saves', async () => {
      const cur = { sig_team: PNG, sig_team_name: 'ช่างเอ', sig_supervisor: JPEG, sig_supervisor_name: 'หัวหน้าบี' };
      const r = await call('technician', 'PUT', '/api/simple-wo/1',
        form({ team: { data: PNG, name: 'ช่างเอ' }, supervisor: { data: JPEG, name: 'หัวหน้าบี' } }), cur);
      assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.row.sig_team, PNG);
      assert.strictEqual(r.row.sig_supervisor, JPEG);
      assert.strictEqual(r.row.sig_supervisor_name, 'หัวหน้าบี');
    });

    await t('control', 'edit: เจ้าของพื้นที่ after ช่างแอร์ + หัวหน้า signed earlier → saved with the typed name', async () => {
      const cur = { sig_team: PNG, sig_team_name: 'ช่างเอ', sig_supervisor: JPEG, sig_supervisor_name: 'หัวหน้าบี' };
      const r = await call('technician', 'PUT', '/api/simple-wo/1', form({
        team: { data: PNG, name: 'ช่างเอ' }, supervisor: { data: JPEG, name: 'หัวหน้าบี' },
        department: { data: PNG2, name: 'พว.สมศรี', position: 'หัวหน้าห้อง LR' } }), cur);
      assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.row.sig_department, PNG2);
      assert.strictEqual(r.row.sig_department_name, 'พว.สมศรี');
    });

    await t('control', 'เจ้าของพื้นที่ (outside signer) never gets the operator\'s name', async () => {
      const cur = { sig_team: PNG, sig_team_name: 'ช่างเอ', sig_supervisor: JPEG, sig_supervisor_name: 'หัวหน้าบี' };
      const r = await call('technician', 'PUT', '/api/simple-wo/1', form({
        team: { data: PNG, name: 'ช่างเอ' }, supervisor: { data: JPEG, name: 'หัวหน้าบี' },
        department: { data: PNG2, name: '' } }), cur);
      assert.notStrictEqual(r.row && r.row.sig_department_name, ME, 'operator name written under the hospital staff signature');
    });

    await t('control', 'create with no signatures at all still saves (nothing signed)', async () => {
      const r = await call('technician', 'POST', '/api/simple-wo', form({}));
      assert.strictEqual(r.status, 201, `status ${r.status}`);
      assert.strictEqual(r.row.sig_team, null);
      assert.strictEqual(r.row.sig_team_name, null);
    });

    await t('control', 'admin edit (cannot sign) leaves every stored signature as it was', async () => {
      const cur = { sig_team: PNG, sig_team_name: 'ช่างเอ' };
      const r = await call('admin', 'PUT', '/api/simple-wo/1',
        form({ team: { data: JPEG, name: 'แอดมิน' }, supervisor: { data: JPEG, name: 'แอดมิน' } }), cur);
      assert.strictEqual(r.status, 200, `status ${r.status}`);
      assert.strictEqual(r.row.sig_team, PNG);
      assert.strictEqual(r.row.sig_team_name, 'ช่างเอ');
      assert.strictEqual(r.row.sig_supervisor, null);
    });
  } finally {
    server.close();
  }

  const by = (k) => results.filter((r) => r.kind === k);
  console.log(`\n# fix: ${by('fix').filter((r) => r.ok).length}/${by('fix').length} · control: ${by('control').filter((r) => r.ok).length}/${by('control').length}`);
  const fail = results.filter((r) => !r.ok);
  if (fail.length) { console.log(`# FAILED ${fail.length}`); process.exit(1); }
  console.log(`# all ${results.length} passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
