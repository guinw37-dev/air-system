const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Fan defaults — พัดลมในไฟล์ไม่มี client/site ของตัวเอง → ผูกกับลูกค้า/site เริ่มต้นนี้
const FAN_DEFAULT_CLIENT_CODE = process.env.FAN_DEFAULT_CLIENT_CODE || 'PTS1';
const FAN_DEFAULT_SITE_NAME   = process.env.FAN_DEFAULT_SITE_NAME   || 'โรงพยาบาลพญาไท ศรีราชา 1';

// ── helpers ────────────────────────────────────────────────────────────────
// Pull the first non-empty value from a row by trying several candidate header
// strings — real workbook headers vary slightly (spacing / wording).
function strVal(row, ...keys) {
  // 1. exact match
  for (const k of keys) {
    if (row[k] == null) continue;
    const v = row[k].toString().trim();
    if (v) return v;
  }
  // 2. partial match — header contains one of the candidate strings
  // (handles headers like "เลขเครื่อง (asset_code)" when candidate is "เลขเครื่อง")
  for (const header of Object.keys(row)) {
    for (const k of keys) {
      if (header.includes(k) || k.includes(header)) {
        const v = (row[header] ?? '').toString().trim();
        if (v) return v;
      }
    }
  }
  return '';
}

// Thai/Buddhist-era aware date parser. Years > 2300 are พ.ศ. → subtract 543.
// Accepts "2569-01-27", "27/01/2569", and Excel serial numbers.
const SKIP_DATE_VALS = new Set(['แอร์เสีย', 'ไม่มีฟิลเตอร์', 'ถอดออก', 'รื้อถอน', '-', '']);
function parseCeDate(val) {
  if (val == null) return null;

  // Excel serial date number → JS date
  if (typeof val === 'number' && isFinite(val)) {
    const d = xlsx.SSF ? xlsx.SSF.parse_date_code(val) : null;
    if (d && d.y) {
      let y = d.y; if (y > 2300) y -= 543;
      return `${y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
  }

  const s = String(val).trim();
  if (!s || SKIP_DATE_VALS.has(s)) return null;

  // "2569-01-27" or "2026-01-27"
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    let y = +m[1]; if (y > 2300) y -= 543;
    return `${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
  }
  // "27/01/2569"
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    let y = +m[3]; if (y > 2300) y -= 543;
    return `${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  }
  return null;
}

// Normalize free-text status into the schema enum (active|broken|inactive).
function parseStatus(s) {
  const t = (s || '').toString().trim().toLowerCase();
  if (!t) return 'active';
  if (/เสีย|broken|ชำรุด/.test(t)) return 'broken';
  if (/ถอด|รื้อ|ปิด|inactive|ยกเลิก|ไม่ใช้/.test(t)) return 'inactive';
  if (/active|ใช้งาน|ปกติ/.test(t)) return 'active';
  return 'active';
}

// Generic get-or-create with an in-memory cache. queryFn returns rows[],
// insertFn returns rows[] with .id. Idempotent: existing rows are reused.
async function getOrCreate(cache, key, queryFn, insertFn) {
  if (cache[key] !== undefined) return cache[key];
  const existing = await queryFn();
  if (existing.length) { cache[key] = existing[0].id; return existing[0].id; }
  const ins = await insertFn();
  cache[key] = ins[0].id;
  return ins[0].id;
}

function makeCaches() {
  return { clients: {}, sites: {}, buildings: {}, floors: {}, rooms: {} };
}

// Idempotency keys:
//   clients   — code (UNIQUE)
//   sites     — (client_id, name)            schema UNIQUE
//   buildings — (site_id, name)              schema UNIQUE
//   floors    — (building_id, name)          schema UNIQUE
//   rooms     — (floor_id, name)             schema UNIQUE
//   units     — (client_id, asset_code)      schema UNIQUE
async function getOrCreateClient(caches, code, name) {
  const c = (code || '').trim();
  if (!c) return null;
  return getOrCreate(caches.clients, c,
    () => pool.query('SELECT id FROM clients WHERE code=$1', [c]).then(r => r.rows),
    () => pool.query('INSERT INTO clients (code, name) VALUES ($1,$2) RETURNING id',
      [c, (name || c).trim()]).then(r => r.rows));
}

async function getOrCreateSite(caches, clientId, name) {
  const n = (name || '').trim();
  if (!n) return null;
  return getOrCreate(caches.sites, `${clientId}::${n}`,
    () => pool.query('SELECT id FROM sites WHERE client_id=$1 AND name=$2', [clientId, n]).then(r => r.rows),
    () => pool.query('INSERT INTO sites (client_id, name) VALUES ($1,$2) RETURNING id',
      [clientId, n]).then(r => r.rows));
}

async function getOrCreateBuilding(caches, siteId, name) {
  const n = (name || '').trim() || 'Main';
  return getOrCreate(caches.buildings, `${siteId}::${n}`,
    () => pool.query('SELECT id FROM buildings WHERE site_id=$1 AND name=$2', [siteId, n]).then(r => r.rows),
    () => pool.query('INSERT INTO buildings (site_id, name) VALUES ($1,$2) RETURNING id',
      [siteId, n]).then(r => r.rows));
}

async function getOrCreateFloor(caches, buildingId, name) {
  const n = (name || '').trim() || 'ชั้น 1';
  return getOrCreate(caches.floors, `${buildingId}::${n}`,
    () => pool.query('SELECT id FROM floors WHERE building_id=$1 AND name=$2', [buildingId, n]).then(r => r.rows),
    () => pool.query('INSERT INTO floors (building_id, name) VALUES ($1,$2) RETURNING id',
      [buildingId, n]).then(r => r.rows));
}

async function getOrCreateRoom(caches, floorId, name) {
  const n = (name || '').trim() || 'ทั่วไป';
  return getOrCreate(caches.rooms, `${floorId}::${n}`,
    () => pool.query('SELECT id FROM rooms WHERE floor_id=$1 AND name=$2', [floorId, n]).then(r => r.rows),
    () => pool.query('INSERT INTO rooms (floor_id, name) VALUES ($1,$2) RETURNING id',
      [floorId, n]).then(r => r.rows));
}

// Upsert a unit by (client_id, asset_code). On conflict we UPDATE in place so
// re-running the import never creates duplicates.
async function upsertUnit(u) {
  const { rows } = await pool.query(
    'SELECT id FROM units WHERE client_id=$1 AND asset_code=$2', [u.clientId, u.assetCode]);
  if (rows.length) {
    await pool.query(`
      UPDATE units SET
        room_id=$1, name=$2, equipment_type=$3, family=$4, capacity_btu=$5,
        status=$6, last_major_clean_date=$7, needs_recode=$8, updated_at=NOW()
      WHERE id=$9
    `, [u.roomId, u.name || null, u.equipmentType, u.family || null, u.capacityBtu || null,
        u.status, u.lastMajorCleanDate || null, u.needsRecode, rows[0].id]);
    return { id: rows[0].id, created: false };
  }
  const ins = await pool.query(`
    INSERT INTO units
      (client_id, room_id, asset_code, name, equipment_type, family, capacity_btu,
       status, last_major_clean_date, needs_recode)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
  `, [u.clientId, u.roomId, u.assetCode, u.name || null, u.equipmentType, u.family || null,
      u.capacityBtu || null, u.status, u.lastMajorCleanDate || null, u.needsRecode]);
  return { id: ins.rows[0].id, created: true };
}

// ── sheet processors ────────────────────────────────────────────────────────

// AC sheet "แอร์ ac_units" — full client→site→building→floor→room→unit chain.
// `forceRecode` true for the duplicate-codes sheet "ตรวจสอบ-รหัสซ้ำ".
async function processAcSheet(ws, results, caches, forceRecode) {
  const data = xlsx.utils.sheet_to_json(ws, { defval: '', raw: true });
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2;
    try {
      const clientCode = strVal(row, 'รหัสลูกค้า', 'รหัส ลูกค้า', 'client_code', 'รหัสลูกค้า (code)');
      const clientName = strVal(row, 'ลูกค้า', 'ชื่อลูกค้า', 'client', 'client_name');
      const siteName   = strVal(row, 'สถานที่', 'site', 'สถานที่ (site)');
      const buildingNm = strVal(row, 'อาคาร', 'building');
      const floorNm    = strVal(row, 'ชั้น', 'floor');
      const roomNm     = strVal(row, 'แผนก/ห้อง', 'แผนก', 'ห้อง', 'แผนก / ห้อง', 'room', 'department');
      let   assetCode  = strVal(row, 'เลขเครื่อง', 'asset_code', 'รหัสเครื่อง', 'เลขที่เครื่อง');
      const family     = strVal(row, 'ตระกูลแอร์', 'family', 'ตระกูล', 'ประเภทแอร์');
      const btu        = strVal(row, 'BTU', 'btu', 'capacity_btu', 'ขนาด BTU');
      const statusRaw  = strVal(row, 'สถานะ', 'status');
      const cleanDate  = parseCeDate(row['ล้างใหญ่ล่าสุด'] != null && String(row['ล้างใหญ่ล่าสุด']).trim()
        ? row['ล้างใหญ่ล่าสุด']
        : (row['last_major_clean_date'] != null ? row['last_major_clean_date'] : null));

      if (!assetCode) { results.skipped++; continue; }

      // Client code is the tenant key. Fall back to the fan-default client only
      // if the row truly has none (keeps tenant correctness for real AC rows).
      const effClientCode = clientCode || FAN_DEFAULT_CLIENT_CODE;
      const clientId = await getOrCreateClient(caches, effClientCode, clientName);
      results.clientIds.add(clientId);

      const sId = await getOrCreateSite(caches, clientId, siteName || FAN_DEFAULT_SITE_NAME);
      results.siteIds.add(sId);
      const bId = await getOrCreateBuilding(caches, sId, buildingNm);
      results.buildingIds.add(bId);
      const fId = await getOrCreateFloor(caches, bId, floorNm);
      results.floorIds.add(fId);
      const rId = await getOrCreateRoom(caches, fId, roomNm);
      results.roomIds.add(rId);

      let needsRecode = false;
      if (forceRecode) {
        // Duplicate-codes sheet: append a temporary suffix so it can coexist with
        // the original under the same client, and flag needs_recode for manual fix.
        needsRecode = true;
        assetCode = `${assetCode}__DUP${rowNum}`;
        results.needsRecode.push(assetCode);
      }

      const { created } = await upsertUnit({
        clientId, roomId: rId, assetCode, name: roomNm || assetCode,
        equipmentType: 'ac', family, capacityBtu: btu,
        status: parseStatus(statusRaw), lastMajorCleanDate: cleanDate, needsRecode,
      });
      if (created) results.units_ac++;
    } catch (err) {
      results.errors.push(`AC row ${rowNum}: ${err.message}`);
    }
  }
}

// Fan sheet "พัดลม fans" — no client/site columns. Bind to the env default
// client + its main site. NOTE: schema has no dedicated "needs_site_review"
// column, so we reuse needs_recode=true to surface every fan for manual site
// assignment later (per DECISIONS_phase0 §1 answer 5 / .env.example comment).
async function processFanSheet(ws, results, caches) {
  const data = xlsx.utils.sheet_to_json(ws, { defval: '', raw: true });

  const clientId = await getOrCreateClient(caches, FAN_DEFAULT_CLIENT_CODE, FAN_DEFAULT_SITE_NAME);
  results.clientIds.add(clientId);
  const sId = await getOrCreateSite(caches, clientId, FAN_DEFAULT_SITE_NAME);
  results.siteIds.add(sId);

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2;
    try {
      const buildingNm = strVal(row, 'อาคาร', 'building');
      const floorNm    = strVal(row, 'ชั้น', 'floor');
      const roomNm     = strVal(row, 'ตำแหน่ง/ห้อง', 'ตำแหน่ง', 'ห้อง', 'ตำแหน่ง / ห้อง', 'room');
      const family     = strVal(row, 'ประเภทพัดลม', 'family', 'ประเภท');
      const assetCode  = strVal(row, 'เลขเครื่อง', 'asset_code', 'รหัสเครื่อง');

      if (!assetCode) { results.skipped++; continue; }

      const bId = await getOrCreateBuilding(caches, sId, buildingNm);
      results.buildingIds.add(bId);
      const fId = await getOrCreateFloor(caches, bId, floorNm);
      results.floorIds.add(fId);
      const rId = await getOrCreateRoom(caches, fId, roomNm);
      results.roomIds.add(rId);

      const { created } = await upsertUnit({
        clientId, roomId: rId, assetCode, name: roomNm || assetCode,
        equipmentType: 'fan', family, capacityBtu: null,
        status: 'active', lastMajorCleanDate: null,
        needsRecode: true, // review flag for default-site binding (see note above)
      });
      if (created) { results.units_fan++; results.fans_unassigned++; }
    } catch (err) {
      results.errors.push(`Fan row ${rowNum}: ${err.message}`);
    }
  }
}

// ── core: import a whole workbook ────────────────────────────────────────────
async function importWorkbook(wb) {
  const results = {
    // counts of newly-created units; hierarchy counts derive from the id sets
    units_ac: 0, units_fan: 0, skipped: 0,
    needs_recode: [], fans_unassigned: 0, errors: [],
    // internal id sets (stripped before returning)
    clientIds: new Set(), siteIds: new Set(), buildingIds: new Set(),
    floorIds: new Set(), roomIds: new Set(), needsRecode: [],
  };
  const caches = makeCaches();

  // Resolve sheets defensively by partial name match.
  let acSheet = null, fanSheet = null, dupSheet = null;
  for (const name of wb.SheetNames) {
    if (name.includes('รหัสซ้ำ')) dupSheet = name;
    else if (name.includes('แอร์')) acSheet = name;
    else if (name.includes('พัดลม')) fanSheet = name;
  }

  if (acSheet)  await processAcSheet(wb.Sheets[acSheet], results, caches, false);
  if (fanSheet) await processFanSheet(wb.Sheets[fanSheet], results, caches);
  if (dupSheet) await processAcSheet(wb.Sheets[dupSheet], results, caches, true);

  if (!acSheet && !fanSheet && !dupSheet) {
    results.errors.push('ไม่พบชีตที่รองรับ (แอร์ / พัดลม / รหัสซ้ำ)');
  }

  return {
    clients: results.clientIds.size,
    sites: results.siteIds.size,
    buildings: results.buildingIds.size,
    floors: results.floorIds.size,
    rooms: results.roomIds.size,
    units_ac: results.units_ac,
    units_fan: results.units_fan,
    skipped: results.skipped,
    needs_recode: results.needsRecode,
    fans_unassigned: results.fans_unassigned,
    errors: results.errors,
  };
}

// ── POST /api/import/ac-data  (upload a posted workbook) ─────────────────────
router.post('/ac-data', authMiddleware, requireRole('admin'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer', raw: true });
    const summary = await importWorkbook(wb);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/import/ac-data/server  (read the workbook from EXCEL_PATH) ─────
router.post('/ac-data/server', authMiddleware, requireRole('admin'), async (req, res) => {
  const path = process.env.EXCEL_PATH;
  if (!path) return res.status(400).json({ error: 'EXCEL_PATH not configured' });
  if (!fs.existsSync(path)) return res.status(404).json({ error: `ไม่พบไฟล์: ${path}` });
  try {
    const wb = xlsx.readFile(path, { raw: true });
    const summary = await importWorkbook(wb);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/import/template/ac-data  (download a blank 3-sheet template) ────
router.get('/template/ac-data', authMiddleware, (req, res) => {
  const wb = xlsx.utils.book_new();

  const acWs = xlsx.utils.aoa_to_sheet([
    ['ลำดับ', 'ลูกค้า', 'รหัสลูกค้า', 'สถานที่', 'อาคาร', 'ชั้น', 'แผนก/ห้อง',
     'เลขเครื่อง', 'ตระกูลแอร์', 'BTU', 'สถานะ', 'ล้างใหญ่ล่าสุด'],
    [1, 'พญาไท ศรีราชา 1', 'PTS1', 'รพ.หลัก', 'อาคาร A', 'ชั้น 1', 'อายุรกรรม',
     'AC-001', 'FCU', '36000', 'ใช้งาน', '2026-01-15'],
  ]);
  xlsx.utils.book_append_sheet(wb, acWs, 'แอร์ ac_units');

  const fanWs = xlsx.utils.aoa_to_sheet([
    ['ลำดับ', 'อาคาร', 'ชั้น', 'ตำแหน่ง/ห้อง', 'ประเภทพัดลม', 'เลขเครื่อง'],
    [1, 'อาคาร A', 'ชั้น 1', 'โถงทางเดิน', 'พัดลมดูดอากาศ', 'FAN-001'],
  ]);
  xlsx.utils.book_append_sheet(wb, fanWs, 'พัดลม fans');

  const dupWs = xlsx.utils.aoa_to_sheet([
    ['ลำดับ', 'ลูกค้า', 'รหัสลูกค้า', 'สถานที่', 'อาคาร', 'ชั้น', 'แผนก/ห้อง',
     'เลขเครื่อง', 'ตระกูลแอร์', 'BTU', 'สถานะ', 'ล้างใหญ่ล่าสุด'],
  ]);
  xlsx.utils.book_append_sheet(wb, dupWs, 'ตรวจสอบ-รหัสซ้ำ');

  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="template_ac_data.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── POST /api/import/work-history  (deferred to a later phase) ───────────────
router.post('/work-history', authMiddleware, requireRole('admin'), (req, res) => {
  res.status(501).json({ error: 'นำเข้าประวัติงานจะทำในเฟสถัดไป' });
});

module.exports = router;
