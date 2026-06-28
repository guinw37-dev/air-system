// /api/wash-schedule — ปฏิทินแผนล้างแอร์ (per-branch, schema-per-tenant via req.db).
// hybrid: POST /generate กระจายแผนให้อัตโนมัติ (ตาม freq ใน wash_units) แล้ว admin
// ย้าย/ข้าม/เพิ่มเองได้. เสร็จ = ผูกอัตโนมัติเมื่อสร้างใบงาน simple-wo (ใน simpleWorkOrders.js).
const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');

const canEdit = requireRole('admin', 'super_admin');
const WORK_TYPES = ['major', 'minor', 'fan'];

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// ── GET /summary?from=&to= — นับต่อวัน (planned/done/skipped) สำหรับ month grid ──
router.get('/summary', authMiddleware, async (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'from/to ต้องเป็น YYYY-MM-DD' });
  try {
    const { rows } = await req.db(
      `SELECT planned_date::text AS date,
              COUNT(*) FILTER (WHERE status = 'planned')::int AS planned,
              COUNT(*) FILTER (WHERE status = 'done')::int    AS done,
              COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
              COUNT(*)::int AS total
         FROM wash_schedule
        WHERE planned_date BETWEEN $1 AND $2
        GROUP BY planned_date ORDER BY planned_date`, [from, to]);
    res.json({ days: rows });
  } catch (err) { serverError(res, err); }
});

// ── GET /?from=&to=&status= — รายการนัด (join ทะเบียนแอร์) สำหรับ day panel/ช่วง ──
router.get('/', authMiddleware, async (req, res) => {
  const { from, to, status } = req.query;
  if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: 'from/to ต้องเป็น YYYY-MM-DD' });
  try {
    const params = [from, to];
    let where = 's.planned_date BETWEEN $1 AND $2';
    if (status && ['planned', 'done', 'skipped'].includes(status)) { params.push(status); where += ` AND s.status = $${params.length}`; }
    const { rows } = await req.db(
      `SELECT s.id, s.asset_code, s.work_type, s.planned_date::text AS planned_date,
              s.status, s.done_wo_id, s.note,
              u.pts_zone, u.building, u.floor, u.room, u.ac_type, u.location
         FROM wash_schedule s
         LEFT JOIN wash_units u ON u.asset_code = s.asset_code
        WHERE ${where}
        ORDER BY s.planned_date, u.building, u.floor, u.room, s.asset_code`, params);
    res.json({ items: rows });
  } catch (err) { serverError(res, err); }
});

