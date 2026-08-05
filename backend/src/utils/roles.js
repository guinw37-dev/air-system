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
// EXTERNAL slots are signed by someone who has NO account here — the hospital's
// own staff. Whoever holds the device opens the pad for them, so the signer's
// name/position are TYPED IN, never snapshotted from the logged-in user.
const EXTERNAL_SLOTS = ['department'];   // เจ้าหน้าที่เจ้าของพื้นที่ (คนของ รพ.)
// Extra slots a role may sign IN ADDITION to its own (Worawit 27 Jul 2026):
// หัวหน้าช่างแอร์ (checker) may also sign the ช่างแอร์ slot — covers a tech who
// is absent / forgot. Single-WO signing only; batch-sign stays own-slot.
// Every on-site branch role may open the เจ้าของพื้นที่ pad (PTN, 5 Aug 2026) —
// it is a proxy for an outside signer, not an approval of their own.
const ROLE_EXTRA_SLOTS = {
  checker:          ['team', 'department'],
  technician:       ['department'],
  approve_building: ['department'],
  approve_engineer: ['department'],
};
// A role may sign the slot mapped to it (plus any ROLE_EXTRA_SLOTS). admin /
// super_admin do NOT sign at all (they manage + bill) — signing is reserved for
// the field/approval roles.
const canSignSlot = (role, slot) =>
  ROLE_SLOT[role] === slot || (ROLE_EXTRA_SLOTS[role] || []).includes(slot);
// A ใบงาน is "เซ็นครบ" (billable / ดำเนินการเสร็จสิ้น) only when ALL FOUR slots
// are signed: ช่างแอร์ + หัวหน้าช่าง + ช่างอาคาร + วิศวกรรม. (Worawit 8 Jul 2026 —
// previously the building/engineer pair could sign in place of each other, which
// let a WO show "เสร็จสิ้น" while the badge still said "รอช่างอาคารตรวจเช็ค".)
// building/engineer still sign in ANY ORDER — only the completeness rule changed.
//
// A branch may additionally require เจ้าหน้าที่เจ้าของพื้นที่ (department) — opt-in
// per branch via clients.require_department_sign (PTN, 5 Aug 2026). Branches with
// the flag OFF keep the exact 4-slot rule, so their existing ใบงาน never move.
// Callers pass { requireDepartment } from req.branch; omitting it = the 4-slot rule.
const REQUIRED_SLOTS = ['team', 'supervisor', 'building', 'engineer'];
const requiredSlots = (opts = {}) =>
  opts.requireDepartment ? [...REQUIRED_SLOTS, 'department'] : REQUIRED_SLOTS;
const allSigned = (wo, opts = {}) =>
  !!(wo && requiredSlots(opts).every((s) => wo[`sig_${s}`]));
// Same rule as SQL, for the queries that derive "เซ็นครบ" in the database.
// `alias` prefixes the columns (e.g. 's' → s.sig_team). Slot names are literals
// from REQUIRED_SLOTS — nothing from a request is interpolated here.
const allSignedSql = (opts = {}, alias = '') => {
  const p = alias ? `${alias}.` : '';
  return `(${requiredSlots(opts).map((s) => `${p}sig_${s} IS NOT NULL`).join(' AND ')})`;
};

// Signing order (display) + per-slot prerequisites. The chain is:
//   ช่างแอร์ → หัวหน้าช่าง → { ช่างอาคาร , วิศวกรรม }
// ช่างอาคาร and วิศวกรรม are a PARALLEL pair — once ช่างแอร์ + หัวหน้า have signed,
// either can sign in any order (they don't wait on each other).
// เจ้าหน้าที่เจ้าของพื้นที่ sits 4th in the DISPLAY order (ก่อนวิศวกรรม) but is a
// third member of the parallel group — วิศวกรรม never waits on it, or one ward
// staffer being unavailable would stall the whole ใบงาน.
const SIGN_ORDER = ['team', 'supervisor', 'building', 'department', 'engineer'];
const SLOT_TH = {
  team: 'ช่างแอร์', supervisor: 'หัวหน้าช่างแอร์', building: 'เจ้าหน้าที่ช่างอาคาร',
  department: 'เจ้าหน้าที่เจ้าของพื้นที่', engineer: 'เจ้าหน้าวิศวกรรม',
};
const SIG_PREREQ = {
  team:       [],
  supervisor: ['team'],
  building:   ['team', 'supervisor'],
  department: ['team', 'supervisor'],
  engineer:  ['team', 'supervisor'],
};
// First prerequisite slot still unsigned (the one blocking `slot`), or null if ready.
function blockingSlot(slot, wo) {
  for (const pre of SIG_PREREQ[slot] || []) {
    if (!wo || !wo[`sig_${pre}`]) return pre;
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
  requiredSlots, allSignedSql, EXTERNAL_SLOTS, ROLE_EXTRA_SLOTS,
  SIGN_ORDER, SIG_PREREQ, SLOT_TH, blockingSlot,
  LEGACY_ROLE_MAP, rankOf, REMAP_CASE_SQL,
};
