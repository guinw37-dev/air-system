// Work-order state machine — the single authority on legal status transitions.
//
//   draft → in_progress → pending_admin → pending_approval → approved
//                                       ↘ rejected (→ back to in_progress)
//
// Every transition declares which roles may perform it and whether a reason is
// required. Routes MUST go through assertTransition() before mutating status,
// and call logTransition() inside the same transaction to keep the audit trail.

// Role model: technician (field) → checker (ด่าน 1 ตรวจ) → approve_* (ด่าน 2 อนุมัติ).
// The legacy single 'approver' is kept here so in-flight tokens still resolve.
// admin = system administrator (users/master/system) — NOT a workflow actor.
const APPROVE_ROLES = ['approve_building', 'approve_engineer', 'approver'];
const TRANSITIONS = {
  draft: {
    in_progress: { roles: ['technician', 'checker'] },
  },
  in_progress: {
    pending_admin: { roles: ['technician', 'checker'], gate: 'photos' },
    rejected:      { roles: ['checker', ...APPROVE_ROLES], requireReason: true },
  },
  pending_admin: {
    pending_approval: { roles: ['checker'] },                          // ด่าน 1
    rejected:         { roles: ['checker', ...APPROVE_ROLES], requireReason: true },
  },
  pending_approval: {
    approved: { roles: [...APPROVE_ROLES] },                           // ด่าน 2
    rejected: { roles: [...APPROVE_ROLES, 'checker'], requireReason: true },
  },
  rejected: {
    in_progress: { roles: ['technician', 'checker'] },
  },
  approved: {}, // terminal — locked, no edits
};

// Statuses where inspection/photos/signatures may still be edited.
const EDITABLE_STATUSES = ['draft', 'in_progress', 'rejected'];

function isEditable(status) {
  return EDITABLE_STATUSES.includes(status);
}

// Validate a transition. Returns { ok: true, rule } or { ok: false, code, error }.
// code lets the caller pick an HTTP status: 'status'→409, 'role'→403, 'reason'→400.
function checkTransition(from, to, role, { reason } = {}) {
  const rule = TRANSITIONS[from]?.[to];
  if (!rule) {
    return { ok: false, code: 'status', error: `ไม่สามารถเปลี่ยนสถานะจาก ${from} → ${to}` };
  }
  if (!rule.roles.includes(role)) {
    return { ok: false, code: 'role', error: `role ${role} ไม่มีสิทธิ์ทำขั้นตอนนี้` };
  }
  if (rule.requireReason && !reason?.trim()) {
    return { ok: false, code: 'reason', error: 'กรุณาระบุเหตุผล' };
  }
  return { ok: true, rule };
}

const HTTP_FOR_CODE = { status: 409, role: 403, reason: 400 };

// Append an audit row. Pass the SAME client used for the status UPDATE so it is
// part of one transaction.
async function logTransition(client, { workOrderId, from, to, changedBy = null, reason = null }) {
  await client.query(
    `INSERT INTO work_order_status_history (work_order_id, from_status, to_status, changed_by, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [workOrderId, from, to, changedBy, reason]
  );
}

module.exports = {
  TRANSITIONS,
  EDITABLE_STATUSES,
  isEditable,
  checkTransition,
  HTTP_FOR_CODE,
  logTransition,
};
