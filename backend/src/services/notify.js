// In-app notification helpers. Recipients are read from the BRANCH users table
// (via the schema-pinned `client`), but notifications themselves live in
// public.notifications — so the INSERT goes through `pool` (public), NOT the
// branch transaction. This avoids a cross-schema FK violation (branch user id ∉
// public.users) that used to roll back the whole status-change transaction.
const pool = require('../db/pool');

// Insert one notification per target user. `branchSlug` records which branch the
// recipient ids belong to (no hard FK — recipients are per-branch users).
async function notifyUsers(client, userIds, { workOrderId, type, message, branchSlug }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  for (const uid of ids) {
    await pool.query(
      `INSERT INTO notifications (user_id, work_order_id, type, message, branch_slug) VALUES ($1,$2,$3,$4,$5)`,
      [uid, workOrderId, type, message, branchSlug || null]
    );
  }
}

async function userIdsByRole(client, roles) {
  const list = Array.isArray(roles) ? roles : [roles];
  const { rows } = await client.query('SELECT id FROM users WHERE role = ANY($1) AND active = true', [list]);
  return rows.map((r) => r.id);
}

async function assigneeIds(client, woId) {
  const { rows } = await client.query('SELECT user_id FROM work_order_assignees WHERE work_order_id = $1', [woId]);
  return rows.map((r) => r.user_id);
}

// Fan out the right notification for a transition. `wo` is the work-order row.
// `branchSlug` = the schema/branch the WO + its users belong to.
async function notifyTransition(client, wo, to, { reason, branchSlug } = {}) {
  const orderNo = wo.order_no || `#${wo.id}`;
  const base = { workOrderId: wo.id, branchSlug };
  if (to === 'pending_admin') {
    await notifyUsers(client, await userIdsByRole(client, ['admin', 'central_admin']),
      { ...base, type: 'pending_admin', message: `ใบงาน ${orderNo} รอตรวจ (Admin)` });
  } else if (to === 'pending_approval') {
    await notifyUsers(client, await userIdsByRole(client, 'approver'),
      { ...base, type: 'pending_approval', message: `ใบงาน ${orderNo} รออนุมัติ` });
  } else if (to === 'approved') {
    await notifyUsers(client, await assigneeIds(client, wo.id),
      { ...base, type: 'approved', message: `ใบงาน ${orderNo} อนุมัติแล้ว` });
  } else if (to === 'rejected') {
    await notifyUsers(client, await assigneeIds(client, wo.id),
      { ...base, type: 'rejected', message: `ใบงาน ${orderNo} ถูกส่งคืน: ${reason || '-'}` });
  }
}

module.exports = { notifyUsers, notifyTransition };
