// /api/ac-repair-jobs — AC repair job management (air-system owns the record).
// Standalone: no link to repair-system (bridge removed 20 Aug 2026) — jobs are
// opened by the TW team here and live entirely in this schema.
//
// Flow: Register → (Work On ⇄ Wait Parts ⇄ Wait Quote) → Clear (= ปิดงาน) | Cancel
// Wait Quote = รอเสนอราคาซ่อม (PDF ปรับ dashboard 9 พ.ย. 69) — สถานะคู่ขนานกับรออะไหล่.
// ถ้าเพิ่มสถานะอีก: grep 'Wait Parts' ทุกไฟล์ (dashboard.js, washUnits.js,
// reportTemplates.js, AcRepair.jsx, AcApproval.jsx, Dashboard.jsx) แล้วเติมให้ครบ.
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');
const { insertJob } = require('../services/acRepairCreate');
const { htmlToPdf, PdfUnavailableError } = require('../services/pdfRenderer');
const { buildAcRepairReportHtml } = require('../services/reportTemplates');
const { isSignatureImage } = require('../utils/signature');

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
const OPEN = ['Register', 'Assign', 'Work On', 'Wait Parts', 'Wait Quote'];   // ยังไม่ปิด = งานค้าง
const TRANSITIONS = {
  start:      { from: OPEN.filter((s) => s !== 'Work On'),    to: 'Work On'    },
  wait_parts: { from: OPEN.filter((s) => s !== 'Wait Parts'), to: 'Wait Parts' },
  wait_quote: { from: OPEN.filter((s) => s !== 'Wait Quote'), to: 'Wait Quote' },
  clear:      { from: OPEN,                                   to: 'Clear'      },
  cancel:     { from: OPEN,                                   to: 'Cancel'     },
};

// ── ลายเซ็นออนไลน์ในใบแจ้งซ่อม (ไม่บังคับ — ปริ้นไปเซ็นสดได้เหมือนเดิม) ─────────
// requester = ผู้แจ้ง (เจ้าหน้าที่ รพ. ไม่มีบัญชี) เซ็นบนเครื่องของช่าง + พิมพ์ชื่อ/ตำแหน่ง
//             → role ไหนที่ใช้หน้านี้ได้ก็เปิดให้เซ็นได้ (แบบช่องเจ้าของพื้นที่ในใบงานล้าง)
// tech      = ช่างผู้ปฏิบัติงาน เซ็นในนามบัญชีที่ login (ชื่อจากบัญชี ไม่รับจาก body)
const SIGN_SLOTS = ['requester', 'tech'];
const TECH_SIGN_ROLES = ['technician', 'checker'];
function checkAcSign(body, role) {
  const { slot, signature_data, signer_name, signer_position } = body || {};
  if (!SIGN_SLOTS.includes(slot)) return { status: 400, error: 'ช่องเซ็นไม่ถูกต้อง' };
  if (slot === 'tech' && !TECH_SIGN_ROLES.includes(role)) {
    return { status: 403, error: 'ช่องช่างผู้ปฏิบัติงาน เซ็นได้เฉพาะช่าง/หัวหน้าช่างแอร์' };
  }
  if (!isSignatureImage(signature_data)) {
    return { status: 400, error: 'ลายเซ็นต้องเป็นรูปจากช่องเซ็น (PNG/JPEG) ขนาดไม่เกิน ~300 KB' };
  }
  if (slot === 'requester') {
    const name = String(signer_name || '').trim();
    if (!name) return { status: 400, error: 'กรอกชื่อผู้แจ้งก่อนเซ็น' };
    if (name.length > 150) return { status: 400, error: 'ชื่อยาวเกิน 150 ตัวอักษร' };
    const pos = String(signer_position || '').trim().slice(0, 150);
    return { slot, signature: signature_data, name, position: pos || null };
  }
  return { slot, signature: signature_data };
}

// รายการไม่ส่งรูปลายเซ็น (ใบละหลายสิบ KB × ทุกใบ) — ส่งแค่ธงว่าเซ็นแล้ว; รูปอยู่ใน GET /:id
function listRow(r) {
  const { sig_requester, sig_tech, ...rest } = r;
  return { ...rest, requester_signed: !!sig_requester, tech_signed: !!sig_tech };
}

