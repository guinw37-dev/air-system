/**
 * /api/mcp — read-only MCP (Model Context Protocol) endpoint for air-system.
 *
 * Lets a Claude client query the AC wash/repair data of any branch directly.
 * Streamable-HTTP flavour, stateless: every request is one JSON-RPC message
 * POSTed here; no SSE stream, no sessions. Same design as repair-system /api/mcp.
 *
 *   claude mcp add --transport http air https://api.tw-carework.online/api/mcp \
 *     --header "Authorization: Bearer <MCP_API_KEY>"
 *
 * Security (fail-closed, read-only by construction):
 * - Auth: Bearer key compared timing-safe against env MCP_API_KEY (Coolify).
 *   No key (or shorter than 24 chars) => 503 for every call.
 * - Every tool query runs inside BEGIN READ ONLY + statement_timeout, so the
 *   database itself refuses a write even if a tool's SQL were wrong.
 * - There is deliberately no tool that writes. A write tool needs ป้อม's OK per tool.
 * - branch input is validated (slug pattern) and looked up in public.clients
 *   (active) before its schema is used; slugToSchema whitelists it again.
 * - PII kept out: no requester name/phone, no signature images, no photos.
 * - Row caps on every list; rate limited per IP at the mount point (app.js).
 *
 * The RPC core is exported as buildMcp(deps) so tests drive it with a fake db
 * (test/mcp.test.js).
 */
const crypto = require('crypto');
const { UNITS_EXPR, washDateExpr } = require('../utils/washCount');
const { notWashedQuery, NW_TYPES } = require('../services/notWashed');

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'air-system', version: '1.0.0' };

const WO_STATUSES = ['submitted', 'checked', 'approved', 'rejected'];
const AC_STATUSES = ['Register', 'Assign', 'Work On', 'Wait Parts', 'Wait Quote', 'Clear', 'Close', 'Cancel'];
const AC_OPEN = ['Register', 'Assign', 'Work On', 'Wait Parts', 'Wait Quote'];
const ZONES = ['PTS1', 'PTS2'];
const YM = /^\d{4}-\d{2}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9-]{1,63}$/;