// ── POST /generate — hybrid auto-distribute (admin) ──────────────────────────
// กระจายเครื่อง active แต่ละตัว 1 นัด/ประเภท ลงช่วง window = 365/freq วัน (ข้ามวันอาทิตย์),
// เรียงตามอาคาร/ชั้น เพื่อให้แต่ละวันอยู่อาคารใกล้กัน. ลบเฉพาะแผน planned ในอนาคต (ไม่แตะ done).
router.post('/generate', authMiddleware, canEdit, async (req, res) => {
  const fromStr = isDate(req.body.from) ? req.body.from
    : (await req.db('SELECT CURRENT_DATE::text AS d')).rows[0].d;
  const client = await req.tx();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM wash_schedule WHERE status = 'planned' AND planned_date >= $1`, [fromStr]);

    // ── config (กรอกตอนสร้างแผน) ──────────────────────────────────────────────
    const capacity = Math.max(1, parseInt(req.body.capacity, 10) || 15);   // ล้างได้/วัน
    const workdays = req.body.workdays === 'mon_fri' ? 'mon_fri' : 'mon_sat';
    const byZone = req.body.byZone !== false;                              // capacity แยกต่อโซน (default)
    const isWork = (d) => {
      const g = d.getDay();
      if (g === 0) return false;                       // อาทิตย์หยุดเสมอ
      if (workdays === 'mon_fri' && g === 6) return false; // เสาร์หยุด (จ-ศ)
      return true;
    };

    const { rows: units } = await client.query(
      `SELECT asset_code, pts_zone, building, floor, room, freq_major, freq_minor, freq_fan,
              last_major_at::text AS last_major_at, last_minor_at::text AS last_minor_at
         FROM wash_units WHERE active = true`);

    const from = new Date(`${fromStr}T00:00:00`);
    const dayDiff = (a, b) => Math.round((a - b) / 86400000);

    // 1) สร้างรายการงานที่ต้องล้าง (ต่อเครื่อง × ประเภท) + due index จาก from
    const items = [];
    for (const wt of WORK_TYPES) {
      const freqCol = `freq_${wt}`, lastCol = `last_${wt}_at`;
      const list = units.filter((u) => (u[freqCol] || 0) > 0);
      if (!list.length) continue;
      const freqs = list.map((u) => u[freqCol]);
      const typical = freqs.sort((a, b) => freqs.filter((f) => f === a).length - freqs.filter((f) => f === b).length).pop() || 1;
      const interval = Math.max(7, Math.round(365 / typical));
      for (const u of list) {
        const last = u[lastCol] ? new Date(`${u[lastCol]}T00:00:00`) : null;
        const dueIdx = last ? Math.max(0, interval + dayDiff(last, from)) : 0;  // ไม่เคยล้าง/เกิน → 0 (วันนี้)
        items.push({ asset: u.asset_code, wt, zone: u.pts_zone || '-', building: u.building || '', floor: u.floor || '', room: u.room || '', dueIdx });
      }
    }
    // 2) เรียง: ครบกำหนดก่อน (due asc) → จัดกลุ่มโซน/อาคาร/ชั้น (ลดเดินทาง)
    const cmp = (a, b) => (a > b ? 1 : a < b ? -1 : 0);
    items.sort((a, b) => a.dueIdx - b.dueIdx || cmp(a.zone, b.zone) || cmp(a.building, b.building) || cmp(a.floor, b.floor) || cmp(a.room, b.room));
    // 3) เติมลงวันทำงานไม่เกิน capacity (แยกต่อโซนถ้าเลือก) เกินดันวันถัดไป
    const used = {};
    const keyOf = (idx, zone) => (byZone ? `${idx}|${zone}` : `${idx}`);
    const MAX_HORIZON = 1095;   // กันลูปค้าง (~3 ปี)
    const out = [];
    for (const it of items) {
      let idx = it.dueIdx;
      let guard = 0;
      while (guard++ < MAX_HORIZON) {
        const d = addDays(from, idx);
        if (isWork(d) && (used[keyOf(idx, it.zone)] || 0) < capacity) break;
        idx++;
      }
      used[keyOf(idx, it.zone)] = (used[keyOf(idx, it.zone)] || 0) + 1;
      out.push([it.asset, it.wt, ymd(addDays(from, idx))]);
    }

    // chunked multi-row insert
    let created = 0;
    const uid = req.user?.id || null;
    for (let i = 0; i < out.length; i += 400) {
      const chunk = out.slice(i, i + 400);
      const vals = [];
      const ph = chunk.map((r, j) => {
        const b = j * 4;
        vals.push(r[0], r[1], r[2], uid);
        return `($${b + 1},$${b + 2},$${b + 3},'planned',$${b + 4})`;
      }).join(',');
      const { rowCount } = await client.query(
        `INSERT INTO wash_schedule (asset_code, work_type, planned_date, status, created_by) VALUES ${ph}`, vals);
      created += rowCount;
    }
    await client.query('COMMIT');
    res.json({ ok: true, from: fromStr, created, capacity, workdays, byZone });
  } catch (err) {
    await client.query('ROLLBACK');
    serverError(res, err);
  } finally { client.release(); }
});

// ── POST / — เพิ่มนัดเอง ──────────────────────────────────────────────────────
router.post('/', authMiddleware, canEdit, async (req, res) => {
  const { asset_code, work_type, planned_date, note } = req.body;
  if (!asset_code) return res.status(400).json({ error: 'ต้องมี asset_code' });
  if (!WORK_TYPES.includes(work_type)) return res.status(400).json({ error: 'work_type ไม่ถูกต้อง' });
  if (!isDate(planned_date)) return res.status(400).json({ error: 'planned_date ไม่ถูกต้อง' });
  try {
    const { rows } = await req.db(
      `INSERT INTO wash_schedule (asset_code, work_type, planned_date, note, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [String(asset_code).trim(), work_type, planned_date, note || null, req.user?.id || null]);
    res.status(201).json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── PATCH /:id — ย้ายวัน / เปลี่ยนสถานะ (planned|skipped|done) / แก้หมายเหตุ ─────
router.patch('/:id', authMiddleware, canEdit, async (req, res) => {
  const sets = [], params = [];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (isDate(req.body.planned_date)) add('planned_date', req.body.planned_date);
  if (['planned', 'done', 'skipped'].includes(req.body.status)) {
    add('status', req.body.status);
    if (req.body.status !== 'done') { add('done_wo_id', null); add('done_at', null); }
  }
  if (req.body.note !== undefined) add('note', req.body.note || null);
  if (!sets.length) return res.status(400).json({ error: 'ไม่มีฟิลด์ให้แก้' });
  params.push(req.params.id);
  try {
    const { rows } = await req.db(
      `UPDATE wash_schedule SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบนัด' });
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── DELETE /:id ──────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, canEdit, async (req, res) => {
  try {
    const { rowCount } = await req.db('DELETE FROM wash_schedule WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'ไม่พบนัด' });
    res.json({ ok: true });
  } catch (err) { serverError(res, err); }
});

module.exports = router;
