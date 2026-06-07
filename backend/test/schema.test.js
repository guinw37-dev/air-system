// Tests for the schema-per-tenant slug→schema whitelist (no DB needed).
// slugToSchema is the SQL-injection boundary — schema names are interpolated
// into SET search_path, so a dirty slug must NEVER pass. Run: node test/schema.test.js
const assert = require('assert');
const { slugToSchema, branchSchema } = require('../src/utils/schema');
const { leftmostLabel } = require('../src/middleware/resolveBranch');

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok - ${name}`); };

// dash → underscore, lowercased
assert.strictEqual(slugToSchema('acme-co'), 'acme_co');
ok('slugToSchema converts dashes to underscores');
assert.strictEqual(slugToSchema('PTS1'), 'pts1');
ok('slugToSchema lowercases');

// rejects anything that could break out of an identifier
for (const bad of ['a;DROP TABLE x', 'a.b', '../x', 'a b', 'a"b', "a'b", 'a-'.repeat(40), '']) {
  assert.throws(() => slugToSchema(bad), /invalid schema name/, `should reject ${JSON.stringify(bad)}`);
}
ok('slugToSchema throws on injection / illegal chars / empty / too-long');

// branchSchema prefers schema_name, falls back to slug
assert.strictEqual(branchSchema({ schema_name: 'acme_co', slug: 'acme-co' }), 'acme_co');
ok('branchSchema prefers schema_name');
assert.strictEqual(branchSchema({ slug: 'beta-co' }), 'beta_co');
ok('branchSchema falls back to slug');

// leftmostLabel: branch detection
assert.strictEqual(leftmostLabel('acme-co.example.com'), 'acme-co');
ok('leftmostLabel extracts the branch label');
assert.strictEqual(leftmostLabel('example.com'), null);
ok('leftmostLabel treats apex as no branch');
assert.strictEqual(leftmostLabel('www.example.com'), null);
ok('leftmostLabel ignores www');
assert.strictEqual(leftmostLabel('127.0.0.1'), null);
ok('leftmostLabel ignores raw IPv4');
assert.strictEqual(leftmostLabel('localhost'), null);
ok('leftmostLabel ignores localhost');

// enforceBranch inside authMiddleware: a branch-scoped token can't be used on
// another branch; super-admins + apex pass. (signs a real JWT, no DB.)
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const { authMiddleware } = require('../src/middleware/auth');
function runAuth(req) {
  let status = 200, body = null, nexted = false;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  authMiddleware(req, res, () => { nexted = true; });
  return { status, body, nexted };
}
const sign = (p) => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '5m' });

let r2 = runAuth({ headers: { authorization: `Bearer ${sign({ id: 1, branchSlug: 'pts1', isSuper: false })}` }, query: {}, branch: { slug: 'pts2' } });
assert.strictEqual(r2.status, 403);
ok('authMiddleware blocks a pts1 token on branch pts2');

r2 = runAuth({ headers: { authorization: `Bearer ${sign({ id: 1, branchSlug: 'pts1', isSuper: false })}` }, query: {}, branch: { slug: 'pts1' } });
assert.strictEqual(r2.nexted, true);
ok('authMiddleware allows a pts1 token on branch pts1');

r2 = runAuth({ headers: { authorization: `Bearer ${sign({ id: 1, branchSlug: null, isSuper: true })}` }, query: {}, branch: { slug: 'pts2' } });
assert.strictEqual(r2.nexted, true);
ok('authMiddleware lets a super-admin onto any branch');

r2 = runAuth({ headers: { authorization: `Bearer ${sign({ id: 1, branchSlug: 'pts1', isSuper: false })}` }, query: {}, branch: null });
assert.strictEqual(r2.nexted, true);
ok('authMiddleware passes through on apex (no branch)');

console.log(`\n${passed} passed`);
