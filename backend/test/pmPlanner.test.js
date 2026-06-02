// Runnable tests for PM scheduling logic (no DB). Run: node test/pmPlanner.test.js
const assert = require('assert');
const dayjs = require('dayjs');
const { buildUnitEvents } = require('../src/services/pmPlanner');

let passed = 0;
const ok = (n) => { passed++; console.log(`  ok - ${n}`); };
const today = dayjs('2026-06-15');

// AC with last major 2026-01-10 → minors at +2(Mar),+4(May已past? floor), majors at +6(Jul)...
let e = buildUnitEvents(
  { equipment_type: 'ac', status: 'active', last_major_clean_date: '2026-01-10', pm_cycle_pos: 0 },
  2026, today
);
assert(e.length > 0);
assert(e.every((x) => ['major', 'minor'].includes(x.planned_type)));
// every event on/after today-1
assert(e.every((x) => !dayjs(x.scheduled_date).isBefore(today.subtract(1, 'day'))));
// the +6mo from LM = 2026-07-10 should be a major
const jul = e.find((x) => x.scheduled_date === '2026-07-10');
assert(jul && jul.planned_type === 'major');
ok('AC: +6mo from last major is a major, within year, future-only');

// AC never cleaned → first event next month is a major
e = buildUnitEvents(
  { equipment_type: 'ac', status: 'active', last_major_clean_date: null, pm_cycle_pos: 0 },
  2026, today
);
assert(e.length > 0 && e[0].planned_type === 'major');
assert(dayjs(e[0].scheduled_date).isAfter(today));
ok('AC never cleaned: first event is a major next month');

// fan → all 'fan'
e = buildUnitEvents(
  { equipment_type: 'fan', status: 'active', next_pm_date: '2026-07-01' },
  2026, today
);
assert(e.length > 0 && e.every((x) => x.planned_type === 'fan'));
ok('fan: events typed fan, every 2 months');

// non-active unit → skipped entirely
e = buildUnitEvents(
  { equipment_type: 'ac', status: 'broken', last_major_clean_date: '2026-01-10' },
  2026, today
);
assert.strictEqual(e.length, 0);
ok('broken/inactive unit: no events');

// events stay within the requested year
e = buildUnitEvents(
  { equipment_type: 'ac', status: 'active', last_major_clean_date: '2026-01-10' },
  2026, today
);
assert(e.every((x) => x.scheduled_date >= '2026-01-01' && x.scheduled_date <= '2026-12-31'));
ok('all events within the requested year');

console.log(`\n${passed} passed`);
