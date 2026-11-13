// ตัวเลขสรุปที่ต้องนับตรงกับหน้ารายงาน:
//  • Excel สรุประบบ (/api/wash-units/export-all, sheet "สรุป") — "ปิดงาน" ของงานซ่อม
//    = Clear + Close (Clear คือปิดงานใน flow ปัจจุบัน — เหมือน dashboard.js)
//  • ข้อความ LINE ประจำวัน — "สรุปเมื่อวาน เสร็จ N ตัว" นับเป็นเครื่อง (ล้างย่อย/พัดลม
//    = จำนวนแถวในตาราง) ตามนิยามกลาง utils/washCount (DONE_EXPR) เหมือนปฏิทิน/รายงานล้าง
// DB ปลอม "คำนวณตาม SQL ที่ได้รับ" บนแถวในหน่วยความจำ: COUNT(*) / COUNT(*) FILTER (WHERE
// status = | IN …) / DONE_EXPR — ไม่รู้จัก expression ไหน = throw (ไม่เดาแทนโค้ด).
// Run: node test/reportCounts.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'report-counts-test-secret';
const assert = require('assert');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');
const { DONE_EXPR } = require('../src/utils/washCount');

// ── fake evaluation of the aggregate expressions these queries use ──────────────
// status condition inside FILTER (WHERE …): status='X' | status IN ('a','b')
function statusPred(cond) {
  let m;
  if ((m = /^status\s*=\s*'([^']+)'$/.exec(cond.trim()))) return (r) => r.status === m[1];
  if ((m = /^status IN \(([^)]*)\)$/i.exec(cond.trim()))) {
    const set = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    return (r) => set.includes(r.status);
  }
  throw new Error(`fake db: unsupported FILTER condition: ${cond}`);
}
// "COUNT(*)::int total, COUNT(*) FILTER (WHERE …)::int closed, …" over `rows`
function evalCounts(selectList, rows) {
  const out = {};
  const re = /COUNT\(\*\)(?:\s+FILTER\s*\(WHERE\s+((?:[^()]|\([^)]*\))+)\))?::int\s+(?:AS\s+)?(\w+)/gi;
  let m; let n = 0;
  while ((m = re.exec(selectList))) {
    n++;
    out[m[2]] = m[1] ? rows.filter(statusPred(m[1])).length : rows.length;
  }
  if (!n) throw new Error(`fake db: no COUNT(*) in ${selectList.slice(0, 80)}`);
  return out;
}
// one ใบงาน's contribution to an aggregate measure
function measureOf(expr, wo) {
  const e = expr.replace(/\s+/g, ' ').trim();
  if (/^COUNT\(\*\)::int$/i.test(e)) return 1;
  if (e === DONE_EXPR.replace(/\s+/g, ' ').trim()) {          // utils/washCount: units per ใบ
    return ['minor', 'fan'].includes(wo.work_type) ? Math.max((wo.grid_rows || []).length, 1) : 1;
  }
  throw new Error(`fake db: unsupported measure: ${e}`);
}

// ── 1) Excel สรุประบบ: router + authMiddleware ตัวจริง ─────────────────────────────
const REPAIRS = [
  { status: 'Clear' }, { status: 'Clear' }, { status: 'Close' },   // ปิดงานแล้ว 3
  { status: 'Work On' }, { status: 'Register' },                    // คงค้าง 2
  { status: 'Cancel' },
];
let repairs = REPAIRS;
const exportDb = async (sql) => {
  const q = sql.replace(/\s+/g, ' ').trim();
  const m = /^SELECT (.+) FROM ac_repair_jobs$/i.exec(q);
  if (m && /COUNT\(\*\)/i.test(m[1])) return { rows: [evalCounts(m[1], repairs)] };
  return { rows: [] };   // other sheets/summaries: empty branch
};
const units = require('../src/routes/washUnits');
const app = express();
app.use((req, res, next) => { req.branch = { slug: 'test-branch' }; req.db = exportDb; next(); });
app.use('/api/wash-units', units);
const token = jwt.sign({ id: 1, role: 'admin', name: 'แอดมิน', branchSlug: 'test-branch' }, process.env.JWT_SECRET);

async function summarySheet(base) {
  const r = await fetch(`${base}/api/wash-units/export-all`, { headers: { Authorization: `Bearer ${token}` } });
  assert.strictEqual(r.status, 200, `export-all status ${r.status}`);
  const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets['สรุป'], { header: 1 });
  return Object.fromEntries(aoa.filter((row) => row.length >= 2).map((row) => [row[0], row[1]]));
}

