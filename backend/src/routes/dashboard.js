// /api/dashboard — summary counts across งานซ่อมแอร์ (ac_repair_jobs), งานล้าง
// (simple_work_orders) and billing. Self-guarding on branch context:
//   • on a branch (X-Branch) → that branch's summary only
//   • on apex + super-admin  → every active branch + a grand total
//   • on apex, not super      → 403
const express = require('express');
const router = express.Router();
const { pool, query } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { serverError } = require('../utils/respond');

// ── per-schema summary. Tolerant: a branch missing a table (mid-migration)
// yields zeros instead of failing the whole dashboard. ───────────────────────
const AC_SQL = `
  SELECT
    COALESCE(SUM((status='Register')::int),0) AS ac_register,
    COALESCE(SUM((status='Assign')::int),0)   AS ac_assign,
    COALESCE(SUM((status='Work On')::int),0)  AS ac_work,
    COALESCE(SUM((status='Clear')::int),0)    AS ac_clear,
    COALESCE(SUM((status='Close')::int),0)    AS ac_close,
    COALESCE(SUM((status='Cancel')::int),0)   AS ac_cancel
  FROM ac_repair_jobs`;

// งานล้าง buckets — same sig logic as the simple-wo list (team + supervisor +
// one of building/engineer = all_signed). pending = not yet all-signed;
// ready = all-signed but not billed; billed = status approved.
const ALL_SIGNED = `(sig_team IS NOT NULL AND sig_supervisor IS NOT NULL
                     AND (sig_building IS NOT NULL OR sig_engineer IS NOT NULL))`;
const WO_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved'
                     AND status <> 'rejected' AND NOT ${ALL_SIGNED})      AS wo_pending,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved'
                     AND ${ALL_SIGNED})                                   AS wo_ready,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'approved')    AS wo_billed
  FROM simple_work_orders`;

async function summarizeBranch(branch) {
  const schema = branch.schema_name || branch.slug;
  const z = { ac_register:0, ac_assign:0, ac_work:0, ac_clear:0, ac_close:0, ac_cancel:0,
              wo_pending:0, wo_ready:0, wo_billed:0 };
  const out = { id: branch.id, slug: branch.slug, name: branch.name, ...z };
  try {
    const ac = await query(schema, AC_SQL);
    Object.assign(out, mapInts(ac.rows[0]));
  } catch (e) { out.error = true; }
  try {
    const wo = await query(schema, WO_SQL);
    Object.assign(out, mapInts(wo.rows[0]));
  } catch (e) { out.error = true; }
  // derived
  out.ac_active = out.ac_register + out.ac_assign + out.ac_work + out.ac_clear;
  return out;
}
const mapInts = (row) => Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [k, Number(v) || 0]));

// Sum the numeric fields of many branch summaries into one total.
function totalOf(branches) {
  const keys = ['ac_register','ac_assign','ac_work','ac_clear','ac_close','ac_cancel',
                'ac_active','wo_pending','wo_ready','wo_billed'];
  const t = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const b of branches) for (const k of keys) t[k] += b[k] || 0;
  return t;
}

// ── richer branch detail (recent lists + 6-month trend) for the branch view ──
const RECENT_AC_SQL = `
  SELECT id, job_number, description, department, status, register_time
  FROM ac_repair_jobs
  WHERE status NOT IN ('Close','Cancel')
  ORDER BY register_time DESC LIMIT 6`;
const RECENT_WO_SQL = `
  SELECT wo_number, client_name, work_type, status, created_at,
         ${ALL_SIGNED} AS all_signed
  FROM simple_work_orders
  WHERE deleted_at IS NULL
  ORDER BY created_at DESC LIMIT 6`;
const TREND_AC_SQL = `
  SELECT to_char(register_time,'YYYY-MM') ym, COUNT(*)::int c
  FROM ac_repair_jobs
  WHERE register_time >= date_trunc('month', now()) - interval '5 months'
  GROUP BY ym`;
const TREND_WO_SQL = `
  SELECT to_char(created_at,'YYYY-MM') ym, COUNT(*)::int c
  FROM simple_work_orders
  WHERE deleted_at IS NULL AND created_at >= date_trunc('month', now()) - interval '5 months'
  GROUP BY ym`;

// Build the last 6 month keys (YYYY-MM), oldest → newest, anchored to a passed
// "now" so the series is stable across the two queries.
function lastSixMonths(now) {
  const out = [];
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

async function branchDetail(branch) {
  const schema = branch.schema_name || branch.slug;
  const summary = await summarizeBranch(branch);
  const detail = { recentRepair: [], recentWo: [], trend: [] };
  try {
    const [ra, rw, ta, tw] = await Promise.all([
      query(schema, RECENT_AC_SQL),
      query(schema, RECENT_WO_SQL),
      query(schema, TREND_AC_SQL),
      query(schema, TREND_WO_SQL),
    ]);
    detail.recentRepair = ra.rows;
    detail.recentWo = rw.rows;
    const acByM = Object.fromEntries(ta.rows.map((r) => [r.ym, r.c]));
    const woByM = Object.fromEntries(tw.rows.map((r) => [r.ym, r.c]));
    detail.trend = lastSixMonths(new Date()).map((ym) => ({
      ym, month: ym.slice(5), repair: acByM[ym] || 0, wash: woByM[ym] || 0,
    }));
  } catch (e) { /* tolerate a mid-migration schema — summary still returns */ }
  return { ...summary, ...detail };
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    // Branch context → just this branch (with recent lists + trend).
    if (req.branch) {
      const branch = await branchDetail(req.branch);
      return res.json({ scope: 'branch', branch });
    }
    // Apex → super-admin only, aggregate every active branch.
    if (!req.user?.isSuper && req.user?.role !== 'super_admin') {
      return res.status(403).json({ error: 'เฉพาะ super-admin ดูภาพรวมทุกสาขาได้' });
    }
    const { rows } = await pool.query(
      `SELECT id, slug, name, schema_name FROM clients
         WHERE active = true AND schema_name IS NOT NULL ORDER BY name`
    );
    const branches = await Promise.all(rows.map(summarizeBranch));
    res.json({ scope: 'all', branches, total: totalOf(branches) });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
