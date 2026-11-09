// ใบแจ้งซ่อมแอร์: สถานะ "รอเสนอราคาซ่อม" + ลายเซ็นออนไลน์ผู้แจ้ง/ช่าง + PDF
// Run: node test/acRepair.test.js
const assert = require('assert');
const router = require('../src/routes/acRepairJobs');
const { buildAcRepairReportHtml } = require('../src/services/reportTemplates');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log(`  ok - ${name}`); };
const TX = router._TRANSITIONS;
const check = router._checkAcSign;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ── state machine ────────────────────────────────────────────────────────────
t('wait_quote exists and moves open jobs to Wait Quote', () => {
  assert.ok(TX && TX.wait_quote, 'wait_quote transition missing');
  assert.strictEqual(TX.wait_quote.to, 'Wait Quote');
  assert.deepStrictEqual([...TX.wait_quote.from].sort(), ['Assign', 'Register', 'Wait Parts', 'Work On']);
});

t('from Wait Quote the job can resume, wait for parts, close or cancel', () => {
  for (const a of ['start', 'wait_parts', 'clear', 'cancel']) {
    assert.ok(TX[a].from.includes('Wait Quote'), `${a} must accept Wait Quote`);
  }
});

t('every transition that existed before still works from the same states', () => {
  const OLD = {
    start:      { from: ['Register', 'Assign', 'Wait Parts'],            to: 'Work On'    },
    wait_parts: { from: ['Register', 'Assign', 'Work On'],               to: 'Wait Parts' },
    clear:      { from: ['Register', 'Assign', 'Work On', 'Wait Parts'], to: 'Clear'      },
    cancel:     { from: ['Register', 'Assign', 'Work On', 'Wait Parts'], to: 'Cancel'     },
  };
  for (const [a, o] of Object.entries(OLD)) {
    assert.strictEqual(TX[a].to, o.to);
    for (const s of o.from) assert.ok(TX[a].from.includes(s), `${a} lost ${s}`);
  }
});

t('closed jobs stay closed (no transition out of Clear/Close/Cancel)', () => {
  for (const [a, tr] of Object.entries(TX)) {
    for (const s of ['Clear', 'Close', 'Cancel']) assert.ok(!tr.from.includes(s), `${a} from ${s}`);
  }
});

// ── signature validation ─────────────────────────────────────────────────────
t('only the two slots exist', () => {
  assert.strictEqual(check({ slot: 'engineer', signature_data: PNG }, 'technician').status, 400);
  assert.strictEqual(check({ signature_data: PNG }, 'technician').status, 400);
});

t('signature must be an inline PNG/JPEG image — no URL the PDF renderer would fetch', () => {
  for (const bad of ['http://169.254.169.254/latest/meta-data', 'file:///etc/passwd',
    'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=',
    `${PNG}" onerror="x`, '', null, 42]) {
    const r = check({ slot: 'tech', signature_data: bad }, 'technician');
    assert.strictEqual(r.status, 400, `accepted ${String(bad).slice(0, 30)}`);
  }
  const huge = `data:image/png;base64,${'A'.repeat(400001)}`;
  assert.strictEqual(check({ slot: 'tech', signature_data: huge }, 'technician').status, 400);
});

t('requester (hospital staff, no account) must have a typed name', () => {
  assert.strictEqual(check({ slot: 'requester', signature_data: PNG }, 'technician').status, 400);
  assert.strictEqual(check({ slot: 'requester', signature_data: PNG, signer_name: '   ' }, 'technician').status, 400);
  assert.strictEqual(check({ slot: 'requester', signature_data: PNG, signer_name: 'x'.repeat(151) }, 'technician').status, 400);
  const ok = check({ slot: 'requester', signature_data: PNG, signer_name: '  ธีรภัทร  ', signer_position: 'พยาบาล' }, 'technician');
  assert.deepStrictEqual(ok, { slot: 'requester', signature: PNG, name: 'ธีรภัทร', position: 'พยาบาล' });
});

