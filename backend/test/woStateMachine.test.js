// Runnable tests for the WO state machine (no DB). Run: node test/woStateMachine.test.js
const assert = require('assert');
const { checkTransition, isEditable } = require('../src/services/woStateMachine');

let passed = 0;
const ok = (n) => { passed++; console.log(`  ok - ${n}`); };

// Happy path
assert.strictEqual(checkTransition('draft', 'in_progress', 'technician').ok, true);
ok('technician draft→in_progress');

assert.strictEqual(checkTransition('in_progress', 'pending_admin', 'technician').ok, true);
ok('technician submit in_progress→pending_admin');

assert.strictEqual(checkTransition('pending_admin', 'pending_approval', 'checker').ok, true);
ok('checker admin-approve (ด่าน 1)');

assert.strictEqual(checkTransition('pending_approval', 'approved', 'approver').ok, true);
ok('approver final-approve');

// Role gate
let r = checkTransition('pending_admin', 'pending_approval', 'technician');
assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'role');
ok('technician cannot admin-approve (role)');

r = checkTransition('pending_approval', 'approved', 'central_admin');
assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'role');
ok('central_admin cannot final-approve (role)');

// Illegal jumps
r = checkTransition('draft', 'approved', 'admin');
assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'status');
ok('cannot skip draft→approved (status)');

r = checkTransition('approved', 'in_progress', 'admin');
assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'status');
ok('approved is terminal (status)');

// Reject requires reason
r = checkTransition('pending_admin', 'rejected', 'checker', { reason: '' });
assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'reason');
ok('reject needs a reason');

r = checkTransition('pending_admin', 'rejected', 'checker', { reason: 'รูปไม่ชัด' });
assert.strictEqual(r.ok, true);
ok('reject with reason ok');

// Rejected loops back
assert.strictEqual(checkTransition('rejected', 'in_progress', 'technician').ok, true);
ok('rejected→in_progress resubmit');

// Editability
assert.strictEqual(isEditable('in_progress'), true);
assert.strictEqual(isEditable('approved'), false);
assert.strictEqual(isEditable('pending_admin'), false);
ok('isEditable: editable only in draft/in_progress/rejected');

console.log(`\n${passed} passed`);
