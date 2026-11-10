// ลายเซ็นใบงานแบบเดิม (work_orders) รับเฉพาะรูปจาก SignaturePad (data:image/png|jpeg;base64)
// ทั้งสองทางที่เขียนตาราง signatures:
//   POST /api/sign/:token               — ลิงก์สาธารณะให้เจ้าของพื้นที่เซ็น (ไม่ login, ใช้ token)
//   POST /api/work-orders/:id/signatures — ช่าง/ผู้ตรวจ/ผู้อนุมัติเซ็นในแอป
// ค่านี้ไปอยู่ใน <img src> ของ PDF ที่ Chromium ฝั่งเซิร์ฟเวอร์ render — ถ้าเก็บ URL ไว้
// Chromium จะไปดึงให้ (SSRF). simple-wo ปิดไปแล้วใน PR #271; ไฟล์นี้ปิดฝั่ง work_orders.
// ยิงผ่าน express + router ตัวจริง (+ authMiddleware ตัวจริงสำหรับ /work-orders);
// DB เป็นตัวปลอมที่จดทุก query. Run: node test/legacyWoSign.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'legacy-wo-sign-test-secret';
const assert = require('assert');
const Module = require('module');
const express = require('express');
const jwt = require('jsonwebtoken');

// รูป PNG จริง 1×1 (รูปแบบเดียวกับที่ canvas.toDataURL('image/png') ให้)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const BAD = [
  'http://169.254.169.254/latest/meta-data/',
  'https://evil.example/pixel.png',
  'http://127.0.0.1:5432/',
  'file:///etc/passwd',
  '//evil.example/x.png',
  'javascript:alert(1)',
  'data:text/html;base64,PHNjcmlwdD4=',
  'data:image/svg+xml;base64,PHN2Zz4=',
  `${PNG}" onerror="alert(1)`,
  `data:image/png;base64,${'A'.repeat(400001)}`,   // เกินเพดาน 400000 ตัวอักษร
  42,
  { src: 'http://evil.example/' },
];
const show = (v) => (typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v));

