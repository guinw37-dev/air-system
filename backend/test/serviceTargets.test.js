// Unit tests for the carry-over target math — the core of Dashboard A.
// Run: node test/serviceTargets.test.js
const assert = require('assert');
const { _carryForward, _monthSeq } = require('../src/routes/serviceTargets');

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok - ${name}`); };

// monthSeq inclusive, ascending, capped.
assert.deepStrictEqual(_monthSeq('2026-01', '2026-03'), ['2026-01', '2026-02', '2026-03']);
assert.deepStrictEqual(_monthSeq('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
assert.deepStrictEqual(_monthSeq('2026-05', '2026-05'), ['2026-05']);
assert.ok(_monthSeq('2000-01', '2030-01').length <= 25); // capped at 24+break
ok('monthSeq: inclusive ascending, wraps year, capped');

const at = (map) => (ym) => map[ym] || 0;

// Single month, met exactly → no carry.
let r = _carryForward(100, at({ '2026-06': 100 }), ['2026-06']);
assert.deepStrictEqual(r, { carry_in: 0, effective_target: 100, done: 100, remaining: 0 });
ok('met exactly → remaining 0');

// Short last month → remaining is the shortfall.
r = _carryForward(100, at({ '2026-06': 70 }), ['2026-06']);
assert.strictEqual(r.remaining, 30);
assert.strictEqual(r.effective_target, 100);
ok('shortfall → remaining = unmet');

// Carry-over: month1 does 70/100 (−30) → month2 target = 130.
r = _carryForward(100, at({ '2026-05': 70, '2026-06': 0 }), ['2026-05', '2026-06']);
assert.strictEqual(r.carry_in, 30);           // carried into June
assert.strictEqual(r.effective_target, 130);  // 100 base + 30 carry
assert.strictEqual(r.done, 0);
assert.strictEqual(r.remaining, 130);
ok('unmet rolls into next month target (+carry)');

// Catch-up: month1 70/100 (−30), month2 does 130 → clears debt, remaining 0.
r = _carryForward(100, at({ '2026-05': 70, '2026-06': 130 }), ['2026-05', '2026-06']);
assert.strictEqual(r.effective_target, 130);
assert.strictEqual(r.done, 130);
assert.strictEqual(r.remaining, 0);
ok('over-do next month pays down carry → remaining 0');

// Overshoot does NOT bank negative carry (no credit forward).
r = _carryForward(100, at({ '2026-05': 150, '2026-06': 0 }), ['2026-05', '2026-06']);
assert.strictEqual(r.carry_in, 0);            // 150>100 → no debt, no credit
assert.strictEqual(r.effective_target, 100);
ok('overshoot banks no negative carry');

console.log(`\n${passed} passed`);
