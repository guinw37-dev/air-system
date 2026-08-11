// Static guards on the boot-migration SQL in db/provision.js.
//
// These exist because two migrations shipped broken in a row and BOTH failures
// were invisible until the container booted against a real Postgres:
//   1) a new value_type hit the CHECK constraint (23514)
//   2) $1 used in both an INSERT…SELECT list and a WHERE comparison →
//      "inconsistent types deduced for parameter $1"
// node --check and the unit suite pass happily on both. A parse of the file is
// the only check that runs without a database, so keep these cheap and blunt.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok - ${name}`); };

const SRC = fs.readFileSync(path.join(__dirname, '../src/db/provision.js'), 'utf8');

// Pull out every await c.query(`…`) template literal.
const statements = [...SRC.matchAll(/query\(`([\s\S]*?)`/g)].map((m) => m[1]);

t('provision.js exposes its SQL to inspection', () => {
  assert.ok(statements.length > 20, `expected many statements, got ${statements.length}`);
});

t('a placeholder reused across SELECT-list and WHERE is cast', () => {
  // Postgres infers a parameter's type from where it appears. Land in an
  // INSERT…SELECT projection AND a comparison at once and the two inferences
  // collide, taking down the whole migration — not just that statement.
  const offenders = [];
  for (const sql of statements) {
    if (!/INSERT\s+INTO/i.test(sql) || !/SELECT/i.test(sql)) continue;
    for (const ph of new Set((sql.match(/\$\d+/g) || []))) {
      const uses = sql.split(ph).length - 1;
      if (uses < 2) continue;                       // single use → no collision
      const casts = sql.split(`${ph}::`).length - 1;
      if (casts < uses) offenders.push(`${ph} in: ${sql.trim().slice(0, 70)}…`);
    }
  }
  assert.deepStrictEqual(offenders, [], `cast these with ::varchar →\n  ${offenders.join('\n  ')}`);
});

t('every value_type written is allowed by the CHECK constraint', () => {
  // The constraint is re-created inside this same file; the row writes below it
  // must stay inside that list or the migration dies at the first offending row.
  const check = SRC.match(/value_type_check CHECK \(value_type IN \(([\s\S]*?)\)\)/);
  assert.ok(check, 'value_type CHECK constraint not found in provision.js');
  const allowed = new Set([...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  for (const need of ['single_number', 'temp_rh', 'temp_rh_after']) {
    assert.ok(allowed.has(need), `${need} missing from the CHECK list`);
  }
  // Anything the migration inserts/updates as a value_type must be in the list.
  const written = new Set();
  for (const sql of statements) {
    if (!/inspection_template_items/.test(sql)) continue;
    for (const m of sql.matchAll(/value_type\s*=\s*'([a-z_]+)'/g)) written.add(m[1]);
    // INSERT…SELECT 'ac', '<cat>', <label>, '<value_type>', …
    for (const m of sql.matchAll(/SELECT 'ac',\s*'[a-z0-9]+',\s*[^,]+,\s*'([a-z_]+)'/g)) written.add(m[1]);
  }
  const bad = [...written].filter((v) => !allowed.has(v));
  assert.deepStrictEqual(bad, [], `value_type(s) not permitted by the constraint: ${bad.join(', ')}`);
});

t('the CHECK constraint is widened BEFORE any row uses a new type', () => {
  const constraintAt = SRC.indexOf('value_type_check CHECK');
  for (const need of ["'single_number'", "'temp_rh_after'"]) {
    const firstUse = SRC.indexOf(need, constraintAt + 1);
    assert.ok(firstUse > constraintAt, `${need} is written before the constraint is widened`);
  }
});

console.log(`\n${pass} passed`);