router.use(authMiddleware, canUse);

// ── GET / — list jobs ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status } = req.query;
  let where = '';
  const params = [];
  if (status === 'active') {
    // งานค้าง = ยังไม่ซ่อมเสร็จ; Clear(ซ่อมเสร็จ)/Close/Cancel ไม่นับเป็นงานค้าง (รอเสนอราคา = ค้าง)
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
    res.json(rows.map(listRow));
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
  // รูปแจ้งซ่อม (ก่อน สูงสุด 6) — save base64 → disk ก่อน insert
  let photoUrls = [];
  try {
    photoUrls = (Array.isArray(req.body.photosBase64) ? req.body.photosBase64 : [])
      .slice(0, 6)
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
    // Memo ของใบงาน (ส่วนที่ 4) — สาขาที่ยังไม่ migrate ตาราง memo ไม่ทำให้ใบงานพัง
    let memo = null;
    try {
      const { rows: mr } = await req.db('SELECT * FROM ac_memos WHERE job_id = $1', [req.params.id]);
      memo = mr[0] || null;
    } catch { /* no ac_memos table yet */ }
    const baseUrl = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
    const html = buildAcRepairReportHtml(rows[0], req.branch, { memo, baseUrl });
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
  if (!tx) return res.status(400).json({ error: 'action ไม่ถูกต้อง (start|wait_parts|wait_quote|clear|cancel)' });
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
    if (action === 'wait_quote') {
      // เวลาเข้าสถานะล่าสุด + หมายเหตุ (เช่น เสนอราคาเปลี่ยนถาดน้ำทิ้ง) — ไม่มียอดเงิน/ไฟล์ตามที่ป้อมเคาะ
      add('wait_quote_time', new Date());
      add('wait_quote_note', String(req.body.wait_quote_note || '').trim().slice(0, 500) || null);
    }
    if (action === 'clear') {
      add('work_desc', work_desc || null);
      add('clear_time', new Date());
      // รูปหลังซ่อมหลายรูป (สูงสุด 6); afterImageBase64 เดี่ยวคงไว้เพื่อ client เก่า
      const afterList = (Array.isArray(req.body.afterPhotosBase64) ? req.body.afterPhotosBase64 : [])
        .slice(0, 6).filter((p) => p && p.base64 && p.name);
      if (afterList.length) {
        add('after_photo_urls', JSON.stringify(
          afterList.map((p) => savePhoto(req.branch.slug, p.base64, p.name))
        ));
      } else if (afterImageBase64 && afterImageName) {
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

// ── POST /:id/sign — เซ็นออนไลน์ 1 ช่อง (requester | tech) ─────────────────────
// เซ็นซ้ำ = ทับของเดิม (เซ็นผิดเซ็นใหม่ได้) ยกเว้นใบที่ยกเลิกแล้ว. ล็อกแถวใน transaction
// เดียวกับการตรวจสถานะ ไม่ให้ยกเลิกแทรกกลางทาง.
router.post('/:id/sign', async (req, res) => {
  const v = checkAcSign(req.body, req.user && req.user.role);
  if (v.error) return res.status(v.status).json({ error: v.error });
  const client = await req.tx();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT status FROM ac_repair_jobs WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'ไม่พบใบงาน' }); }
    if (rows[0].status === 'Cancel') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'ใบงานถูกยกเลิกแล้ว — เซ็นไม่ได้' });
    }
    const upd = v.slot === 'requester'
      ? await client.query(
        `UPDATE ac_repair_jobs SET sig_requester = $1, sig_requester_name = $2,
                sig_requester_position = $3, sig_requester_at = NOW()
          WHERE id = $4 RETURNING *`, [v.signature, v.name, v.position, req.params.id])
      : await client.query(
        `UPDATE ac_repair_jobs SET sig_tech = $1, sig_tech_name = $2, sig_tech_at = NOW()
          WHERE id = $3 RETURNING *`, [v.signature, (req.user && req.user.name) || '', req.params.id]);
    await client.query('COMMIT');
    res.json(upd.rows[0]);
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); serverError(res, err); }
  finally { client.release(); }
});

router._TRANSITIONS = TRANSITIONS;   // unit tests
router._checkAcSign = checkAcSign;
router._listRow = listRow;
module.exports = router;
