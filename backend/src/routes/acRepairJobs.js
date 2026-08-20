// /api/ac-repair-jobs — AC repair job management (air-system owns the record).
// Standalone: no link to repair-system (bridge removed 20 Aug 2026) — jobs are
// opened by the TW team here and live entirely in this schema.
//
// Flow: Register → (Work On ⇄ Wait Parts) → Clear (= ปิดงาน) | Cancel
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');
const { insertJob } = require('../services/acRepairCreate');
const { htmlToPdf, PdfUnavailableError } = require('../services/pdfRenderer');
const { buildAcRepairReportHtml } = require('../services/reportTemplates');

const canUse = requireRole(
  'technician', 'checker', 'approve_building', 'approve_engineer', 'admin', 'super_admin'
);

// Photo storage (base64 → disk).
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
function savePhoto(slug, base64, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error('ชนิดไฟล์ไม่อนุญาต (jpg/png/webp เท่านั้น)');
  const dir = path.join(UPLOAD_DIR, 'photos', 'ac-repair', slug);
  fs.mkdirSync(dir, { recursive: true });
  const name = `acr_${Date.now()}${ext}`;
  const buf = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  fs.writeFileSync(path.join(dir, name), buf);
  return `/uploads/photos/ac-repair/${slug}/${name}`;
}

// Status transition table. 'Assign' remains only as a legacy from-state so any
// job still sitting in it (pre-simplification) can move forward; nothing
// transitions INTO Assign or Close any more.
const TRANSITIONS = {
  start:      { from: ['Register', 'Assign', 'Wait Parts'],           to: 'Work On'    },
  wait_parts: { from: ['Register', 'Assign', 'Work On'],              to: 'Wait Parts' },
  clear:      { from: ['Register', 'Assign', 'Work On', 'Wait Parts'], to: 'Clear'     },
  cancel:     { from: ['Register', 'Assign', 'Work On', 'Wait Parts'], to: 'Cancel'    },
};

router.use(authMiddleware, canUse);

// ── GET / — list jobs ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status } = req.query;
  let where = '';
  const params = [];
  if (status === 'active') {
    // งานค้าง = ยังไม่ซ่อมเสร็จ; Clear(ซ่อมเสร็จ)/Close/Cancel ไม่นับเป็นงานค้าง
    where = `WHERE j.status NOT IN ('Clear','Close','Cancel')`;
  } else if (status && status !== 'all') {
    params.push(status);
    where = `WHERE j.status = $1`;
  }
  try {
    const { rows } = await req.db(
      `SELECT j.*, u.name AS created_by_name
         FROM ac_repair_jobs j
         LEFT JOIN users u ON j.created_by = u.id
         ${where}
         ORDER BY j.register_time DESC`,
      params
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// ── GET /stats — counts by status ─────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const { rows } = await req.db(
      `SELECT status, COUNT(*)::int AS count FROM ac_repair_jobs GROUP BY status`
    );
    res.json(Object.fromEntries(rows.map((r) => [r.status, r.count])));
  } catch (err) { serverError(res, err); }
});

// ── GET /locations — distinct อาคาร/ชั้น/แผนก already used on this branch's jobs.
// Feeds the form comboboxes so suggestions exist even when master data is empty
// (e.g. a freshly-provisioned branch whose jobs came in via import).
router.get('/locations', async (req, res) => {
  try {
    const { rows } = await req.db(`
      SELECT
        ARRAY(SELECT DISTINCT building   FROM ac_repair_jobs WHERE COALESCE(building,'')   <> '' ORDER BY building)   AS buildings,
        ARRAY(SELECT DISTINCT floor      FROM ac_repair_jobs WHERE COALESCE(floor,'')      <> '' ORDER BY floor)      AS floors,
        ARRAY(SELECT DISTINCT department FROM ac_repair_jobs WHERE COALESCE(department,'') <> '' ORDER BY department) AS departments
    `);
    res.json(rows[0] || { buildings: [], floors: [], departments: [] });
  } catch (err) { serverError(res, err); }
});

