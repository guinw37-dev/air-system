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
    -- stage buckets for ภาพรวมงานล้างแอร์ (landing): ช่างเซ็นแล้วรอหัวหน้า /
    -- หัวหน้าเซ็นแล้วรออาคารหรือวิศวกรรม. building/engineer = คู่ขนาน.
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved'
                     AND status <> 'rejected'
                     AND sig_team IS NOT NULL AND sig_supervisor IS NULL) AS wo_wait_supervisor,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved'
                     AND status <> 'rejected'
                     AND sig_team IS NOT NULL AND sig_supervisor IS NOT NULL
                     AND NOT ${ALL_SIGNED})                               AS wo_wait_buildeng,
    -- แยกแสดงผล 4 stage: รอช่างอาคาร (building ยังไม่เซ็น) / รอวิศวกรรม (building เซ็นแล้ว engineer ยังไม่เซ็น)
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved' AND status <> 'rejected'
                     AND sig_team IS NOT NULL AND sig_supervisor IS NOT NULL
                     AND sig_building IS NULL)                            AS wo_wait_building,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved' AND status <> 'rejected'
                     AND sig_team IS NOT NULL AND sig_supervisor IS NOT NULL
                     AND sig_building IS NOT NULL AND sig_engineer IS NULL) AS wo_wait_engineer,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved'
                     AND sig_team IS NOT NULL AND sig_supervisor IS NOT NULL
                     AND sig_building IS NOT NULL AND sig_engineer IS NOT NULL) AS wo_done_full,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved'
                     AND ${ALL_SIGNED})                                   AS wo_ready,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'approved')    AS wo_billed,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved'
                     AND work_type = 'major')                            AS wo_major,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved'
                     AND work_type = 'minor')                            AS wo_minor,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved'
                     AND work_type = 'fan')                              AS wo_fan
  FROM simple_work_orders`;

async function summarizeBranch(branch) {
  const schema = branch.schema_name || branch.slug;
  const z = { ac_register:0, ac_assign:0, ac_work:0, ac_clear:0, ac_close:0, ac_cancel:0,
              wo_pending:0, wo_wait_supervisor:0, wo_wait_buildeng:0,
              wo_wait_building:0, wo_wait_engineer:0, wo_done_full:0,
              wo_ready:0, wo_billed:0, wo_major:0, wo_minor:0, wo_fan:0 };
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
  out.wo_active = out.wo_pending + out.wo_ready;   // งานล้างค้าง (ยังไม่วางบิล)
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

// ── GET /wash-report — รายงานงานล้างแอร์ (per-branch, schema-per-tenant) ───────
// Branch-scoped: needs req.branch (set by the global resolveBranch when on a
// branch). Reuses the serviceTargets "done" expression (major = 1 ใบ/เครื่อง;
// minor/fan = นับแถวใน grid). Tolerant: a half-migrated branch (missing
// service_targets / wash_units) returns zeros instead of a 500.
const DONE_EXPR = `SUM(CASE WHEN work_type IN ('minor','fan')
                            THEN GREATEST(jsonb_array_length(COALESCE(grid_rows,'[]'::jsonb)), 1)
                            ELSE 1 END)::int`;
const WASH_TYPES = ['major', 'minor', 'fan'];
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                   'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// Run a query, returning [] (not throwing) if the table is missing mid-migration.
async function safeRows(db, sql, params) {
  try { const { rows } = await db(sql, params); return rows; }
  catch (e) { return null; }   // null = table unavailable → caller treats as zeros
}

async function buildWashReport(req) {
    const db = req.db;
    // server "today" / period anchors — computed in SQL so they match the DB tz.
    const meta = (await db(
      `SELECT CURRENT_DATE::text AS date,
              to_char(CURRENT_DATE,'YYYY-MM') AS month,
              EXTRACT(YEAR FROM CURRENT_DATE)::int AS year,
              EXTRACT(MONTH FROM CURRENT_DATE)::int AS mon,
              EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE)
                                + interval '1 month - 1 day'))::int AS dim`
    )).rows[0];

    // selectable period (เลือกวัน/เดือน/ปีได้) — validate format, else fall back to today.
    const qDate  = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')  ? req.query.date  : null;
    const qMonth = /^\d{4}-\d{2}$/.test(req.query.month || '')        ? req.query.month : null;
    const qYear  = /^\d{4}$/.test(String(req.query.year || ''))       ? Number(req.query.year) : null;

    const date = qDate || meta.date;
    let { month, year, mon, dim } = meta;
    if (qMonth) {
      month = qMonth; year = Number(qMonth.slice(0, 4)); mon = Number(qMonth.slice(5, 7));
      dim = new Date(year, mon, 0).getDate();           // last day of the chosen month
    }
    if (qYear) year = qYear;                             // yearly card year (independent of month)

    // ── zone filter (PTS1/PTS2) — whitelist แล้ว interpolate ได้ปลอดภัย ──────────
    const zone = ['PTS1', 'PTS2'].includes(req.query.zone) ? req.query.zone : null;
    const swoZ = zone ? ` AND pts_zone = '${zone}'` : '';        // simple_work_orders
    const wuZ  = zone ? ` AND pts_zone = '${zone}'` : '';        // wash_units
    const stZ  = zone ? ` AND zone = '${zone}'` : '';            // service_targets
    // wash_schedule ไม่มี pts_zone → join ทะเบียนเมื่อเลือก zone
    const schedFrom = zone
      ? `wash_schedule s JOIN wash_units wu ON wu.asset_code = s.asset_code AND wu.pts_zone = '${zone}'`
      : `wash_schedule s`;

    // daily — งานล้างของวันที่เลือก ต่อ work_type (work_date fallback created_at::date)
    const dailyRows = await safeRows(db,
      `SELECT work_type, ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL
          AND COALESCE(work_date, created_at::date) = $1::date${swoZ}
        GROUP BY work_type`, [date]) || [];
    const dailyBy = Object.fromEntries(dailyRows.map((r) => [r.work_type, r.done || 0]));
    const daily = {
      major: dailyBy.major || 0, minor: dailyBy.minor || 0, fan: dailyBy.fan || 0,
      total: (dailyBy.major || 0) + (dailyBy.minor || 0) + (dailyBy.fan || 0),
    };

    // repair — งานซ่อมประจำเดือนนี้ (สร้างในเดือน) ทั้งหมด/สำเร็จ/คงค้าง
    const repRows = await safeRows(db,
      `SELECT COUNT(*) FILTER (WHERE status <> 'Cancel')::int AS total,
              COUNT(*) FILTER (WHERE status IN ('Clear','Close'))::int AS done,
              COUNT(*) FILTER (WHERE status IN ('Register','Assign','Work On'))::int AS pending
         FROM ac_repair_jobs
        WHERE to_char(created_at,'YYYY-MM') = $1`, [month]);
    const r0 = (repRows && repRows[0]) || {};
    // อะไหล่ที่ใช้เดือนนี้ — นับจาก parts JSONB ของใบงานซ่อม (รายการ + จำนวนงานที่มีอะไหล่)
    const partsRows = await safeRows(db,
      `SELECT COALESCE(SUM(jsonb_array_length(COALESCE(parts,'[]'::jsonb))),0)::int AS lines,
              COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE(parts,'[]'::jsonb)) > 0)::int AS jobs
         FROM ac_repair_jobs
        WHERE status <> 'Cancel' AND to_char(created_at,'YYYY-MM') = $1`, [month]);
    const p0 = (partsRows && partsRows[0]) || {};
    const repair = {
      done: r0.done || 0, total: r0.total || 0, pending: r0.pending || 0, month,
      parts_lines: p0.lines || 0, parts_jobs: p0.jobs || 0,
    };

    // service_targets sums: per work_type (monthly) and grand total (weekly split)
    const tgtRows = await safeRows(db,
      `SELECT work_type, SUM(monthly_target)::int AS target
         FROM service_targets WHERE true${stZ} GROUP BY work_type`) || [];
    const targetByType = {};
    let grandMonthlyTarget = 0;
    for (const t of tgtRows) {
      grandMonthlyTarget += t.target || 0;
      if (t.work_type) targetByType[t.work_type] = (targetByType[t.work_type] || 0) + (t.target || 0);
    }
    const perDay = (v) => (dim > 0 ? Math.round((v || 0) / dim) : 0);
    // เป้า/วัน = จำนวนนัดในปฏิทินล้างแอร์ (wash_schedule) ของวันนั้น ต่อประเภท
    // (นับ planned + done = ที่วางแผนไว้). fallback เป็น เป้าเดือน÷วัน ถ้ายังไม่มีตาราง/แผน.
    const schedRows = await safeRows(db,
      `SELECT s.work_type, COUNT(*)::int AS n
         FROM ${schedFrom}
        WHERE s.planned_date = $1::date AND s.status IN ('planned','done')
        GROUP BY s.work_type`, [date]);
    const schedBy = Object.fromEntries((schedRows || []).map((r) => [r.work_type, r.n || 0]));
    const hasPlan = (schedRows || []).length > 0;
    daily.target_major = hasPlan ? (schedBy.major || 0) : perDay(targetByType.major);
    daily.target_minor = hasPlan ? (schedBy.minor || 0) : perDay(targetByType.minor);
    daily.target_fan = hasPlan ? (schedBy.fan || 0) : perDay(targetByType.fan);
    daily.target = daily.target_major + daily.target_minor + daily.target_fan;

    // monthly done per work_type (current month)
    const monRows = await safeRows(db,
      `SELECT work_type, ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL
          AND to_char(COALESCE(work_date, created_at::date),'YYYY-MM') = $1${swoZ}
        GROUP BY work_type`, [month]) || [];
    const monDoneBy = Object.fromEntries(monRows.map((r) => [r.work_type, r.done || 0]));
    // เป้าเดือน = จำนวนนัดในปฏิทินของเดือนนั้น (planned+done) ต่อประเภท; fallback service_targets
    const schedMonRows = await safeRows(db,
      `SELECT s.work_type, COUNT(*)::int AS n FROM ${schedFrom}
        WHERE to_char(s.planned_date,'YYYY-MM') = $1 AND s.status IN ('planned','done')
        GROUP BY s.work_type`, [month]);
    const schedMonBy = Object.fromEntries((schedMonRows || []).map((r) => [r.work_type, r.n || 0]));
    const schedMonTotal = (schedMonRows || []).reduce((s, r) => s + (r.n || 0), 0);
    const monTargetOf = (wt) => (schedMonTotal > 0 ? (schedMonBy[wt] || 0) : (targetByType[wt] || 0));
    const monthly = {
      month,
      types: WASH_TYPES.map((wt) => ({
        work_type: wt, target: monTargetOf(wt), done: monDoneBy[wt] || 0,
      })),
    };

    // yearly target from wash_units freq (active); done per work_type (current year)
    const freqRows = await safeRows(db,
      `SELECT COALESCE(SUM(freq_major),0)::int AS major,
              COALESCE(SUM(freq_minor),0)::int AS minor,
              COALESCE(SUM(freq_fan),0)::int   AS fan
         FROM wash_units WHERE active = true${wuZ}`);
    const freq = (freqRows && freqRows[0]) || { major: 0, minor: 0, fan: 0 };
    const yrRows = await safeRows(db,
      `SELECT work_type, ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL
          AND EXTRACT(YEAR FROM COALESCE(work_date, created_at::date)) = $1${swoZ}
        GROUP BY work_type`, [year]) || [];
    const yrDoneBy = Object.fromEntries(yrRows.map((r) => [r.work_type, r.done || 0]));
    const yearly = {
      year,
      types: WASH_TYPES.map((wt) => ({
        work_type: wt, target: freq[wt] || 0, done: yrDoneBy[wt] || 0,
      })),
    };

    // yearly graph series — ยอดล้างรายเดือน (ม.ค.–ธ.ค.) เทียบเป้า/เดือน (เป้าปี ÷ 12)
    const yrMonRows = await safeRows(db,
      `SELECT EXTRACT(MONTH FROM COALESCE(work_date, created_at::date))::int AS m,
              work_type, ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL
          AND EXTRACT(YEAR FROM COALESCE(work_date, created_at::date)) = $1${swoZ}
        GROUP BY m, work_type`, [year]) || [];
    const yrGrandTarget = (freq.major || 0) + (freq.minor || 0) + (freq.fan || 0);
    const monthlyTargetLine = Math.round(yrGrandTarget / 12);
    const seriesBy = {};   // m → { major, minor, fan }
    for (const r of yrMonRows) {
      (seriesBy[r.m] ||= {})[r.work_type] = r.done || 0;
    }
    yearly.series = Array.from({ length: 12 }, (_, i) => {
      const s = seriesBy[i + 1] || {};
      const total = (s.major || 0) + (s.minor || 0) + (s.fan || 0);
      return {
        month: TH_MONTHS[i], major: s.major || 0, minor: s.minor || 0, fan: s.fan || 0,
        total, target: monthlyTargetLine,
      };
    });

    // ── แยกประเภทแอร์ (ac_type) — done เดือน/ปี + เป้าจาก wash_units freq ────────
    // เป้าปี ต่อ (work_type × ac_type) = SUM(freq_X) group by ac_type. เป้าเดือน = ÷12.
    const acTgtRows = await safeRows(db,
      `SELECT COALESCE(NULLIF(ac_type,''),'ไม่ระบุ') AS ac_type,
              COALESCE(SUM(freq_major),0)::int AS major,
              COALESCE(SUM(freq_minor),0)::int AS minor,
              COALESCE(SUM(freq_fan),0)::int   AS fan
         FROM wash_units WHERE active = true${wuZ}
        GROUP BY 1`) || [];
    const acDoneMon = await safeRows(db,
      `SELECT work_type, COALESCE(NULLIF(ac_type,''),'ไม่ระบุ') AS ac_type, ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL
          AND to_char(COALESCE(work_date, created_at::date),'YYYY-MM') = $1${swoZ}
        GROUP BY 1, 2`, [month]) || [];
    const acDoneYr = await safeRows(db,
      `SELECT work_type, COALESCE(NULLIF(ac_type,''),'ไม่ระบุ') AS ac_type, ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL
          AND EXTRACT(YEAR FROM COALESCE(work_date, created_at::date)) = $1${swoZ}
        GROUP BY 1, 2`, [year]) || [];
    // index helpers
    const tgtByAc = Object.fromEntries(acTgtRows.map((r) => [r.ac_type, r]));
    const key = (wt, ac) => `${wt}|${ac}`;
    const doneMonBy = Object.fromEntries(acDoneMon.map((r) => [key(r.work_type, r.ac_type), r.done || 0]));
    const doneYrBy = Object.fromEntries(acDoneYr.map((r) => [key(r.work_type, r.ac_type), r.done || 0]));
    // union of ac_types seen anywhere, per work_type
    const byType = WASH_TYPES.map((wt) => {
      const acs = new Set();
      for (const r of acTgtRows) if ((r[wt] || 0) > 0) acs.add(r.ac_type);
      for (const r of acDoneMon) if (r.work_type === wt) acs.add(r.ac_type);
      for (const r of acDoneYr) if (r.work_type === wt) acs.add(r.ac_type);
      const rows = Array.from(acs).map((ac) => {
        const targetYear = (tgtByAc[ac] && tgtByAc[ac][wt]) || 0;
        return {
          ac_type: ac,
          done_month: doneMonBy[key(wt, ac)] || 0,
          done_year: doneYrBy[key(wt, ac)] || 0,
          target_year: targetYear,
          target_month: Math.round(targetYear / 12),
        };
      }).sort((a, b) => b.target_year - a.target_year || b.done_year - a.done_year);
      return { work_type: wt, rows };
    });

    // weekly — 4 buckets of the current month (1-7, 8-14, 15-21, 22-end)
    const fallbackBucket = grandMonthlyTarget > 0 ? Math.round(grandMonthlyTarget / 4) : 0;
    const ranges = [[1, 7], [8, 14], [15, 21], [22, dim]];
    const pad = (n) => String(n).padStart(2, '0');
    const ymPrefix = `${year}-${pad(mon)}`;
    // done per day-of-month (all work_types combined) → bucket in JS
    const dayRows = await safeRows(db,
      `SELECT EXTRACT(DAY FROM COALESCE(work_date, created_at::date))::int AS d,
              ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL
          AND to_char(COALESCE(work_date, created_at::date),'YYYY-MM') = $1${swoZ}
        GROUP BY d`, [month]) || [];
    const doneByDay = Object.fromEntries(dayRows.map((r) => [r.d, r.done || 0]));
    // เป้ารายวันจากปฏิทิน (planned+done) → bucket ต่อสัปดาห์; fallback เป้าเดือน÷4
    const schedDayRows = await safeRows(db,
      `SELECT EXTRACT(DAY FROM s.planned_date)::int AS d, COUNT(*)::int AS n
         FROM ${schedFrom}
        WHERE to_char(s.planned_date,'YYYY-MM') = $1 AND s.status IN ('planned','done')
        GROUP BY d`, [month]);
    const schedByDay = Object.fromEntries((schedDayRows || []).map((r) => [r.d, r.n || 0]));
    const hasWeekPlan = (schedDayRows || []).length > 0;
    const weeks = ranges.map(([from, to], i) => {
      let done = 0, plan = 0;
      for (let d = from; d <= to; d++) { done += doneByDay[d] || 0; plan += schedByDay[d] || 0; }
      const target = hasWeekPlan ? plan : fallbackBucket;
      const remaining = Math.max(0, target - done);
      const pct = target > 0 ? Math.round((done / target) * 100) : 0;
      return {
        no: i + 1,
        from: `${ymPrefix}-${pad(from)}`,
        to: `${ymPrefix}-${pad(to)}`,
        label: `${from}-${to} ${TH_MONTHS[mon - 1]}`,
        target, done, remaining, pct,
      };
    });
    // สัปดาห์ปัจจุบัน (bucket ที่วันนี้อยู่) → การ์ด "สัปดาห์นี้"
    const today = parseInt(date.slice(8), 10);
    const currentNo = ranges.findIndex(([f, t]) => today >= f && today <= t) + 1 || weeks.length;
    const weekly = { month, weeks, current_no: currentNo };

    return { date, daily, repair, monthly, yearly, weekly, byType };
}

router.get('/wash-report', authMiddleware, async (req, res) => {
  if (!req.branch) return res.status(400).json({ error: 'ต้องเลือกสาขาก่อน' });
  try { res.json(await buildWashReport(req)); }
  catch (err) { serverError(res, err); }
});

// ── GET /wash-report/excel — export รายงานล้างแอร์เป็น Excel (หลาย sheet) ──────
router.get('/wash-report/excel', authMiddleware, async (req, res) => {
  if (!req.branch) return res.status(400).json({ error: 'ต้องเลือกสาขาก่อน' });
  try {
    const XLSX = require('xlsx');
    const r = await buildWashReport(req);
    const WTL = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลม' };
    const wb = XLSX.utils.book_new();

    const summary = [
      ['รายงานงานล้างแอร์', r.date],
      [],
      ['สรุปงานล้างประจำวัน', 'จำนวน (ตัว)', 'เป้า/วัน'],
      ['ล้างใหญ่', r.daily.major, r.daily.target_major],
      ['ล้างย่อย', r.daily.minor, r.daily.target_minor],
      ['พัดลม', r.daily.fan, r.daily.target_fan],
      ['รวม', r.daily.total, r.daily.target],
      [],
      ['สรุปงานซ่อมประจำเดือน', 'จำนวน'],
      ['สำเร็จ', r.repair.done],
      ['ทั้งหมด', r.repair.total],
      ['คงค้าง', r.repair.pending],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'สรุป');

    const monthly = [['ประเภท', 'เป้าหมายเดือน', 'ยอดล้าง'],
      ...r.monthly.types.map((t) => [WTL[t.work_type] || t.work_type, t.target, t.done])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(monthly), 'เป้าหมายเดือน');

    const yearly = [['ประเภท', 'เป้าหมายปี', 'ยอดล้าง', 'เหลือ'],
      ...r.yearly.types.map((t) => [WTL[t.work_type] || t.work_type, t.target, t.done, Math.max(0, t.target - t.done)])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(yearly), 'สะสมปี');

    const weekly = [['สัปดาห์', 'ช่วง', 'เป้าหมาย', 'ยอดล้าง', 'คงค้าง', '% สำเร็จ'],
      ...r.weekly.weeks.map((w) => [`Week ${w.no}`, w.label, w.target, w.done, w.remaining, w.pct])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(weekly), 'รายสัปดาห์');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="wash-report-${r.date}.xlsx"`);
    res.send(buf);
  } catch (err) { serverError(res, err); }
});

module.exports = router;
