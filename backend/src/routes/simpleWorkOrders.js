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
const { buildSimpleReportHtml, buildSimpleBatchHtml, buildSimpleBatchCoverHtml } = require('../services/reportTemplates');
const { htmlToPdf, renderAndMerge, PdfUnavailableError } = require('../services/pdfRenderer');

// Fan out an in-app notification for a simple-wo event. Recipients are branch
// users (by role and/or a specific id) read from req.db (<schema>.users); rows
// are inserted into the GLOBAL public.notifications with branch_slug set so the
// per-branch GET can scope them. Best-effort — never throws into the caller.
async function notifyWo(req, { woId, type, message, toRoles, toUserId }) {
  try {
    if (!req.branch) return;                 // only meaningful inside a branch
    const branchSlug = req.branch.slug;
    const ids = new Set();
    if (toUserId) ids.add(toUserId);
    if (toRoles && toRoles.length) {
      const { rows } = await req.db('SELECT id FROM users WHERE role = ANY($1) AND active = true', [toRoles]);
      rows.forEach((r) => ids.add(r.id));
    }
    const recipients = [...ids].filter(Boolean).filter((id) => id !== req.user.id); // don't notify self
    if (!recipients.length) return;
    const values = recipients.map((_, i) => `($${i * 5 + 1},$${i * 5 + 2},$${i * 5 + 3},$${i * 5 + 4},$${i * 5 + 5})`).join(',');
    const params = recipients.flatMap((id) => [id, woId, branchSlug, type, message]);
    await pool.query(`INSERT INTO notifications (user_id, work_order_id, branch_slug, type, message) VALUES ${values}`, params);
  } catch { /* notifications are best-effort — never break the WO action */ }
}

// Schema-per-tenant: simple_work_orders lives in the current branch schema, so
// req.db scopes every read/write. The "customer" is the branch itself (no
// wo_clients table) — client_name on the WO is just denormalized display text.

const PUBLIC_BASE = process.env.FRONTEND_URL || '';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');

// ── Signature slots — each role may fill ONLY its own slot ───────────────────
// A technician signs the "team" (ช่างแอร์) slot, a supervisor the supervisor
// slot, etc. admin/super_admin may fill any. On create/edit a non-privileged
// user's input for slots they don't own is dropped: the slot keeps its existing
// value (edit) or stays empty (create). This stops a tech from forging the
// engineer / หัวหน้าช่าง / ช่างอาคาร signature on the form.
const SIG_SLOTS = ['engineer', 'department', 'team', 'supervisor', 'building'];
const ROLE_SLOT = { technician: 'team', supervisor: 'supervisor', building: 'building', approver: 'engineer' };
const canSignSlot = (role, slot) =>
  role === 'admin' || role === 'super_admin' || ROLE_SLOT[role] === slot;

// Resolve the sig_* values to persist. `cur` = current DB row (edit) or {} (create).
// Allowed slots take the submitted value; others fall back to the existing value.
function resolveSigs(role, b, cur = {}) {
  const out = {};
  for (const slot of SIG_SLOTS) {
    if (canSignSlot(role, slot)) {
      out[`sig_${slot}`] = b[`sig_${slot}`] || null;
      out[`sig_${slot}_name`] = b[`sig_${slot}_name`] || null;
    } else {
      out[`sig_${slot}`] = cur[`sig_${slot}`] || null;
      out[`sig_${slot}_name`] = cur[`sig_${slot}_name`] || null;
    }
  }
  return out;
}

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

