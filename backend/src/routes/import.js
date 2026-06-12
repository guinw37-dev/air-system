const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Schema-per-tenant: a workbook is imported INTO the current branch schema (the
// branch IS the client), so there is no client layer / client_id here anymore.
// Fans with no site column bind to this default site name within the branch.
const FAN_DEFAULT_SITE_NAME = process.env.FAN_DEFAULT_SITE_NAME || 'รพ.หลัก';

// ── helpers ────────────────────────────────────────────────────────────────
function strVal(row, ...keys) {
  for (const k of keys) {
    if (row[k] == null) continue;
    const v = row[k].toString().trim();
    if (v) return v;
  }
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

const SKIP_DATE_VALS = new Set(['แอร์เสีย', 'ไม่มีฟิลเตอร์', 'ถอดออก', 'รื้อถอน', '-', '']);
function parseCeDate(val) {
  if (val == null) return null;
  if (typeof val === 'number' && isFinite(val)) {
    const d = xlsx.SSF ? xlsx.SSF.parse_date_code(val) : null;
    if (d && d.y) {
      let y = d.y; if (y > 2300) y -= 543;
      return `${y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
  }
  const s = String(val).trim();
  if (!s || SKIP_DATE_VALS.has(s)) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) { let y = +m[1]; if (y > 2300) y -= 543; return `${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`; }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) { let y = +m[3]; if (y > 2300) y -= 543; return `${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`; }
  return null;
}

function parseStatus(s) {
  const t = (s || '').toString().trim().toLowerCase();
  if (!t) return 'active';
  if (/เสีย|broken|ชำรุด/.test(t)) return 'broken';
  if (/ถอด|รื้อ|ปิด|inactive|ยกเลิก|ไม่ใช้/.test(t)) return 'inactive';
  return 'active';
}

async function getOrCreate(cache, key, queryFn, insertFn) {
  if (cache[key] !== undefined) return cache[key];
  const existing = await queryFn();
  if (existing.length) { cache[key] = existing[0].id; return existing[0].id; }
  const ins = await insertFn();
  cache[key] = ins[0].id;
  return ins[0].id;
}

function makeCaches() {
  return { sites: {}, buildings: {}, floors: {}, rooms: {} };
}

// Idempotency keys within the branch schema:
//   sites(name) / buildings(site_id,name) / floors(building_id,name) /
//   rooms(floor_id,name) / units(asset_code)  — all schema-local UNIQUE.
async function getOrCreateSite(db, caches, name) {
  const n = (name || '').trim();
  if (!n) return null;
  return getOrCreate(caches.sites, n,
    () => db('SELECT id FROM sites WHERE name=$1', [n]).then(r => r.rows),
    () => db('INSERT INTO sites (name) VALUES ($1) RETURNING id', [n]).then(r => r.rows));
}
async function getOrCreateBuilding(db, caches, siteId, name) {
  const n = (name || '').trim() || 'Main';
  return getOrCreate(caches.buildings, `${siteId}::${n}`,
    () => db('SELECT id FROM buildings WHERE site_id=$1 AND name=$2', [siteId, n]).then(r => r.rows),
    () => db('INSERT INTO buildings (site_id, name) VALUES ($1,$2) RETURNING id', [siteId, n]).then(r => r.rows));
}
async function getOrCreateFloor(db, caches, buildingId, name) {
  const n = (name || '').trim() || 'ชั้น 1';
  return getOrCreate(caches.floors, `${buildingId}::${n}`,
    () => db('SELECT id FROM floors WHERE building_id=$1 AND name=$2', [buildingId, n]).then(r => r.rows),
    () => db('INSERT INTO floors (building_id, name) VALUES ($1,$2) RETURNING id', [buildingId, n]).then(r => r.rows));
}
async function getOrCreateRoom(db, caches, floorId, name) {
  const n = (name || '').trim() || 'ทั่วไป';
  return getOrCreate(caches.rooms, `${floorId}::${n}`,
    () => db('SELECT id FROM rooms WHERE floor_id=$1 AND name=$2', [floorId, n]).then(r => r.rows),
    () => db('INSERT INTO rooms (floor_id, name) VALUES ($1,$2) RETURNING id', [floorId, n]).then(r => r.rows));
}

// Upsert a unit by asset_code (unique within the branch).
async function upsertUnit(db, u) {
  const { rows } = await db('SELECT id FROM units WHERE asset_code=$1', [u.assetCode]);
  if (rows.length) {
    await db(`
      UPDATE units SET
        room_id=$1, name=$2, equipment_type=$3, family=$4, capacity_btu=$5,
        status=$6, last_major_clean_date=$7, needs_recode=$8, updated_at=NOW()
      WHERE id=$9
    `, [u.roomId, u.name || null, u.equipmentType, u.family || null, u.capacityBtu || null,
        u.status, u.lastMajorCleanDate || null, u.needsRecode, rows[0].id]);
    return { id: rows[0].id, created: false };
  }
  const ins = await db(`
    INSERT INTO units
      (room_id, asset_code, name, equipment_type, family, capacity_btu,
       status, last_major_clean_date, needs_recode)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
  `, [u.roomId, u.assetCode, u.name || null, u.equipmentType, u.family || null,
      u.capacityBtu || null, u.status, u.lastMajorCleanDate || null, u.needsRecode]);
  return { id: ins.rows[0].id, created: true };
}

// ── sheet processors ────────────────────────────────────────────────────────
async function processAcSheet(db, ws, results, caches, forceRecode) {
  const data = xlsx.utils.sheet_to_json(ws, { defval: '', raw: true });
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2;
    try {
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

      const sId = await getOrCreateSite(db, caches, siteName || FAN_DEFAULT_SITE_NAME);
      results.siteIds.add(sId);
      const bId = await getOrCreateBuilding(db, caches, sId, buildingNm);
      results.buildingIds.add(bId);
      const fId = await getOrCreateFloor(db, caches, bId, floorNm);
      results.floorIds.add(fId);
      const rId = await getOrCreateRoom(db, caches, fId, roomNm);
      results.roomIds.add(rId);

      let needsRecode = false;
      if (forceRecode) {
        needsRecode = true;
        assetCode = `${assetCode}__DUP${rowNum}`;
        results.needsRecode.push(assetCode);
      }

      const { created } = await upsertUnit(db, {
        roomId: rId, assetCode, name: roomNm || assetCode,
        equipmentType: 'ac', family, capacityBtu: btu,
        status: parseStatus(statusRaw), lastMajorCleanDate: cleanDate, needsRecode,
      });
      if (created) results.units_ac++;
    } catch (err) {
      results.errors.push(`AC row ${rowNum}: ${err.message}`);
    }
  }
}

async function processFanSheet(db, ws, results, caches) {
  const data = xlsx.utils.sheet_to_json(ws, { defval: '', raw: true });
  const sId = await getOrCreateSite(db, caches, FAN_DEFAULT_SITE_NAME);
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

      const bId = await getOrCreateBuilding(db, caches, sId, buildingNm);
      results.buildingIds.add(bId);
      const fId = await getOrCreateFloor(db, caches, bId, floorNm);
      results.floorIds.add(fId);
      const rId = await getOrCreateRoom(db, caches, fId, roomNm);
      results.roomIds.add(rId);

      const { created } = await upsertUnit(db, {
        roomId: rId, assetCode, name: roomNm || assetCode,
        equipmentType: 'fan', family, capacityBtu: null,
        status: 'active', lastMajorCleanDate: null,
        needsRecode: true,
      });
      if (created) { results.units_fan++; results.fans_unassigned++; }
    } catch (err) {
      results.errors.push(`Fan row ${rowNum}: ${err.message}`);
    }
  }
}

// ── core: import a whole workbook into the current branch schema ─────────────
async function importWorkbook(db, wb) {
  const results = {
    units_ac: 0, units_fan: 0, skipped: 0,
    needs_recode: [], fans_unassigned: 0, errors: [],
    siteIds: new Set(), buildingIds: new Set(),
    floorIds: new Set(), roomIds: new Set(), needsRecode: [],
  };
  const caches = makeCaches();

  let acSheet = null, fanSheet = null, dupSheet = null;
  for (const name of wb.SheetNames) {
    if (name.includes('รหัสซ้ำ')) dupSheet = name;
    else if (name.includes('แอร์')) acSheet = name;
    else if (name.includes('พัดลม')) fanSheet = name;
  }

  if (acSheet)  await processAcSheet(db, wb.Sheets[acSheet], results, caches, false);
  if (fanSheet) await processFanSheet(db, wb.Sheets[fanSheet], results, caches);
  if (dupSheet) await processAcSheet(db, wb.Sheets[dupSheet], results, caches, true);

  if (!acSheet && !fanSheet && !dupSheet) {
    results.errors.push('ไม่พบชีตที่รองรับ (แอร์ / พัดลม / รหัสซ้ำ)');
  }

  return {
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
router.post('/ac-data', authMiddleware, requireRole('admin', 'super_admin'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer', raw: true });
    const summary = await importWorkbook(req.db, wb);
    res.json(summary);
  } catch (err) {
    serverError(res, err);
  }
});

// ── POST /api/import/ac-data/server  (read the workbook from EXCEL_PATH) ─────
router.post('/ac-data/server', authMiddleware, requireRole('admin', 'super_admin'), async (req, res) => {
  const path = process.env.EXCEL_PATH;
  if (!path) return res.status(400).json({ error: 'EXCEL_PATH not configured' });
  if (!fs.existsSync(path)) return res.status(404).json({ error: `ไม่พบไฟล์: ${path}` });
  try {
    const wb = xlsx.readFile(path, { raw: true });
    const summary = await importWorkbook(req.db, wb);
    res.json(summary);
  } catch (err) {
    serverError(res, err);
  }
});

// ── GET /api/import/template/ac-data  (download a blank 3-sheet template) ────
router.get('/template/ac-data', authMiddleware, (req, res) => {
  const wb = xlsx.utils.book_new();
  const acWs = xlsx.utils.aoa_to_sheet([
    ['ลำดับ', 'สถานที่', 'อาคาร', 'ชั้น', 'แผนก/ห้อง',
     'เลขเครื่อง', 'ตระกูลแอร์', 'BTU', 'สถานะ', 'ล้างใหญ่ล่าสุด'],
    [1, 'รพ.หลัก', 'อาคาร A', 'ชั้น 1', 'อายุรกรรม',
     'AC-001', 'FCU', '36000', 'ใช้งาน', '2026-01-15'],
  ]);
  xlsx.utils.book_append_sheet(wb, acWs, 'แอร์ ac_units');

  const fanWs = xlsx.utils.aoa_to_sheet([
    ['ลำดับ', 'อาคาร', 'ชั้น', 'ตำแหน่ง/ห้อง', 'ประเภทพัดลม', 'เลขเครื่อง'],
    [1, 'อาคาร A', 'ชั้น 1', 'โถงทางเดิน', 'พัดลมดูดอากาศ', 'FAN-001'],
  ]);
  xlsx.utils.book_append_sheet(wb, fanWs, 'พัดลม fans');

  const dupWs = xlsx.utils.aoa_to_sheet([
    ['ลำดับ', 'สถานที่', 'อาคาร', 'ชั้น', 'แผนก/ห้อง',
     'เลขเครื่อง', 'ตระกูลแอร์', 'BTU', 'สถานะ', 'ล้างใหญ่ล่าสุด'],
  ]);
  xlsx.utils.book_append_sheet(wb, dupWs, 'ตรวจสอบ-รหัสซ้ำ');

  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="template_ac_data.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── POST /api/import/work-history  (deferred to a later phase) ───────────────
router.post('/work-history', authMiddleware, requireRole('admin', 'super_admin'), (req, res) => {
  res.status(501).json({ error: 'นำเข้าประวัติงานจะทำในเฟสถัดไป' });
});

module.exports = router;
