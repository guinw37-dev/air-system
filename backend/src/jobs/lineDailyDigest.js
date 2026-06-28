// แจ้งเตือน LINE ประจำวัน (08:45 น.) ต่อสาขา — แผนล้างวันนี้ + สรุปเมื่อวาน + งานรอเซ็น
// ตั้ง env: LINE_CHANNEL_ACCESS_TOKEN. ตั้ง line_group_id ต่อสาขาในตาราง clients.
const { pool, query } = require('../db');

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const pad = (n) => String(n).padStart(2, '0');

const ALL_SIGNED = `(sig_team IS NOT NULL AND sig_supervisor IS NOT NULL AND (sig_building IS NOT NULL OR sig_engineer IS NOT NULL))`;

// token: system_settings (แก้จากเว็บได้) ก่อน, fallback env
async function getLineToken() {
  try {
    const { rows } = await pool.query(`SELECT value FROM system_settings WHERE key = 'LINE_CHANNEL_ACCESS_TOKEN'`);
    if (rows[0] && rows[0].value) return rows[0].value;
  } catch { /* ตารางอาจยังไม่มี */ }
  return process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
}

// ดึงตัวเลขทั้งหมดของสาขา (1 schema) แล้วประกอบเป็นข้อความ
async function buildText(branch) {
  const schema = branch.schema_name || branch.slug;
  const safe = async (sql) => { try { return (await query(schema, sql)).rows; } catch { return []; } };

  const today = await safe(
    `SELECT work_type, COUNT(*)::int n FROM wash_schedule
      WHERE planned_date = CURRENT_DATE AND status IN ('planned','done') GROUP BY work_type`);
  const tBy = Object.fromEntries(today.map((r) => [r.work_type, r.n]));
  const tTotal = (tBy.major || 0) + (tBy.minor || 0) + (tBy.fan || 0);

  const zone = await safe(
    `SELECT COALESCE(NULLIF(u.pts_zone,''),'-') z, COUNT(*)::int n
       FROM wash_schedule s LEFT JOIN wash_units u ON u.asset_code = s.asset_code
      WHERE s.planned_date = CURRENT_DATE AND s.status IN ('planned','done')
      GROUP BY z ORDER BY z`);

  const yest = await safe(
    `SELECT work_type, COUNT(*)::int n FROM simple_work_orders
      WHERE deleted_at IS NULL AND ${ALL_SIGNED}
        AND COALESCE(work_date, created_at::date) = CURRENT_DATE - 1
      GROUP BY work_type`);
  const yBy = Object.fromEntries(yest.map((r) => [r.work_type, r.n]));
  const yTotal = (yBy.major || 0) + (yBy.minor || 0) + (yBy.fan || 0);

  const pend = await safe(
    `SELECT COUNT(*)::int n FROM simple_work_orders
      WHERE deleted_at IS NULL AND status <> 'approved' AND status <> 'rejected'
        AND sig_team IS NOT NULL AND sig_supervisor IS NOT NULL AND NOT ${ALL_SIGNED}`);
  const pendCount = (pend[0] && pend[0].n) || 0;

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const dateStr = `${TH_DOW[now.getDay()]} ${now.getDate()} ${TH_MONTHS[now.getMonth()]} ${now.getFullYear() + 543}`;
  const zoneStr = zone.length ? zone.map((z) => `${z.z} ${z.n}`).join(' · ') : '-';

  return [
    `🔔 แผนล้างแอร์ประจำวัน`,
    `📅 ${dateStr} · ${branch.name}`,
    ``,
    `🧼 วันนี้ต้องล้าง ${tTotal} ตัว`,
    `• ใหญ่ ${tBy.major || 0} · ย่อย ${tBy.minor || 0} · พัดลม ${tBy.fan || 0}`,
    `• โซน: ${zoneStr}`,
    ``,
    `✅ สรุปเมื่อวาน เสร็จ ${yTotal} ตัว`,
    `• ใหญ่ ${yBy.major || 0} · ย่อย ${yBy.minor || 0} · พัดลม ${yBy.fan || 0}`,
    `(นับจากใบงานที่เซ็นครบ)`,
    ``,
    `📝 รออาคาร/วิศวกรรมเซ็น: ${pendCount} ใบ`,
  ].join('\n');
}

// ส่งข้อความเข้า LINE group
async function pushLine(to, text) {
  const token = await getLineToken();
  if (!token) throw new Error('ยังไม่ได้ตั้ง LINE token');
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) throw new Error(`LINE push ${res.status}: ${await res.text()}`);
}

// รันแจ้งเตือนทุกสาขาที่ตั้ง line_group_id ไว้
async function runDigest() {
  if (!(await getLineToken())) { console.log('[line] skip — no LINE token'); return { sent: 0 }; }
  const { rows } = await pool.query(
    `SELECT id, slug, name, schema_name, line_group_id FROM clients
      WHERE active = true AND schema_name IS NOT NULL AND COALESCE(line_group_id,'') <> ''`);
  let sent = 0;
  for (const b of rows) {
    try { await pushLine(b.line_group_id, await buildText(b)); sent++; }
    catch (e) { console.error(`[line] ${b.slug} failed:`, e.message); }
  }
  console.log(`[line] daily digest sent to ${sent}/${rows.length} branch(es)`);
  return { sent };
}

// ส่งเฉพาะสาขาเดียว (สำหรับปุ่มทดสอบ)
async function runDigestForBranch(branch) {
  if (!branch.line_group_id) throw new Error('สาขานี้ยังไม่ได้ตั้ง line_group_id');
  await pushLine(branch.line_group_id, await buildText(branch));
}

// เวลาแจ้งเตือน (HH:MM) — system_settings ก่อน, default 08:45
async function getDigestTime() {
  try {
    const { rows } = await pool.query(`SELECT value FROM system_settings WHERE key = 'LINE_DIGEST_TIME'`);
    if (rows[0] && /^\d{2}:\d{2}$/.test(rows[0].value)) return rows[0].value;
  } catch { /* ไม่มีตาราง */ }
  return '08:45';
}

// minute-tick scheduler — ยิงตามเวลาที่ตั้ง (Asia/Bangkok) วันละครั้ง
function startLineDigestScheduler() {
  let lastRun = '';
  setInterval(async () => {
    const bkk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const hhmm = `${pad(bkk.getHours())}:${pad(bkk.getMinutes())}`;
    const dayKey = `${bkk.getFullYear()}-${pad(bkk.getMonth() + 1)}-${pad(bkk.getDate())}`;
    if (lastRun === dayKey) return;
    if (hhmm === await getDigestTime()) {
      lastRun = dayKey;
      runDigest().catch((e) => console.error('[line] digest error:', e.message));
    }
  }, 60 * 1000);
  console.log('[line] daily digest scheduler started (time from settings, Asia/Bangkok)');
}

module.exports = { runDigest, runDigestForBranch, startLineDigestScheduler, getLineToken, getDigestTime };
