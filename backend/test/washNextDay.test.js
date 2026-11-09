// เป้าหมายล้างวันถัดไป: รายการเครื่องที่ยังไม่ล้าง (wash-units/not-washed) + ตั้งเป้าหลายเครื่อง
// (wash-schedule/bulk). Run: node test/washNextDay.test.js
const assert = require('assert');
const units = require('../src/routes/washUnits');
const sched = require('../src/routes/washSchedule');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log(`  ok - ${name}`); };
const nw = units._notWashedQuery;
const bulk = sched._checkBulk;

// ── not-washed ──────────────────────────────────────────────────────────────
t('helpers are exported for tests', () => {
  assert.strictEqual(typeof nw, 'function');
  assert.strictEqual(typeof bulk, 'function');
});

t('work_type and month are validated', () => {
  assert.ok(nw({ month: '2026-11', work_type: 'drop' }).error);
  for (const m of ['', '2026-1', '2026/11', "2026-11' OR 1=1"]) assert.ok(nw({ month: m }).error, m);
  assert.ok(!nw({ month: '2026-11' }).error, 'work_type defaults to major');
});

t('fan wash looks at fan units; major/minor at AC units', () => {
  assert.strictEqual(nw({ month: '2026-11', work_type: 'fan' }).params[0], 'fan');
  assert.strictEqual(nw({ month: '2026-11', work_type: 'minor' }).params[0], 'ac');
  assert.strictEqual(nw({ month: '2026-11', work_type: 'major' }).params[0], 'ac');
});

t('washed = same work type, rejected orders excluded, legacy NULL type counts as major', () => {
  const { sql } = nw({ month: '2026-11', work_type: 'major' });
  assert.ok(sql.includes("s.status <> 'rejected'"));
  assert.ok(sql.includes("COALESCE(s.work_type, 'major') = $2::text"));
  assert.ok(sql.includes("g->>'machine_no'"), 'grid machine numbers count (minor/fan rows)');
});

t('filters become placeholders — values never enter the SQL text', () => {
  const evil = "x' OR '1'='1";
  const q = nw({ month: '2026-11', work_type: 'minor', zone: 'PTS1', location: evil, ac_type: 'FCU' });
  assert.ok(!q.sql.includes(evil) && !q.sql.includes('PTS1') && !q.sql.includes('FCU'));
  assert.deepStrictEqual(q.params, ['ac', 'minor', '2026-11', 'PTS1', evil, 'FCU']);
  assert.ok(q.sql.includes('u.pts_zone = $4::text') && q.sql.includes('u.location = $5::text') && q.sql.includes('u.ac_type = $6::text'));
});

// ── bulk ────────────────────────────────────────────────────────────────────
const ok = { planned_date: '2026-11-10', work_type: 'major', asset_codes: ['FCU-01', 'AHU-02'] };

t('valid request is normalised (trim, de-duplicate, drop blanks)', () => {
  const v = bulk({ ...ok, asset_codes: [' FCU-01 ', 'FCU-01', '', null, 'AHU-02'], note: 'ล้างก่อนเปิดคลินิก' });
  assert.deepStrictEqual(v, { date: '2026-11-10', wt: 'major', codes: ['FCU-01', 'AHU-02'], note: 'ล้างก่อนเปิดคลินิก' });
});

t('bad date / type / list are refused', () => {
  for (const d of ['', '10/11/2026', '2026-11-10; DROP', null]) assert.ok(bulk({ ...ok, planned_date: d }).error, String(d));
  assert.ok(bulk({ ...ok, work_type: 'deep' }).error);
  assert.ok(bulk({ ...ok, asset_codes: 'FCU-01' }).error);
  assert.ok(bulk({ ...ok, asset_codes: [] }).error);
  assert.ok(bulk({ ...ok, asset_codes: ['', '  '] }).error);
});

t('at most 200 machines per request; codes at most 60 chars', () => {
  const many = Array.from({ length: 201 }, (_, i) => `U-${i}`);
  assert.ok(bulk({ ...ok, asset_codes: many }).error);
  assert.ok(!bulk({ ...ok, asset_codes: many.slice(0, 200) }).error);
  assert.ok(bulk({ ...ok, asset_codes: ['X'.repeat(61)] }).error);
});

console.log(`\n${passed} passed`);
