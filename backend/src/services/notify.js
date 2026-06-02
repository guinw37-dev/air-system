// In-app notification helpers. Called inside status-transition transactions so
// a notification is written atomically with the status change.

// Insert one notification per target user.
async function notifyUsers(client, userIds, { workOrderId, type, message }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  for (const uid of ids) {
    await client.query(
      `INSERT INTO notifications (user_id, work_order_id, type, message) VALUES ($1,$2,$3,$4)`,
      [uid, workOrderId, type, message]
    );
  }
}

async function userIdsByRole(client, role) {
  const { rows } = await client.query('SELECT id FROM users WHERE role = $1 AND active = true', [role]);
  return rows.map((r) => r.id);
}

async function assigneeIds(client, woId) {
  const { rows } = await client.query('SELECT user_id FROM work_order_assignees WHERE work_order_id = $1', [woId]);
  return rows.map((r) => r.user_id);
}

// Fan out the right notification for a transition. `wo` is the work-order row.
async function notifyTransition(client, wo, to, { reason } = {}) {
  const orderNo = wo.order_no || `#${wo.id}`;
  if (to === 'pending_admin') {
    await notifyUsers(client, await userIdsByRole(client, 'central_admin'),
      { workOrderId: wo.id, type: 'pending_admin', message: `ใบงาน ${orderNo} รอตรวจ (Admin)` });
  } else if (to === 'pending_approval') {
    await notifyUsers(client, await userIdsByRole(client, 'approver'),
      { workOrderId: wo.id, type: 'pending_approval', message: `ใบงาน ${orderNo} รออนุมัติ` });
  } else if (to === 'approved') {
    await notifyUsers(client, await assigneeIds(client, wo.id),
      { workOrderId: wo.id, type: 'approved', message: `ใบงาน ${orderNo} อนุมัติแล้ว` });
  } else if (to === 'rejected') {
    await notifyUsers(client, await assigneeIds(client, wo.id),
      { workOrderId: wo.id, type: 'rejected', message: `ใบงาน ${orderNo} ถูกส่งคืน: ${reason || '-'}` });
  }
}

module.exports = { notifyUsers, notifyTransition };
