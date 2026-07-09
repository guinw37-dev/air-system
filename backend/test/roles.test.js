const assert = require('assert');
const { ROLE_RANK, ALL_ROLES, SUPER_ROLES, BRANCH_ROLES, LEGACY_ROLE_MAP, rankOf, REMAP_CASE_SQL,
        ROLE_SLOT, canSignSlot, slotForRole, allSigned, blockingSlot } = require('../src/utils/roles');

let pass = 0;
const t = (name, fn) => { fn(); pass++; };

t('role set: new roles present, hard-retired legacy gone', () => {
  assert.deepStrictEqual(ALL_ROLES.sort(),
    ['admin', 'approve_building', 'approve_engineer', 'approver', 'checker', 'super_admin', 'technician']);
  // central_admin/supervisor/building/field_tech are fully retired. 'approver'
  // is kept (legacy alias) so in-flight tokens still resolve.
  for (const legacy of ['central_admin', 'supervisor', 'building', 'field_tech']) {
    assert.ok(!(legacy in ROLE_RANK), `${legacy} must be retired`);
  }
});

t('hierarchy: super > admin > approve_*=checker > technician', () => {
  assert.ok(rankOf('super_admin') > rankOf('admin'));
  assert.ok(rankOf('admin') > rankOf('approve_engineer'));
  assert.strictEqual(rankOf('approve_engineer'), rankOf('checker'));
  assert.strictEqual(rankOf('approve_building'), rankOf('checker'));
  assert.ok(rankOf('checker') > rankOf('technician'));
  assert.strictEqual(rankOf('central_admin'), 0); // retired → rank 0
  assert.strictEqual(rankOf('nope'), 0);
});

t('super only in SUPER_ROLES; approver not assignable', () => {
  assert.deepStrictEqual(SUPER_ROLES, ['super_admin']);
  assert.ok(!BRANCH_ROLES.includes('super_admin'));
  assert.ok(!BRANCH_ROLES.includes('approver')); // legacy, no longer offered
  assert.deepStrictEqual(BRANCH_ROLES,
    ['admin', 'approve_engineer', 'approve_building', 'checker', 'technician']);
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

t('each branch role signs exactly its own slot', () => {
  assert.strictEqual(slotForRole('technician'), 'team');
  assert.strictEqual(slotForRole('checker'), 'supervisor');
  assert.strictEqual(slotForRole('approve_building'), 'building');
  assert.strictEqual(slotForRole('approve_engineer'), 'engineer');
  // a role may sign only its own slot
  assert.ok(canSignSlot('technician', 'team'));
  assert.ok(!canSignSlot('technician', 'engineer'));
  assert.ok(canSignSlot('approve_engineer', 'engineer'));
  assert.ok(!canSignSlot('approve_engineer', 'building'));
  assert.ok(!canSignSlot('checker', 'building'));
  // admin / super_admin do NOT sign any slot (they manage + bill)
  assert.ok(!canSignSlot('admin', 'engineer'));
  assert.ok(!canSignSlot('super_admin', 'building'));
  // no signing slot for admin/super
  assert.strictEqual(slotForRole('admin'), null);
});

t('allSigned: requires ALL FOUR slots (team+supervisor+building+engineer)', () => {
  const ts = { sig_team: 'a', sig_supervisor: 'b' };
  // one of the approve pair alone is NOT enough anymore (Worawit 8 Jul 2026)
  assert.ok(!allSigned({ ...ts, sig_building: 'c' }));
  assert.ok(!allSigned({ ...ts, sig_engineer: 'd' }));
  // both approves signed → complete
  assert.ok(allSigned({ ...ts, sig_building: 'c', sig_engineer: 'd' }));
  // neither of the pair → not yet
  assert.ok(!allSigned(ts));
  // missing team or supervisor → not billable even with both approves
  assert.ok(!allSigned({ sig_supervisor: 'b', sig_building: 'c', sig_engineer: 'd' }));
  assert.ok(!allSigned({ sig_team: 'a', sig_building: 'c', sig_engineer: 'd' }));
  assert.ok(!allSigned({}));
  // sig_department is irrelevant
  assert.ok(allSigned({ ...ts, sig_building: 'c', sig_engineer: 'd', sig_department: '' }));
});

t('blockingSlot: team→supervisor→{building,engineer parallel}', () => {
  const none = {};
  // team is first — never blocked
  assert.strictEqual(blockingSlot('team', none), null);
  // supervisor needs team
  assert.strictEqual(blockingSlot('supervisor', none), 'team');
  assert.strictEqual(blockingSlot('supervisor', { sig_team: 'a' }), null);
  // building + engineer each need team + supervisor — but NOT each other (parallel)
  const ts = { sig_team: 'a', sig_supervisor: 'b' };
  assert.strictEqual(blockingSlot('building', { sig_team: 'a' }), 'supervisor');
  assert.strictEqual(blockingSlot('engineer', { sig_team: 'a' }), 'supervisor');
  assert.strictEqual(blockingSlot('building', ts), null);   // ready after team+supervisor
  assert.strictEqual(blockingSlot('engineer', ts), null);   // ready too — no wait on building
  // signing one of the pair does not gate the other
  assert.strictEqual(blockingSlot('engineer', { ...ts, sig_building: 'c' }), null);
  assert.strictEqual(blockingSlot('building', { ...ts, sig_engineer: 'd' }), null);
});

console.log(`${pass} passed`);