// ── GET /parts-summary — aggregate อะไหล่ที่ต้องสั่ง across open jobs (สั่งของ) ──
// Response shape: { items: [...rows], total_cost }
//   row: { key, name, qty_list, jobs,        ← existing (backward compatible)
//          unit_price, qty_total, cost_total } ← pricing
//   unit_price  = max non-zero price seen for that name (representative)
//   qty_total   = Σ numeric qty across jobs needing it
//   cost_total  = Σ (qty × unit_price) across those jobs
//   total_cost  = Σ cost_total over all rows
// qty is stored as free text, so it's parsed leniently: the leading numeric run
// of each value is taken (e.g. "2 ตัว" → 2); non-numeric qty counts as 0 for sums.
router.get('/parts-summary', async (req, res) => {
  try {
    const { rows } = await req.db(`
      SELECT lower(trim(p->>'name')) AS key,
             max(p->>'name')         AS name,
             string_agg(NULLIF(p->>'qty',''), ' + ') AS qty_list,
             count(*)::int           AS jobs,
             COALESCE(max(NULLIF(p->>'unit_price','')::numeric), 0) AS unit_price,
             COALESCE(SUM(
               COALESCE(NULLIF(substring(p->>'qty' FROM '^\\s*[0-9]+(\\.[0-9]+)?'),'')::numeric, 0)
             ), 0) AS qty_total,
             COALESCE(SUM(
               COALESCE(NULLIF(substring(p->>'qty' FROM '^\\s*[0-9]+(\\.[0-9]+)?'),'')::numeric, 0)
               * COALESCE(NULLIF(p->>'unit_price','')::numeric, 0)
             ), 0) AS cost_total
      FROM ac_repair_jobs j
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(j.parts,'[]'::jsonb)) AS p
      WHERE j.status NOT IN ('Clear','Close','Cancel') AND trim(p->>'name') <> ''
      GROUP BY lower(trim(p->>'name'))
      ORDER BY name`);
    // numeric columns come back as strings from pg → coerce to JS numbers.
    const items = rows.map((r) => ({
      ...r,
      unit_price: Number(r.unit_price) || 0,
      qty_total: Number(r.qty_total) || 0,
      cost_total: Number(r.cost_total) || 0,
    }));
    const total_cost = items.reduce((s, r) => s + r.cost_total, 0);
    res.json({ items, total_cost });
  } catch (err) { serverError(res, err); }
});

