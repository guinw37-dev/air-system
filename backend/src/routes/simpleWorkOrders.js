const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const dayjs = require('dayjs');
const XLSX = require('xlsx');
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const { getSimpleReportData } = require('../services/simpleReportBuilder');
const { buildSimpleReportHtml, buildSimpleBatchHtml } = require('../services/reportTemplates');
const { htmlToPdf, PdfUnavailableError } = require('../services/pdfRenderer');

const PUBLIC_BASE = process.env.FRONTEND_URL || '';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');

// ── photo upload (multer → /uploads/photos/simple/...) ──────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, 'photos', 'simple');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '.jpg').slice(0, 8);
    cb(null, `s_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

// ── WO number: WO-{พ.ศ.}-{MM}-{running4} ────────────────────────────────────
async function genWoNumber(client) {
  const be = dayjs().year() + 543;
  const mm = dayjs().format('MM');
  const prefix = `WO-${be}-${mm}-`;
  const { rows } = await client.query(
    'SELECT COUNT(*) FROM simple_work_orders WHERE wo_number LIKE $1', [`${prefix}%`]
  );
  return `${prefix}${String(parseInt(rows[0].count, 10) + 1).padStart(4, '0')}`;
}

// ── POST /api/simple-wo/upload — single photo → { url } ─────────────────────
router.post('/upload', authMiddleware, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const url = '/uploads/' + path.relative(UPLOAD_DIR, req.file.path).split(path.sep).join('/');
  res.status(201).json({ url });
});

// ── GET /api/simple-wo/form-schema?work_type= — template items grouped ──────
const CAT_ORDER = ['all3', 'refrigerant', 'fcu', 'ahu', 'other', 'fan'];
const CAT_LABEL = {
  all3: 'ใช้งานทั้ง 3 ประเภท', refrigerant: 'แอร์น้ำยา', fcu: 'FCU',
  ahu: 'AHU', other: 'อื่น ๆ', fan: 'พัดลม',
};
router.get('/form-schema', authMiddleware, async (req, res) => {
  const wt = req.query.work_type || 'major';
  let where;
  if (wt === 'fan') where = `equipment_type = 'fan'`;
  else if (wt === 'minor') where = `equipment_type = 'ac' AND applies_minor = true`;
  else where = `equipment_type = 'ac' AND applies_major = true`;
  try {
    const { rows } = await pool.query(`
      SELECT id, category, item_label, value_type, unit_label, sort_order
      FROM inspection_template_items WHERE ${where}
      ORDER BY sort_order, id
    `);
    const byCat = new Map();
    for (const it of rows) {
      if (!byCat.has(it.category)) byCat.set(it.category, []);
      byCat.get(it.category).push(it);
    }
    const sections = CAT_ORDER
      .filter((k) => byCat.has(k))
      .map((k) => ({ key: k, label: CAT_LABEL[k] || k, fields: byCat.get(k) }));
    res.json({ work_type: wt, sections });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/simple-wo/export/excel — all (filter date range) ───────────────
const RESULT_LABEL = { ok: 'เรียบร้อย', not_ok: 'ไม่เรียบร้อย' };
const WT_LABEL = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลม' };
const AC_KIND_LABEL = { water: 'แอร์น้ำ', refrigerant: 'แอร์น้ำยา', other: 'อื่น ๆ' };

const s = (x) => (x === null || x === undefined || x === '' ? '' : String(x));

// Extract one atomic sub-field of a stored checklist value by column key.
function atomicValue(v, key) {
  v = v || {};
  switch (key) {
    case 'ก่อน': return s(v.value_before);
    case 'หลัง': return s(v.value_after);
    case 'หน่วย': return s(v.unit);
    case 'R ก่อน': return s(v.val_r_before);
    case 'S ก่อน': return s(v.val_s_before);
    case 'T ก่อน': return s(v.val_t_before);
    case 'R หลัง': return s(v.val_r_after);
    case 'S หลัง': return s(v.val_s_after);
    case 'T หลัง': return s(v.val_t_after);
    case 'LN ก่อน': return s(v.val_ln_before);
    case 'L ก่อน': return s(v.val_l_before);
    case 'LN หลัง': return s(v.val_ln_after);
    case 'L หลัง': return s(v.val_l_after);
    case 'R(V)': return s(v.val_r_v_after);
    case 'S(V)': return s(v.val_s_v_after);
    case 'T(V)': return s(v.val_t_v_after);
    case 'R(A)': return s(v.val_r_after);
    case 'S(A)': return s(v.val_s_after);
    case 'T(A)': return s(v.val_t_after);
    case 'Suction': return s(v.val_suction);
    case 'Discharge': return s(v.val_discharge);
    case 'น้ำยา': return s(v.refrigerant_type);
    case 'ข้อความ': return s(v.val_text);
    case 'หมายเหตุ': return s(v.note);
    case 'ติ๊ก': return (v.checked === true || v.checked === 'true') ? '1' : '-';
    default: return '';
  }
}

// Which atomic sub-columns to expose for each value_type (keeps the sheet
// narrow — only the fields that type can actually hold). 'หมายเหตุ' appended.
function relevantKeys(valueType) {
  switch (valueType) {
    case 'number':
    case 'before_after': return ['ก่อน', 'หลัง', 'หน่วย'];
    case 'rst_amp': return ['R ก่อน', 'S ก่อน', 'T ก่อน', 'R หลัง', 'S หลัง', 'T หลัง', 'LN ก่อน', 'L ก่อน', 'LN หลัง', 'L หลัง'];
    case 'ln_vi': return ['LN หลัง', 'L หลัง', 'R(V)', 'R(A)', 'S(V)', 'S(A)', 'T(V)', 'T(A)'];
    case 'pressure_pair': return ['Suction', 'Discharge', 'น้ำยา'];
    case 'check': return ['ติ๊ก'];
    case 'text': return ['ข้อความ'];
    default: return ['ก่อน', 'หลัง'];
  }
}

router.get('/export/excel', authMiddleware, async (req, res) => {
  const { date_from, date_to } = req.query;
  const where = ['1=1']; const params = []; let i = 1;
  if (date_from) { where.push(`created_at >= $${i++}`); params.push(date_from); }
  if (date_to)   { where.push(`created_at < ($${i++}::date + 1)`); params.push(date_to); }
  try {
    const { rows } = await pool.query(`
      SELECT s.*, u.name AS created_by_name FROM simple_work_orders s
      LEFT JOIN users u ON s.created_by = u.id
      WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC
    `, params);
    // Simple-WO uses ONE checklist (the full AC/major set).
    const { rows: items } = await pool.query(`
      SELECT id, category, item_label, value_type, unit_label, sort_order
      FROM inspection_template_items
      WHERE equipment_type = 'ac' AND applies_major = true
      ORDER BY sort_order, id
    `);

    // Build the checklist columns once — each item expands rightward into its
    // relevant atomic sub-columns, number-prefixed so headers stay unique/ordered.
    const itemCols = [];
    items.forEach((it, idx) => {
      const nn = String(idx + 1).padStart(2, '0');
      for (const key of [...relevantKeys(it.value_type), 'หมายเหตุ']) {
        itemCols.push({ id: it.id, key, header: `${nn}. ${it.item_label} · ${key}` });
      }
    });

    // ── Single wide sheet: one row per WO, checklist expands to the right ──
    const data = rows.map((r) => {
      const tc = r.team_comment || {};
      const ac = r.ac_info || {};
      const cv = r.checklist_values || {};
      const row = {
        'เลขใบงาน': r.wo_number,
        'วันที่สร้าง': dayjs(r.created_at).format('DD/MM/YYYY HH:mm'),
        'ช่าง': r.tech_name || r.created_by_name || '',
        'วันที่ปฏิบัติงาน': r.work_date ? dayjs(r.work_date).format('DD/MM/YYYY') : '',
        'ลูกค้า': r.client_name || '',
        'อาคาร': r.building || '',
        'ชั้น': r.floor || '',
        'ห้อง': r.room || '',
        'เลขเครื่อง': r.asset_code || '',
        'ประเภทงาน': WT_LABEL[r.work_type] || r.work_type || '',
        'ระบบไฟ': r.power_system || '',
        'ผลงาน': RESULT_LABEL[r.result] || r.result || '',
        'เวลาเริ่ม': r.start_time || '',
        'เวลาเสร็จ': r.end_time || '',
        'แอร์: รายละเอียด': ac.detail || '',
        'แอร์: ตำแหน่ง': ac.location || '',
        'แอร์: ชนิด': AC_KIND_LABEL[ac.kind] || ac.kind || '',
        'แอร์: ยี่ห้อ': ac.brand || '',
        'แอร์: รุ่น': ac.model || '',
        'แอร์: ขนาดทำความเย็น': ac.cooling_size || '',
        'สภาพ: แอร์เสื่อม': tc.ac_degraded ? '1' : '',
        'สภาพ: แอร์เก่า 5-7 ปี': tc.ac_old_5_7yr ? '1' : '',
        'สภาพ: ภายนอกเสื่อม': tc.external_degraded ? '1' : '',
        'สภาพ: ภายนอก รายละเอียด': tc.external_detail || '',
        'สภาพ: ภายในเสื่อม': tc.internal_degraded ? '1' : '',
        'สภาพ: ภายใน รายละเอียด': tc.internal_detail || '',
        'เซ็น: ช่างแอร์': r.sig_team_name || '',
        'เซ็น: หัวหน้าช่างแอร์': r.sig_supervisor_name || '',
        'เซ็น: เจ้าหน้าที่ช่างอาคาร': r.sig_building_name || '',
        'เซ็น: เจ้าหน้าวิศวกรรม': r.sig_engineer_name || '',
      };
      // Checklist columns to the right.
      for (const c of itemCols) {
        row[c.header] = atomicValue(cv[c.id] || cv[String(c.id)], c.key);
      }
      return row;
    });

    const baseHeader = data.length ? Object.keys(data[0]).filter((k) => !itemCols.some((c) => c.header === k)) : [];
    const header = [...baseHeader, ...itemCols.map((c) => c.header)];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data, { header }), 'ใบงาน');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="simple-workorders-${dayjs().format('YYYYMMDD')}.xlsx"`);
    res.end(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/simple-wo — create + submit ───────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wo_number = await genWoNumber(client);
    const { rows } = await client.query(`
      INSERT INTO simple_work_orders (
        wo_number, created_by, tech_name, work_date, client_name, building, floor, room,
        asset_code, work_type, power_system, checklist_values, result, start_time, end_time,
        team_comment, photo_urls, gallery_urls, ac_info,
        sig_engineer, sig_engineer_name, sig_department, sig_department_name, sig_team, sig_team_name,
        sig_supervisor, sig_supervisor_name, sig_building, sig_building_name,
        grid_rows, recommendation
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
      RETURNING id, wo_number
    `, [
      wo_number, req.user.id, b.tech_name || null, b.work_date || null, b.client_name || null,
      b.building || null, b.floor || null, b.room || null, b.asset_code || null,
      b.work_type || 'major', b.power_system || null,
      JSON.stringify(b.checklist_values || {}), b.result || null,
      b.start_time || null, b.end_time || null,
      JSON.stringify(b.team_comment || {}), JSON.stringify(b.photo_urls || []),
      JSON.stringify(b.gallery_urls || []), JSON.stringify(b.ac_info || {}),
      b.sig_engineer || null, b.sig_engineer_name || null,
      b.sig_department || null, b.sig_department_name || null,
      b.sig_team || null, b.sig_team_name || null,
      b.sig_supervisor || null, b.sig_supervisor_name || null,
      b.sig_building || null, b.sig_building_name || null,
      JSON.stringify(b.grid_rows || []), b.recommendation || null,
    ]);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── GET /api/simple-wo — list (filter date range / created_by) ──────────────
router.get('/', authMiddleware, async (req, res) => {
  const { date_from, date_to, created_by, limit = 100, offset = 0 } = req.query;
  const where = ['1=1']; const params = []; let i = 1;
  if (date_from)  { where.push(`s.created_at >= $${i++}`); params.push(date_from); }
  if (date_to)    { where.push(`s.created_at < ($${i++}::date + 1)`); params.push(date_to); }
  if (created_by) { where.push(`s.created_by = $${i++}`); params.push(created_by); }
  params.push(limit, offset);
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.wo_number, s.created_at, s.work_date, s.tech_name, s.client_name,
             s.building, s.asset_code, s.work_type, s.result, s.status,
             u.name AS created_by_name,
             jsonb_array_length(COALESCE(s.photo_urls,'[]'::jsonb)) AS photo_count
      FROM simple_work_orders s
      LEFT JOIN users u ON s.created_by = u.id
      WHERE ${where.join(' AND ')}
      ORDER BY s.created_at DESC
      LIMIT $${i++} OFFSET $${i++}
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/simple-wo/:id ──────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*, u.name AS created_by_name FROM simple_work_orders s
      LEFT JOIN users u ON s.created_by = u.id WHERE s.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/simple-wo/:id/pdf ──────────────────────────────────────────────
router.get('/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const data = await getSimpleReportData(req.params.id, { publicBaseUrl: PUBLIC_BASE });
    if (!data) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    const html = buildSimpleReportHtml(data);
    try {
      const pdf = await htmlToPdf(html, { landscape: false });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${data.wo.order_no}.pdf"`);
      return res.end(pdf);
    } catch (err) {
      if (err instanceof PdfUnavailableError) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-PDF-Fallback', 'html');
        return res.send(html);
      }
      throw err;
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/simple-wo/:id — edit ───────────────────────────────────────────
// Allowed: the creator, or admin / central_admin. wo_number/created_by frozen.
router.put('/:id', authMiddleware, async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await pool.query(
      'SELECT created_by FROM simple_work_orders WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    const privileged = ['admin', 'central_admin'].includes(req.user.role);
    if (!privileged && rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขใบงานนี้' });
    }
    const { rows: upd } = await pool.query(`
      UPDATE simple_work_orders SET
        tech_name=$2, work_date=$3, client_name=$4, building=$5, floor=$6, room=$7,
        asset_code=$8, work_type=$9, power_system=$10, checklist_values=$11, result=$12,
        start_time=$13, end_time=$14, team_comment=$15, photo_urls=$16,
        sig_engineer=$17, sig_engineer_name=$18, sig_department=$19, sig_department_name=$20,
        sig_team=$21, sig_team_name=$22, gallery_urls=$23, ac_info=$24,
        sig_building=$25, sig_building_name=$26, sig_supervisor=$27, sig_supervisor_name=$28,
        grid_rows=$29, recommendation=$30
      WHERE id=$1
      RETURNING id, wo_number
    `, [
      req.params.id, b.tech_name || null, b.work_date || null, b.client_name || null,
      b.building || null, b.floor || null, b.room || null, b.asset_code || null,
      b.work_type || 'major', b.power_system || null,
      JSON.stringify(b.checklist_values || {}), b.result || null,
      b.start_time || null, b.end_time || null,
      JSON.stringify(b.team_comment || {}), JSON.stringify(b.photo_urls || []),
      b.sig_engineer || null, b.sig_engineer_name || null,
      b.sig_department || null, b.sig_department_name || null,
      b.sig_team || null, b.sig_team_name || null,
      JSON.stringify(b.gallery_urls || []), JSON.stringify(b.ac_info || {}),
      b.sig_building || null, b.sig_building_name || null,
      b.sig_supervisor || null, b.sig_supervisor_name || null,
      JSON.stringify(b.grid_rows || []), b.recommendation || null,
    ]);
    res.json(upd[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/simple-wo/:id ───────────────────────────────────────────────
// Allowed: the creator, or admin / central_admin. Best-effort unlink of photos.
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT created_by, photo_urls, gallery_urls FROM simple_work_orders WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    const row = rows[0];
    const privileged = ['admin', 'central_admin'].includes(req.user.role);
    if (!privileged && row.created_by !== req.user.id) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบใบงานนี้' });
    }
    await pool.query('DELETE FROM simple_work_orders WHERE id = $1', [req.params.id]);
    // best-effort: remove photo + gallery files (ignore errors)
    for (const p of [...(row.photo_urls || []), ...(row.gallery_urls || [])]) {
      if (p && typeof p.url === 'string' && p.url.startsWith('/uploads/')) {
        fs.unlink(path.join(UPLOAD_DIR, p.url.replace('/uploads/', '')), () => {});
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/simple-wo/batch-sign — sign many WOs at once ──────────────────
// role → which signature slot: approver=วิศวกรรม, checker=หน่วยงาน, technician=ทีมช่าง
// Sign slots (left→right on the report): ช่างแอร์ / หัวหน้าช่างแอร์ /
// เจ้าหน้าที่ช่างอาคาร / เจ้าหน้าวิศวกรรม. checker has no slot.
const ROLE_SLOT = { technician: 'team', supervisor: 'supervisor', building: 'building', approver: 'engineer' };
router.post('/batch-sign', authMiddleware, async (req, res) => {
  const slot = ROLE_SLOT[req.user.role];
  if (!slot) return res.status(403).json({ error: 'role นี้เซ็นชุดไม่ได้' });
  const { ids = [], signature_data, signer_name } = req.body || {};
  const cleanIds = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
  if (!cleanIds.length) return res.status(400).json({ error: 'ไม่ได้เลือกใบงาน' });
  if (!signature_data) return res.status(400).json({ error: 'ไม่มีลายเซ็น' });
  const dataCol = `sig_${slot}`;
  const nameCol = `sig_${slot}_name`;
  try {
    const { rowCount } = await pool.query(
      `UPDATE simple_work_orders SET ${dataCol} = $1, ${nameCol} = $2 WHERE id = ANY($3)`,
      [signature_data, signer_name || '', cleanIds]
    );
    res.json({ ok: true, signed: rowCount, slot });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/simple-wo/batch-pdf — billing cover + each WO report ───────────
router.post('/batch-pdf', authMiddleware, async (req, res) => {
  if (!['admin', 'central_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'เฉพาะ admin ออกเอกสารชุดได้' });
  }
  const { ids = [], cover = {} } = req.body || {};
  const cleanIds = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
  if (!cleanIds.length) return res.status(400).json({ error: 'ไม่ได้เลือกใบงาน' });
  const ov = cover && typeof cover === 'object' ? cover : {};
  try {
    const dataArray = [];
    for (const id of cleanIds) {
      const d = await getSimpleReportData(id, { publicBaseUrl: PUBLIC_BASE });
      if (d) dataArray.push(d);
    }
    if (!dataArray.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    // billing cover meta
    const clients = [...new Set(dataArray.map((d) => d.wo.client_name).filter(Boolean))];
    const dates = dataArray.map((d) => d.wo.work_date || d.wo.created_at).filter(Boolean).sort();
    const fmt = (v) => (v ? dayjs(v).format('DD/MM/YYYY') : '');
    const meta = {
      client_name: clients.length === 1 ? clients[0] : `${clients.length} โรงพยาบาล`,
      doc_no: `BILL-${dayjs().format('YYYYMM')}-${String(cleanIds[0]).padStart(4, '0')}`,
      issue_date: new Date(),
      date_range: dates.length ? (fmt(dates[0]) === fmt(dates[dates.length - 1]) ? fmt(dates[0]) : `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`) : '—',
      wo_count: dataArray.length,
    };
    // editable cover overrides (only non-empty values win)
    for (const k of ['client_name', 'doc_no', 'date_range', 'note']) {
      if (ov[k] != null && String(ov[k]).trim() !== '') meta[k] = String(ov[k]).trim();
    }
    if (ov.issue_date != null && String(ov.issue_date).trim() !== '') meta.issue_date = ov.issue_date;
    const html = buildSimpleBatchHtml(dataArray, meta);
    try {
      const pdf = await htmlToPdf(html, { landscape: false });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${meta.doc_no}.pdf"`);
      return res.end(pdf);
    } catch (err) {
      if (err instanceof PdfUnavailableError) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-PDF-Fallback', 'html');
        return res.send(html);
      }
      throw err;
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
