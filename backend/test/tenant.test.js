// Lightweight runnable tests for the tenant-isolation helper (no DB needed).
// Run: node backend/test/tenant.test.js
const assert = require('assert');
const { getClientId, requireClientId, leftmostLabel } = require('../src/middleware/tenant');

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok - ${name}`); };

// getClientId: reads query first, then body; rejects junk
assert.strictEqual(getClientId({ query: { client_id: '7' }, body: {} }), 7);
ok('getClientId reads client_id from query');

// getClientId: a subdomain-forced req.clientId wins over query/body
assert.strictEqual(getClientId({ clientId: 9, query: { client_id: '7' }, body: {} }), 9);
ok('getClientId prefers forced req.clientId (branch wins)');

// rawOnly bypasses the forced value (used internally to detect a page value)
assert.strictEqual(getClientId({ clientId: 9, query: { client_id: '7' }, body: {} }, true), 7);
ok('getClientId(rawOnly) ignores forced req.clientId');

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

// leftmostLabel: branch detection from hostname
assert.strictEqual(leftmostLabel('phayathai-1.pypl-engineering.online'), 'phayathai-1');
ok('leftmostLabel extracts the branch slug');
assert.strictEqual(leftmostLabel('pypl-engineering.online'), null);
ok('leftmostLabel treats apex (2 labels) as no branch');
assert.strictEqual(leftmostLabel('www.pypl-engineering.online'), null);
ok('leftmostLabel ignores www');
assert.strictEqual(leftmostLabel('localhost'), null);
ok('leftmostLabel ignores localhost');
assert.strictEqual(leftmostLabel('127.0.0.1'), null);
ok('leftmostLabel ignores raw IPv4');
assert.strictEqual(leftmostLabel('phayathai-1.pypl.online:5173'), 'phayathai-1');
ok('leftmostLabel strips port');

console.log(`\n${passed} passed`);
