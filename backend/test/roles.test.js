const assert = require('assert');
const { ROLE_RANK, ALL_ROLES, SUPER_ROLES, BRANCH_ROLES, LEGACY_ROLE_MAP, rankOf, REMAP_CASE_SQL } = require('../src/utils/roles');

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

t('exactly the 5 roles, no legacy', () => {
  assert.deepStrictEqual(ALL_ROLES.sort(), ['admin', 'approver', 'checker', 'super_admin', 'technician']);
  for (const legacy of ['central_admin', 'supervisor', 'building', 'field_tech']) {
    assert.ok(!(legacy in ROLE_RANK), `${legacy} must be retired`);
  }
});

t('hierarchy: super > admin > approver=checker > technician', () => {
  assert.ok(rankOf('super_admin') > rankOf('admin'));
  assert.ok(rankOf('admin') > rankOf('approver'));
  assert.strictEqual(rankOf('approver'), rankOf('checker'));
  assert.ok(rankOf('checker') > rankOf('technician'));
  assert.strictEqual(rankOf('central_admin'), 0); // retired → rank 0
  assert.strictEqual(rankOf('nope'), 0);
});

t('super only in SUPER_ROLES, never a branch role', () => {
  assert.deepStrictEqual(SUPER_ROLES, ['super_admin']);
  assert.ok(!BRANCH_ROLES.includes('super_admin'));
  assert.deepStrictEqual(BRANCH_ROLES, ['admin', 'approver', 'checker', 'technician']);
});

t('legacy map points only at valid new roles', () => {
  for (const [legacy, mapped] of Object.entries(LEGACY_ROLE_MAP)) {
    assert.ok(ALL_ROLES.includes(mapped), `${legacy}→${mapped} must be a valid role`);
  }
  assert.strictEqual(LEGACY_ROLE_MAP.central_admin, 'admin');
});

t('remap SQL covers every legacy role', () => {
  for (const legacy of Object.keys(LEGACY_ROLE_MAP)) {
    assert.ok(REMAP_CASE_SQL.includes(`'${legacy}'`), `remap must handle ${legacy}`);
  }
});

console.log(`${pass} passed`);
