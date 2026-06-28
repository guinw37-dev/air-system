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
  'freq_major', 'freq_minor', 'freq_fan', 'last_major_at', 'last_minor_at', 'active', 'note',
];

// ── value coercion (shared by POST/PUT/import) ──────────────────────────────
const str = (v) => (v == null ? null : String(v).trim() || null);
const toInt0 = (v) => Math.max(0, parseInt(v, 10) || 0);
// ISO date (YYYY-MM-DD) only; anything else → null. (xlsx import ส่งเป็น ISO string)
const toDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v == null ? '' : v).trim()) ? String(v).trim() : null);
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
    last_major_at: toDate(b.last_major_at),
    last_minor_at: toDate(b.last_minor_at),
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
  last_major_at: ['ล้างใหญ่ล่าสุด', 'last_major_at', 'lastmajorat'],
  last_minor_at: ['ล้างย่อยล่าสุด', 'last_minor_at', 'lastminorat'],
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

// ── GET /export-all — ดาวน์โหลด Excel สรุปทั้งระบบ (backup/ตรวจสอบ/ประวัติ) ─────
// หลาย sheet: ทะเบียนแอร์ · ใบงานล้าง · งานซ่อม · ปฏิทินแผน · สรุป.
router.get('/export-all', authMiddleware, async (req, res) => {
  try {
    const wb = XLSX.utils.book_new();
    // แปลง object/array → JSON string, อื่นๆ ปล่อยตามเดิม
    const flat = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(
      ([k, v]) => [k, v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v])));
    const sheet = async (name, sql, params) => {
      try {
        const { rows } = await req.db(sql, params || []);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? flat(rows) : [{ '—': 'ไม่มีข้อมูล' }]), name);
      } catch { /* ตารางอาจยังไม่ migrate → ข้าม sheet */ }
    };

    const ALL_SIGNED = `(sig_team IS NOT NULL AND sig_supervisor IS NOT NULL AND (sig_building IS NOT NULL OR sig_engineer IS NOT NULL))`;
    await sheet('ทะเบียนแอร์', 'SELECT * FROM wash_units ORDER BY pts_zone NULLS LAST, asset_code');
    // ใบงานล้าง — เลือกคอลัมน์ (เลี่ยง base64 ลายเซ็น/รูป/checklist)
    await sheet('ใบงานล้าง',
      `SELECT wo_number, work_date, work_type, client_name, pts_zone, building, floor, room,
              asset_code, ac_type, result, status, tech_name,
              sig_team_name, sig_supervisor_name, sig_building_name, sig_engineer_name,
              ${ALL_SIGNED} AS all_signed, created_at
         FROM simple_work_orders WHERE deleted_at IS NULL ORDER BY created_at DESC`);
    // ── ประวัติเครื่องจักร — ทุกเครื่อง + timeline งานล้าง + สภาพ (1 แถว/บริการ) ──
    try {
      const { rows: hist } = await req.db(
        `SELECT u.asset_code, u.ac_type, u.cooling_size, u.brand, u.model, u.pts_zone, u.location,
                u.building AS u_building, u.floor AS u_floor, u.room AS u_room,
                u.freq_major, u.freq_minor, u.last_major_at, u.last_minor_at, u.active,
                s.work_date, s.work_type, s.result, s.status, s.tech_name, s.wo_number, s.condition
           FROM wash_units u
           LEFT JOIN simple_work_orders s ON s.asset_code = u.asset_code AND s.deleted_at IS NULL
          ORDER BY u.pts_zone NULLS LAST, u.asset_code, s.work_date NULLS FIRST, s.created_at NULLS FIRST`);
      const WTL = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลม' };
      const RES = { ok: 'ปกติ', not_ok: 'พบปัญหา' };
      const STT = { submitted: 'รอเซ็น', checked: 'หัวหน้าเซ็นแล้ว', approved: 'วางบิลแล้ว', rejected: 'ตีกลับ' };
      const condText = (c) => {
        if (!c || typeof c !== 'object') return '';
        const parts = [];
        if (Array.isArray(c.issues) && c.issues.length) parts.push(`อาการ: ${c.issues.join(', ')}`);
        if (c.issues_other) parts.push(c.issues_other);
        if (c.health_pct != null) parts.push(`สภาพ ${c.health_pct}%`);
        if (c.priority) parts.push(`เร่งด่วน: ${c.priority}`);
        if (c.health_reason) parts.push(c.health_reason);
        return parts.join(' · ');
      };
      const histRows = hist.map((r) => ({
        'เลขเครื่อง': r.asset_code, 'ประเภทแอร์': r.ac_type, 'BTU': r.cooling_size,
        'ยี่ห้อ': r.brand, 'รุ่น': r.model, 'โซน': r.pts_zone, 'สถานที่': r.location,
        'อาคาร': r.u_building, 'ชั้น': r.u_floor, 'ห้อง': r.u_room,
        'ล้างใหญ่/ปี': r.freq_major, 'ล้างย่อย/ปี': r.freq_minor,
        'ล้างใหญ่ล่าสุด': r.last_major_at, 'ล้างย่อยล่าสุด': r.last_minor_at,
        'ใช้งาน': r.active ? 'ใช่' : 'ไม่',
        'วันที่บริการ': r.work_date || '', 'งาน': WTL[r.work_type] || r.work_type || '',
        'ผล': RES[r.result] || r.result || '', 'สถานะใบงาน': STT[r.status] || r.status || '',
        'ช่าง': r.tech_name || '', 'เลขใบงาน': r.wo_number || '', 'สภาพ/อาการ': condText(r.condition),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(histRows.length ? histRows : [{ '—': 'ไม่มีข้อมูล' }]), 'ประวัติเครื่องจักร');
    } catch { /* ตารางอาจยังไม่ migrate → ข้าม */ }

    await sheet('งานซ่อม', `SELECT * FROM ac_repair_jobs ORDER BY register_time DESC`);
    await sheet('ปฏิทินแผน',
      `SELECT asset_code, work_type, planned_date, status, done_wo_id, done_at, note, created_at
         FROM wash_schedule ORDER BY planned_date`);

    // สรุป
    const one = async (sql) => { try { return (await req.db(sql)).rows[0] || {}; } catch { return {}; } };
    const u = await one(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE active)::int active,
        COUNT(*) FILTER (WHERE ac_type='AHU')::int ahu, COUNT(*) FILTER (WHERE ac_type='FCU')::int fcu,
        COUNT(*) FILTER (WHERE ac_type='SPT')::int spt, COUNT(*) FILTER (WHERE ac_type='VRF')::int vrf
        FROM wash_units`);
    const w = await one(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='approved')::int billed,
        COUNT(*) FILTER (WHERE ${ALL_SIGNED})::int signed FROM simple_work_orders WHERE deleted_at IS NULL`);
    const r = await one(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='Close')::int closed,
        COUNT(*) FILTER (WHERE status IN ('Register','Assign','Work On'))::int open FROM ac_repair_jobs`);
    const sch = await one(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='planned')::int planned,
        COUNT(*) FILTER (WHERE status='done')::int done FROM wash_schedule`);
    const summary = [
      ['สรุประบบ (export)', new Date().toISOString().slice(0, 10)],
      [],
      ['ทะเบียนแอร์ทั้งหมด', u.total || 0],
      ['ใช้งาน', u.active || 0],
      ['AHU / FCU / SPT / VRF', `${u.ahu || 0} / ${u.fcu || 0} / ${u.spt || 0} / ${u.vrf || 0}`],
      [],
      ['ใบงานล้างทั้งหมด', w.total || 0],
      ['เซ็นครบ', w.signed || 0],
      ['วางบิลแล้ว', w.billed || 0],
      [],
      ['งานซ่อมทั้งหมด', r.total || 0],
      ['ปิดงาน', r.closed || 0],
      ['คงค้าง', r.open || 0],
      [],
      ['นัดในปฏิทินทั้งหมด', sch.total || 0],
      ['ค้าง (planned)', sch.planned || 0],
      ['เสร็จ (done)', sch.done || 0],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'สรุป');
    // จัดลำดับ sheet: สรุป → ประวัติเครื่องจักร → ที่เหลือ
    const front = ['สรุป', 'ประวัติเครื่องจักร'];
    wb.SheetNames = [...front.filter((n) => wb.SheetNames.includes(n)), ...wb.SheetNames.filter((n) => !front.includes(n))];

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="air-system-backup-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
  } catch (err) { serverError(res, err); }
});

module.exports = router;
