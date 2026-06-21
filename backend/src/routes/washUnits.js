// /api/wash-units — ทะเบียนแอร์รายตัว (master AC/fan unit registry) for the
// simple-wo cleaning world. Per-branch (schema-per-tenant): req.db scopes every
// read/write to the current branch schema. Flat table (asset_code unique).
const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');

const canEdit = requireRole('admin', 'super_admin');
const EQUIP_OK = ['ac', 'fan'];

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// All columns persisted (asset_code is the natural key).
const COLS = [
  'asset_code', 'pts_zone', 'location', 'is_clinic', 'building', 'floor', 'room',
  'equipment', 'ac_type', 'brand', 'model', 'cooling_size',
  'freq_major', 'freq_minor', 'freq_fan', 'active', 'note',
];

// ── value coercion (shared by POST/PUT/import) ──────────────────────────────
const str = (v) => (v == null ? null : String(v).trim() || null);
const toInt0 = (v) => Math.max(0, parseInt(v, 10) || 0);
function toBool(v, dflt = false) {
  if (v == null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  return /^(1|true|yes|ใช่|y)$/i.test(String(v).trim());
}
function normEquip(v) {
  const t = String(v == null ? '' : v).trim().toLowerCase();
  if (t === 'fan' || t.includes('พัดลม')) return 'fan';
  return 'ac';
}

// Build the column→value map for an insert/update from a (validated) input obj.
function rowFromInput(b) {
  return {
    asset_code: str(b.asset_code),
    pts_zone: str(b.pts_zone),
    location: str(b.location),
    is_clinic: toBool(b.is_clinic),
    building: str(b.building),
    floor: str(b.floor),
    room: str(b.room),
    equipment: EQUIP_OK.includes(b.equipment) ? b.equipment : (b.equipment ? normEquip(b.equipment) : 'ac'),
    ac_type: str(b.ac_type),
    brand: str(b.brand),
    model: str(b.model),
    cooling_size: str(b.cooling_size),
    freq_major: toInt0(b.freq_major),
    freq_minor: toInt0(b.freq_minor),
    freq_fan: toInt0(b.freq_fan),
    active: toBool(b.active, true),
    note: b.note ? String(b.note) : null,
  };
}

// ── GET / — list (filters: zone, equipment, q) ──────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  const where = []; const params = []; let i = 1;
  if (req.query.zone) { where.push(`pts_zone = $${i++}`); params.push(req.query.zone); }
  if (req.query.equipment && EQUIP_OK.includes(req.query.equipment)) {
    where.push(`equipment = $${i++}`); params.push(req.query.equipment);
  }
  if (req.query.q) {
    where.push(`(asset_code ILIKE $${i} OR location ILIKE $${i} OR room ILIKE $${i})`);
    params.push(`%${req.query.q}%`); i++;
  }
  const sql = `SELECT * FROM wash_units
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY active DESC, pts_zone NULLS LAST, location NULLS LAST, asset_code`;
  try {
    const { rows } = await req.db(sql, params);
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// ── GET /codes — distinct active asset_code list (for the WO form dropdown) ──
router.get('/codes', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(
      `SELECT DISTINCT asset_code FROM wash_units WHERE active = true ORDER BY asset_code`
    );
    res.json(rows.map((r) => r.asset_code));
  } catch (err) { serverError(res, err); }
});

