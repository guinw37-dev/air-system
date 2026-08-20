// /api/ac-memos — MEMO ขออนุมัติจัดซื้ออะไหล่ ออกจากใบงานซ่อมแอร์ (1 ใบงาน = 1 memo).
// รายการอะไหล่ default มาจาก parts ของใบงาน; ค่าฟอร์มล่าสุด (เรียน/จาก/ผู้เซ็น)
// persist ใน ac_memo_template ให้ใบถัดไปเริ่มจากค่าที่แก้ล่าสุด — แบบเดียวกับ
// memo ฝั่ง repair-system แต่ย่อส่วน.
const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');
const { htmlToPdf, PdfUnavailableError } = require('../services/pdfRenderer');
const { buildAcMemoHtml } = require('../services/acMemoPdf');

const canUse = requireRole(
  'technician', 'checker', 'approve_building', 'approve_engineer', 'admin', 'super_admin'
);
router.use(authMiddleware, canUse);

const TW_ORG = 'บริษัท เทคนิคอล วอเตอร์ จำกัด (TW)';
function defaultTemplate(branch) {
  const hos = branch?.name || '';
  return {
    to_line: `ผู้จัดการแผนกวิศวกรรม ${hos}`.trim(),
    from_line: 'ทีมงานแอร์ บริษัท เทคนิคอล วอเตอร์ จำกัด',
    signers: {
      requester: { name: '', pos: '', org: TW_ORG },
      inspector: { name: '', pos: '', org: TW_ORG },
      reviewer:  { name: '', pos: '', org: hos },
      approver:  { name: '', pos: 'ผู้จัดการแผนกวิศวกรรม', org: hos },
    },
  };
}

async function loadTemplate(db, branch) {
  const { rows } = await db('SELECT data FROM ac_memo_template WHERE id = 1');
  return { ...defaultTemplate(branch), ...(rows[0]?.data || {}) };
}
async function saveTemplate(db, { to_line, from_line, signers }) {
  await db(
    `INSERT INTO ac_memo_template (id, data, updated_at) VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()`,
    [JSON.stringify({ to_line, from_line, signers })]
  );
}

// เลขรัน MEMO-AIR-{BE2}{MM}-{NNN} ต่อสาขา — MAX-based กันเลขวนซ้ำหลังลบ
async function genMemoNumber(db) {
  const now = new Date();
  const be2 = String(now.getFullYear() + 543).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `MEMO-AIR-${be2}${mm}-`;
  const { rows } = await db(
    `SELECT COALESCE(MAX(CAST(RIGHT(memo_number, 3) AS INTEGER)), 0) AS maxn
       FROM ac_memos WHERE memo_number LIKE $1`, [`${prefix}%`]
  );
  return `${prefix}${String(rows[0].maxn + 1).padStart(3, '0')}`;
}

const cleanParts = (parts) => (Array.isArray(parts) ? parts : [])
  .map((p) => ({
    name: String(p?.name || '').trim(),
    qty: String(p?.qty || '').trim(),
    note: String(p?.note || '').trim(),
    unit_price: Number.isFinite(Number(p?.unit_price)) && Number(p.unit_price) > 0 ? Number(p.unit_price) : 0,
  })).filter((p) => p.name);

// ── GET /template — ค่าเริ่มต้นฟอร์ม (ค่าล่าสุดที่เคยแก้) ─────────────────────
router.get('/template', async (req, res) => {
  try { res.json(await loadTemplate(req.db, req.branch)); }
  catch (err) { serverError(res, err); }
});

// ── GET /by-job/:jobId — memo ของใบงาน (ถ้ามี) ───────────────────────────────
router.get('/by-job/:jobId', async (req, res) => {
  try {
    const { rows } = await req.db('SELECT * FROM ac_memos WHERE job_id = $1', [req.params.jobId]);
    res.json(rows[0] || null);
  } catch (err) { serverError(res, err); }
});

// ── POST / — ออก memo จากใบงาน ───────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { job_id, subject, reason, to_line, from_line, parts, signers } = req.body;
  if (!job_id) return res.status(400).json({ error: 'ต้องระบุใบงาน (job_id)' });
  if (!String(subject || '').trim()) return res.status(400).json({ error: 'ต้องระบุเรื่อง' });
  try {
    const { rows: jr } = await req.db('SELECT * FROM ac_repair_jobs WHERE id = $1', [job_id]);
    if (!jr.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    const { rows: dup } = await req.db('SELECT id, memo_number FROM ac_memos WHERE job_id = $1', [job_id]);
    if (dup.length) {
      return res.status(409).json({ error: `ใบงานนี้ออก Memo แล้ว (${dup[0].memo_number})`, memoId: dup[0].id });
    }
    const memoNumber = await genMemoNumber(req.db);
    const p = cleanParts(parts?.length ? parts : jr[0].parts);
    const { rows } = await req.db(
      `INSERT INTO ac_memos (memo_number, job_id, subject, reason, to_line, from_line, parts, signers, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [memoNumber, job_id, subject.trim(), reason || '', to_line || '', from_line || '',
       JSON.stringify(p), JSON.stringify(signers || {}), req.user.id]
    );
    await saveTemplate(req.db, { to_line, from_line, signers });
    res.status(201).json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── PUT /:id — แก้ไข memo ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { subject, reason, to_line, from_line, parts, signers } = req.body;
  if (!String(subject || '').trim()) return res.status(400).json({ error: 'ต้องระบุเรื่อง' });
  try {
    const { rows } = await req.db(
      `UPDATE ac_memos SET subject=$1, reason=$2, to_line=$3, from_line=$4,
              parts=$5, signers=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [subject.trim(), reason || '', to_line || '', from_line || '',
       JSON.stringify(cleanParts(parts)), JSON.stringify(signers || {}), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบ Memo' });
    await saveTemplate(req.db, { to_line, from_line, signers });
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── DELETE /:id — admin เท่านั้น ─────────────────────────────────────────────
router.delete('/:id', requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { rows } = await req.db('DELETE FROM ac_memos WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบ Memo' });
    res.json({ ok: true });
  } catch (err) { serverError(res, err); }
});

// ── GET /:id/pdf — MEMO PDF (หัวส้ม ระบบ Air) ────────────────────────────────
router.get('/:id/pdf', async (req, res) => {
  try {
    const { rows } = await req.db('SELECT * FROM ac_memos WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบ Memo' });
    const memo = rows[0];
    const { rows: jr } = await req.db('SELECT * FROM ac_repair_jobs WHERE id = $1', [memo.job_id]);
    const html = buildAcMemoHtml(memo, jr[0], req.branch);
    try {
      const pdf = await htmlToPdf(html);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${memo.memo_number}.pdf"`);
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

module.exports = router;
