// /api/attendance — ตรวจเช็คการเข้าทำงานของช่างแต่ละวัน (daily technician
// attendance). Per-branch (schema-per-tenant). 1 แถว/ช่าง/วัน; work_date = วันนี้
// ตามเวลา server (CURRENT_DATE). ช่างเห็นของตัวเองผ่าน /me; หัวหน้า/แม่งานดู
// ภาพรวมทั้งสาขาผ่าน GET / และ /summary (role-gated).
const express = require('express');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth');
const { serverError } = require('../utils/respond');

// ภาพรวม/สรุปการลงเวลา — เฉพาะ Admin (และ super_admin) เท่านั้น
const canSupervise = requireRole('admin', 'super_admin');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

// device token ส่งมาจาก frontend (localStorage UUID) ทาง body หรือ header.
const deviceOf = (req) => {
  const d = req.body?.device_id || req.get('X-Device-Id') || '';
  return String(d).trim().slice(0, 64) || null;
};

// พิกัด GPS จาก body (อาจไม่ส่งมา = null). guard NaN/ค่าไม่ใช่ตัวเลข → null.
const coordOf = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ── Geofence (monitor only — ไม่บล็อกการลงเวลา) ──────────────────────────────
// ระยะทางระหว่าง 2 พิกัด (เมตร) สูตร haversine.
function distanceM(aLat, aLng, bLat, bLng) {
  const R = 6371000, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// คืน { in_area, geo_site } — จุด active ที่ใกล้สุดและอยู่ในรัศมีของมัน; ไม่มี = นอกพื้นที่.
// ไม่มีพิกัด → { in_area: null, geo_site: null } (ไม่ตัดสิน).
async function resolveGeo(req, lat, lng) {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return { in_area: null, geo_site: null };
  const { rows } = await req.db('SELECT name, lat, lng, radius_m FROM work_sites WHERE active = true');
  let best = null;
  for (const s of rows) {
    const d = distanceM(lat, lng, s.lat, s.lng);
    if (d <= (s.radius_m || 200) && (!best || d < best.d)) best = { d, name: s.name };
  }
  return best ? { in_area: true, geo_site: best.name } : { in_area: false, geo_site: null };
}

// อ่าน setting require_gps ของสาขา (default false ถ้ายังไม่ตั้ง)
async function requireGps(req) {
  try {
    const { rows } = await req.db('SELECT require_gps FROM attendance_settings WHERE id = 1');
    return !!rows[0]?.require_gps;
  } catch { return false; }
}

// ถ้าสาขาบังคับ GPS → ต้องมีพิกัด + อยู่ในพื้นที่ (ถ้ากำหนด work_sites ไว้).
// คืน error string ถ้าไม่ผ่าน, null ถ้าผ่าน/ไม่บังคับ.
async function gpsBlock(req, lat, lng, geo) {
  if (!(await requireGps(req))) return null;
  if (lat == null || lng == null) return 'สาขานี้บังคับลงเวลาด้วย GPS — กรุณาเปิดตำแหน่ง (Location) แล้วลองใหม่';
  const { rows } = await req.db('SELECT COUNT(*)::int AS n FROM work_sites WHERE active = true');
  if (rows[0].n > 0 && geo.in_area === false) return 'อยู่นอกพื้นที่ลงเวลาที่กำหนด';
  return null;
}

// ── GET /me/today — แถวของวันนี้ของผู้ใช้ปัจจุบัน (หรือ null) ─────────────────
router.get('/me/today', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(
      `SELECT check_in_at, check_out_at, note, lat, lng, geo_site, in_area
         FROM tech_attendance
        WHERE user_id = $1 AND work_date = CURRENT_DATE`,
      [req.user.id]
    );
    res.json(rows[0] || null);
  } catch (err) { serverError(res, err); }
});