// ── GET /coverage?month=YYYY-MM — ล้างได้/เหลือ เทียบทะเบียนแอร์ ──────────────
// ฐาน = wash_units (active). เครื่องถือว่า "ล้างแล้วเดือนนี้" ถ้ามีใบงาน simple-wo
// ที่ asset_code (ล้างใหญ่) หรือ grid machine_no (ล้างย่อย/พัดลม) ตรงกัน ในเดือนนั้น.
// กลุ่ม: ปกติ → pts_zone × ac_type; คลินิก/หอพัก (is_clinic) → pts_zone × location
// (ไม่แยกประเภทแอร์ ตามสัญญาศรีราชา 1).
router.get('/coverage', authMiddleware, async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month
    : new Date().toISOString().slice(0, 7);
  try {
    const { rows: units } = await req.db(
      `SELECT asset_code, pts_zone, is_clinic, location, ac_type
       FROM wash_units WHERE active = true`
    );
    const { rows: cleaned } = await req.db(
      `SELECT DISTINCT code FROM (
         SELECT asset_code AS code, COALESCE(work_date, created_at::date) AS d
           FROM simple_work_orders WHERE deleted_at IS NULL
         UNION ALL
         SELECT g->>'machine_no', COALESCE(s.work_date, s.created_at::date)
           FROM simple_work_orders s,
                jsonb_array_elements(COALESCE(s.grid_rows,'[]'::jsonb)) g
           WHERE s.deleted_at IS NULL
       ) x
       WHERE COALESCE(code,'') <> '' AND to_char(d,'YYYY-MM') = $1`,
      [month]
    );
    const done = new Set(cleaned.map((r) => r.code));
    const groups = new Map();   // key → { zone, kind, label, total, done }
    for (const u of units) {
      const zone = u.pts_zone || 'ไม่ระบุโซน';
      const clinic = u.is_clinic;
      const label = clinic ? (u.location || 'ไม่ระบุสถานที่') : (u.ac_type || 'ไม่ระบุประเภท');
      const key = `${zone}|${clinic ? 'clinic' : 'type'}|${label}`;
      const g = groups.get(key) || (groups.set(key, { zone, kind: clinic ? 'clinic' : 'type', label, total: 0, done: 0 }).get(key));
      g.total += 1;
      if (u.asset_code && done.has(u.asset_code)) g.done += 1;
    }
    const out = [...groups.values()].map((g) => ({ ...g, remaining: g.total - g.done }))
      .sort((a, b) => a.zone.localeCompare(b.zone) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
    res.json({ month, groups: out });
  } catch (err) { serverError(res, err); }
});

