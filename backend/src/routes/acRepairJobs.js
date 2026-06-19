// /api/ac-repair-jobs — AC repair job management (air-system owns the record).
// Fully decoupled from repair-system: once a job is created here it is
// managed entirely in this schema. repair-system is only read once (optional
// import) to seed the initial details — nothing is written back.
//
// Flow: Register → Assign → Work On → Clear → Close | Cancel
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');
const { callRepair, configured } = require('../services/repairClient');
const { insertJob } = require('../services/acRepairCreate');

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

// Status transition table.
const TRANSITIONS = {
  assign: { from: ['Register'],                          to: 'Assign'   },
  start:  { from: ['Assign'],                            to: 'Work On'  },
  clear:  { from: ['Work On'],                           to: 'Clear'    },
  close:  { from: ['Clear'],                             to: 'Close'    },
  cancel: { from: ['Register', 'Assign', 'Work On', 'Clear'], to: 'Cancel' },
};

router.use(authMiddleware, canUse);

// ── GET / — list jobs ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { status } = req.query;
  let where = '';
  const params = [];
  if (status === 'active') {
    where = `WHERE j.status NOT IN ('Close','Cancel')`;
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

// ── GET /repair-locations — hospital อาคาร/ชั้น/แผนก master from repair-system,
// for cascading dropdowns on the form. Read-only; never blocks (returns empty on
// any failure so the form still works offline / when the bridge is off).
router.get('/repair-locations', async (req, res) => {
  const slug = req.branch?.repair_slug;
  if (!configured() || !slug) return res.json({ buildings: [] });
  try {
    const data = await callRepair('GET', slug, '/buildings', { actor: req.user?.name || 'air' });
    res.json({ buildings: Array.isArray(data) ? data : [] });
  } catch (e) {
    res.json({ buildings: [] });
  }
});

// ── GET /pending-repair — fetch active AC jobs from repair-system (import UI)
router.get('/pending-repair', async (req, res) => {
  if (!configured()) return res.json({ ok: false, jobs: [], reason: 'ยังไม่ตั้งค่า REPAIR_API_URL / REPAIR_SERVICE_KEY' });
  const slug = req.branch?.repair_slug;
  if (!slug) return res.status(400).json({ error: 'สาขานี้ยังไม่ผูก repair_slug' });
  try {
    const data = await callRepair('GET', slug, '/ac-jobs?status=active', { actor: req.user?.name || 'air' });
    const jobs = Array.isArray(data) ? data : (data.jobs || []);
    res.json({ ok: true, jobs });
  } catch (e) {
    res.status(e.status || 502).json({ ok: false, error: e.message });
  }
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
  const c = await req.tx();
  try {
    await c.query('BEGIN');
    const { row } = await insertJob(c, req.body, req.user.id);
    await c.query('COMMIT');
    res.status(201).json(row);
  } catch (e) { await c.query('ROLLBACK'); serverError(res, e); }
  finally { c.release(); }
});

// ── POST /import — create job from repair-system record (one-way copy) ───
router.post('/import', async (req, res) => {
  if (!req.body.description?.trim()) return res.status(400).json({ error: 'กรุณาระบุรายละเอียด' });
  const c = await req.tx();
  try {
    await c.query('BEGIN');
    const { row, duplicate } = await insertJob(c, req.body, req.user.id);
    await c.query('COMMIT');
    if (duplicate) return res.status(409).json({ error: 'นำเข้างานนี้แล้ว', existing: duplicate });
    res.status(201).json(row);
  } catch (e) { await c.query('ROLLBACK'); serverError(res, e); }
  finally { c.release(); }
});

// ── PUT /:id — update details (only for non-terminal jobs) ───────────────
router.put('/:id', async (req, res) => {
  const { building, floor, department, requester, telephone, description,
          assign_name, issue_type, job_detail } = req.body;
  try {
    const { rows: cur } = await req.db(
      'SELECT status FROM ac_repair_jobs WHERE id = $1', [req.params.id]
    );
    if (!cur.length) return res.status(404).json({ error: 'ไม่พบใบงาน' });
    if (['Close', 'Cancel'].includes(cur[0].status)) {
      return res.status(400).json({ error: 'ใบงานปิดแล้ว แก้ไขไม่ได้' });
    }
    const { rows } = await req.db(
      `UPDATE ac_repair_jobs SET
         building=$1, floor=$2, department=$3, requester=$4, telephone=$5,
         description=$6, assign_name=$7, issue_type=$8, job_detail=$9
       WHERE id=$10 RETURNING *`,
      [building || '', floor || '', department || '', requester || '', telephone || '',
       description || '', assign_name || null, issue_type || null, job_detail || null,
       req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── PUT /:id/status — transition status ──────────────────────────────────
router.put('/:id/status', async (req, res) => {
  const { action, assign_name, work_desc, afterImageBase64, afterImageName, cancel_reason } = req.body;
  const tx = TRANSITIONS[action];
  if (!tx) return res.status(400).json({ error: 'action ไม่ถูกต้อง (assign|start|clear|close|cancel)' });
  if (action === 'close' && !['admin', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'เฉพาะ Admin ปิดงานได้' });
  }
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

    if (action === 'assign') {
      add('assign_name', assign_name || null);
      add('assign_time', new Date());
    }
    if (action === 'start') {
      add('start_time', new Date());
    }
    if (action === 'clear') {
      add('work_desc', work_desc || null);
      add('clear_time', new Date());
      if (afterImageBase64 && afterImageName) {
        add('after_image_url', savePhoto(req.branch.slug, afterImageBase64, afterImageName));
      }
    }
    if (action === 'close') {
      add('close_time', new Date());
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
