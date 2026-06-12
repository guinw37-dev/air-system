// ============================================================
// roles.js — single source of truth for the role model + hierarchy.
//
//   Super Dev        super_admin       apex/public, cross-branch, owner only
//   Admin Dep.       admin             branch-local, full within the branch
//   Approve Engineer approve_engineer  branch, signs วิศวกรรม + approves
//   Approve Building approve_building  branch, signs ช่างอาคาร + approves
//   Checker Dev      checker           branch, signs หัวหน้าช่างแอร์ + inspects
//   Technician       technician        branch, field tech, signs ช่างแอร์
//
// Each branch signing role owns exactly ONE signature slot on a ใบงาน. The two
// approve_* roles inherit the old "approver" workflow rights (approve / reject).
// The legacy single 'approver' (Approve Dev) is retired → remapped to
// approve_engineer; it stays in ROLE_RANK only so existing tokens don't break.
//
// Hierarchy rule: a user may only create / edit / delete a target whose rank is
// <= their own, and may never assign a role of higher rank than their own.
// Creating or editing a super_admin additionally requires a password step-up
// (see master.js). Legacy roles are remapped to the new set on migration.
// ============================================================

const ROLE_RANK = {
  super_admin:      100,
  admin:            80,
  approve_engineer: 60,
  approve_building: 60,
  checker:          60,
  technician:       40,
  approver:         60, // legacy (Approve Dev) — kept so old accounts/tokens resolve
};

const ALL_ROLES    = Object.keys(ROLE_RANK);
const SUPER_ROLES  = ['super_admin'];
// Roles assignable inside a branch (the user-management dropdown). 'approver' is
// intentionally absent — it is legacy and no longer offered for new users.
const BRANCH_ROLES = ['admin', 'approve_engineer', 'approve_building', 'checker', 'technician'];

// ── Signature slots — each role owns ONE slot on a ใบงาน ─────────────────────
// Slot keys match the sig_<slot> columns on simple_work_orders.
const SIG_SLOTS = ['team', 'supervisor', 'building', 'engineer', 'department'];
const ROLE_SLOT = {
  technician:       'team',        // ช่างแอร์
  checker:          'supervisor',  // หัวหน้าช่างแอร์
  approve_building: 'building',     // เจ้าหน้าที่ช่างอาคาร
  approve_engineer: 'engineer',    // เจ้าหน้าวิศวกรรม
  approver:         'engineer',    // legacy alias
};
// A role may sign ONLY the slot mapped to it. admin / super_admin do NOT sign at
// all (they manage + bill) — signing is reserved for the field/approval roles.
const canSignSlot = (role, slot) => ROLE_SLOT[role] === slot;
// The 4 visible signature slots that must ALL be filled before a ใบงาน is billable.
const REQUIRED_SLOTS = ['team', 'supervisor', 'building', 'engineer'];
const allSigned = (wo) => REQUIRED_SLOTS.every((s) => !!(wo && wo[`sig_${s}`]));

// Signatures are a STEP CHAIN — each slot can be signed only after every earlier
// slot in this order is already signed: ช่างแอร์ → หัวหน้าช่าง → ช่างอาคาร → วิศวกรรม.
const SIGN_ORDER = ['team', 'supervisor', 'building', 'engineer'];
const SLOT_TH = { team: 'ช่างแอร์', supervisor: 'หัวหน้าช่างแอร์', building: 'เจ้าหน้าที่ช่างอาคาร', engineer: 'เจ้าหน้าวิศวกรรม' };
// First earlier slot still unsigned (the one blocking `slot`), or null if ready.
function blockingSlot(slot, wo) {
  const idx = SIGN_ORDER.indexOf(slot);
  if (idx <= 0) return null;                 // ช่างแอร์ (first) or non-chain slot has no prerequisite
  for (let i = 0; i < idx; i++) {
    if (!wo || !wo[`sig_${SIGN_ORDER[i]}`]) return SIGN_ORDER[i];
  }
  return null;
}
// The slot a role signs (null for admin/super/none — they choose).
const slotForRole = (role) => ROLE_SLOT[role] || null;

// Retired roles → their replacement in the new model.
const LEGACY_ROLE_MAP = {
  central_admin: 'admin',
  supervisor:    'checker',
  building:      'approve_building',
  field_tech:    'technician',
  approver:      'approve_engineer',
};

const rankOf = (role) => ROLE_RANK[role] || 0;

// CASE expression to remap any legacy role to the new model in a single UPDATE.
const REMAP_CASE_SQL = `CASE role
  WHEN 'central_admin' THEN 'admin'
  WHEN 'supervisor'    THEN 'checker'
  WHEN 'building'      THEN 'approve_building'
  WHEN 'field_tech'    THEN 'technician'
  WHEN 'approver'      THEN 'approve_engineer'
  ELSE role END`;

module.exports = {
  ROLE_RANK, ALL_ROLES, SUPER_ROLES, BRANCH_ROLES,
  SIG_SLOTS, ROLE_SLOT, canSignSlot, slotForRole, REQUIRED_SLOTS, allSigned,
  SIGN_ORDER, SLOT_TH, blockingSlot,
  LEGACY_ROLE_MAP, rankOf, REMAP_CASE_SQL,
};
