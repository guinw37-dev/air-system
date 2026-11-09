// รายการใบงาน: ตัวกรองวันที่ของงานล้าง (wdate_*) + นิยามยอดล้างกลาง (utils/washCount)
// Run: node test/simpleWoList.test.js
const assert = require('assert');
const router = require('../src/routes/simpleWorkOrders');
const { UNITS_EXPR, DONE_EXPR, washDateExpr } = require('../src/utils/washCount');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log(`  ok - ${name}`); };
const build = router._buildListFilter;

t('list filter is exported for tests', () => {
  assert.strictEqual(typeof build, 'function');
});

t('no wash-date params → only the soft-delete guard', () => {
  const f = build({});
  assert.deepStrictEqual(f.where, ['s.deleted_at IS NULL']);
  assert.deepStrictEqual(f.params, []);
  assert.strictEqual(f.next, 1);
});

t('wdate_from/to filter on work_date fallback created_at (same as the calendar)', () => {
  const f = build({ wdate_from: '2026-09-17', wdate_to: '2026-09-17' });
  assert.ok(f.where.includes('COALESCE(s.work_date, s.created_at::date) >= $1::date'));
  assert.ok(f.where.includes('COALESCE(s.work_date, s.created_at::date) <= $2::date'));
  assert.deepStrictEqual(f.params, ['2026-09-17', '2026-09-17']);
  assert.strictEqual(f.next, 3);
});

t('values never reach SQL text — only placeholders', () => {
  const f = build({ wdate_from: '2026-01-01', created_by: '7' });
  assert.ok(!f.where.join(' ').includes('2026-01-01'));
  assert.deepStrictEqual(f.params, ['7', '2026-01-01']);
});

t('malformed wash dates are rejected (400) before any SQL is built', () => {
  for (const bad of ["2026-01-01' OR 1=1 --", '2026/01/01', '20260101', 'x', '2026-1-1']) {
    assert.ok(build({ wdate_from: bad }).error, `wdate_from=${bad}`);
    assert.ok(build({ wdate_to: bad }).error, `wdate_to=${bad}`);
  }
});

t('legacy params (date_from/date_to/created_by) keep their old SQL', () => {
  const f = build({ date_from: '2026-09-01', date_to: '2026-09-30', created_by: '3' });
  assert.deepStrictEqual(f.where, ['s.deleted_at IS NULL', 's.created_at >= $1',
    's.created_at < ($2::date + 1)', 's.created_by = $3']);
});

// The calendar (dashboard.js) and the list must count machines the same way. Guard the
// shared definition against drift: this is the exact expression dashboard.js used inline.
const norm = (s) => s.replace(/\s+/g, ' ').trim();
t('DONE_EXPR is byte-equivalent to the old inline dashboard definition', () => {
  assert.strictEqual(norm(DONE_EXPR), norm(`SUM(CASE WHEN work_type IN ('minor','fan')
    THEN GREATEST(jsonb_array_length(COALESCE(grid_rows,'[]'::jsonb)), 1) ELSE 1 END)::int`));
  assert.strictEqual(norm(DONE_EXPR), norm(`SUM(${UNITS_EXPR})::int`));
});

t('washDateExpr aliases both columns (users also has created_at)', () => {
  assert.strictEqual(washDateExpr('s'), 'COALESCE(s.work_date, s.created_at::date)');
  assert.strictEqual(washDateExpr(), 'COALESCE(work_date, created_at::date)');
});

console.log(`\n${passed} passed`);