// ── 2) LINE digest: buildText ตัวจริง, ../db ถูกแทนด้วยตัวปลอม ───────────────────────
let yesterdayWos = [];
const digestQuery = async (schema, sql) => {
  const q = sql.replace(/\s+/g, ' ').trim();
  let m;
  if ((m = /^SELECT work_type, (.+?) (?:AS )?(\w+) FROM simple_work_orders WHERE .*CURRENT_DATE - 1 GROUP BY work_type$/i.exec(q))) {
    const by = {};
    for (const wo of yesterdayWos) by[wo.work_type] = (by[wo.work_type] || 0) + measureOf(m[1], wo);
    return { rows: Object.entries(by).map(([work_type, v]) => ({ work_type, [m[2]]: v })) };
  }
  if (/FROM simple_work_orders/i.test(q)) return { rows: [{ n: 0 }] };   // งานรอเซ็น
  return { rows: [] };                                                  // แผนวันนี้ (wash_schedule)
};
const dbPath = require.resolve(path.join(__dirname, '../src/db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
  exports: { pool: { query: async () => ({ rows: [] }) }, query: digestQuery } };
const { _buildText: buildText } = require('../src/jobs/lineDailyDigest');
const BRANCH = { slug: 'test-branch', schema_name: 'test_branch', name: 'สาขาทดสอบ' };

const results = [];
async function t(kind, name, fn) {
  try { await fn(); results.push({ kind, ok: true }); console.log(`  ok - [${kind}] ${name}`); }
  catch (e) { results.push({ kind, ok: false }); console.log(`  FAIL - [${kind}] ${name}\n      ${e.message.split('\n')[0]}`); }
}

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await t('fix', 'Excel สรุป: ปิดงาน counts Clear + Close (same as the dashboard)', async () => {
      repairs = REPAIRS;
      const s = await summarySheet(base);
      assert.strictEqual(s['ปิดงาน'], 3, `ปิดงาน = ${s['ปิดงาน']}`);
    });

    await t('fix', 'LINE: เสร็จ N ตัว counts machines (ล้างย่อย/พัดลม = rows in the grid)', async () => {
      yesterdayWos = [
        { work_type: 'major' },
        { work_type: 'minor', grid_rows: [{}, {}, {}] },
        { work_type: 'fan', grid_rows: [{}, {}] },
      ];
      const text = await buildText(BRANCH);
      assert.ok(text.includes('สรุปเมื่อวาน เสร็จ 6 ตัว'), text.split('\n').find((l) => l.includes('สรุปเมื่อวาน')));
      assert.ok(text.includes('• ใหญ่ 1 · ย่อย 3 · พัดลม 2'), 'per-type line counts ใบงาน, not machines');
    });

    await t('control', 'Excel สรุป: งานซ่อมทั้งหมด / คงค้าง unchanged', async () => {
      repairs = REPAIRS;
      const s = await summarySheet(base);
      assert.strictEqual(s['งานซ่อมทั้งหมด'], 6);
      assert.strictEqual(s['คงค้าง'], 2);
    });

    await t('control', 'Excel สรุป: a branch with only Close jobs reads the same as before', async () => {
      repairs = [{ status: 'Close' }, { status: 'Close' }, { status: 'Wait Parts' }];
      const s = await summarySheet(base);
      assert.strictEqual(s['ปิดงาน'], 2);
      assert.strictEqual(s['คงค้าง'], 1);
    });

    await t('control', 'LINE: ล้างใหญ่ only → same number as before (1 ใบ = 1 เครื่อง); a grid with no rows counts 1', async () => {
      yesterdayWos = [{ work_type: 'major' }, { work_type: 'major' }];
      let text = await buildText(BRANCH);
      assert.ok(text.includes('สรุปเมื่อวาน เสร็จ 2 ตัว'));
      assert.ok(text.includes('• ใหญ่ 2 · ย่อย 0 · พัดลม 0'));
      yesterdayWos = [{ work_type: 'minor', grid_rows: [] }];
      text = await buildText(BRANCH);
      assert.ok(text.includes('สรุปเมื่อวาน เสร็จ 1 ตัว'));
    });

    await t('control', 'LINE: message keeps its lines (plan today, signed-only note, pending)', async () => {
      yesterdayWos = [];
      const text = await buildText(BRANCH);
      for (const s of ['🔔 แผนล้างแอร์ประจำวัน', 'วันนี้ต้องล้าง 0 ตัว', 'สรุปเมื่อวาน เสร็จ 0 ตัว', '(นับจากใบงานที่เซ็นครบ)', 'รออาคาร/วิศวกรรมเซ็น: 0 ใบ']) {
        assert.ok(text.includes(s), `missing "${s}"`);
      }
    });
  } finally {
    server.close();
  }

  const by = (k) => results.filter((r) => r.kind === k);
  console.log(`\n# fix: ${by('fix').filter((r) => r.ok).length}/${by('fix').length} · control: ${by('control').filter((r) => r.ok).length}/${by('control').length}`);
  const fail = results.filter((r) => !r.ok);
  if (fail.length) { console.log(`# FAILED ${fail.length}`); process.exit(1); }
  console.log(`# all ${results.length} passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