const branchArg = { type: 'string', description: 'branch slug จาก list_branches เช่น phayathai-sriracha' };
const TOOLS = [
  {
    name: 'list_branches',
    description: 'รายชื่อสาขา (slug + ชื่อ) ที่เปิดใช้งาน — เรียกก่อนเพื่อเอา slug ไปใช้กับ tool อื่น',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'wash_daily',
    description: 'ยอดล้าง (นับเป็นเครื่อง ไม่รวมใบส่งกลับ — ตัวเลขเดียวกับปฏิทินในรายงานล้าง). ส่ง date = สรุปวันนั้น + รายการใบงาน (สูงสุด 100); ไม่ส่ง date = ยอดรายวันทั้งเดือน (month, ค่าเริ่มต้น = เดือนนี้)',
    inputSchema: {
      type: 'object',
      properties: {
        branch: branchArg,
        date: { type: 'string', description: 'YYYY-MM-DD' },
        month: { type: 'string', description: 'YYYY-MM (ใช้เมื่อไม่ส่ง date)' },
        zone: { type: 'string', enum: ZONES, description: 'เฉพาะสาขาที่มีโซน (ศรีราชา)' },
      },
      required: ['branch'],
      additionalProperties: false,
    },
  },
  {
    name: 'wo_search',
    description: 'ค้นใบงานล้างในเดือน กรองประเภทล้าง / ประเภทแอร์-พัดลม / สถานะ / โซน — คืนจำนวนทั้งหมด + รายการ (สูงสุด 100)',
    inputSchema: {
      type: 'object',
      properties: {
        branch: branchArg,
        month: { type: 'string', description: 'YYYY-MM (วันที่ของงานล้าง = work_date หรือวันสร้างใบ)' },
        work_type: { type: 'string', enum: NW_TYPES },
        ac_type: { type: 'string', description: 'FCU/SPT/VRF/AHU/OAU/Exhaust Fan/Exhaust Fan Duct Type หรือ none = ไม่ระบุ' },
        status: { type: 'string', enum: WO_STATUSES, description: 'submitted=รอเซ็น approved=วางบิลแล้ว rejected=ส่งกลับ' },
        zone: { type: 'string', enum: ZONES },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['branch', 'month'],
      additionalProperties: false,
    },
  },
  {
    name: 'ac_repair_status',
    description: 'งานซ่อมแอร์: จำนวนตามสถานะ (รวม Wait Quote = รอเสนอราคาซ่อม) + รายการใบ (ค่าเริ่มต้น = งานค้าง, สูงสุด 50). ไม่มีชื่อ/เบอร์ผู้แจ้งและรูปลายเซ็น',
    inputSchema: {
      type: 'object',
      properties: {
        branch: branchArg,
        status: { type: 'string', enum: ['open', 'all', ...AC_STATUSES] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['branch'],
      additionalProperties: false,
    },
  },
  {
    name: 'wash_plan',
    description: 'เป้าหมายล้างของวัน (นัดในปฏิทินล้างแอร์, สูงสุด 200) + จำนวนเครื่องที่ยังไม่ล้างในเดือนนั้นแยกประเภท. date ค่าเริ่มต้น = พรุ่งนี้ (เวลาไทย)',
    inputSchema: {
      type: 'object',
      properties: {
        branch: branchArg,
        date: { type: 'string', description: 'YYYY-MM-DD' },
        work_type: { type: 'string', enum: NW_TYPES },
      },
      required: ['branch'],
      additionalProperties: false,
    },
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}
function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function toolText(obj) { return { content: [{ type: 'text', text: JSON.stringify(obj, null, 1) }] }; }
function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}
// วันที่ตามเวลาไทย (เซิร์ฟเวอร์อาจเป็น UTC) — ใช้เป็นค่าเริ่มต้นเท่านั้น
function bangkokDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}
class ToolError extends Error {}
const need = (cond, msg) => { if (!cond) throw new ToolError(msg); };

// ใบซ่อม: ส่งเฉพาะฟิลด์งาน — ไม่มี requester/telephone/รูป/ลายเซ็น (กันหลุดแม้ SQL เผลอ select มา)
const sanitizeAcJob = (j) => ({
  job_number: j.job_number, status: j.status,
  building: j.building, floor: j.floor, department: j.department,
  description: j.description, issue_type: j.issue_type || null, assign_name: j.assign_name || null,
  register_time: j.register_time, start_time: j.start_time || null,
  wait_parts_time: j.wait_parts_time || null, wait_quote_time: j.wait_quote_time || null,
  wait_quote_note: j.wait_quote_note || null, clear_time: j.clear_time || null,
  requester_signed: !!j.requester_signed, tech_signed: !!j.tech_signed,
});

/**
 * Build the MCP request handler from injectable deps:
 *   deps.publicQuery(sql, params)   — public schema (branch registry)
 *   deps.ro(schema, sql, params)    — read-only, time-limited query in a branch schema
 */
function buildMcp(deps) {
  async function branchOf(slug) {
    need(SLUG.test(String(slug || '')), 'branch ต้องเป็น slug จาก list_branches');
    const { rows } = await deps.publicQuery(
      `SELECT slug, name, schema_name FROM public.clients WHERE slug = $1 AND active = true`, [slug]);
    need(rows.length, `ไม่พบสาขา ${slug}`);
    return { slug: rows[0].slug, name: rows[0].name, schema: rows[0].schema_name || rows[0].slug };
  }

  const impl = {
    async list_branches() {
      const { rows } = await deps.publicQuery(
        `SELECT slug, name FROM public.clients WHERE active = true AND slug IS NOT NULL ORDER BY name`, []);
      return { branches: rows.map((r) => ({ slug: r.slug, name: r.name })) };
    },

    async wash_daily(a) {
      const b = await branchOf(a.branch);
      need(!a.zone || ZONES.includes(a.zone), 'zone ต้องเป็น PTS1 หรือ PTS2');
      const params = []; const where = ['deleted_at IS NULL', "status <> 'rejected'"];
      if (a.zone) { params.push(a.zone); where.push(`pts_zone = $${params.length}`); }
      if (a.date) {
        need(YMD.test(a.date), 'date ต้องเป็น YYYY-MM-DD');
        params.push(a.date); where.push(`${washDateExpr()} = $${params.length}::date`);
        const w = where.join(' AND ');
        const tot = await deps.ro(b.schema,
          `SELECT work_type, SUM(${UNITS_EXPR})::int AS machines, COUNT(*)::int AS orders
             FROM simple_work_orders WHERE ${w} GROUP BY work_type ORDER BY work_type`, params);
        const list = await deps.ro(b.schema,
          `SELECT wo_number, work_type, ac_type, (${UNITS_EXPR})::int AS machines, status, pts_zone,
                  COALESCE(NULLIF(location,''), client_name) AS location, building, tech_name
             FROM simple_work_orders WHERE ${w} ORDER BY wo_number LIMIT 100`, params);
        return { branch: b.slug, date: a.date, zone: a.zone || null, by_type: tot.rows,
          total_machines: tot.rows.reduce((s, r) => s + r.machines, 0), orders: list.rows };
      }
      const month = a.month || bangkokDate().slice(0, 7);
      need(YM.test(month), 'month ต้องเป็น YYYY-MM');
      params.push(month); where.push(`to_char(${washDateExpr()}, 'YYYY-MM') = $${params.length}`);
      const { rows } = await deps.ro(b.schema,
        `SELECT ${washDateExpr()}::text AS date, work_type, SUM(${UNITS_EXPR})::int AS machines
           FROM simple_work_orders WHERE ${where.join(' AND ')} GROUP BY 1, 2 ORDER BY 1, 2`, params);
      const days = {};
      for (const r of rows) (days[r.date] ||= { date: r.date, major: 0, minor: 0, fan: 0, total: 0 })[r.work_type || 'major'] += r.machines;
      for (const d of Object.values(days)) d.total = d.major + d.minor + d.fan;
      return { branch: b.slug, month, zone: a.zone || null, days: Object.values(days) };
    },

    async wo_search(a) {
      const b = await branchOf(a.branch);
      need(YM.test(String(a.month || '')), 'month ต้องเป็น YYYY-MM');
      need(!a.work_type || NW_TYPES.includes(a.work_type), 'work_type ต้องเป็น major | minor | fan');
      need(!a.status || WO_STATUSES.includes(a.status), 'status ไม่ถูกต้อง');
      need(!a.zone || ZONES.includes(a.zone), 'zone ต้องเป็น PTS1 หรือ PTS2');
      need(!a.ac_type || String(a.ac_type).length <= 40, 'ac_type ยาวเกิน');
      const limit = clampInt(a.limit, 1, 100, 50);
      const params = [a.month]; const where = ['deleted_at IS NULL', `to_char(${washDateExpr()}, 'YYYY-MM') = $1`];
      const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
      if (a.work_type) add("COALESCE(work_type, 'major') = ?", a.work_type);
      if (a.status) add("COALESCE(status, 'submitted') = ?", a.status);
      if (a.zone) add('pts_zone = ?', a.zone);
      if (a.ac_type === 'none') where.push("COALESCE(ac_type, '') = ''");
      else if (a.ac_type) add('ac_type = ?', String(a.ac_type));
      const w = where.join(' AND ');
      const cnt = await deps.ro(b.schema, `SELECT COUNT(*)::int AS n, COALESCE(SUM(${UNITS_EXPR}),0)::int AS machines FROM simple_work_orders WHERE ${w}`, params);
      const { rows } = await deps.ro(b.schema,
        `SELECT wo_number, ${washDateExpr()}::text AS wash_date, work_type, ac_type,
                (${UNITS_EXPR})::int AS machines, COALESCE(status, 'submitted') AS status, result,
                pts_zone, COALESCE(NULLIF(location,''), client_name) AS location, building, floor, tech_name
           FROM simple_work_orders WHERE ${w}
          ORDER BY ${washDateExpr()} DESC, wo_number DESC LIMIT ${limit}`, params);
      return { branch: b.slug, month: a.month, total_orders: cnt.rows[0].n, total_machines: cnt.rows[0].machines,
        returned: rows.length, orders: rows };
    },

    async ac_repair_status(a) {
      const b = await branchOf(a.branch);
      const st = a.status || 'open';
      need(st === 'open' || st === 'all' || AC_STATUSES.includes(st), 'status ไม่ถูกต้อง');
      const limit = clampInt(a.limit, 1, 50, 20);
      const counts = await deps.ro(b.schema,
        `SELECT status, COUNT(*)::int AS n FROM ac_repair_jobs GROUP BY status ORDER BY status`, []);
      const params = []; let where = '';
      if (st === 'open') { params.push(AC_OPEN); where = 'WHERE status = ANY($1::text[])'; }
      else if (st !== 'all') { params.push(st); where = 'WHERE status = $1'; }
      const { rows } = await deps.ro(b.schema,
        `SELECT job_number, status, building, floor, department, description, issue_type, assign_name,
                register_time, start_time, wait_parts_time, wait_quote_time, wait_quote_note, clear_time,
                (sig_requester IS NOT NULL) AS requester_signed, (sig_tech IS NOT NULL) AS tech_signed
           FROM ac_repair_jobs ${where} ORDER BY register_time DESC LIMIT ${limit}`, params);
      const byStatus = Object.fromEntries(counts.rows.map((r) => [r.status, r.n]));
      return { branch: b.slug, counts: byStatus,
        open: AC_OPEN.reduce((s, k) => s + (byStatus[k] || 0), 0),
        filter: st, returned: rows.length, jobs: rows.map(sanitizeAcJob) };
    },

    async wash_plan(a) {
      const b = await branchOf(a.branch);
      const date = a.date || bangkokDate(1);
      need(YMD.test(date), 'date ต้องเป็น YYYY-MM-DD');
      need(!a.work_type || NW_TYPES.includes(a.work_type), 'work_type ต้องเป็น major | minor | fan');
      const params = [date]; let extra = '';
      if (a.work_type) { params.push(a.work_type); extra = ' AND s.work_type = $2'; }
      const { rows } = await deps.ro(b.schema,
        `SELECT s.asset_code, s.work_type, s.status, u.pts_zone, u.location, u.building, u.floor, u.room, u.ac_type
           FROM wash_schedule s LEFT JOIN wash_units u ON u.asset_code = s.asset_code
          WHERE s.planned_date = $1::date${extra}
          ORDER BY s.work_type, u.building, u.floor, u.room, s.asset_code LIMIT 200`, params);
      const month = date.slice(0, 7);
      const notWashed = {};
      for (const wt of (a.work_type ? [a.work_type] : NW_TYPES)) {
        const q = notWashedQuery({ month, work_type: wt });
        const r = await deps.ro(b.schema, q.sql, q.params);
        notWashed[wt] = { units: r.rows.length, not_washed: r.rows.filter((x) => !x.washed_in_month).length };
      }
      const byType = {};
      for (const r of rows) {
        const t = (byType[r.work_type] ||= { planned: 0, done: 0, skipped: 0 });
        if (t[r.status] !== undefined) t[r.status] += 1;
      }
      return { branch: b.slug, date, month, targets_by_type: byType, not_washed_in_month: notWashed,
        returned: rows.length, targets: rows };
    },
  };

  return async function handle(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return rpcError(msg && msg.id, -32600, 'invalid request');
    }
    const { id, method, params } = msg;
    if (method === 'initialize') {
      return rpcResult(id, {
        protocolVersion: (params && typeof params.protocolVersion === 'string') ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'MCP อ่านอย่างเดียวของระบบงานแอร์ TW (air-system) — เริ่มจาก list_branches เพื่อได้ slug แล้วใช้ wash_daily / wo_search (งานล้าง) · ac_repair_status (งานซ่อมแอร์) · wash_plan (เป้าหมายล้างของวัน + เครื่องที่ยังไม่ล้าง)',
      });
    }
    if (method.startsWith('notifications/')) return null;   // ack, no body
    if (method === 'ping') return rpcResult(id, {});
    if (method === 'tools/list') return rpcResult(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const name = params && params.name;
      const fn = Object.prototype.hasOwnProperty.call(impl, name) ? impl[name] : null;
      if (!fn || !TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `unknown tool: ${name}`);
      try {
        return rpcResult(id, toolText(await fn((params && params.arguments) || {})));
      } catch (e) {
        // tool-level failure => isError result (per MCP). Only our own validation messages
        // go back verbatim; database/internal errors are not echoed (no schema details leak).
        const text = e instanceof ToolError ? `error: ${e.message}` : 'error: internal error';
        if (!(e instanceof ToolError)) console.error('[mcp]', name, e.message);
        return rpcResult(id, { content: [{ type: 'text', text }], isError: true });
      }
    }
    return rpcError(id, -32601, `method not found: ${method}`);
  };
}

// ── read-only query runner ───────────────────────────────────────────────────
// Every tool query runs in BEGIN READ ONLY + statement_timeout: Postgres itself refuses
// INSERT/UPDATE/DELETE/DDL here, whatever the SQL says. Exported so the guarantee can be
// checked against a real database (.localdb check), not only with fakes.
function makeReadOnly(txClient, timeout = '8s') {
  return async function ro(schema, sql, params) {
    const client = await txClient(schema);
    try {
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = '${timeout}'`);
      const r = await client.query(sql, params);
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  };
}

// ── express wiring: auth + transport ─────────────────────────────────────────
function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function buildRouter({ getKey = () => process.env.MCP_API_KEY, deps } = {}) {
  const router = require('express').Router();
  let handle = null;
  const handler = () => {
    if (handle) return handle;
    let d = deps;
    if (!d) {
      const { pool, txClient } = require('../db');
      d = { publicQuery: (sql, params) => pool.query(sql, params), ro: makeReadOnly(txClient) };
    }
    handle = buildMcp(d);
    return handle;
  };

  router.post('/', async (req, res) => {
    try {
      const key = getKey();
      if (!key || String(key).length < 24) return res.status(503).json(rpcError(null, -32000, 'MCP is not enabled on this server'));
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token || !timingSafeEq(token, key)) return res.status(401).json(rpcError(null, -32000, 'unauthorized'));
      const body = req.body;
      if (Array.isArray(body)) return res.status(400).json(rpcError(null, -32600, 'batch requests not supported'));
      const out = await handler()(body);
      if (out === null) return res.status(202).end();   // notification
      res.json(out);
    } catch (e) {
      console.error('[mcp] transport', e.message);
      res.status(500).json(rpcError(null, -32603, 'internal error'));
    }
  });
  // Streamable HTTP allows servers without a stream: reject GET politely.
  router.get('/', (req, res) => res.status(405).json({ error: 'MCP endpoint: POST JSON-RPC only (no SSE stream)' }));
  return router;
}

module.exports = buildRouter();
module.exports.buildRouter = buildRouter;
module.exports.buildMcp = buildMcp;
module.exports.TOOLS = TOOLS;
module.exports.makeReadOnly = makeReadOnly;
