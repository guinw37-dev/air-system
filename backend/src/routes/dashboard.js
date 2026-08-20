// /api/dashboard — summary counts across งานซ่อมแอร์ (ac_repair_jobs), งานล้าง
// (simple_work_orders) and billing. Self-guarding on branch context:
//   • on a branch (X-Branch) → that branch's summary only
//   • on apex + super-admin  → every active branch + a grand total
//   • on apex, not super      → 403
const express = require('express');
const router = express.Router();
const { pool, query } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { allSignedSql, waitSlotSql } = require('../utils/roles');
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
// เซ็นครบ = ครบทั้ง 4 ช่อง (team+supervisor+building+engineer — Worawit 8 Jul 2026),
// บวก เจ้าหน้าที่เจ้าของพื้นที่ เฉพาะสาขาที่เปิด clients.require_department_sign (PTN).
// pending = not yet all-signed; ready = all-signed but not billed; billed = approved.
const allSignedOf = (b) => allSignedSql({ requireDepartment: !!(b && b.require_department_sign) });
const woSql = (b) => {
  const ALL_SIGNED = allSignedOf(b);
  return `
  SELECT
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved'
                     AND status <> 'rejected' AND NOT ${ALL_SIGNED})      AS wo_pending,
    -- stage buckets for ภาพรวมงานล้างแอร์ (landing). ใช้ waitSlotSql เดียวกับตัวกรอง
    -- ของหน้า ใบงาน (?pending=<slot>) — เลขบนการ์ดกับจำนวนแถวที่กดเข้าไปเห็นต้องตรงกัน.
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved'
                     AND status <> 'rejected' AND ${waitSlotSql('supervisor')}) AS wo_wait_supervisor,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved'
                     AND status <> 'rejected'
                     AND sig_team IS NOT NULL AND sig_supervisor IS NOT NULL
                     AND NOT ${ALL_SIGNED})                               AS wo_wait_buildeng,
    -- อาคาร / เจ้าของพื้นที่ / วิศวกรรม เซ็นขนานกัน → ใบเดียวนับได้หลายการ์ด
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved' AND status <> 'rejected'
                     AND ${waitSlotSql('building')})                      AS wo_wait_building,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved' AND status <> 'rejected'
                     AND ${waitSlotSql('department')})                    AS wo_wait_department,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved' AND status <> 'rejected'
                     AND ${waitSlotSql('engineer')})                      AS wo_wait_engineer,
    COUNT(*) FILTER (WHERE deleted_at IS NULL AND status <> 'approved'
                     AND ${ALL_SIGNED})                                   AS wo_done_full,
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
};

async function summarizeBranch(branch) {
  const schema = branch.schema_name || branch.slug;
  const z = { ac_register:0, ac_assign:0, ac_work:0, ac_clear:0, ac_close:0, ac_cancel:0,
              wo_pending:0, wo_wait_supervisor:0, wo_wait_buildeng:0,
              wo_wait_building:0, wo_wait_department:0, wo_wait_engineer:0, wo_done_full:0,
              wo_ready:0, wo_billed:0, wo_major:0, wo_minor:0, wo_fan:0 };
  // การ์ด "รอเจ้าของพื้นที่เซ็น" โผล่เฉพาะสาขาที่เปิดกติกา → ส่ง flag ไปให้ FE ตัดสินใจ
  const out = { id: branch.id, slug: branch.slug, name: branch.name,
                require_department_sign: !!branch.require_department_sign, ...z };
  try {
    const ac = await query(schema, AC_SQL);
    Object.assign(out, mapInts(ac.rows[0]));
  } catch (e) { out.error = true; }
  try {
    const wo = await query(schema, woSql(branch));
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
const recentWoSql = (b) => `
  SELECT wo_number, client_name, work_type, status, created_at,
         ${allSignedOf(b)} AS all_signed
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
      query(schema, recentWoSql(branch)),
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
      `SELECT id, slug, name, schema_name,
              COALESCE(require_department_sign, false) AS require_department_sign
         FROM clients
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
    const adjZ = zone ? ` AND zone = '${zone}'` : '';            // wash_count_adjust
    // wash_schedule ไม่มี pts_zone → join ทะเบียนเมื่อเลือก zone
    const schedFrom = zone
      ? `wash_schedule s JOIN wash_units wu ON wu.asset_code = s.asset_code AND wu.pts_zone = '${zone}'`
      : `wash_schedule s`;

    // daily — งานล้างของวันที่เลือก ต่อ work_type (work_date fallback created_at::date)
    const dailyRows = await safeRows(db,
      `SELECT work_type, ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL AND status <> 'rejected'
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
              COUNT(*) FILTER (WHERE status IN ('Register','Assign','Work On','Wait Parts'))::int AS pending
         FROM ac_repair_jobs
        WHERE to_char(register_time,'YYYY-MM') = $1`, [month]);
    const r0 = (repRows && repRows[0]) || {};
    // อะไหล่ที่ใช้เดือนนี้ — นับจาก parts JSONB ของใบงานซ่อม (รายการ + จำนวนงานที่มีอะไหล่)
    const partsRows = await safeRows(db,
      `SELECT COALESCE(SUM(jsonb_array_length(COALESCE(parts,'[]'::jsonb))),0)::int AS lines,
              COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE(parts,'[]'::jsonb)) > 0)::int AS jobs
         FROM ac_repair_jobs
        WHERE status <> 'Cancel' AND to_char(register_time,'YYYY-MM') = $1`, [month]);
    const p0 = (partsRows && partsRows[0]) || {};
    const repair = {
      done: r0.done || 0, total: r0.total || 0, pending: r0.pending || 0, month,
      parts_lines: p0.lines || 0, parts_jobs: p0.jobs || 0,
    };

    // service_targets sums: per work_type (monthly) and grand total (weekly split)
    const tgtRows = await safeRows(db,
      `SELECT work_type, SUM(monthly_target)::int AS target
         FROM service_targets WHERE (month = '${month}' OR month IS NULL)${stZ} GROUP BY work_type`) || [];
    const targetByType = {};
    let grandMonthlyTarget = 0;
    for (const t of tgtRows) {
      grandMonthlyTarget += t.target || 0;
      if (t.work_type) targetByType[t.work_type] = (targetByType[t.work_type] || 0) + (t.target || 0);
    }
    // monthly done per work_type (current month)
    const monRows = await safeRows(db,
      `SELECT work_type, ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL AND status <> 'rejected'
          AND to_char(COALESCE(work_date, created_at::date),'YYYY-MM') = $1${swoZ}
        GROUP BY work_type`, [month]) || [];
    const monDoneByRaw = Object.fromEntries(monRows.map((r) => [r.work_type, r.done || 0]));
    // ปรับยอดเอง (wash_count_adjust) เดือนนี้ ต่อประเภท
    const monAdj = await safeRows(db,
      `SELECT work_type, SUM(delta)::int AS d FROM wash_count_adjust
        WHERE month = $1${adjZ} AND work_type IS NOT NULL GROUP BY work_type`, [month]) || [];
    const monAdjBy = Object.fromEntries(monAdj.map((r) => [r.work_type, r.d || 0]));
    const monDoneBy = Object.fromEntries(WASH_TYPES.map((wt) => [wt, Math.max(0, (monDoneByRaw[wt] || 0) + (monAdjBy[wt] || 0))]));
    // เป้าเดือน = จากหน้าเป้าหมายล้าง (service_targets) ของเดือนที่เลือก ต่อประเภท
    const monTargetOf = (wt) => (targetByType[wt] || 0);

    // เป้า/วัน = (เป้าเดือน − ล้างแล้วในเดือน) ÷ วันที่เหลือในเดือน  ต่อประเภท
    // วันที่เหลือ = นับจากวันที่เลือกถึงสิ้นเดือน (รวมวันนี้). ถ้าวันที่เลือกอยู่คนละเดือน
    // กับเดือนที่เลือก ให้ถือว่าเริ่มต้นเดือน (ยังไม่ล้าง).
    const dSameMonth = date.slice(0, 7) === month;
    const dDay = dSameMonth ? parseInt(date.slice(8, 10), 10) : 1;
    const dLeft = Math.max(1, dim - dDay + 1);
    const perDayRemain = (wt) => {
      const remain = Math.max(0, monTargetOf(wt) - (dSameMonth ? (monDoneBy[wt] || 0) : 0));
      return Math.ceil(remain / dLeft);
    };
    daily.target_major = perDayRemain('major');
    daily.target_minor = perDayRemain('minor');
    daily.target_fan   = perDayRemain('fan');
    daily.target = daily.target_major + daily.target_minor + daily.target_fan;

    const monthly = {
      month,
      types: WASH_TYPES.map((wt) => ({
        work_type: wt, target: monTargetOf(wt), done: monDoneBy[wt] || 0,
      })),
    };

    // เป้าปี = SUM service_targets ตลอด 12 เดือนของปีนั้น ต่อ (work_type × ac_type)
    // month = 'YYYY-MM' นับครั้งเดียว; month IS NULL (ทุกเดือน) นับ 12 ครั้ง
    const styRows = await safeRows(db,
      `SELECT work_type, COALESCE(NULLIF(ac_type,''),'ไม่ระบุ') AS ac_type,
              COALESCE(SUM(monthly_target) FILTER (WHERE month LIKE $1),0)::int
              + 12 * COALESCE(SUM(monthly_target) FILTER (WHERE month IS NULL),0)::int AS target
         FROM service_targets
        WHERE (month LIKE $1 OR month IS NULL)${stZ}
        GROUP BY 1, 2`, [`${year}-%`]) || [];
    const yrTargetByType = {};              // wt → เป้าปีรวม
    const styByAcWt = {};                    // 'wt|ac' → เป้าปี
    for (const r of styRows) {
      if (r.work_type) yrTargetByType[r.work_type] = (yrTargetByType[r.work_type] || 0) + (r.target || 0);
      const k = `${r.work_type}|${r.ac_type}`;
      styByAcWt[k] = (styByAcWt[k] || 0) + (r.target || 0);
    }
    // done per work_type (current year) — นับงานล้างจริงทั้งหมด
    const yrRows = await safeRows(db,
      `SELECT work_type, ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL AND status <> 'rejected'
          AND EXTRACT(YEAR FROM COALESCE(work_date, created_at::date)) = $1${swoZ}
        GROUP BY work_type`, [year]) || [];
    const yrDoneRaw = Object.fromEntries(yrRows.map((r) => [r.work_type, r.done || 0]));
    // ปรับยอดเอง รายเดือน×ประเภท ทั้งปี
    const yrAdj = await safeRows(db,
      `SELECT (split_part(month,'-',2))::int AS m, work_type, SUM(delta)::int AS d
         FROM wash_count_adjust
        WHERE split_part(month,'-',1) = $1${adjZ} AND work_type IS NOT NULL
        GROUP BY m, work_type`, [String(year)]) || [];
    const yrAdjByWt = {}; const yrAdjByMonthWt = {};
    for (const a of yrAdj) {
      yrAdjByWt[a.work_type] = (yrAdjByWt[a.work_type] || 0) + (a.d || 0);
      (yrAdjByMonthWt[a.m] ||= {})[a.work_type] = a.d || 0;
    }
    const yrDoneBy = Object.fromEntries(WASH_TYPES.map((wt) => [wt, Math.max(0, (yrDoneRaw[wt] || 0) + (yrAdjByWt[wt] || 0))]));
    const yearly = {
      year,
      types: WASH_TYPES.map((wt) => ({
        work_type: wt, target: yrTargetByType[wt] || 0, done: yrDoneBy[wt] || 0,
      })),
    };

    // yearly graph series — ยอดล้างรายเดือน (ม.ค.–ธ.ค.) เทียบเป้า/เดือน (เป้าปี ÷ 12)
    const yrMonRows = await safeRows(db,
      `SELECT EXTRACT(MONTH FROM COALESCE(work_date, created_at::date))::int AS m,
              work_type, ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL AND status <> 'rejected'
          AND EXTRACT(YEAR FROM COALESCE(work_date, created_at::date)) = $1${swoZ}
        GROUP BY m, work_type`, [year]) || [];
    const yrGrandTarget = WASH_TYPES.reduce((s, wt) => s + (yrTargetByType[wt] || 0), 0);
    const monthlyTargetLine = Math.round(yrGrandTarget / 12);
    const seriesBy = {};   // m → { major, minor, fan }
    for (const r of yrMonRows) {
      (seriesBy[r.m] ||= {})[r.work_type] = r.done || 0;
    }
    yearly.series = Array.from({ length: 12 }, (_, i) => {
      const s = seriesBy[i + 1] || {};
      const adj = yrAdjByMonthWt[i + 1] || {};
      const v = (wt) => Math.max(0, (s[wt] || 0) + (adj[wt] || 0));
      const major = v('major'), minor = v('minor'), fan = v('fan');
      return { month: TH_MONTHS[i], major, minor, fan, total: major + minor + fan, target: monthlyTargetLine };
    });

    // ── แยกประเภทแอร์ (ac_type) — done เดือน/ปี + เป้าจาก service_targets (SUM 12 เดือน) ──
    // เป้าปี ต่อ (work_type × ac_type) = styByAcWt (คำนวณไว้ด้านบน). เป้าเดือน = ÷12.
    const acDoneMon = await safeRows(db,
      `SELECT work_type, COALESCE(NULLIF(ac_type,''),'ไม่ระบุ') AS ac_type, ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL AND status <> 'rejected'
          AND to_char(COALESCE(work_date, created_at::date),'YYYY-MM') = $1${swoZ}
        GROUP BY 1, 2`, [month]) || [];
    const acDoneYr = await safeRows(db,
      `SELECT work_type, COALESCE(NULLIF(ac_type,''),'ไม่ระบุ') AS ac_type, ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL AND status <> 'rejected'
          AND EXTRACT(YEAR FROM COALESCE(work_date, created_at::date)) = $1${swoZ}
        GROUP BY 1, 2`, [year]) || [];
    // index helpers
    const key = (wt, ac) => `${wt}|${ac}`;
    const doneMonBy = Object.fromEntries(acDoneMon.map((r) => [key(r.work_type, r.ac_type), r.done || 0]));
    const doneYrBy = Object.fromEntries(acDoneYr.map((r) => [key(r.work_type, r.ac_type), r.done || 0]));
    // union of ac_types seen anywhere, per work_type
    const byType = WASH_TYPES.map((wt) => {
      const acs = new Set();
      for (const r of styRows) if (r.work_type === wt && (r.target || 0) > 0) acs.add(r.ac_type);
      for (const r of acDoneMon) if (r.work_type === wt) acs.add(r.ac_type);
      for (const r of acDoneYr) if (r.work_type === wt) acs.add(r.ac_type);
      const rows = Array.from(acs).map((ac) => {
        const targetYear = styByAcWt[key(wt, ac)] || 0;
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

    // weekly — ช่วงสัปดาห์กำหนดเองจาก wash_week_config (admin ตั้ง) ต่อ zone+เดือน
    // ถ้าไม่มี config → fallback 4 bucket ตายตัว (1-7, 8-14, 15-21, 22-สิ้นเดือน) เป้า=เป้าเดือน÷4
    const pad = (n) => String(n).padStart(2, '0');
    const ymPrefix = `${year}-${pad(mon)}`;
    const cfgCols = 'week_no, day_from, day_to, target_major, target_minor, target_fan';
    // เลือก config ตรง zone ก่อน (NULL=NULL ก็ตรง); ถ้าเลือก zone แต่ไม่มี → ใช้ config zone ว่าง (ทุกโซน)
    let cfgRows = await safeRows(db,
      `SELECT ${cfgCols} FROM wash_week_config
        WHERE month = $1 AND zone IS NOT DISTINCT FROM $2 ORDER BY week_no`, [month, zone]) || [];
    if (!cfgRows.length && zone) {
      cfgRows = await safeRows(db,
        `SELECT ${cfgCols} FROM wash_week_config
          WHERE month = $1 AND zone IS NULL ORDER BY week_no`, [month]) || [];
    }
    const hasCfg = cfgRows.length > 0;
    const ranges = hasCfg
      ? cfgRows.map((c) => [c.day_from, c.day_to])
      : [[1, 7], [8, 14], [15, 21], [22, dim]];
    const fallbackBucket = grandMonthlyTarget > 0 ? Math.round(grandMonthlyTarget / 4) : 0;
    const cfgTargetOf = (i) => {
      const c = cfgRows[i] || {};
      return (c.target_major || 0) + (c.target_minor || 0) + (c.target_fan || 0);
    };
    // done per day-of-month (all work_types combined) → bucket in JS
    const dayRows = await safeRows(db,
      `SELECT EXTRACT(DAY FROM COALESCE(work_date, created_at::date))::int AS d,
              ${DONE_EXPR} AS done
         FROM simple_work_orders
        WHERE deleted_at IS NULL AND status <> 'rejected'
          AND to_char(COALESCE(work_date, created_at::date),'YYYY-MM') = $1${swoZ}
        GROUP BY d`, [month]) || [];
    const doneByDay = Object.fromEntries(dayRows.map((r) => [r.d, r.done || 0]));
    const weeks = ranges.map(([from, to], i) => {
      let done = 0;
      for (let d = from; d <= to; d++) done += doneByDay[d] || 0;
      const target = hasCfg ? cfgTargetOf(i) : fallbackBucket;
      const remaining = Math.max(0, target - done);
      const pct = target > 0 ? Math.round((done / target) * 100) : 0;
      return {
        no: hasCfg ? cfgRows[i].week_no : i + 1,
        from: `${ymPrefix}-${pad(from)}`,
        to: `${ymPrefix}-${pad(to)}`,
        label: `${from}-${to} ${TH_MONTHS[mon - 1]}`,
        target, done, remaining, pct,
      };
    });
    // สัปดาห์ปัจจุบัน (ช่วงที่วันนี้อยู่) → การ์ด "สัปดาห์นี้"
    const today = parseInt(date.slice(8), 10);
    const curIdx = ranges.findIndex(([f, t]) => today >= f && today <= t);
    const currentNo = curIdx >= 0 ? weeks[curIdx].no : (weeks.length ? weeks[weeks.length - 1].no : 1);
    const weekly = { month, weeks, current_no: currentNo, custom: hasCfg };

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

// ── รายงานล้างแอร์ตามช่วงวันที่ (จาก–ถึง) — ดูบนจอ + ออก PPTX ─────────────────
// สรุปช่วงวันที่กำหนดเอง: ยอดต่อประเภท, กราฟรายวัน, แยก ac_type, สถานที่,
// สภาพแอร์เสื่อม และรายละเอียดใบงานทุกใบ (cap ORDER_CAP แถว กัน deck บวม)
const ORDER_CAP = 400;
const UNITS_EXPR = `CASE WHEN work_type IN ('minor','fan')
                         THEN GREATEST(jsonb_array_length(COALESCE(grid_rows,'[]'::jsonb)), 1)
                         ELSE 1 END`;

async function buildWashRangeReport(req, from, to) {
  const db = req.db;
  const zone = ['PTS1', 'PTS2'].includes(req.query.zone) ? req.query.zone : null;
  const swoZ = zone ? ` AND pts_zone = '${zone}'` : '';
  const RANGE = `deleted_at IS NULL AND status <> 'rejected' AND COALESCE(work_date, created_at::date) BETWEEN $1::date AND $2::date${swoZ}`;

  // ยอดรวมต่อประเภท (นับเครื่องแบบเดียวกับหน้า wash-report)
  const totRows = await safeRows(db,
    `SELECT work_type, ${DONE_EXPR} AS done, COUNT(*)::int AS orders
       FROM simple_work_orders WHERE ${RANGE} GROUP BY work_type`, [from, to]) || [];
  const totBy = Object.fromEntries(totRows.map((r) => [r.work_type, r]));
  const totals = WASH_TYPES.map((wt) => ({
    work_type: wt, done: totBy[wt]?.done || 0, orders: totBy[wt]?.orders || 0,
  }));
  const grand = {
    done: totals.reduce((s, t) => s + t.done, 0),
    orders: totals.reduce((s, t) => s + t.orders, 0),
  };

  // กราฟรายวัน ต่อประเภท
  const dayRows = await safeRows(db,
    `SELECT COALESCE(work_date, created_at::date)::text AS d, work_type, ${DONE_EXPR} AS done
       FROM simple_work_orders WHERE ${RANGE} GROUP BY d, work_type ORDER BY d`, [from, to]) || [];
  const dayBy = {};
  for (const r of dayRows) (dayBy[r.d] ||= {})[r.work_type] = r.done || 0;
  const daily = Object.keys(dayBy).sort().map((d) => {
    const v = dayBy[d];
    const major = v.major || 0, minor = v.minor || 0, fan = v.fan || 0;
    return { date: d, major, minor, fan, total: major + minor + fan };
  });

  // แยกชนิดแอร์ (ac_type) ต่อประเภทงาน
  const acRows = await safeRows(db,
    `SELECT work_type, COALESCE(NULLIF(ac_type,''),'ไม่ระบุ') AS ac_type, ${DONE_EXPR} AS done
       FROM simple_work_orders WHERE ${RANGE} GROUP BY 1, 2 ORDER BY 1, done DESC`, [from, to]) || [];
  const byAcType = WASH_TYPES.map((wt) => ({
    work_type: wt,
    rows: acRows.filter((r) => r.work_type === wt).map((r) => ({ ac_type: r.ac_type, done: r.done || 0 })),
  })).filter((g) => g.rows.length);

  // สถานที่ top (location fallback client_name)
  const locRows = await safeRows(db,
    `SELECT COALESCE(NULLIF(location,''), NULLIF(client_name,''), 'ไม่ระบุ') AS location,
            ${DONE_EXPR} AS done, COUNT(*)::int AS orders
       FROM simple_work_orders WHERE ${RANGE}
      GROUP BY 1 ORDER BY done DESC LIMIT 12`, [from, to]) || [];
  const byLocation = locRows.map((r) => ({ location: r.location, done: r.done || 0, orders: r.orders || 0 }));

  // สภาพแอร์เสื่อม — นับอาการจาก condition.issues ในช่วง
  const condRows = await safeRows(db,
    `SELECT k AS issue, COUNT(*)::int AS n
       FROM simple_work_orders, jsonb_array_elements_text(COALESCE(condition->'issues','[]'::jsonb)) AS k
      WHERE ${RANGE} GROUP BY k ORDER BY n DESC`, [from, to]) || [];
  const conditionIssues = condRows.map((r) => ({ issue: r.issue, count: r.n || 0 }));

  // ผลงาน ok / not_ok
  const resRows = await safeRows(db,
    `SELECT COALESCE(NULLIF(result,''),'-') AS result, COUNT(*)::int AS n
       FROM simple_work_orders WHERE ${RANGE} GROUP BY 1`, [from, to]) || [];
  const resultBy = Object.fromEntries(resRows.map((r) => [r.result, r.n || 0]));

  // แยกยอดตามขั้นอนุมัติ — ให้ deck โชว์ที่มาของยอดรวม (เซ็นครบ vs ยังรอเซ็น)
  const apRows = await safeRows(db,
    `SELECT (status = 'approved') AS ap, ${DONE_EXPR} AS done, COUNT(*)::int AS orders
       FROM simple_work_orders WHERE ${RANGE} GROUP BY 1`, [from, to]) || [];
  const apBy = { approved: { done: 0, orders: 0 }, pending: { done: 0, orders: 0 } };
  for (const r of apRows) apBy[r.ap ? 'approved' : 'pending'] = { done: r.done || 0, orders: r.orders || 0 };

  // รายละเอียดใบงาน (ส่งงาน) — cap กันช่วงยาวเกิน
  const orderRows = await safeRows(db,
    `SELECT wo_number, COALESCE(work_date, created_at::date)::text AS work_date,
            work_type, COALESCE(NULLIF(ac_type,''),'-') AS ac_type,
            (${UNITS_EXPR})::int AS units,
            COALESCE(NULLIF(location,''), NULLIF(client_name,''), '-') AS location,
            COALESCE(NULLIF(building,''),'') AS building, COALESCE(NULLIF(floor,''),'') AS floor,
            COALESCE(NULLIF(room,''),'') AS room,
            COALESCE(NULLIF(tech_name,''),'-') AS tech_name,
            COALESCE(NULLIF(result,''),'-') AS result, status
       FROM simple_work_orders WHERE ${RANGE}
      ORDER BY COALESCE(work_date, created_at::date), wo_number
      LIMIT ${ORDER_CAP + 1}`, [from, to]) || [];
  const truncated = orderRows.length > ORDER_CAP;
  const orders = (truncated ? orderRows.slice(0, ORDER_CAP) : orderRows).map((r) => ({
    ...r,
    place: [r.location, r.building && `อาคาร ${r.building}`, r.floor && `ชั้น ${r.floor}`, r.room]
      .filter(Boolean).join(' › '),
  }));

  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  return {
    from, to, days, zone,
    branch: { name: req.branch?.name || '', slug: req.branch?.slug || '' },
    totals, grand, daily, byAcType, byLocation, conditionIssues,
    result: { ok: resultBy.ok || 0, not_ok: resultBy.not_ok || 0 },
    approval: apBy,
    orders, orders_truncated: truncated, order_cap: ORDER_CAP,
  };
}

// validate + normalize from/to (สลับให้ถ้าใส่กลับด้าน)
function parseRange(req) {
  const D = /^\d{4}-\d{2}-\d{2}$/;
  let { from, to } = req.query;
  if (!D.test(from || '') || !D.test(to || '')) return null;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

router.get('/wash-report/range', authMiddleware, async (req, res) => {
  if (!req.branch) return res.status(400).json({ error: 'ต้องเลือกสาขาก่อน' });
  const range = parseRange(req);
  if (!range) return res.status(400).json({ error: 'ระบุ from/to เป็น YYYY-MM-DD' });
  try { res.json(await buildWashRangeReport(req, range.from, range.to)); }
  catch (err) { serverError(res, err); }
});

// ── GET /wash-report/pptx — deck Theme3 (TW Corporate Infographic) ────────────
router.get('/wash-report/pptx', authMiddleware, async (req, res) => {
  if (!req.branch) return res.status(400).json({ error: 'ต้องเลือกสาขาก่อน' });
  const range = parseRange(req);
  if (!range) return res.status(400).json({ error: 'ระบุ from/to เป็น YYYY-MM-DD' });
  try {
    const model = await buildWashRangeReport(req, range.from, range.to);
    const { buildWashRangeDeck } = require('../services/washRangePptx');
    const buf = await buildWashRangeDeck(model);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition',
      `attachment; filename="wash-report_${range.from}_${range.to}_TW.pptx"`);
    res.send(buf);
  } catch (err) { serverError(res, err); }
});

module.exports = router;
