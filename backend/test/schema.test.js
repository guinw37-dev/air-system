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

console.log(`\n${passed} passed`);
