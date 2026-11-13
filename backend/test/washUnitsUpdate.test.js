// ทะเบียนแอร์: แก้ไขเครื่อง (PUT /:id) และนำเข้า Excel (POST /import) ต้องไม่ล้างค่า
// ที่ผู้ใช้ไม่ได้ส่งมา — โดยเฉพาะ "ล้างใหญ่/ล้างย่อยล่าสุด" (last_major_at / last_minor_at)
// ที่แผนอัตโนมัติ (wash-schedule/generate) ใช้คำนวณรอบถัดไป: ถูกล้างเป็น NULL = เครื่องนั้น
// กลายเป็น "ค้างล้าง" ทันที.
// ยิงผ่าน express + authMiddleware + router ตัวจริง. DB เป็นตัวปลอมที่ "ทำตาม SQL" แบบ
// Postgres (UPDATE … SET col = $n / INSERT … ON CONFLICT DO UPDATE SET col = EXCLUDED.col)
// บนแถวในหน่วยความจำ — ไม่ได้เขียนจากความเชื่อว่าโค้ดควรส่งคอลัมน์ไหน.
// Run: node test/washUnitsUpdate.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'wash-units-update-test-secret';
const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');
const XLSX = require('xlsx');
const router = require('../src/routes/washUnits');

// ── fake wash_units table that applies the SQL it is given ────────────────────
// A stored row shaped like what pg returns for wash_units (dates as YYYY-MM-DD
// strings are enough here: the route never formats them on these paths).
const seedRow = (over = {}) => ({
  id: 1, asset_code: 'FCU-001', pts_zone: 'PTS1', location: 'อาคาร A', is_clinic: true,
  building: 'A', floor: '2', room: '201', equipment: 'ac', ac_type: 'FCU',
  brand: 'Daikin', model: 'FTKM', cooling_size: '18000',
  freq_major: 2, freq_minor: 4, freq_fan: 0,
  last_major_at: '2026-06-15', last_minor_at: '2026-09-20', active: true, note: 'ห้ามปิดเครื่องช่วงบ่าย',
  ...over,
});

function fakeDb(initial) {
  const rows = initial.map((r) => ({ ...r }));
  let nextId = Math.max(0, ...rows.map((r) => r.id)) + 1;
  const val = (tok, params) => {
    const m = /^\$(\d+)$/.exec(tok.trim());
    if (m) return params[Number(m[1]) - 1];
    if (/^now\(\)$/i.test(tok.trim())) return '__NOW__';
    throw new Error(`fake db: unsupported value token ${tok}`);
  };
  // "a = $1, b = $2, updated_at = NOW()" → [[a,$1],[b,$2],[updated_at,NOW()]]
  const assigns = (setList) => setList.split(',').map((p) => p.split('=').map((x) => x.trim()))
    .filter((p) => p.length === 2 && p[0]);
  const query = async (sql, params = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(q)) return { rows: [] };
    let m;
    if ((m = /^SELECT \* FROM wash_units WHERE id = \$1$/i.exec(q))) {
      return { rows: rows.filter((r) => String(r.id) === String(params[0])).map((r) => ({ ...r })) };
    }
    if ((m = /^UPDATE wash_units SET (.+) WHERE id = (\$\d+) RETURNING \*$/i.exec(q))) {
      const row = rows.find((r) => String(r.id) === String(val(m[2], params)));
      if (!row) return { rows: [], rowCount: 0 };
      for (const [col, tok] of assigns(m[1])) row[col] = val(tok, params);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if ((m = /^INSERT INTO wash_units \(([^)]+)\) VALUES \(([^)]+)\)(?: ON CONFLICT \(asset_code\) DO UPDATE SET (.+) RETURNING \(xmax = 0\) AS inserted| RETURNING \*)$/i.exec(q))) {
      const cols = m[1].split(',').map((c) => c.trim());
      const vals = m[2].split(',').map((t) => val(t, params));
      const incoming = Object.fromEntries(cols.map((c, i) => [c, vals[i]]));
      const hit = rows.find((r) => r.asset_code === incoming.asset_code);
      if (hit) {
        if (!m[3]) { const e = new Error('duplicate key'); e.code = '23505'; throw e; }
        for (const [col, rhs] of assigns(m[3])) {
          const ex = /^EXCLUDED\.(\w+)$/i.exec(rhs);
          hit[col] = ex ? incoming[ex[1]] : val(rhs, params);
        }
        return { rows: [{ inserted: false }] };
      }
      const row = { id: nextId++, ...incoming };
      rows.push(row);
      return { rows: m[3] ? [{ inserted: true }] : [{ ...row }] };
    }
    throw new Error(`fake db: unexpected SQL: ${q.slice(0, 120)}`);
  };
  return { rows, db: query, tx: async () => ({ query, release() {} }) };
}

