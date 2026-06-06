const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const QRCode = require('qrcode');
const { BRAND } = require('./reportBuilder');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');

// Inline a stored photo as a base64 data URI so Puppeteer doesn't have to fetch
// each image over HTTP (with networkidle0) — for a WO with ~16 photos that
// network wait can exceed the proxy timeout and fail the whole PDF. Falls back
// to the HTTP URL if the file can't be read.
function inlinePhoto(url, httpBase) {
  if (!url || /^https?:|^data:/.test(url)) return url || '';
  try {
    const buf = fs.readFileSync(path.join(UPLOAD_DIR, url.replace(/^\/uploads\//, '')));
    const ext = path.extname(url).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return `${httpBase}${url}`;
  }
}

// Map work_type → which template items apply.
// Simple-WO uses ONE checklist for every work type (the full AC/major set);
// the tech just fills what applies. Keeps field ids stable across work types.
function templateFilter() {
  return { sql: `equipment_type = 'ac' AND applies_major = true`, params: [] };
}

const WORK_TYPE_LABEL = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลม' };

// Combine a DATE (or timestamptz) + TIME string into an ISO datetime, so the
// shared fmtTime() helper (which does new Date(value)) can format it. Returns
// null when either part is missing.
function combineDateTime(dateVal, timeStr) {
  if (!dateVal || !timeStr) return null;
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  const ymd = d.toISOString().slice(0, 10);
  return `${ymd}T${timeStr}`;
}

// Assemble the `data` object buildSimpleReportHtml() expects from a
// simple_work_orders row. Returns null when the WO does not exist.
async function getSimpleReportData(id, { publicBaseUrl = '' } = {}) {
  const { rows } = await pool.query(`
    SELECT s.*, u.name AS created_by_name
    FROM simple_work_orders s
    LEFT JOIN users u ON s.created_by = u.id
    WHERE s.id = $1
  `, [id]);
  if (!rows.length) return null;
  const r = rows[0];

  // Template items for this work_type → build inspection rows merged with values.
  const f = templateFilter(r.work_type);
  const { rows: items } = await pool.query(`
    SELECT id, category, item_label, value_type, unit_label, sort_order
    FROM inspection_template_items
    WHERE ${f.sql}
    ORDER BY sort_order, id
  `, f.params);

  const cv = r.checklist_values || {};
  const inspections = items.map((it) => {
    const v = cv[it.id] || cv[String(it.id)] || {};
    return {
      category: it.category,
      item_label: it.item_label,
      value_type: it.value_type,
      unit_label: v.unit || it.unit_label,
      sort_order: it.sort_order,
      // power preference: per-field override; rst_amp (Blower) falls back to the
      // WO-level power_system, but ln_vi (Compressor) is independent — never
      // borrow the Blower's 380V. When unset, mirror the form's default (has an
      // L/A reading → 1 เฟส, else 3 เฟส) so the PDF matches what was entered.
      power_system: v.power_system
        || (it.value_type === 'ln_vi' ? (v.val_l_after ? '220' : '380') : r.power_system)
        || null,
      checked: v.checked === true || v.checked === 'true',
      value_before: v.value_before ?? null,
      value_after: v.value_after ?? null,
      note: v.note ?? null,
      val_text: v.val_text ?? null,
      val_r_before: v.val_r_before ?? null, val_s_before: v.val_s_before ?? null, val_t_before: v.val_t_before ?? null,
      val_r_after: v.val_r_after ?? null, val_s_after: v.val_s_after ?? null, val_t_after: v.val_t_after ?? null,
      val_r_v_after: v.val_r_v_after ?? null, val_s_v_after: v.val_s_v_after ?? null, val_t_v_after: v.val_t_v_after ?? null,
      val_ln_before: v.val_ln_before ?? null, val_l_before: v.val_l_before ?? null,
      val_ln_after: v.val_ln_after ?? null, val_l_after: v.val_l_after ?? null,
      val_suction: v.val_suction ?? null, val_discharge: v.val_discharge ?? null,
      refrigerant_type: v.refrigerant_type ?? null,
    };
  });

  // Photos → grouped by phase, ordered by point_no (Location, วัดไฟ, …).
  const photos = { before: [], after: [], measurement: [] };
  for (const p of (r.photo_urls || [])) {
    const phase = ['before', 'after', 'measurement'].includes(p.phase) ? p.phase : 'before';
    photos[phase].push({
      url: p.url, label: p.label || '', point_no: p.point_no ?? null,
      taken_at: r.created_at, uploaded_by_name: r.created_by_name,
    });
  }
  for (const k of Object.keys(photos)) {
    photos[k].sort((a, b) => (a.point_no ?? 99) - (b.point_no ?? 99));
  }

  const tc = r.team_comment || {};
  const wo = {
    order_no: r.wo_number,
    work_type: r.work_type,
    client_name: r.client_name,
    site_name: r.building,
    tech_name: r.tech_name,
    work_date: r.work_date,
    created_at: r.created_at,
    started_at: combineDateTime(r.work_date || r.created_at, r.start_time),
    completed_at: combineDateTime(r.work_date || r.created_at, r.end_time),
    cond_ac_degraded: !!tc.ac_degraded,
    cond_ac_old_5_7yr: !!tc.ac_old_5_7yr,
    cond_external_degraded: !!tc.external_degraded, cond_external_detail: tc.external_detail || '',
    cond_internal_degraded: !!tc.internal_degraded, cond_internal_detail: tc.internal_detail || '',
  };

  const unit = {
    asset_code: r.asset_code,
    room_name: r.room,
    building_name: r.building,
    floor_name: r.floor,
    family: '',
    equipment_type: WORK_TYPE_LABEL[r.work_type] || r.work_type,
    has_repair: r.result === 'not_ok',
    inspections,
    photos,
  };

  const sigs = {
    engineer:   { signer_name: r.sig_engineer_name,   signature_data: r.sig_engineer,   signed_at: r.created_at },
    department: { signer_name: r.sig_department_name, signature_data: r.sig_department, signed_at: r.created_at },
    team:       { signer_name: r.sig_team_name,       signature_data: r.sig_team,       signed_at: r.created_at },
    supervisor: { signer_name: r.sig_supervisor_name, signature_data: r.sig_supervisor, signed_at: r.created_at },
    building:   { signer_name: r.sig_building_name,    signature_data: r.sig_building,   signed_at: r.created_at },
  };

  const woUrl = `${publicBaseUrl}/simple-wo/${id}`;
  const httpBase = `http://localhost:${process.env.PORT || 3001}`;

  // Inline every report photo as base64 → PDF render needs no image network
  // round-trips (fast + reliable). src = p.url directly, so imageBase is ''.
  for (const k of Object.keys(photos)) {
    for (const p of photos[k]) p.url = inlinePhoto(p.url, httpBase);
  }

  // No QR badge on the simple-wo report (qr omitted → qrBadge() renders nothing).
  const gridRows = Array.isArray(r.grid_rows) ? r.grid_rows : [];
  return { wo, unit, sigs, ac: r.ac_info || {}, brand: BRAND, qr: '', woUrl, imageBase: '', gridRows, recommendation: r.recommendation || '' };
}

module.exports = { getSimpleReportData };