// ── GET /:id — detail ──────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await req.db(
      `SELECT j.*, u.name AS created_by_name
         FROM ac_repair_jobs j
         LEFT JOIN users u ON j.created_by = u.id
         WHERE j.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── POST / — create job manually ─────────────────────────────────────────
router.post('/', async (req, res) => {
  if (!req.body.description?.trim()) return res.status(400).json({ error: 'กรุณาระบุรายละเอียด' });
  // รูปแจ้งซ่อม (สูงสุด 3) — save base64 → disk ก่อน insert
  let photoUrls = [];
  try {
    photoUrls = (Array.isArray(req.body.photosBase64) ? req.body.photosBase64 : [])
      .slice(0, 3)
      .filter((p) => p && p.base64 && p.name)
      .map((p) => savePhoto(req.branch.slug, p.base64, p.name));
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const c = await req.tx();
  try {
    await c.query('BEGIN');
    const { row } = await insertJob(c, { ...req.body, photo_urls: photoUrls }, req.user.id);
    await c.query('COMMIT');
    res.status(201).json(row);
  } catch (e) { await c.query('ROLLBACK'); serverError(res, e); }
  finally { c.release(); }
});

// ── PUT /:id — update details (only for non-terminal jobs) ───────────────
router.put('/:id', async (req, res) => {
  const { building, floor, department, requester, telephone, description,
          assign_name, issue_type, job_detail, parts, asset_code } = req.body;
  // Normalise the parts list — keep only {name, qty, note, unit_price}, drop blank rows.
  // unit_price is THB per unit (optional); coerced to a non-negative number, default 0.
  // A part's line cost = qty × unit_price.
  const toPrice = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const cleanParts = Array.isArray(parts)
    ? parts.map((p) => ({
        name: String(p?.name || '').trim(),
        qty: String(p?.qty || '').trim(),
        note: String(p?.note || '').trim(),
        unit_price: toPrice(p?.unit_price),
      })).filter((p) => p.name)
    : [];
  try {
    const { rows: cur } = await req.db(
      'SELECT status FROM ac_repair_jobs WHERE id = $1', [req.params.id]
    );
    if (!cur.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    if (['Clear', 'Close', 'Cancel'].includes(cur[0].status)) {
      return res.status(400).json({ error: 'ใบงานปิดแล้ว แก้ไขไม่ได้' });
    }
    const { rows } = await req.db(
      `UPDATE ac_repair_jobs SET
         building=$1, floor=$2, department=$3, requester=$4, telephone=$5,
         description=$6, assign_name=$7, issue_type=$8, job_detail=$9, parts=$10, asset_code=$11
       WHERE id=$12 RETURNING *`,
      [building || '', floor || '', department || '', requester || '', telephone || '',
       description || '', assign_name || null, issue_type || null, job_detail || null,
       JSON.stringify(cleanParts), asset_code || null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── GET /:id/pdf — printable ใบงานซ่อม ──────────────────────────────────────
router.get('/:id/pdf', async (req, res) => {
  try {
    const { rows } = await req.db(
      `SELECT j.*, u.name AS created_by_name FROM ac_repair_jobs j
         LEFT JOIN users u ON j.created_by = u.id WHERE j.id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    const html = buildAcRepairReportHtml(rows[0], req.branch);
    try {
      const pdf = await htmlToPdf(html);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${rows[0].job_number}.pdf"`);
      return res.end(pdf);
    } catch (e) {
      if (e instanceof PdfUnavailableError) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-PDF-Fallback', 'html');
        return res.send(html);
      }
      throw e;
    }
  } catch (err) { serverError(res, err); }
});

// ── PUT /:id/status — transition status ──────────────────────────────────
router.put('/:id/status', async (req, res) => {
  const { action, work_desc, afterImageBase64, afterImageName, cancel_reason } = req.body;
  const tx = TRANSITIONS[action];
  if (!tx) return res.status(400).json({ error: 'action ไม่ถูกต้อง (start|wait_parts|clear|cancel)' });
  try {
    const { rows: cur } = await req.db(
      'SELECT * FROM ac_repair_jobs WHERE id = $1', [req.params.id]
    );
    if (!cur.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    const job = cur[0];
    if (!tx.from.includes(job.status)) {
      return res.status(400).json({ error: `ไม่สามารถ "${action}" จากสถานะ "${job.status}"` });
    }
    // Build dynamic SET.
    let sql = `UPDATE ac_repair_jobs SET status=$1`;
    const params = [tx.to];
    const add = (col, val) => { params.push(val); sql += `, ${col}=$${params.length}`; };

    if (action === 'start') {
      // เริ่มซ่อมครั้งแรกเท่านั้นที่ stamp เวลา (กลับมาจากรออะไหล่ไม่ทับของเดิม)
      if (!job.start_time) add('start_time', new Date());
    }
    if (action === 'wait_parts') {
      add('wait_parts_time', new Date());
    }
    if (action === 'clear') {
      add('work_desc', work_desc || null);
      add('clear_time', new Date());
      if (afterImageBase64 && afterImageName) {
        add('after_image_url', savePhoto(req.branch.slug, afterImageBase64, afterImageName));
      }
    }
    if (action === 'cancel') {
      add('cancel_reason', cancel_reason || '');
      add('cancel_time', new Date());
    }
    params.push(req.params.id);
    const { rows } = await req.db(`${sql} WHERE id=$${params.length} RETURNING *`, params);
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

module.exports = router;