// ── app: real router + real authMiddleware; branch middleware replaced by the fake ──
let current;
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.branch = { slug: 'test-branch', name: 'สาขาทดสอบ' };
  req.db = current.db;
  req.tx = current.tx;
  next();
});
app.use('/api/wash-units', router);
const token = (role = 'admin') => jwt.sign({ id: 1, role, name: 'แอดมิน', branchSlug: 'test-branch' }, process.env.JWT_SECRET);

let base;
async function put(id, body) {
  const r = await fetch(`${base}/api/wash-units/${id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function post(body) {
  const r = await fetch(`${base}/api/wash-units`, {
    method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function importXlsx(sheetRows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'ทะเบียนแอร์');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fd = new FormData();
  fd.append('file', new Blob([buf]), 'units.xlsx');
  const r = await fetch(`${base}/api/wash-units/import`, {
    method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// What frontend/src/pages/WashUnits.jsx UnitModal.save() sends for an edit: the form
// state (no last_major_at / last_minor_at fields) with freq_* parsed to numbers.
function modalBody(u, changes = {}) {
  const form = {
    asset_code: u.asset_code || '', pts_zone: u.pts_zone || '', location: u.location || '',
    is_clinic: u.is_clinic || false, building: u.building || '', floor: u.floor || '', room: u.room || '',
    equipment: u.equipment || 'ac', ac_type: u.ac_type || 'FCU', brand: u.brand || '', model: u.model || '',
    cooling_size: u.cooling_size || '',
    freq_major: u.freq_major != null ? String(u.freq_major) : '',
    freq_minor: u.freq_minor != null ? String(u.freq_minor) : '',
    freq_fan: u.freq_fan != null ? String(u.freq_fan) : '',
    active: u.active !== false, note: u.note || '',
    ...changes,
  };
  return {
    ...form,
    freq_major: form.freq_major !== '' ? parseInt(form.freq_major, 10) : null,
    freq_minor: form.freq_minor !== '' ? parseInt(form.freq_minor, 10) : null,
    freq_fan: form.freq_fan !== '' ? parseInt(form.freq_fan, 10) : null,
  };
}

// Each test reports on its own so the revert run shows the fix tests red and the
// controls green as two separate signals.
const results = [];
async function t(kind, name, fn) {
  try { await fn(); results.push({ kind, ok: true }); console.log(`  ok - [${kind}] ${name}`); }
  catch (e) { results.push({ kind, ok: false }); console.log(`  FAIL - [${kind}] ${name}\n      ${e.message.split('\n')[0]}`); }
}

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    // ── fix: what the user did not send is left alone ──────────────────────────────
    await t('fix', 'PUT from the edit modal (no last_* fields) keeps ล้างใหญ่/ล้างย่อยล่าสุด', async () => {
      current = fakeDb([seedRow()]);
      const r = await put(1, modalBody(seedRow(), { room: '202' }));
      assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
      const row = current.rows[0];
      assert.strictEqual(row.room, '202', 'the edited field must still be saved');
      assert.strictEqual(row.last_major_at, '2026-06-15', `last_major_at wiped to ${row.last_major_at}`);
      assert.strictEqual(row.last_minor_at, '2026-09-20', `last_minor_at wiped to ${row.last_minor_at}`);
    });

    await t('fix', 'PUT with only some fields keeps every field not in the body (note/active/is_clinic too)', async () => {
      current = fakeDb([seedRow()]);
      const r = await put(1, { asset_code: 'FCU-001', brand: 'Carrier' });
      assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
      const row = current.rows[0];
      assert.strictEqual(row.brand, 'Carrier');
      for (const [k, v] of Object.entries(seedRow())) {
        if (k === 'brand' || k === 'updated_at') continue;
        assert.deepStrictEqual(row[k], v, `${k} changed to ${JSON.stringify(row[k])}`);
      }
    });

    await t('fix', 'import of a file WITHOUT the ล้างล่าสุด/หมายเหตุ/ใช้งาน columns keeps those values', async () => {
      current = fakeDb([seedRow()]);
      const r = await importXlsx([{ 'รหัสแอร์': 'FCU-001', 'ยี่ห้อ': 'Carrier', 'ห้อง': '305' }]);
      assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.body.updated, 1, JSON.stringify(r.body));
      const row = current.rows[0];
      assert.strictEqual(row.brand, 'Carrier', 'a column in the file must still update');
      assert.strictEqual(row.room, '305', 'a column in the file must still update');
      assert.strictEqual(row.last_major_at, '2026-06-15', `last_major_at wiped to ${row.last_major_at}`);
      assert.strictEqual(row.last_minor_at, '2026-09-20', `last_minor_at wiped to ${row.last_minor_at}`);
      assert.strictEqual(row.note, 'ห้ามปิดเครื่องช่วงบ่าย', `note wiped to ${row.note}`);
      assert.strictEqual(row.is_clinic, true, `is_clinic reset to ${row.is_clinic}`);
      assert.strictEqual(row.freq_major, 2, `freq_major reset to ${row.freq_major}`);
      assert.strictEqual(row.pts_zone, 'PTS1', `pts_zone wiped to ${row.pts_zone}`);
    });

    // ── controls: green before AND after ──────────────────────────────────────────
    await t('control', 'PUT that sends last_major_at sets it; sending it blank clears it', async () => {
      current = fakeDb([seedRow()]);
      let r = await put(1, { ...modalBody(seedRow()), last_major_at: '2026-10-01' });
      assert.strictEqual(r.status, 200, `status ${r.status}`);
      assert.strictEqual(current.rows[0].last_major_at, '2026-10-01');
      r = await put(1, { ...modalBody(seedRow()), last_minor_at: '' });
      assert.strictEqual(r.status, 200, `status ${r.status}`);
      assert.strictEqual(current.rows[0].last_minor_at, null, 'an explicit blank must still clear');
    });

    await t('control', 'PUT from the modal still saves every form field (incl. unticking คลินิก / ใช้งาน)', async () => {
      current = fakeDb([seedRow()]);
      const r = await put(1, modalBody(seedRow(), { is_clinic: false, active: false, note: '', freq_major: '', brand: 'LG' }));
      assert.strictEqual(r.status, 200, `status ${r.status}`);
      const row = current.rows[0];
      assert.strictEqual(row.is_clinic, false);
      assert.strictEqual(row.active, false);
      assert.strictEqual(row.note, null);
      assert.strictEqual(row.freq_major, 0);
      assert.strictEqual(row.brand, 'LG');
    });

    await t('control', 'PUT without asset_code or for a missing id answers as before (400 / 404)', async () => {
      current = fakeDb([seedRow()]);
      assert.strictEqual((await put(1, { brand: 'X' })).status, 400);
      assert.strictEqual((await put(1, { asset_code: '  ' })).status, 400);
      assert.strictEqual((await put(999, modalBody(seedRow()))).status, 404);
      assert.strictEqual(current.rows[0].brand, 'Daikin', 'a rejected PUT wrote to the row');
    });

    await t('control', 'import: a column that IS in the file but blank still clears/defaults (export-edit round trip)', async () => {
      current = fakeDb([seedRow()]);
      // export-edit writes '' for is_clinic=false and for empty dates/notes; editing those
      // cells to blank and re-importing must keep working as it always has.
      const r = await importXlsx([{ 'รหัสแอร์': 'FCU-001', 'คลินิก': '', 'หมายเหตุ': '', 'ล้างย่อยล่าสุด': '', 'ล้างใหญ่/ปี': '' }]);
      assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
      const row = current.rows[0];
      assert.strictEqual(row.is_clinic, false);
      assert.strictEqual(row.note, null);
      assert.strictEqual(row.last_minor_at, null);
      assert.strictEqual(row.freq_major, 0);
    });

    await t('control', 'import: a new รหัสแอร์ is created with defaults; a dated column sets the date', async () => {
      current = fakeDb([seedRow()]);
      const r = await importXlsx([
        { 'รหัสแอร์': 'FCU-001', 'ล้างใหญ่ล่าสุด': '2026-11-01' },
        { 'รหัสแอร์': 'NEW-9', 'ล้างใหญ่ล่าสุด': '' },
        { 'รหัสแอร์': '', 'ล้างใหญ่ล่าสุด': '2026-11-01' },
      ]);
      assert.strictEqual(r.status, 200, `status ${r.status} ${JSON.stringify(r.body)}`);
      assert.deepStrictEqual([r.body.created, r.body.updated, r.body.skipped], [1, 1, 1], JSON.stringify(r.body));
      assert.strictEqual(current.rows[0].last_major_at, '2026-11-01');
      const fresh = current.rows.find((x) => x.asset_code === 'NEW-9');
      assert.ok(fresh, 'new unit not inserted');
      assert.strictEqual(fresh.active, true);
      assert.strictEqual(fresh.equipment, 'ac');
      assert.strictEqual(fresh.freq_major, 0);
      assert.strictEqual(fresh.last_major_at, null);
    });

    await t('control', 'POST (เพิ่มเครื่องใหม่) still inserts every column', async () => {
      current = fakeDb([seedRow()]);
      const r = await post({ asset_code: 'SPT-7', ac_type: 'SPT', last_major_at: '2026-01-02', freq_major: 3 });
      assert.strictEqual(r.status, 201, `status ${r.status} ${JSON.stringify(r.body)}`);
      const row = current.rows.find((x) => x.asset_code === 'SPT-7');
      assert.strictEqual(row.last_major_at, '2026-01-02');
      assert.strictEqual(row.freq_major, 3);
      assert.strictEqual(row.active, true);
      assert.strictEqual((await post({ asset_code: 'FCU-001' })).status, 409);
    });

    await t('control', 'PUT stays admin-only', async () => {
      current = fakeDb([seedRow()]);
      const r = await fetch(`${base}/api/wash-units/1`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token('technician')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(modalBody(seedRow(), { brand: 'X' })),
      });
      assert.strictEqual(r.status, 403);
      assert.strictEqual(current.rows[0].brand, 'Daikin');
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