// ── GET /:id — one row ──────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db('SELECT * FROM wash_units WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบเครื่อง' });
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── POST / — create ─────────────────────────────────────────────────────────
router.post('/', authMiddleware, canEdit, async (req, res) => {
  const r = rowFromInput(req.body || {});
  if (!r.asset_code) return res.status(400).json({ error: 'ต้องระบุรหัสแอร์ (asset_code)' });
  const placeholders = COLS.map((_, idx) => `$${idx + 1}`).join(',');
  const values = COLS.map((c) => r[c]);
  try {
    const { rows } = await req.db(
      `INSERT INTO wash_units (${COLS.join(',')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'รหัสแอร์นี้มีอยู่แล้ว' });
    serverError(res, err);
  }
});

// ── PUT /:id — update ───────────────────────────────────────────────────────
router.put('/:id', authMiddleware, canEdit, async (req, res) => {
  const r = rowFromInput(req.body || {});
  if (!r.asset_code) return res.status(400).json({ error: 'ต้องระบุรหัสแอร์ (asset_code)' });
  const sets = COLS.map((c, idx) => `${c} = $${idx + 1}`).join(', ');
  const values = COLS.map((c) => r[c]);
  values.push(req.params.id);
  try {
    const { rows } = await req.db(
      `UPDATE wash_units SET ${sets}, updated_at = NOW() WHERE id = $${COLS.length + 1} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบเครื่อง' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'รหัสแอร์นี้มีอยู่แล้ว' });
    serverError(res, err);
  }
});

// ── DELETE /:id — hard delete ───────────────────────────────────────────────
router.delete('/:id', authMiddleware, canEdit, async (req, res) => {
  try {
    const { rowCount } = await req.db('DELETE FROM wash_units WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'ไม่พบเครื่อง' });
    res.json({ ok: true });
  } catch (err) { serverError(res, err); }
});

// ── Excel import ────────────────────────────────────────────────────────────
// Map Thai OR English headers (case/space-insensitive) → input keys. First key
// listed that is present (non-blank) wins.
const HEADER_MAP = {
  asset_code:   ['รหัสแอร์', 'asset_code', 'assetcode'],
  pts_zone:     ['โซน', 'สัญญา', 'zone', 'pts_zone', 'ptszone'],
  location:     ['สถานที่', 'location'],
  is_clinic:    ['คลินิก', 'is_clinic', 'isclinic'],
  building:     ['อาคาร', 'building'],
  floor:        ['ชั้น', 'floor'],
  room:         ['ห้อง', 'room'],
  equipment:    ['ประเภทอุปกรณ์', 'equipment'],
  ac_type:      ['ประเภทแอร์', 'ac_type', 'actype'],
  brand:        ['ยี่ห้อ', 'brand'],
  model:        ['รุ่น', 'model'],
  cooling_size: ['ขนาด', 'cooling_size', 'coolingsize'],
  freq_major:   ['ล้างใหญ่/ปี', 'ล้างใหญ่ต่อปี', 'freq_major', 'freqmajor'],
  freq_minor:   ['ล้างย่อย/ปี', 'ล้างย่อยต่อปี', 'freq_minor', 'freqminor'],
  freq_fan:     ['พัดลม/ปี', 'พัดลมต่อปี', 'freq_fan', 'freqfan'],
  active:       ['ใช้งาน', 'active', 'สถานะใช้งาน'],
  note:         ['หมายเหตุ', 'note'],
};

const normKey = (s) => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();

// Pull a value from a sheet row by the candidate header list, ignoring case/space.
function pick(normRow, candidates) {
  for (const c of candidates) {
    const k = normKey(c);
    if (normRow[k] != null && String(normRow[k]).trim() !== '') return normRow[k];
  }
  return undefined;
}

// POST /import — upsert wash_units from an xlsx (first sheet) by asset_code.
router.post('/import', authMiddleware, canEdit, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่ได้แนบไฟล์' });
  let json;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return res.status(400).json({ error: 'ไฟล์ไม่มีชีต' });
    json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
  } catch (err) {
    return res.status(400).json({ error: 'อ่านไฟล์ Excel ไม่ได้' });
  }

  const result = { created: 0, updated: 0, skipped: 0, errors: [] };
  const updateSet = COLS.filter((c) => c !== 'asset_code')
    .map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  const placeholders = COLS.map((_, idx) => `$${idx + 1}`).join(',');
  const sql = `INSERT INTO wash_units (${COLS.join(',')}) VALUES (${placeholders})
    ON CONFLICT (asset_code) DO UPDATE SET ${updateSet}, updated_at = NOW()
    RETURNING (xmax = 0) AS inserted`;

  const client = await req.tx();
  try {
    await client.query('BEGIN');
    for (let idx = 0; idx < json.length; idx++) {
      const raw = json[idx];
      const rowNum = idx + 2; // header is row 1
      // normalize this row's headers once
      const normRow = {};
      for (const h of Object.keys(raw)) normRow[normKey(h)] = raw[h];
      const input = {};
      for (const [key, cands] of Object.entries(HEADER_MAP)) {
        const v = pick(normRow, cands);
        if (v !== undefined) input[key] = v;
      }
      const r = rowFromInput(input);
      if (!r.asset_code) { result.skipped++; continue; }
      try {
        const { rows } = await client.query(sql, COLS.map((c) => r[c]));
        if (rows[0] && rows[0].inserted) result.created++;
        else result.updated++;
      } catch (e) {
        result.errors.push(`แถว ${rowNum} (${r.asset_code || '-'}): ${e.message}`);
      }
    }
    await client.query('COMMIT');
    res.json(result);
  } catch (err) {
    await client.query('ROLLBACK');
    serverError(res, err);
  } finally {
    client.release();
  }
});

module.exports = router;