// ── WO number: WO-{พ.ศ.}-{MM}-{running4} — unique within the branch schema ───
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
    // inspection_template_items is GLOBAL (public) — req.db resolves it via the
    // public fallback on the search_path.
    const { rows } = await req.db(`
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

// ── Customer list — the branch IS the customer. On a branch return just it; on
// apex (super-admin) return the active registry. POST/DELETE are no-ops kept for
// frontend compatibility (customer name is free text on the WO).
router.get('/clients', authMiddleware, async (req, res) => {
  try {
    if (req.branch) return res.json([{ id: req.branch.id, name: req.branch.name }]);
    const { rows } = await pool.query('SELECT id, name FROM clients WHERE active = true ORDER BY name');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/clients', authMiddleware, async (req, res) => {
  const name = (req.body && req.body.name ? String(req.body.name) : '').trim();
  if (!name) return res.status(400).json({ error: 'ต้องระบุชื่อ' });
  // Not persisted — the customer is the branch; the WO stores client_name as text.
  res.status(201).json({ id: req.branch ? req.branch.id : 0, name });
});
router.delete('/clients/:id', authMiddleware, async (req, res) => {
  res.json({ ok: true });
});

// ── GET /api/simple-wo/export/excel — branch's WOs (filter date range) ──────
const RESULT_LABEL = { ok: 'เรียบร้อย', not_ok: 'ไม่เรียบร้อย' };
const WT_LABEL = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลม' };
const AC_KIND_LABEL = { water: 'แอร์น้ำ', refrigerant: 'แอร์น้ำยา', other: 'อื่น ๆ' };

const WORK_TYPES_OK = ['major', 'minor', 'fan'];
const RESULTS_OK = ['ok', 'not_ok'];
const POWER_OK = ['380', '220'];
const AC_TYPES_OK = ['FCU', 'SPT', 'VRF', 'AHU', 'OAU'];
const FAN_TYPES_OK = ['Exhaust Fan', 'Exhaust Fan Duct Type'];
const AC_OR_FAN_TYPES = [...AC_TYPES_OK, ...FAN_TYPES_OK];
function validateBody(b) {
  if (b.work_type && !WORK_TYPES_OK.includes(b.work_type)) return 'work_type ไม่ถูกต้อง';
  if (b.result && !RESULTS_OK.includes(b.result)) return 'result ไม่ถูกต้อง';
  if (b.power_system && !POWER_OK.includes(String(b.power_system))) return 'power_system ไม่ถูกต้อง';
  if (b.ac_type && !AC_OR_FAN_TYPES.includes(String(b.ac_type))) return 'ac_type ไม่ถูกต้อง';
  if (b.grid_rows != null && !Array.isArray(b.grid_rows)) return 'grid_rows ต้องเป็น array';
  if (b.photo_urls != null && !Array.isArray(b.photo_urls)) return 'photo_urls ต้องเป็น array';
  if (b.gallery_urls != null && !Array.isArray(b.gallery_urls)) return 'gallery_urls ต้องเป็น array';
  if (b.checklist_values != null && (typeof b.checklist_values !== 'object' || Array.isArray(b.checklist_values))) return 'checklist_values ต้องเป็น object';
  if (b.ac_info != null && (typeof b.ac_info !== 'object' || Array.isArray(b.ac_info))) return 'ac_info ต้องเป็น object';
  if (b.team_comment != null && (typeof b.team_comment !== 'object' || Array.isArray(b.team_comment))) return 'team_comment ต้องเป็น object';
  return null;
}

const s = (x) => (x === null || x === undefined || x === '' ? '' : String(x));

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
  const where = ['s.deleted_at IS NULL']; const params = []; let i = 1;
  if (date_from) { where.push(`s.created_at >= $${i++}`); params.push(date_from); }
  if (date_to)   { where.push(`s.created_at < ($${i++}::date + 1)`); params.push(date_to); }
  try {
    const { rows } = await req.db(`
      SELECT s.*, u.name AS created_by_name FROM simple_work_orders s
      LEFT JOIN users u ON s.created_by = u.id
      WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC
    `, params);
    const { rows: items } = await req.db(`
      SELECT id, category, item_label, value_type, unit_label, sort_order
      FROM inspection_template_items
      WHERE equipment_type = 'ac' AND applies_major = true
      ORDER BY sort_order, id
    `);

    const itemCols = [];
    items.forEach((it, idx) => {
      const nn = String(idx + 1).padStart(2, '0');
      for (const key of [...relevantKeys(it.value_type), 'หมายเหตุ']) {
        itemCols.push({ id: it.id, key, header: `${nn}. ${it.item_label} · ${key}` });
      }
    });

    const data = rows.filter((r) => !r.work_type || r.work_type === 'major').map((r) => {
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
      for (const c of itemCols) {
        row[c.header] = atomicValue(cv[c.id] || cv[String(c.id)], c.key);
      }
      return row;
    });

    const baseHeader = data.length ? Object.keys(data[0]).filter((k) => !itemCols.some((c) => c.header === k)) : [];
    const header = [...baseHeader, ...itemCols.map((c) => c.header)];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data, { header }), 'ล้างใหญ่');

    const GRID_COLS_X = {
      minor: ['ตรวจเช็คระบบการทำงาน', 'ล้างหัวจ่าย', 'ล้างช่องรีเทิร์น', 'ล้างฟิลเตอร์'],
      fan: ['ล้างหน้ากาก/มอเตอร์/ใบพัด', 'ใส่น้ำมันหล่อลื่นมอเตอร์', 'เช็คกระแสไฟฟ้า', 'เช็คความดังเสียง', 'ใช้งานได้ปกติ'],
    };
    const gridSheetFor = (wt, cols, sheetName) => {
      const fan = wt === 'fan';
      const typeLabel = fan ? 'ประเภทพัดลม' : 'ประเภทแอร์';  // both ล้างย่อย & พัดลม carry สถานที่ + ห้อง/เลขเครื่อง
      const out = [];
      for (const r of rows) {
        if (r.work_type !== wt) continue;
        const grows = Array.isArray(r.grid_rows) ? r.grid_rows : [];
        grows.forEach((g, idx) => {
          const row = {
            'เลขใบงาน': r.wo_number,
            'วันที่': r.work_date ? dayjs(r.work_date).format('DD/MM/YYYY') : '',
            'ลูกค้า': r.client_name || '',
            'สถานที่': r.location || r.client_name || '',
            [typeLabel]: r.ac_type || '',
            'อาคาร': r.building || '',
            'ชั้น': r.floor || '',
            'ช่าง': r.tech_name || r.created_by_name || '',
            'ลำดับ': idx + 1,
            'ห้อง/แผนก': g.room || r.room || '',
            'เลขเครื่อง': g.machine_no || g.name || '',
          };
          cols.forEach((c, ci) => { row[c] = (g.checks || [])[ci] ? '1' : '-'; });
          if (fan) row['ชำรุดเนื่องจาก'] = g.broken || '';
          row['ข้อแนะนำ'] = r.recommendation || '';
          out.push(row);
        });
      }
      if (!out.length) return;
      const hdr = ['เลขใบงาน', 'วันที่', 'ลูกค้า', 'สถานที่', typeLabel, 'อาคาร', 'ชั้น', 'ช่าง', 'ลำดับ',
        'ห้อง/แผนก', 'เลขเครื่อง',
        ...cols, ...(fan ? ['ชำรุดเนื่องจาก'] : []), 'ข้อแนะนำ'];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out, { header: hdr }), sheetName);
    };
    gridSheetFor('minor', GRID_COLS_X.minor, 'ล้างย่อย');
    gridSheetFor('fan', GRID_COLS_X.fan, 'พัดลม');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="simple-workorders-${dayjs().format('YYYYMMDD')}.xlsx"`);
    res.end(buf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/simple-wo — create + submit ───────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const b = req.body || {};
  const verr = validateBody(b);
  if (verr) return res.status(400).json({ error: verr });
  const sig = resolveSigs(req.user.role, b);
  const client = await req.tx();
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
        grid_rows, recommendation, location, ac_type, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,NOW())
      RETURNING id, wo_number
    `, [
      wo_number, req.user.id, b.tech_name || null, b.work_date || null,
      b.client_name || (req.branch ? req.branch.name : null),
      b.building || null, b.floor || null, b.room || null, b.asset_code || null,
      b.work_type || 'major', b.power_system || null,
      JSON.stringify(b.checklist_values || {}), b.result || null,
      b.start_time || null, b.end_time || null,
      JSON.stringify(b.team_comment || {}), JSON.stringify(b.photo_urls || []),
      JSON.stringify(b.gallery_urls || []), JSON.stringify(b.ac_info || {}),
      sig.sig_engineer, sig.sig_engineer_name,
      sig.sig_department, sig.sig_department_name,
      sig.sig_team, sig.sig_team_name,
      sig.sig_supervisor, sig.sig_supervisor_name,
      sig.sig_building, sig.sig_building_name,
      JSON.stringify(b.grid_rows || []), b.recommendation || null,
      b.location || null, b.ac_type || null,
    ]);
    await client.query('COMMIT');
    // New ใบงาน starts as 'submitted' → alert checkers/approvers/admins to review.
    await notifyWo(req, {
      woId: rows[0].id, type: 'wo_submitted',
      message: `ใบงาน ${rows[0].wo_number} รอตรวจ`,
      toRoles: ['checker', 'approver', 'admin'],
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ── GET /api/simple-wo — list (filter date range / created_by) ──────────────
router.get('/', authMiddleware, async (req, res) => {
  const { date_from, date_to, created_by, limit = 100, offset = 0 } = req.query;
  const where = ['s.deleted_at IS NULL']; const params = []; let i = 1;
  if (date_from)  { where.push(`s.created_at >= $${i++}`); params.push(date_from); }
  if (date_to)    { where.push(`s.created_at < ($${i++}::date + 1)`); params.push(date_to); }
  if (created_by) { where.push(`s.created_by = $${i++}`); params.push(created_by); }
  params.push(limit, offset);
  try {
    const { rows } = await req.db(`
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
    const { rows } = await req.db(`
      SELECT s.*, u.name AS created_by_name FROM simple_work_orders s
      LEFT JOIN users u ON s.created_by = u.id WHERE s.id = $1 AND s.deleted_at IS NULL
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/simple-wo/:id/pdf ──────────────────────────────────────────────
router.get('/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const data = await getSimpleReportData(req.params.id, { db: req.db, publicBaseUrl: PUBLIC_BASE });
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
router.put('/:id', authMiddleware, async (req, res) => {
  const b = req.body || {};
  const verr = validateBody(b);
  if (verr) return res.status(400).json({ error: verr });
  try {
    const { rows } = await req.db(
      `SELECT created_by, status,
              sig_engineer, sig_engineer_name, sig_department, sig_department_name,
              sig_team, sig_team_name, sig_supervisor, sig_supervisor_name,
              sig_building, sig_building_name
       FROM simple_work_orders WHERE id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    const privileged = ['admin', 'super_admin'].includes(req.user.role);
    if (!privileged && rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขใบงานนี้' });
    }
    // Approved = locked. Only admin/super can edit (they implicitly unlock).
    if (rows[0].status === 'approved' && !privileged) {
      return res.status(409).json({ error: 'ใบงานอนุมัติแล้ว (ล็อก) — ส่งกลับก่อนจึงแก้ได้' });
    }
    // Only the user's own signature slot may be (re)written; others keep their value.
    const sig = resolveSigs(req.user.role, b, rows[0]);
    const { rows: upd } = await req.db(`
      UPDATE simple_work_orders SET
        tech_name=$2, work_date=$3, client_name=$4, building=$5, floor=$6, room=$7,
        asset_code=$8, work_type=$9, power_system=$10, checklist_values=$11, result=$12,
        start_time=$13, end_time=$14, team_comment=$15, photo_urls=$16,
        sig_engineer=$17, sig_engineer_name=$18, sig_department=$19, sig_department_name=$20,
        sig_team=$21, sig_team_name=$22, gallery_urls=$23, ac_info=$24,
        sig_building=$25, sig_building_name=$26, sig_supervisor=$27, sig_supervisor_name=$28,
        grid_rows=$29, recommendation=$30, location=$31, ac_type=$32, updated_at=NOW()
      WHERE id=$1
      RETURNING id, wo_number
    `, [
      req.params.id, b.tech_name || null, b.work_date || null, b.client_name || null,
      b.building || null, b.floor || null, b.room || null, b.asset_code || null,
      b.work_type || 'major', b.power_system || null,
      JSON.stringify(b.checklist_values || {}), b.result || null,
      b.start_time || null, b.end_time || null,
      JSON.stringify(b.team_comment || {}), JSON.stringify(b.photo_urls || []),
      sig.sig_engineer, sig.sig_engineer_name,
      sig.sig_department, sig.sig_department_name,
      sig.sig_team, sig.sig_team_name,
      JSON.stringify(b.gallery_urls || []), JSON.stringify(b.ac_info || {}),
      sig.sig_building, sig.sig_building_name,
      sig.sig_supervisor, sig.sig_supervisor_name,
      JSON.stringify(b.grid_rows || []), b.recommendation || null,
      b.location || null, b.ac_type || null,
    ]);
    res.json(upd[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/simple-wo/:id — soft delete (recoverable) ───────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(
      'SELECT created_by, status FROM simple_work_orders WHERE id = $1 AND deleted_at IS NULL', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    const privileged = ['admin', 'super_admin'].includes(req.user.role);
    if (!privileged && rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบใบงานนี้' });
    }
    if (rows[0].status === 'approved' && !privileged) {
      return res.status(409).json({ error: 'ใบงานอนุมัติแล้ว (ล็อก) — ลบไม่ได้' });
    }
    await req.db('UPDATE simple_work_orders SET deleted_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/simple-wo/:id/transition — approval workflow ──────────────────
// status: submitted → (checked) → approved · rejected. Checker step is optional —
// approver/admin can approve straight from submitted (skip). approved = locked.
const TRANSITIONS = {
  check:   { roles: ['checker', 'admin', 'super_admin'],              from: ['submitted'],            to: 'checked' },
  approve: { roles: ['approver', 'admin', 'super_admin'],             from: ['submitted', 'checked'], to: 'approved' },
  reject:  { roles: ['checker', 'approver', 'admin', 'super_admin'],  from: ['submitted', 'checked'], to: 'rejected' },
  reopen:  { roles: ['admin', 'super_admin'],                         from: ['approved', 'rejected'], to: 'submitted' },
};
router.post('/:id/transition', authMiddleware, async (req, res) => {
  const { action, reason } = req.body || {};
  const t = TRANSITIONS[action];
  if (!t) return res.status(400).json({ error: 'action ไม่ถูกต้อง' });
  if (!t.roles.includes(req.user.role)) return res.status(403).json({ error: 'role นี้ทำขั้นตอนนี้ไม่ได้' });
  try {
    const { rows } = await req.db('SELECT status, created_by, wo_number FROM simple_work_orders WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    const wo = rows[0];
    if (!t.from.includes(wo.status)) {
      return res.status(409).json({ error: `สถานะ "${wo.status}" ทำ "${action}" ไม่ได้` });
    }
    let sql, params;
    if (action === 'check') {
      sql = `UPDATE simple_work_orders SET status='checked', checked_by=$2, checked_at=NOW(), updated_at=NOW() WHERE id=$1`;
      params = [req.params.id, req.user.id];
    } else if (action === 'approve') {
      sql = `UPDATE simple_work_orders SET status='approved', approved_by=$2, approved_at=NOW(), updated_at=NOW() WHERE id=$1`;
      params = [req.params.id, req.user.id];
    } else if (action === 'reject') {
      sql = `UPDATE simple_work_orders SET status='rejected', reject_reason=$2, rejected_at=NOW(), updated_at=NOW() WHERE id=$1`;
      params = [req.params.id, reason || null];
    } else { // reopen — clear the approval/check stamps so the flow restarts cleanly
      sql = `UPDATE simple_work_orders SET status='submitted', approved_by=NULL, approved_at=NULL,
             checked_by=NULL, checked_at=NULL, reject_reason=NULL, rejected_at=NULL, updated_at=NOW() WHERE id=$1`;
      params = [req.params.id];
    }
    await req.db(sql, params);
    // Notify the right people about the transition (best-effort).
    if (action === 'check') {
      await notifyWo(req, { woId: Number(req.params.id), type: 'wo_checked',
        message: `ใบงาน ${wo.wo_number} ตรวจแล้ว รออนุมัติ`, toRoles: ['approver', 'admin'] });
    } else if (action === 'approve') {
      await notifyWo(req, { woId: Number(req.params.id), type: 'wo_approved',
        message: `ใบงาน ${wo.wo_number} อนุมัติแล้ว`, toUserId: wo.created_by });
    } else if (action === 'reject') {
      await notifyWo(req, { woId: Number(req.params.id), type: 'wo_rejected',
        message: `ใบงาน ${wo.wo_number} ถูกส่งกลับ: ${reason || '-'}`, toUserId: wo.created_by });
    }
    res.json({ ok: true, status: t.to });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/simple-wo/batch-sign — sign many WOs at once (own slot only) ───
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
    const { rowCount } = await req.db(
      `UPDATE simple_work_orders SET ${dataCol} = $1, ${nameCol} = $2 WHERE id = ANY($3)`,
      [signature_data, signer_name || '', cleanIds]
    );
    res.json({ ok: true, signed: rowCount, slot });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/simple-wo/batch-pdf — billing cover + each WO report ───────────
router.post('/batch-pdf', authMiddleware, async (req, res) => {
  if (!['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'เฉพาะ admin ออกเอกสารชุดได้' });
  }
  const { ids = [], cover = {} } = req.body || {};
  const cleanIds = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean);
  if (!cleanIds.length) return res.status(400).json({ error: 'ไม่ได้เลือกใบงาน' });
  const ov = cover && typeof cover === 'object' ? cover : {};
  try {
    // Billing covers only APPROVED ใบงาน — block if any selected WO isn't approved.
    const { rows: st } = await req.db(
      `SELECT id, wo_number, status FROM simple_work_orders WHERE id = ANY($1) AND deleted_at IS NULL`, [cleanIds]);
    const notApproved = st.filter((r) => r.status !== 'approved');
    if (notApproved.length) {
      return res.status(409).json({
        error: `วางบิลได้เฉพาะใบที่อนุมัติแล้ว — ยังไม่อนุมัติ ${notApproved.length} ใบ: ${notApproved.map((r) => r.wo_number || r.id).join(', ')}`,
      });
    }
    const dataArray = [];
    for (const id of cleanIds) {
      const d = await getSimpleReportData(id, { db: req.db, publicBaseUrl: PUBLIC_BASE });
      if (d) dataArray.push(d);
    }
    if (!dataArray.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    const clients = [...new Set(dataArray.map((d) => d.wo.client_name).filter(Boolean))];
    const dates = dataArray.map((d) => d.wo.work_date || d.wo.created_at).filter(Boolean).sort();
    const fmt = (v) => (v ? dayjs(v).format('DD/MM/YYYY') : '');
    const meta = {
      client_name: clients.length === 1 ? clients[0] : `${clients.length} ลูกค้า`,
      doc_no: `BILL-${dayjs().format('YYYYMM')}-${String(cleanIds[0]).padStart(4, '0')}`,
      issue_date: new Date(),
      date_range: dates.length ? (fmt(dates[0]) === fmt(dates[dates.length - 1]) ? fmt(dates[0]) : `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`) : '—',
      wo_count: dataArray.length,
    };
    for (const k of ['client_name', 'doc_no', 'date_range', 'note']) {
      if (ov[k] != null && String(ov[k]).trim() !== '') meta[k] = String(ov[k]).trim();
    }
    if (ov.issue_date != null && String(ov.issue_date).trim() !== '') meta.issue_date = ov.issue_date;
    // Render the cover + each WO's FULL (with-photos) report as separate PDFs in
    // one browser (concurrently) and merge → photos are included, yet wall-clock
    // ≈ the slowest single WO, not the sum, so we stay under the proxy timeout.
    const htmls = [buildSimpleBatchCoverHtml(dataArray, meta), ...dataArray.map((d) => buildSimpleReportHtml(d))];
    try {
      const pdf = await renderAndMerge(htmls, { landscape: false });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${meta.doc_no}.pdf"`);
      return res.end(pdf);
    } catch (err) {
      if (err instanceof PdfUnavailableError) {
        // Chrome unavailable → single combined HTML (no photos) as a readable fallback.
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-PDF-Fallback', 'html');
        return res.send(buildSimpleBatchHtml(dataArray, meta));
      }
      throw err;
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
