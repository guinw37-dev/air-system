// Excel ใบงาน (simple-wo) + แท็บ "ความเห็นช่าง" + ตัวหาคำต้องสงสัย + MCP wo_text_flags.
//   - POST /export/excel { ids } = ใบตามที่กรอง/ติ๊กบนหน้ารายการ, เรียงตาม ids
//   - ทุก role ยกเว้นช่างแอร์ (ช่าง → 403 ก่อนแตะ DB) ทั้ง GET และ POST
//   - แท็บความเห็นช่าง: ทุกข้อความที่ช่างพิมพ์ 1 แถว/ข้อความ, แถวมีคำต้องสงสัยขึ้นก่อน
//   - SQL ตัดรูปลายเซ็นออก (jsonb - 'sig_*')
// ยิงผ่าน express + authMiddleware + router ตัวจริง (DB ปลอมที่จดทุก query).
// Run: node test/woExport.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'wo-export-test-secret';
const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');
const router = require('../src/routes/simpleWorkOrders');
const { findSuspectWords, collectWoTexts } = require('../src/utils/woTexts');
const { buildMcp, TOOLS } = require('../src/routes/mcp');

// ── fixtures: แถวจาก DB รูปเดียวกับ to_jsonb(simple_work_orders) (คีย์ = ชื่อคอลัมน์จริง) ──
const ITEMS = [
  { id: 11, category: 'all3', sort_order: 1, item_label: 'อุณหภูมิลมจ่าย', value_type: 'before_after', unit_label: '°C' },
  { id: 12, category: 'all3', sort_order: 2, item_label: 'สภาพทั่วไป', value_type: 'text', unit_label: null },
];
const WO = {
  1: { id: 1, wo_number: 'WO-2569-11-0001', work_type: 'major', tech_name: 'ช่างเอ', client_name: 'รพ.ทดสอบ',
    asset_code: 'AC-PTS2-F5-013', work_date: '2026-11-12', created_at: '2026-11-12T03:00:00.000Z',
    building: 'A', floor: '5', room: '501', result: 'ok', sig_team_name: 'ช่างเอ',
    team_comment: { external_degraded: true, external_detail: 'คอยล์ร้อนผุ' },
    condition: { health_reason: 'ไอ้เหี้ย ไม่ยอมล้างให้' },
    checklist_values: { 12: { val_text: 'ปกติ' }, 11: { value_before: '20', value_after: '12', note: 'ล้างแล้ว มึงดูเอง' } } },
  3: { id: 3, wo_number: 'WO-2569-11-0003', work_type: 'minor', tech_name: 'ช่างบี', client_name: 'รพ.ทดสอบ',
    work_date: '2026-11-13', created_at: '2026-11-13T03:00:00.000Z', recommendation: 'ควรเปลี่ยนฟิลเตอร์',
    grid_rows: [{ room: '101', machine_no: 'AC-1', checks: [true, true, true, true] }] },
  2: { id: 2, wo_number: 'WO-2569-11-0002', work_type: 'fan', tech_name: 'ช่างซี', client_name: 'รพ.ทดสอบ',
    work_date: '2026-11-14', created_at: '2026-11-14T03:00:00.000Z',
    grid_rows: [{ room: 'Z', machine_no: 'EF-1', checks: [true, false], broken: 'มอเตอร์ไหม้' }] },
};

function fakeBranch() {
  const log = [];
  const db = async (sql, params = []) => {
    log.push({ sql, params });
    if (/FROM inspection_template_items/.test(sql)) return { rows: ITEMS };
    if (/FROM simple_work_orders s LEFT JOIN users/.test(sql)) {
      const ids = /id = ANY/.test(sql) ? params[0] : Object.keys(WO).map(Number);
      return { rows: ids.filter((id) => WO[id]).map((id) => ({ wo: WO[id], created_by_name: 'บัญชีช่าง' })) };
    }
    return { rows: [] };
  };
  return { log, db };
}
const woQueries = (log) => log.filter((q) => /simple_work_orders/.test(q.sql));

let current = fakeBranch();
const app = express();
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => { req.branch = { slug: 'test-branch', name: 'สาขาทดสอบ' }; req.db = current.db; next(); });
app.use('/api/simple-wo', router);
const token = (role) => jwt.sign({ id: 7, role, name: 'ผู้ทดสอบ', branchSlug: 'test-branch' }, process.env.JWT_SECRET);
let base;
async function call(role, method, path, body) {
  current = fakeBranch();
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token(role)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* xlsx */ }
  return { status: r.status, type: r.headers.get('content-type') || '', buf, json, log: current.log };
}
const sheets = (buf) => XLSX.read(buf, { type: 'buffer' });
const rowsOf = (wb, name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });

const results = [];
async function t(kind, name, fn) {
  try { await fn(); results.push({ kind, name, ok: true }); console.log(`  ok - [${kind}] ${name}`); }
  catch (e) { results.push({ kind, name, ok: false }); console.log(`  FAIL - [${kind}] ${name}\n      ${e.message.split('\n')[0]}`); }
}

(async () => {
  // ── ตัวหาคำต้องสงสัย ──────────────────────────────────────────────────────────
  await t('fix', 'findSuspectWords จับคำหยาบ รวมแบบเว้นวรรค/จุด/ลากเสียง/ตัวพิมพ์ใหญ่', async () => {
    const hit = {
      'ไอ้เหี้ย ไม่ยอมล้าง': 'เหี้ย', 'เหี้ยยยยย': 'เหี้ย', 'ม ึ ง ดูเอง': 'มึง', 'ม.ึ.ง': 'มึง',
      'กูไม่ล้าง': 'กู', 'แม่งเอ้ย': 'แม่ง', 'สัสสส': 'สัส', 'ควยไร': 'ควย', 'ชิบหายแล้ว': 'ชิบหาย',
      'ฉิบหาย': 'ชิบหาย', 'โง่จริง': 'โง่', 'ไอ้ควาย': 'ควาย', 'อีสัตว์': 'ไอ้สัตว์', 'ไอ้เวร': 'ไอ้เวร',
      'เชี่ยไร': 'เชี่ย', 'ส้นตีน': 'ส้นตีน', 'FUCK this': 'fuck', 'what the shit': 'shit', 'wtf': 'wtf',
      'ไอ้หี': 'หี',
    };
    for (const [text, word] of Object.entries(hit)) {
      assert.ok(findSuspectWords(text).includes(word), `ไม่จับ "${word}" ใน "${text}" → ${JSON.stringify(findSuspectWords(text))}`);
    }
    // คำหนึ่งคำ = ป้ายเดียว (เหี้ย ไม่ต้องติดป้าย หี ซ้อน)
    assert.deepStrictEqual(findSuspectWords('ไอ้เหี้ย'), ['เหี้ย']);
  });
  await t('control', 'findSuspectWords ไม่จับคำปกติที่มีคำหยาบซ้อนอยู่ข้างใน', async () => {
    for (const text of [
      'ช่างผู้เชี่ยวชาญ', 'กู้คืนระบบ', 'ค้นใน Google กูเกิล', 'แม่งานแจ้งให้ล้าง', 'สัดส่วนน้ำยา 1:10',
      'เก็บใส่หีบ', 'พบซากสัตว์ในเครื่อง', 'เข้าเวรดึก', 'ติดตั้งห่างจากผนัง 30 ซม.', 'คอยล์ร้อนผุ', 'ปกติ',
      'ควรเปลี่ยนฟิลเตอร์', 'มอเตอร์ไหม้', 'น้ำหยด ใช้ต่อเสี่ยงเสียหาย', 'สกรูหลวม', 'ไอน้ำเกาะ', '',
      'ใบไม้เหี่ยว', 'คลื่นเหียน', 'โหดเหี้ยม',
    ]) {
      assert.deepStrictEqual(findSuspectWords(text), [], `จับผิด "${text}" → ${JSON.stringify(findSuspectWords(text))}`);
    }
    assert.deepStrictEqual(findSuspectWords(null), []);
    assert.deepStrictEqual(findSuspectWords(undefined), []);
  });

  // ── รวบรวมข้อความที่ช่างพิมพ์ ─────────────────────────────────────────────────
  await t('fix', 'collectWoTexts เก็บทุกช่องข้อความอิสระ ข้ามช่องว่าง/ค่าไม่ใช่ข้อความ เรียง checklist ตามฟอร์ม', async () => {
    const got = collectWoTexts({
      recommendation: '  แนะนำ  ',
      team_comment: { external_detail: 'นอก', internal_detail: '   ' },
      condition: { issues_other: 'อื่น', health_reason: 'เหตุผล' },
      ac_info: { detail: 'รายละเอียดแอร์' },
      checklist_values: { 12: { val_text: 'ข้อความ12' }, 11: { note: 'หมายเหตุ11', val_text: { x: 1 } }, 99: { note: 'เก่า' } },
      grid_rows: [{ broken: '' }, { broken: 'ใบพัดหัก' }],
    }, { itemLabel: (id) => `L${id}`, itemOrder: (id) => ({ 11: 0, 12: 1 })[id] ?? Infinity });
    assert.deepStrictEqual(got, [
      { field: 'ข้อแนะนำ', text: 'แนะนำ' },
      { field: 'ความเห็นทีมช่าง: ภายนอก รายละเอียด', text: 'นอก' },
      { field: 'สภาพแอร์: อื่นๆ (ระบุ)', text: 'อื่น' },
      { field: 'สภาพแอร์: เหตุผล/รายละเอียด', text: 'เหตุผล' },
      { field: 'แอร์: รายละเอียด', text: 'รายละเอียดแอร์' },
      { field: 'L11 · หมายเหตุ', text: 'หมายเหตุ11' },
      { field: 'L12 · ข้อความ', text: 'ข้อความ12' },
      { field: 'L99 · หมายเหตุ', text: 'เก่า' },
      { field: 'แถว 2 · ชำรุดเนื่องจาก', text: 'ใบพัดหัก' },
    ]);
    assert.deepStrictEqual(collectWoTexts({}), []);
    assert.deepStrictEqual(collectWoTexts({ team_comment: null, condition: 'x', grid_rows: 'bad' }), []);
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    // ── สิทธิ์ ───────────────────────────────────────────────────────────────────
    await t('fix', 'ช่างแอร์ดาวน์โหลดไม่ได้ (POST และ GET → 403) และไม่แตะ DB', async () => {
      for (const [method, path, body] of [['POST', '/api/simple-wo/export/excel', { ids: [1] }], ['GET', '/api/simple-wo/export/excel']]) {
        const r = await call('technician', method, path, body);
        assert.strictEqual(r.status, 403, `${method}: status ${r.status}`);
        assert.strictEqual(woQueries(r.log).length, 0, `${method}: query ใบงานไปแล้ว`);
      }
    });
    await t('control', 'ทุก role อื่นดาวน์โหลดได้ (admin/super_admin/หัวหน้าช่าง/ช่างอาคาร/วิศวกรรม/approver)', async () => {
      for (const role of ['admin', 'super_admin', 'checker', 'approve_building', 'approve_engineer', 'approver']) {
        const r = await call(role, 'POST', '/api/simple-wo/export/excel', { ids: [1] });
        assert.strictEqual(r.status, 200, `${role}: status ${r.status}`);
        assert.ok(r.type.includes('spreadsheetml'), `${role}: content-type ${r.type}`);
      }
    });
    await t('control', 'ไม่ login → 401', async () => {
      const r = await fetch(`${base}/api/simple-wo/export/excel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"ids":[1]}' });
      assert.strictEqual(r.status, 401);
    });

    // ── ตรวจ ids ─────────────────────────────────────────────────────────────────
    await t('fix', 'ids ผิดรูป → 400 และไม่ query ใบงาน', async () => {
      const bad = [undefined, [], 'x', [1.5], [0], [-1], ['12abc'], [null], [{ id: 1 }], ['99999999999'],
        [2147483648], Array.from({ length: 5001 }, (_, i) => i + 1)];
      for (const ids of bad) {
        const r = await call('admin', 'POST', '/api/simple-wo/export/excel', ids === undefined ? {} : { ids });
        const label = String(JSON.stringify(ids)).slice(0, 40);
        assert.strictEqual(r.status, 400, `ids=${label} → ${r.status}`);
        assert.strictEqual(woQueries(r.log).length, 0, `ids=${label} query ไปแล้ว`);
      }
    });

    // ── เนื้อไฟล์ ────────────────────────────────────────────────────────────────
    await t('fix', 'POST ส่งเฉพาะ ids ที่ขอ (ตัดซ้ำ) เรียงตามลำดับที่ส่ง + SQL ตัดรูปลายเซ็น', async () => {
      const r = await call('admin', 'POST', '/api/simple-wo/export/excel', { ids: [1, '3', 2, 1] });
      assert.strictEqual(r.status, 200);
      const q = woQueries(r.log)[0];
      assert.ok(/s\.deleted_at IS NULL AND s\.id = ANY\(\$1::int\[\]\)/.test(q.sql), 'ไม่กรอง id/deleted_at');
      assert.ok(/array_position\(\$1::int\[\], s\.id\)/.test(q.sql), 'ไม่เรียงตาม ids');
      assert.deepStrictEqual(q.params, [[1, 3, 2]]);
      for (const slot of ['team', 'supervisor', 'building', 'engineer', 'department']) {
        assert.ok(q.sql.includes(`- 'sig_${slot}'`), `SQL ไม่ตัด sig_${slot}`);
      }
      assert.ok(!/SELECT s\.\*/.test(q.sql), 'ยังดึง s.* (รวมรูปลายเซ็น)');
      const wb = sheets(r.buf);
      assert.deepStrictEqual(wb.SheetNames, ['ความเห็นช่าง', 'ล้างใหญ่', 'ล้างย่อย', 'พัดลม']);
    });
    await t('fix', 'แท็บความเห็นช่าง: ทุกข้อความ 1 แถว/ข้อความ, แถวมีคำต้องสงสัยขึ้นก่อน', async () => {
      const r = await call('admin', 'POST', '/api/simple-wo/export/excel', { ids: [1, 3, 2] });
      const rows = rowsOf(sheets(r.buf), 'ความเห็นช่าง');
      const brief = rows.map((x) => [x['⚠ คำต้องสงสัย'], x['เลขใบงาน'], x['ช่องที่พิมพ์'], x['ข้อความ']]);
      assert.deepStrictEqual(brief, [
        ['เหี้ย', 'WO-2569-11-0001', 'สภาพแอร์: เหตุผล/รายละเอียด', 'ไอ้เหี้ย ไม่ยอมล้างให้'],
        ['มึง', 'WO-2569-11-0001', '01. อุณหภูมิลมจ่าย · หมายเหตุ', 'ล้างแล้ว มึงดูเอง'],
        ['', 'WO-2569-11-0001', 'ความเห็นทีมช่าง: ภายนอก รายละเอียด', 'คอยล์ร้อนผุ'],
        ['', 'WO-2569-11-0001', '02. สภาพทั่วไป · ข้อความ', 'ปกติ'],
        ['', 'WO-2569-11-0003', 'ข้อแนะนำ', 'ควรเปลี่ยนฟิลเตอร์'],
        ['', 'WO-2569-11-0002', 'แถว 1 · ชำรุดเนื่องจาก', 'มอเตอร์ไหม้'],
      ]);
      const first = rows[0];
      assert.strictEqual(first['ช่าง (ชื่อในใบ)'], 'ช่างเอ');
      assert.strictEqual(first['บัญชีที่สร้างใบ'], 'บัญชีช่าง');
      assert.strictEqual(first['วันที่ปฏิบัติงาน'], '12/11/2026');
      assert.strictEqual(first['ประเภทงาน'], 'ล้างใหญ่');
      assert.strictEqual(first['เลขเครื่อง'], 'AC-PTS2-F5-013');
    });
    await t('control', 'แท็บความเห็นช่างไม่มีข้อความ → แถวแจ้ง "ไม่มีข้อความ" (ไฟล์ไม่พัง)', async () => {
      const r = await call('admin', 'POST', '/api/simple-wo/export/excel', { ids: [404] });
      assert.strictEqual(r.status, 200);
      const wb = sheets(r.buf);
      assert.deepStrictEqual(wb.SheetNames, ['ความเห็นช่าง', 'ล้างใหญ่']);
      assert.strictEqual(rowsOf(wb, 'ความเห็นช่าง')[0]['ข้อความ'], 'ไม่มีข้อความที่ช่างพิมพ์ในใบงานชุดนี้');
    });
    await t('control', 'แท็บเดิม (ล้างใหญ่/ล้างย่อย/พัดลม) ยังมีคอลัมน์และค่าเดิม', async () => {
      const r = await call('admin', 'POST', '/api/simple-wo/export/excel', { ids: [1, 3, 2] });
      const wb = sheets(r.buf);
      const major = rowsOf(wb, 'ล้างใหญ่');
      assert.strictEqual(major.length, 1);
      assert.strictEqual(major[0]['เลขใบงาน'], 'WO-2569-11-0001');
      assert.strictEqual(major[0]['สภาพ: ภายนอก รายละเอียด'], 'คอยล์ร้อนผุ');
      assert.strictEqual(major[0]['เซ็น: ช่างแอร์'], 'ช่างเอ');
      assert.strictEqual(major[0]['01. อุณหภูมิลมจ่าย · ก่อน'], '20');
      assert.strictEqual(major[0]['01. อุณหภูมิลมจ่าย · หลัง'], '12');
      assert.strictEqual(major[0]['02. สภาพทั่วไป · ข้อความ'], 'ปกติ');
      assert.strictEqual(major[0]['วันที่ปฏิบัติงาน'], '12/11/2026');
      const minor = rowsOf(wb, 'ล้างย่อย');
      assert.strictEqual(minor[0]['เลขเครื่อง'], 'AC-1');
      assert.strictEqual(minor[0]['ข้อแนะนำ'], 'ควรเปลี่ยนฟิลเตอร์');
      const fan = rowsOf(wb, 'พัดลม');
      assert.strictEqual(fan[0]['ชำรุดเนื่องจาก'], 'มอเตอร์ไหม้');
    });
    await t('control', 'GET /export/excel (ช่วงวันที่) ของเดิมยังได้ไฟล์ สำหรับ admin', async () => {
      const r = await call('admin', 'GET', '/api/simple-wo/export/excel?date_from=2026-11-01&date_to=2026-11-30');
      assert.strictEqual(r.status, 200);
      const q = woQueries(r.log)[0];
      assert.deepStrictEqual(q.params, ['2026-11-01', '2026-11-30']);
      assert.ok(sheets(r.buf).SheetNames.includes('ล้างใหญ่'));
    });
  } finally {
    server.close();
  }

  // ── MCP wo_text_flags ───────────────────────────────────────────────────────
  const mcpDeps = () => {
    const seen = [];
    return {
      seen,
      publicQuery: async (sql, params) => ({ rows: params && params[0] === 'test-branch'
        ? [{ slug: 'test-branch', name: 'สาขาทดสอบ', schema_name: 'test_branch' }] : [] }),
      ro: async (schema, sql, params) => {
        seen.push({ schema, sql, params });
        if (/FROM inspection_template_items/.test(sql)) return { rows: ITEMS };
        if (/FROM simple_work_orders s/.test(sql)) {
          const long = { ...WO[3], wo_number: 'WO-LONG', recommendation: `${'ก'.repeat(300)} มึง` };
          return { rows: [WO[1], WO[3], WO[2], long].map((wo) => ({ wo, wash_date: wo.work_date })) };
        }
        return { rows: [] };
      },
    };
  };
  const mcpCall = (h, args) => h({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wo_text_flags', arguments: args } });
  await t('fix', 'MCP wo_text_flags คืนเฉพาะข้อความที่ถูกทำเครื่องหมาย ตัด 200 ตัวอักษร', async () => {
    const d = mcpDeps();
    const r = await mcpCall(buildMcp(d), { branch: 'test-branch', month: '2026-11' });
    assert.ok(!r.result.isError, r.result.content[0].text);
    const out = JSON.parse(r.result.content[0].text);
    assert.strictEqual(out.scanned_orders, 4);
    assert.strictEqual(out.scanned_texts, 7);
    assert.strictEqual(out.flagged_total, 3);
    assert.deepStrictEqual(out.items.map((x) => [x.wo_number, x.field, x.words]), [
      ['WO-2569-11-0001', 'สภาพแอร์: เหตุผล/รายละเอียด', ['เหี้ย']],
      ['WO-2569-11-0001', 'อุณหภูมิลมจ่าย · หมายเหตุ', ['มึง']],
      ['WO-LONG', 'ข้อแนะนำ', ['มึง']],
    ]);
    assert.strictEqual(out.items[2].text.length, 201, 'ไม่ตัดข้อความยาว');
    assert.ok(!JSON.stringify(out).includes('คอยล์ร้อนผุ'), 'หลุดข้อความที่ไม่ถูกทำเครื่องหมาย');
    const q = d.seen.find((x) => /simple_work_orders/.test(x.sql));
    assert.strictEqual(q.schema, 'test_branch');
    assert.deepStrictEqual(q.params, ['2026-11']);
    assert.ok(q.sql.includes("- 'sig_team'") && /LIMIT 5000/.test(q.sql));
  });
  await t('control', 'MCP wo_text_flags: limit ตัดรายการ, month ผิด/สาขาไม่มี → isError, อยู่ในรายการ tools', async () => {
    const out = JSON.parse((await mcpCall(buildMcp(mcpDeps()), { branch: 'test-branch', month: '2026-11', limit: 1 })).result.content[0].text);
    assert.strictEqual(out.returned, 1);
    assert.strictEqual(out.flagged_total, 3);
    for (const args of [{ branch: 'test-branch', month: '2026-1' }, { branch: 'nope', month: '2026-11' }, { branch: 'test-branch' }]) {
      assert.strictEqual((await mcpCall(buildMcp(mcpDeps()), args)).result.isError, true, JSON.stringify(args));
    }
    const tool = TOOLS.find((x) => x.name === 'wo_text_flags');
    assert.ok(tool && tool.inputSchema.additionalProperties === false);
  });

  const fail = results.filter((r) => !r.ok);
  const by = (k) => results.filter((r) => r.kind === k);
  console.log(`\n# fix: ${by('fix').filter((r) => r.ok).length}/${by('fix').length} · control: ${by('control').filter((r) => r.ok).length}/${by('control').length}`);
  if (fail.length) { console.log(`# FAILED ${fail.length}`); process.exit(1); }
  console.log(`# all ${results.length} passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
