// Unit tests for the ac-repair webhook secret check — the auth boundary for the
// public auto-import endpoint. No DB needed. Run: node test/acRepairWebhook.test.js
const assert = require('assert');
const { _secretMatches } = require('../src/routes/acRepairWebhook');

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok - ${name}`); };

// Fail-closed: a blank/undefined expected secret must reject everything, incl. ''.
assert.strictEqual(_secretMatches('anything', ''), false);
assert.strictEqual(_secretMatches('', ''), false);
assert.strictEqual(_secretMatches('', undefined), false);
ok('blank expected secret rejects all (fail-closed)');

// Exact match passes.
assert.strictEqual(_secretMatches('s3cr3t', 's3cr3t'), true);
ok('exact match passes');

// Any mismatch fails.
assert.strictEqual(_secretMatches('s3cr3t', 'other'), false);     // same length, diff bytes
assert.strictEqual(_secretMatches('s3cr3', 's3cr3t'), false);      // shorter
assert.strictEqual(_secretMatches('s3cr3tX', 's3cr3t'), false);    // longer
assert.strictEqual(_secretMatches(undefined, 's3cr3t'), false);    // missing header
assert.strictEqual(_secretMatches(null, 's3cr3t'), false);
ok('any mismatch / missing header fails');

console.log(`\n${passed} passed`);