t('any role on the page may witness the requester; only technician/checker sign the tech slot', () => {
  for (const role of ['technician', 'checker', 'approve_building', 'approve_engineer', 'admin', 'super_admin']) {
    assert.ok(!check({ slot: 'requester', signature_data: PNG, signer_name: 'ก' }, role).error, role);
  }
  assert.ok(!check({ slot: 'tech', signature_data: PNG }, 'technician').error);
  assert.ok(!check({ slot: 'tech', signature_data: PNG }, 'checker').error);
  for (const role of ['admin', 'super_admin', 'approve_building', 'approve_engineer', undefined]) {
    assert.strictEqual(check({ slot: 'tech', signature_data: PNG }, role).status, 403, String(role));
  }
});

t('tech slot ignores a name sent in the body (name comes from the account)', () => {
  const r = check({ slot: 'tech', signature_data: PNG, signer_name: 'คนอื่น' }, 'technician');
  assert.deepStrictEqual(r, { slot: 'tech', signature: PNG });
});

t('list rows carry signed flags, not the signature images', () => {
  const row = router._listRow({ id: 1, status: 'Clear', sig_requester: PNG, sig_tech: null, sig_requester_name: 'ก' });
  assert.ok(!('sig_requester' in row) && !('sig_tech' in row));
  assert.strictEqual(row.requester_signed, true);
  assert.strictEqual(row.tech_signed, false);
  assert.strictEqual(row.sig_requester_name, 'ก');
});

// ── PDF ──────────────────────────────────────────────────────────────────────
const base = { job_number: 'AC-2569-11-0001', status: 'Work On', requester: 'ธีรภัทร', assign_name: 'ชนาธิป',
  description: 'แอร์น้ำหยด', register_time: '2026-11-09T03:00:00Z' };
const signsOf = (html) => html.slice(html.indexOf('<div class="signs">'), html.indexOf('</div>\n  <script') > 0
  ? html.indexOf('</div>\n  <script') : html.indexOf('</body>'));

t('unsigned job prints the same blank sign lines as before', () => {
  const html = buildAcRepairReportHtml(base, { name: 'สาขา' });
  const OLD = `<div><div class="dots"></div><div class="nm">( ธีรภัทร )</div><div class="rl">ผู้แจ้งซ่อม / รับมอบงาน</div></div>`
    + `<div><div class="dots"></div><div class="nm">( ชนาธิป )</div><div class="rl">เจ้าหน้าที่ผู้ปฏิบัติงาน</div></div>`;
  assert.ok(signsOf(html).replace(/\s+/g, '').includes(OLD.replace(/\s+/g, '')), 'sign block changed for unsigned jobs');
  assert.ok(!html.includes('class="sgw"'));
});

t('signed job prints both signature images with the typed requester name/position', () => {
  const html = buildAcRepairReportHtml({ ...base, sig_requester: PNG, sig_requester_name: 'สมศรี ใจดี',
    sig_requester_position: 'หัวหน้าพยาบาล', sig_requester_at: '2026-11-09T05:00:00Z',
    sig_tech: PNG, sig_tech_name: 'ช่างทดสอบ 1', sig_tech_at: '2026-11-09T05:01:00Z' }, { name: 'สาขา' });
  const s = signsOf(html);
  assert.strictEqual((s.match(/<img src="data:image\/png;base64,/g) || []).length, 2);
  assert.ok(s.includes('( สมศรี ใจดี )') && s.includes('หัวหน้าพยาบาล') && s.includes('( ช่างทดสอบ 1 )'));
  assert.ok(!s.includes('( ธีรภัทร )'), 'typed signer name replaces the requester field');
});

t('a non-image value in the signature column never reaches <img src>', () => {
  const html = buildAcRepairReportHtml({ ...base, sig_requester: 'http://169.254.169.254/x', sig_requester_name: 'x',
    sig_tech: `${PNG}" onerror="alert(1)` }, { name: 'สาขา' });
  assert.ok(!html.includes('169.254.169.254'));
  assert.ok(!html.includes('onerror'));
  assert.ok(!signsOf(html).includes('<img'));
});

t('Wait Quote shows its Thai label and timeline row (with the note)', () => {
  const html = buildAcRepairReportHtml({ ...base, status: 'Wait Quote', wait_quote_time: '2026-11-09T04:00:00Z',
    wait_quote_note: 'เสนอราคาเปลี่ยนถาดน้ำทิ้ง' }, { name: 'สาขา' });
  assert.ok(html.includes('รอเสนอราคาซ่อม'));
  assert.ok(html.includes('เสนอราคาเปลี่ยนถาดน้ำทิ้ง'));
});

console.log(`\n${passed} passed`);
