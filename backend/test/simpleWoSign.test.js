// ลายเซ็นใบงาน (simple-wo): รับเฉพาะรูปจาก SignaturePad (data:image/png|jpeg;base64)
// ทุกทางที่เขียนลายเซ็น — /:id/sign, /batch-sign, สร้างใบ (POST /), แก้ใบ (PUT /:id) —
// และ PDF ไม่ใส่ <img src> ที่ไม่ใช่รูป เพราะ Chromium ฝั่งเซิร์ฟเวอร์จะไปดึง URL นั้น (SSRF).
// ยิงผ่าน express + authMiddleware + router ตัวจริง (DB เป็นตัวปลอมที่จดทุก query).
// Run: node test/simpleWoSign.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'simple-wo-sign-test-secret';
const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');
const router = require('../src/routes/simpleWorkOrders');
const { buildSimpleReportHtml } = require('../src/services/reportTemplates');

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

// ── fake branch DB: answers just enough for the sign/create/edit SQL, logs everything ──
function fakeBranch(cur = {}) {
  const log = [];
  const rowFor = (id) => ({
    id, status: 'submitted', created_by: 7,
    sig_team: null, sig_supervisor: null, sig_building: null, sig_engineer: null, sig_department: null,
    ...cur,
  });
  const answer = async (sql, params = []) => {
    log.push({ sql, params });
    if (/SELECT position FROM users/.test(sql)) return { rows: [{ position: 'ช่างแอร์' }] };
    if (/FROM simple_work_orders WHERE id = ANY/.test(sql)) return { rows: params[0].map(rowFor) };
    if (/FROM simple_work_orders WHERE id = \$1/.test(sql)) return { rows: [rowFor(Number(params[0]))] };
    if (/MAX\(CAST/.test(sql)) return { rows: [{ maxn: 0 }] };
    if (/INSERT INTO simple_work_orders/.test(sql)) return { rows: [{ id: 99, wo_number: 'WO-TEST-0001' }] };
    if (/UPDATE simple_work_orders/.test(sql)) return { rows: [{ id: 1 }], rowCount: 1 };
    return { rows: [] };
  };
  return { log, db: answer, tx: async () => ({ query: answer, release() {} }) };
}
const isWrite = (q) => /(UPDATE|INSERT INTO)\s+simple_work_orders/.test(q.sql);
const wroteAny = (log) => log.some(isWrite);
const wrote = (log, v) => log.some((q) => isWrite(q) && q.params.includes(v));

// ── app: real router + real authMiddleware, the branch middleware replaced by the fake ──
let current = fakeBranch();
const app = express();
app.use(express.json({ limit: '8mb' }));          // same limit as src/app.js
app.use((req, res, next) => {
  req.branch = { slug: 'test-branch', name: 'สาขาทดสอบ' };
  req.db = current.db;
  req.tx = current.tx;
  next();
});
app.use('/api/simple-wo', router);

const token = (role) => jwt.sign({ id: 7, role, name: 'ช่างทดสอบ', branchSlug: 'test-branch' }, process.env.JWT_SECRET);
let base;
async function call(role, method, path, body, cur) {
  current = fakeBranch(cur);
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token(role)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json, log: current.log };
}

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
    // ── fix: every write path refuses a non-image signature ────────────────────────
    await t('fix', 'POST /:id/sign refuses anything that is not a PNG/JPEG data URL', async () => {
      for (const bad of BAD) {
        const r = await call('technician', 'POST', '/api/simple-wo/1/sign', { signature_data: bad });
        assert.strictEqual(r.status, 400, `accepted ${show(bad)} (status ${r.status})`);
        assert.ok(!wroteAny(r.log), `wrote ${show(bad)} to the DB`);
      }
    });

    await t('fix', 'POST /batch-sign refuses anything that is not a PNG/JPEG data URL', async () => {
      for (const bad of BAD) {
        const r = await call('technician', 'POST', '/api/simple-wo/batch-sign', { ids: [1, 2], signature_data: bad });
        assert.strictEqual(r.status, 400, `accepted ${show(bad)} (status ${r.status})`);
        assert.ok(!wroteAny(r.log), `wrote ${show(bad)} to the DB`);
      }
    });

    await t('fix', 'external slot (department) on /sign and /batch-sign also refuses a URL', async () => {
      const one = await call('technician', 'POST', '/api/simple-wo/1/sign',
        { slot: 'department', signature_data: BAD[0], signer_name: 'พว.สมศรี' },
        { sig_team: PNG, sig_supervisor: PNG, sig_building: PNG });
      assert.strictEqual(one.status, 400, `/sign department accepted a URL (status ${one.status})`);
      const many = await call('technician', 'POST', '/api/simple-wo/batch-sign',
        { ids: [1], slot: 'department', signature_data: BAD[0], signer_name: 'พว.สมศรี' },
        { sig_team: PNG, sig_supervisor: PNG, sig_building: PNG });
      assert.strictEqual(many.status, 400, `/batch-sign department accepted a URL (status ${many.status})`);
      assert.ok(!wroteAny(one.log) && !wroteAny(many.log), 'wrote a URL to the DB');
    });

    await t('fix', 'POST / (create) refuses a non-image signature in the signer\'s own slot', async () => {
      for (const bad of BAD) {
        const r = await call('technician', 'POST', '/api/simple-wo', { work_type: 'major', sig_team: bad, sig_team_name: 'ช่าง' });
        assert.strictEqual(r.status, 400, `accepted ${show(bad)} (status ${r.status})`);
        assert.ok(!wroteAny(r.log), `inserted ${show(bad)}`);
      }
    });

    await t('fix', 'PUT /:id (edit) refuses a NEW non-image signature in the signer\'s own slot', async () => {
      for (const bad of BAD) {
        const r = await call('technician', 'PUT', '/api/simple-wo/1', { work_type: 'major', sig_team: bad, sig_team_name: 'ช่าง' });
        assert.strictEqual(r.status, 400, `accepted ${show(bad)} (status ${r.status})`);
        assert.ok(!wroteAny(r.log), `updated with ${show(bad)}`);
      }
    });

    await t('fix', 'PDF: a stored non-image signature never reaches <img src>', async () => {
      const sigs = {};
      for (const s of ['team', 'supervisor', 'building', 'engineer', 'department']) {
        sigs[s] = { signer_name: `ผู้เซ็น ${s}`, signature_data: 'http://169.254.169.254/latest/meta-data/' };
      }
      for (const wt of ['major', 'minor']) {
        const html = buildSimpleReportHtml(pdfData(wt, sigs));
        assert.ok(!html.includes('169.254.169.254'), `${wt}: URL rendered into the PDF HTML`);
        assert.ok(html.includes('ผู้เซ็น team'), `${wt}: signer name must still print`);
      }
    });

    // ── controls: what a real user does keeps working (green before AND after) ─────
    await t('control', '/:id/sign with a real PNG (and JPEG) still signs', async () => {
      for (const img of [PNG, JPEG]) {
        const r = await call('technician', 'POST', '/api/simple-wo/1/sign', { signature_data: img });
        assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
        assert.ok(wrote(r.log, img), 'signature not written');
      }
    });

    await t('control', '/batch-sign with a real PNG still signs every ready row', async () => {
      const r = await call('technician', 'POST', '/api/simple-wo/batch-sign', { ids: [1, 2], signature_data: PNG });
      assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.body.signed, 2);
      assert.ok(wrote(r.log, PNG), 'signature not written');
    });

    await t('control', 'create with a real PNG in the own slot still saves it', async () => {
      const r = await call('technician', 'POST', '/api/simple-wo', { work_type: 'major', sig_team: PNG, sig_team_name: 'ช่าง' });
      assert.strictEqual(r.status, 201, `status ${r.status} ${JSON.stringify(r.body)}`);
      assert.ok(wrote(r.log, PNG), 'signature not inserted');
    });

    await t('control', 'edit with a new real PNG in the own slot still saves it', async () => {
      const r = await call('technician', 'PUT', '/api/simple-wo/1', { work_type: 'major', sig_team: PNG, sig_team_name: 'ช่าง' });
      assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
      assert.ok(wrote(r.log, PNG), 'signature not updated');
    });

    await t('control', 'edit that posts every slot back unchanged (as the form does) still saves', async () => {
      // The form re-posts all five slots exactly as loaded. A stored value is not re-judged,
      // so an old row can always be edited; other roles' slots are ignored as before.
      const legacy = 'legacy-stored-value';
      const cur = { sig_team: legacy, sig_supervisor: PNG, sig_building: legacy };
      const body = { work_type: 'major', sig_team: legacy, sig_team_name: 'ช่าง',
        sig_supervisor: PNG, sig_building: legacy, sig_engineer: 'http://ignored.example/', sig_department: '' };
      const r = await call('technician', 'PUT', '/api/simple-wo/1', body, cur);
      assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
      assert.ok(!wrote(r.log, 'http://ignored.example/'), 'another role\'s slot was written');
    });

    await t('control', 'PDF: a real PNG signature still renders as <img>', async () => {
      const sigs = { team: { signer_name: 'ช่าง', signature_data: PNG }, supervisor: {}, building: {}, engineer: {}, department: {} };
      for (const wt of ['major', 'minor']) {
        const html = buildSimpleReportHtml(pdfData(wt, sigs));
        assert.ok(html.includes(`<img src="${PNG}"`), `${wt}: PNG signature missing from the PDF HTML`);
      }
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

function pdfData(wt, sigs) {
  return {
    wo: { order_no: 'WO-T', client_name: 'รพ.ทดสอบ', tech_name: 'ช่าง', work_date: '2026-06-01', work_type: wt },
    unit: { building_name: 'A', floor_name: '2', equipment_type: 'ล้าง', inspections: [], photos: { before: [], after: [] } },
    sigs, ac: {}, brand: {}, qr: '', imageBase: '',
    gridRows: wt === 'minor' ? [{ room: 'R', machine_no: 'M', checks: [true] }] : [],
    recommendation: '', require_department_sign: true,
  };
}
