// ============================================================
// roles.js — single source of truth for the 5-role model + hierarchy.
//
//   Super Dev   super_admin  apex/public, cross-branch, owner only
//   Admin Dep.  admin        branch-local, full within the branch
//   Approve Dev approver     branch, approves work orders
//   Checker Dev checker      branch, supervisor / inspection
//   Technician  technician   branch, field tech
//
// Hierarchy rule: a user may only create / edit / delete a target whose rank is
// <= their own, and may never assign a role of higher rank than their own.
// Creating or editing a super_admin additionally requires a password step-up
// (see master.js). Legacy roles (central_admin/supervisor/building/field_tech)
// are retired and remapped to the new set on migration.
// ============================================================

const ROLE_RANK = {
  super_admin: 100,
  admin:       80,
  approver:    60,
  checker:     60,
  technician:  40,
};

const ALL_ROLES    = Object.keys(ROLE_RANK);
const SUPER_ROLES  = ['super_admin'];
const BRANCH_ROLES = ['admin', 'approver', 'checker', 'technician'];

// Retired roles → their replacement in the new model.
const LEGACY_ROLE_MAP = {
  central_admin: 'admin',
  supervisor:    'checker',
  building:      'technician',
  field_tech:    'technician',
};

const rankOf = (role) => ROLE_RANK[role] || 0;

// CASE expression to remap any legacy role to the new model in a single UPDATE.
const REMAP_CASE_SQL = `CASE role
  WHEN 'central_admin' THEN 'admin'
  WHEN 'supervisor'    THEN 'checker'
  WHEN 'building'      THEN 'technician'
  WHEN 'field_tech'    THEN 'technician'
  ELSE role END`;

module.exports = {
  ROLE_RANK, ALL_ROLES, SUPER_ROLES, BRANCH_ROLES,
  LEGACY_ROLE_MAP, rankOf, REMAP_CASE_SQL,
};
