// Lightweight runnable tests for the tenant-isolation helper (no DB needed).
// Run: node backend/test/tenant.test.js
const assert = require('assert');
const { getClientId, requireClientId } = require('../src/middleware/tenant');

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok - ${name}`); };

// getClientId: reads query first, then body; rejects junk
assert.strictEqual(getClientId({ query: { client_id: '7' }, body: {} }), 7);
ok('getClientId reads client_id from query');

assert.strictEqual(getClientId({ query: {}, body: { client_id: 3 } }), 3);
ok('getClientId falls back to body');

assert.strictEqual(getClientId({ query: { client_id: 'abc' }, body: {} }), null);
ok('getClientId rejects non-numeric');

assert.strictEqual(getClientId({ query: { client_id: '0' }, body: {} }), null);
ok('getClientId rejects 0 / negatives');

assert.strictEqual(getClientId({ query: {}, body: {} }), null);
ok('getClientId returns null when absent');

// requireClientId: 400 gate + sets req.clientId
function runReq(req) {
  let status = 200, body = null, nexted = false;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  requireClientId(req, res, () => { nexted = true; });
  return { status, body, nexted, req };
}

let r = runReq({ query: { client_id: '5' }, body: {} });
assert.strictEqual(r.nexted, true);
assert.strictEqual(r.req.clientId, 5);
ok('requireClientId passes through and sets req.clientId');

r = runReq({ query: {}, body: {} });
assert.strictEqual(r.nexted, false);
assert.strictEqual(r.status, 400);
assert.deepStrictEqual(r.body, { error: 'client_id required' });
ok('requireClientId blocks with 400 when client_id missing');

console.log(`\n${passed} passed`);