// ── fake DB, swapped per request; every query is logged ─────────────────────────────
// tokenRow: what <branch>.sign_tokens holds for the link (null = no row). wo: the WO row.
let current;
function fakeDb({ tokenRow = { used_at: null, expires_at: new Date(Date.now() + 30 * 60000) }, wo = { id: 1, status: 'in_progress' } } = {}) {
  const log = [];
  const answer = async (sql, params = []) => {
    log.push({ sql, params });
    if (/FROM sign_tokens WHERE token_hash/.test(sql)) return { rows: tokenRow ? [tokenRow] : [] };
    if (/FROM work_orders WHERE id = \$1/.test(sql)) return { rows: wo ? [wo] : [] };
    if (/FROM work_orders w/.test(sql)) return { rows: wo ? [{ id: wo.id, order_no: 'WO-TEST-0001', type: 'major' }] : [] };
    if (/INSERT INTO signatures/.test(sql)) return { rows: [{ id: 5, work_order_id: params[0] }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  };
  const client = { query: answer, release() {} };
  return { log, answer, client };
}
const sigWrites = (log) => log.filter((q) => /INSERT INTO signatures/.test(q.sql));
const wrote = (log, v) => sigWrites(log).some((q) => q.params.includes(v));
const burned = (log) => log.some((q) => /UPDATE sign_tokens SET used_at/.test(q.sql));

// sign.js reads `{ pool, query, txClient }` from ../db at load time → stub that module
// before requiring it, with stable functions that delegate to the current fake.
function stub(relPath, exports) {
  const file = require.resolve(relPath);
  const m = new Module(file, module);
  m.filename = file; m.loaded = true; m.exports = exports;
  require.cache[file] = m;
}
stub('../src/db', {
  pool: { query: (sql, p) => current.answer(sql, p), connect: async () => current.client },
  query: (schema, sql, p) => current.answer(sql, p),
  txClient: async () => current.client,
});
// The public route has a real in-memory limiter (5/min per IP); this file sends ~30
// requests from 127.0.0.1, so it is replaced by a pass-through. It is not under test here.
stub('../src/middleware/rateLimit', () => (req, res, next) => next());

const signRouter = require('../src/routes/sign');
const woRouter = require('../src/routes/workOrders');

// ── app: real routers; the branch middleware replaced by the fake (as in simpleWoSign) ──
const app = express();
app.use(express.json({ limit: '8mb' }));          // same limit as src/app.js
app.use('/api/sign', signRouter);                 // PUBLIC — mounted before any branch middleware, as in app.js
app.use((req, res, next) => {
  req.branch = { slug: 'test-branch', name: 'สาขาทดสอบ' };
  req.db = (sql, p) => current.answer(sql, p);
  req.tx = async () => current.client;
  next();
});
app.use('/api/work-orders', woRouter);

// A sign link exactly as POST /api/work-orders/:id/sign-token mints it.
const signLink = (opts = {}) => jwt.sign(
  { work_order_id: 1, scope: 'area_owner_sign', branch: 'test_branch' },
  process.env.JWT_SECRET, { expiresIn: opts.expiresIn || '30m' });
const userToken = (role) => jwt.sign({ id: 7, role, name: 'ผู้ทดสอบ', branchSlug: 'test-branch' }, process.env.JWT_SECRET);

let base;
async function call(method, path, body, { role, db } = {}) {
  current = fakeDb(db);
  const headers = { 'Content-Type': 'application/json' };
  if (role) headers.Authorization = `Bearer ${userToken(role)}`;
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json, log: current.log };
}
const publicSign = (body, db, link = signLink()) => call('POST', `/api/sign/${link}`, body, { db });
const appSign = (role, body, db) => call('POST', '/api/work-orders/1/signatures', body, { role, db });

// Each test reports on its own (no abort on the first failure) so the revert run shows
// the fix tests red and the controls green as two separate signals.
const results = [];
async function t(kind, name, fn) {
  try { await fn(); results.push({ kind, name, ok: true }); console.log(`  ok - [${kind}] ${name}`); }
  catch (e) { results.push({ kind, name, ok: false }); console.log(`  FAIL - [${kind}] ${name}\n      ${e.message.split('\n')[0]}`); }
}

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    // ── fix: both write paths refuse a non-image signature ─────────────────────────
    await t('fix', 'POST /api/sign/:token refuses anything that is not a PNG/JPEG data URL', async () => {
      for (const bad of BAD) {
        const r = await publicSign({ signer_name: 'คุณสมศรี (หัวหน้าห้อง)', signature_data: bad });
        assert.strictEqual(r.status, 400, `accepted ${show(bad)} (status ${r.status})`);
        assert.ok(!sigWrites(r.log).length, `wrote ${show(bad)} to signatures`);
      }
    });

    await t('fix', 'POST /api/sign/:token with a bad signature leaves the link usable (token not burned)', async () => {
      const r = await publicSign({ signer_name: 'คุณสมศรี', signature_data: BAD[0] });
      assert.ok(!burned(r.log), 'the one-time link was used up by a rejected signature');
    });

    await t('fix', 'POST /api/work-orders/:id/signatures refuses anything that is not a PNG/JPEG data URL', async () => {
      for (const bad of BAD) {
        const r = await appSign('technician', { role: 'area_owner', signer_name: 'ช่าง', signature_data: bad });
        assert.strictEqual(r.status, 400, `accepted ${show(bad)} (status ${r.status})`);
        assert.ok(!sigWrites(r.log).length, `wrote ${show(bad)} to signatures`);
      }
    });

    await t('fix', '/work-orders/:id/signatures refuses a URL for every signer role', async () => {
      for (const [user, role] of [['checker', 'central_admin'], ['approver', 'approver'], ['approve_engineer', 'approver']]) {
        const r = await appSign(user, { role, signer_name: 'ผู้เซ็น', signature_data: BAD[0] });
        assert.strictEqual(r.status, 400, `${user}→${role} accepted a URL (status ${r.status})`);
        assert.ok(!sigWrites(r.log).length, `${user}→${role} wrote a URL`);
      }
    });

    // ── controls: what a real user does keeps working (green before AND after) ─────
    await t('control', 'public link: a real PNG (and JPEG) signs and uses up the link', async () => {
      for (const img of [PNG, JPEG]) {
        const r = await publicSign({ signer_name: 'คุณสมศรี (หัวหน้าห้อง)', signature_data: img });
        assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
        assert.ok(wrote(r.log, img), 'signature not written');
        assert.ok(burned(r.log), 'link not marked used');
      }
    });

    await t('control', 'public link: no name / no signature → 400, nothing written', async () => {
      for (const body of [{ signature_data: PNG }, { signer_name: '   ', signature_data: PNG }, { signer_name: 'คุณสมศรี' }]) {
        const r = await publicSign(body);
        assert.strictEqual(r.status, 400, `${JSON.stringify(body).slice(0, 60)} → ${r.status}`);
        assert.ok(!sigWrites(r.log).length);
      }
    });

    await t('control', 'public link: used / expired / unknown / forged link still refused with a real PNG', async () => {
      const used = await publicSign({ signer_name: 'ก', signature_data: PNG }, { tokenRow: { used_at: new Date(), expires_at: new Date(Date.now() + 60000) } });
      assert.strictEqual(used.status, 410, `used link → ${used.status}`);
      const gone = await publicSign({ signer_name: 'ก', signature_data: PNG }, { tokenRow: null });
      assert.strictEqual(gone.status, 404, `unknown link → ${gone.status}`);
      const expired = await publicSign({ signer_name: 'ก', signature_data: PNG }, undefined, signLink({ expiresIn: -10 }));
      assert.strictEqual(expired.status, 410, `expired JWT → ${expired.status}`);
      const forged = jwt.sign({ work_order_id: 1, scope: 'area_owner_sign', branch: 'test_branch' }, 'not-the-secret');
      const f = await publicSign({ signer_name: 'ก', signature_data: PNG }, undefined, forged);
      assert.strictEqual(f.status, 410, `forged link → ${f.status}`);
      for (const r of [used, gone, expired, f]) assert.ok(!sigWrites(r.log).length, 'wrote on a refused link');
    });

    await t('control', 'in-app: each signer role still saves a real PNG / JPEG', async () => {
      for (const [user, role, img] of [['technician', 'area_owner', PNG], ['checker', 'central_admin', JPEG], ['approver', 'approver', PNG]]) {
        const r = await appSign(user, { role, signer_name: 'ผู้เซ็น', signature_data: img });
        assert.strictEqual(r.status, 201, `${user}→${role} status ${r.status} ${JSON.stringify(r.body)}`);
        assert.ok(wrote(r.log, img), `${user}→${role} signature not written`);
      }
    });

    await t('control', 'in-app: existing guards unchanged (no login 401, wrong role 403, closed WO 409, missing 400)', async () => {
      const anon = await call('POST', '/api/work-orders/1/signatures', { role: 'area_owner', signature_data: PNG });
      assert.strictEqual(anon.status, 401, `no login → ${anon.status}`);
      const wrongRole = await appSign('technician', { role: 'approver', signature_data: PNG });
      assert.strictEqual(wrongRole.status, 403, `technician→approver → ${wrongRole.status}`);
      const closed = await appSign('technician', { role: 'area_owner', signature_data: PNG }, { wo: { id: 1, status: 'approved' } });
      assert.strictEqual(closed.status, 409, `approved WO → ${closed.status}`);
      const missing = await appSign('technician', { role: 'area_owner' });
      assert.strictEqual(missing.status, 400, `no signature_data → ${missing.status}`);
      for (const r of [anon, wrongRole, closed, missing]) assert.ok(!sigWrites(r.log).length, 'wrote on a refused request');
    });
  } finally {
    server.close();
  }

  const fail = results.filter((r) => !r.ok);
  const by = (k) => results.filter((r) => r.kind === k);
  console.log(`\n# fix: ${by('fix').filter((r) => r.ok).length}/${by('fix').length} · control: ${by('control').filter((r) => r.ok).length}/${by('control').length}`);
  if (fail.length) { console.log(`# FAILED ${fail.length}`); process.exit(1); }
  console.log(`# all ${results.length} passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