// ── GET /me?days=7 — ประวัติการเข้างานของตัวเอง (ล่าสุดก่อน) ─────────────────
router.get('/me', authMiddleware, async (req, res) => {
  let days = parseInt(req.query.days, 10);
  if (!Number.isFinite(days)) days = 7;
  days = Math.min(60, Math.max(1, days));
  try {
    const { rows } = await req.db(
      `SELECT * FROM tech_attendance
        WHERE user_id = $1 AND work_date > CURRENT_DATE - ($2::int)
        ORDER BY work_date DESC`,
      [req.user.id, days]
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// ── POST /check-in — ลงเวลาเข้า (ไม่ทับเวลาเข้าเดิมถ้าลงไว้แล้ว) ──────────────
router.post('/check-in', authMiddleware, async (req, res) => {
  try {
    const lat = coordOf(req.body?.lat);
    const lng = coordOf(req.body?.lng);
    const geo = await resolveGeo(req, lat, lng);
    const block = await gpsBlock(req, lat, lng, geo);
    if (block) return res.status(400).json({ error: block });
    const { rows } = await req.db(
      `INSERT INTO tech_attendance (user_id, user_name, work_date, check_in_at, device_id, lat, lng, geo_site, in_area)
       VALUES ($1, $2, CURRENT_DATE, NOW(), $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, work_date) DO UPDATE
         SET check_in_at = COALESCE(tech_attendance.check_in_at, NOW()),
             user_name   = EXCLUDED.user_name,
             device_id   = COALESCE(EXCLUDED.device_id, tech_attendance.device_id),
             lat         = COALESCE(EXCLUDED.lat, tech_attendance.lat),
             lng         = COALESCE(EXCLUDED.lng, tech_attendance.lng),
             geo_site    = CASE WHEN EXCLUDED.lat IS NOT NULL THEN EXCLUDED.geo_site ELSE tech_attendance.geo_site END,
             in_area     = CASE WHEN EXCLUDED.lat IS NOT NULL THEN EXCLUDED.in_area  ELSE tech_attendance.in_area  END,
             updated_at  = NOW()
       RETURNING *`,
      [req.user.id, req.user.name || null, deviceOf(req), lat, lng, geo.geo_site, geo.in_area]
    );
    // จับพฤติกรรมเครื่อง (ไม่บังคับ): นับครั้งที่ลงเวลาจากเครื่องนี้
    const dev = deviceOf(req);
    if (dev) {
      await req.db(
        `INSERT INTO user_devices (user_id, user_name, device_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, device_id) DO UPDATE
           SET last_seen = NOW(), use_count = user_devices.use_count + 1,
               user_name = EXCLUDED.user_name`,
        [req.user.id, req.user.name || null, dev]
      ).catch(() => {});   // best-effort — ไม่ให้ล้มการลงเวลา
    }
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── POST /check-out — ลงเวลาออก (last one wins; สร้างแถวถ้ายังไม่มี) ──────────
router.post('/check-out', authMiddleware, async (req, res) => {
  try {
    const lat = coordOf(req.body?.lat);
    const lng = coordOf(req.body?.lng);
    const geo = await resolveGeo(req, lat, lng);
    const block = await gpsBlock(req, lat, lng, geo);
    if (block) return res.status(400).json({ error: block });
    const { rows } = await req.db(
      `INSERT INTO tech_attendance (user_id, user_name, work_date, check_out_at, lat, lng, geo_site, in_area)
       VALUES ($1, $2, CURRENT_DATE, NOW(), $3, $4, $5, $6)
       ON CONFLICT (user_id, work_date) DO UPDATE
         SET check_out_at = NOW(),
             user_name    = EXCLUDED.user_name,
             lat          = COALESCE(EXCLUDED.lat, tech_attendance.lat),
             lng          = COALESCE(EXCLUDED.lng, tech_attendance.lng),
             geo_site     = CASE WHEN EXCLUDED.lat IS NOT NULL THEN EXCLUDED.geo_site ELSE tech_attendance.geo_site END,
             in_area      = CASE WHEN EXCLUDED.lat IS NOT NULL THEN EXCLUDED.in_area  ELSE tech_attendance.in_area  END,
             updated_at   = NOW()
       RETURNING *`,
      [req.user.id, req.user.name || null, lat, lng, geo.geo_site, geo.in_area]
    );
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── POST /me/note — บันทึกหมายเหตุของวันนี้ (upsert วันนี้ถ้ายังไม่มี) ────────
router.post('/me/note', authMiddleware, async (req, res) => {
  const note = req.body.note != null ? String(req.body.note) : null;
  try {
    const { rows } = await req.db(
      `INSERT INTO tech_attendance (user_id, user_name, work_date, note)
       VALUES ($1, $2, CURRENT_DATE, $3)
       ON CONFLICT (user_id, work_date) DO UPDATE
         SET note       = EXCLUDED.note,
             user_name  = EXCLUDED.user_name,
             updated_at = NOW()
       RETURNING *`,
      [req.user.id, req.user.name || null, note]
    );
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// ── GET /?date=YYYY-MM-DD — ภาพรวมการเข้างานทุกคนของวันนั้น (หัวหน้า/แม่งาน) ──
router.get('/', authMiddleware, canSupervise, async (req, res) => {
  const date = DATE_RE.test(req.query.date || '') ? req.query.date : null;
  try {
    const { rows } = await req.db(
      `SELECT * FROM tech_attendance
        WHERE work_date = COALESCE($1::date, CURRENT_DATE)
        ORDER BY user_name NULLS LAST, user_id`,
      [date]
    );
    // flag เครื่องที่ถูกใช้โดยช่างหลายคนในวันเดียวกัน = น่าจะลงเวลาแทน
    const byDevice = {};
    for (const r of rows) if (r.device_id) (byDevice[r.device_id] ||= new Set()).add(r.user_id);
    for (const r of rows) r.shared_device = !!(r.device_id && byDevice[r.device_id].size > 1);
    // flag เครื่องไม่ประจำ: device วันนี้ ≠ เครื่องที่ช่างคนนั้นใช้บ่อยสุด (primary)
    const uids = [...new Set(rows.map((r) => r.user_id))];
    if (uids.length) {
      const { rows: devs } = await req.db(
        `SELECT DISTINCT ON (user_id) user_id, device_id
           FROM user_devices WHERE user_id = ANY($1)
          ORDER BY user_id, use_count DESC, first_seen ASC`,
        [uids]
      );
      const primary = Object.fromEntries(devs.map((d) => [d.user_id, d.device_id]));
      for (const r of rows) {
        r.other_device = !!(r.device_id && primary[r.user_id] && r.device_id !== primary[r.user_id]);
      }
    }
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// ── GET /devices — พฤติกรรมเครื่องของช่างแต่ละคน (หัวหน้า/แม่งาน) ──────────────
// ใช้กี่เครื่อง + แต่ละเครื่องลงเวลากี่ครั้ง/ล่าสุดเมื่อไร. device_count สูง = น่าดู.
router.get('/devices', authMiddleware, canSupervise, async (req, res) => {
  try {
    const { rows } = await req.db(
      `SELECT user_id,
              MAX(user_name) AS user_name,
              COUNT(*)::int AS device_count,
              SUM(use_count)::int AS total_uses,
              MAX(last_seen) AS last_seen,
              json_agg(json_build_object(
                'device_id', device_id, 'use_count', use_count,
                'first_seen', first_seen, 'last_seen', last_seen
              ) ORDER BY use_count DESC, last_seen DESC) AS devices
         FROM user_devices
        GROUP BY user_id
        ORDER BY device_count DESC, user_name NULLS LAST`
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// ── GET /summary?month=YYYY-MM — จำนวนวันที่มาทำงานต่อคนในเดือนนั้น ──────────
router.get('/summary', authMiddleware, canSupervise, async (req, res) => {
  const month = MONTH_RE.test(req.query.month || '')
    ? req.query.month
    : new Date().toISOString().slice(0, 7);
  try {
    const { rows } = await req.db(
      `SELECT user_id,
              MAX(user_name) AS user_name,
              COUNT(DISTINCT work_date) FILTER (WHERE check_in_at IS NOT NULL)::int AS days,
              COUNT(DISTINCT work_date) FILTER (WHERE check_in_at IS NOT NULL AND check_out_at IS NOT NULL)::int AS days_complete
         FROM tech_attendance
        WHERE to_char(work_date, 'YYYY-MM') = $1
        GROUP BY user_id
       HAVING COUNT(*) FILTER (WHERE check_in_at IS NOT NULL) > 0
        ORDER BY user_name NULLS LAST, user_id`,
      [month]
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// ── work_sites CRUD (จุด geofence ต่อสาขา) ───────────────────────────────────
// GET อ่านได้ทุก authed user (ให้แอปช่างโชว์ "คุณอยู่ที่ X"); เขียนเฉพาะ admin.
const ID_RE = /^\d+$/;
const finite = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// GET /settings — ค่าตั้งการลงเวลาของสาขา (authed; frontend ใช้รู้ว่าต้องบังคับ GPS ไหม)
router.get('/settings', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db('SELECT require_gps FROM attendance_settings WHERE id = 1');
    res.json({ require_gps: !!rows[0]?.require_gps });
  } catch (err) { serverError(res, err); }
});

// PUT /settings — admin ตั้งค่า require_gps
router.put('/settings', authMiddleware, canSupervise, async (req, res) => {
  const require_gps = !!req.body?.require_gps;
  try {
    const { rows } = await req.db(
      `INSERT INTO attendance_settings (id, require_gps, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET require_gps = EXCLUDED.require_gps, updated_at = NOW()
       RETURNING require_gps`,
      [require_gps]
    );
    res.json({ require_gps: !!rows[0].require_gps });
  } catch (err) { serverError(res, err); }
});

// GET /sites — รายการจุดทั้งหมด (active ก่อน แล้วเรียงชื่อ)
router.get('/sites', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(
      `SELECT id, name, lat, lng, radius_m, active, created_at
         FROM work_sites
        ORDER BY active DESC, name`
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// POST /sites — เพิ่มจุด (admin)
router.post('/sites', authMiddleware, canSupervise, async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const lat = finite(req.body?.lat);
  const lng = finite(req.body?.lng);
  let radius = req.body?.radius_m == null || req.body?.radius_m === '' ? 200 : Number(req.body.radius_m);
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng must be finite numbers' });
  if (!Number.isInteger(radius) || radius <= 0) return res.status(400).json({ error: 'radius_m must be a positive integer' });
  try {
    const { rows } = await req.db(
      `INSERT INTO work_sites (name, lat, lng, radius_m)
       VALUES ($1, $2, $3, $4) RETURNING id, name, lat, lng, radius_m, active, created_at`,
      [name.slice(0, 160), lat, lng, radius]
    );
    res.status(201).json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// PUT /sites/:id — แก้ไขจุด (admin)
router.put('/sites/:id', authMiddleware, canSupervise, async (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  const name = String(req.body?.name ?? '').trim();
  const lat = finite(req.body?.lat);
  const lng = finite(req.body?.lng);
  let radius = req.body?.radius_m == null || req.body?.radius_m === '' ? 200 : Number(req.body.radius_m);
  const active = req.body?.active == null ? true : !!req.body.active;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng must be finite numbers' });
  if (!Number.isInteger(radius) || radius <= 0) return res.status(400).json({ error: 'radius_m must be a positive integer' });
  try {
    const { rows } = await req.db(
      `UPDATE work_sites
          SET name = $2, lat = $3, lng = $4, radius_m = $5, active = $6
        WHERE id = $1
        RETURNING id, name, lat, lng, radius_m, active, created_at`,
      [req.params.id, name.slice(0, 160), lat, lng, radius, active]
    );
    if (!rows[0]) return res.status(404).json({ error: 'site not found' });
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// DELETE /sites/:id — ลบจุด (admin)
router.delete('/sites/:id', authMiddleware, canSupervise, async (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const { rowCount } = await req.db('DELETE FROM work_sites WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'site not found' });
    res.json({ ok: true });
  } catch (err) { serverError(res, err); }
});

// ── ใบลา (leave requests) — ยื่น → admin อนุมัติ/ปฏิเสธ ──────────────────────
// ช่างยื่นใบลา (status='pending'); หัวหน้า/แม่งานพิจารณา (approved/rejected).
const LEAVE_TYPES = ['sick', 'personal', 'vacation', 'other'];

// POST /leave — ช่างยื่นใบลา (authed; ของตัวเอง)
router.post('/leave', authMiddleware, async (req, res) => {
  const leave_type = String(req.body?.leave_type ?? '').trim();
  const start_date = String(req.body?.start_date ?? '').trim();
  const end_date = String(req.body?.end_date ?? '').trim();
  const reason = req.body?.reason != null ? String(req.body.reason) : null;
  if (!LEAVE_TYPES.includes(leave_type))
    return res.status(400).json({ error: 'leave_type ไม่ถูกต้อง' });
  if (!DATE_RE.test(start_date) || !DATE_RE.test(end_date))
    return res.status(400).json({ error: 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD' });
  if (end_date < start_date)
    return res.status(400).json({ error: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น' });
  try {
    const { rows } = await req.db(
      `INSERT INTO leave_requests (user_id, user_name, leave_type, start_date, end_date, reason, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING *`,
      [req.user.id, req.user.name || null, leave_type, start_date, end_date, reason]
    );
    res.status(201).json(rows[0]);
  } catch (err) { serverError(res, err); }
});

// GET /leave/me — ใบลาของตัวเอง (ล่าสุดก่อน)
router.get('/leave/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await req.db(
      `SELECT * FROM leave_requests WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// GET /leave?status= — ใบลาทุกคน (หัวหน้า/แม่งาน); pending ขึ้นก่อน
router.get('/leave', authMiddleware, canSupervise, async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
    ? req.query.status : null;
  try {
    const { rows } = await req.db(
      `SELECT * FROM leave_requests
        WHERE ($1::text IS NULL OR status = $1)
        ORDER BY (status = 'pending') DESC, created_at DESC`,
      [status]
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// PUT /leave/:id/decision — อนุมัติ/ปฏิเสธ (หัวหน้า/แม่งาน); เฉพาะที่ยัง pending
router.put('/leave/:id/decision', authMiddleware, canSupervise, async (req, res) => {
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'invalid id' });
  const action = String(req.body?.action ?? '').trim();
  const note = req.body?.note != null ? String(req.body.note) : null;
  if (!['approve', 'reject'].includes(action))
    return res.status(400).json({ error: 'action ต้องเป็น approve หรือ reject' });
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  try {
    // กันการพิจารณาซ้ำ: แยกตรวจสถานะปัจจุบันเพื่อคืน 409 ที่ชัดเจน
    const { rows: cur } = await req.db(
      `SELECT status FROM leave_requests WHERE id = $1`, [req.params.id]);
    if (!cur[0]) return res.status(404).json({ error: 'ไม่พบใบลานี้' });
    if (cur[0].status !== 'pending')
      return res.status(409).json({ error: 'ใบลานี้ถูกพิจารณาแล้ว' });
    const { rows } = await req.db(
      `UPDATE leave_requests
          SET status = $2, reviewed_by = $3, reviewer_name = $4,
              reviewed_at = NOW(), review_note = $5
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [req.params.id, newStatus, req.user.id, req.user.name || null, note]
    );
    if (!rows[0]) return res.status(409).json({ error: 'ใบลานี้ถูกพิจารณาแล้ว' });
    res.json(rows[0]);
  } catch (err) { serverError(res, err); }
});

module.exports = router;
