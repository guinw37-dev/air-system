const pool = require('../db/pool');
const QRCode = require('qrcode');

// Brand constants (TW — Technical Water)
const BRAND = {
  name: 'Technical Water Co., Ltd.',
  nameTh: 'บริษัท เทคนิคอล วอเตอร์ จำกัด',
  teal: '#0E7C86',
  navy: '#0B3A47',
};

// Assemble everything a report template needs for one work order.
// Returns null if the WO does not exist. Caller enforces tenant + status rules.
async function getReportData(woId, { publicBaseUrl = '' } = {}) {
  const { rows: woRows } = await pool.query(`
    SELECT w.*, c.name client_name, c.code client_code, s.name site_name,
           ap.name approver_name
    FROM work_orders w
    LEFT JOIN clients c ON w.client_id = c.id
    LEFT JOIN sites s   ON w.site_id = s.id
    LEFT JOIN users ap  ON w.approver_id = ap.id
    WHERE w.id = $1
  `, [woId]);
  if (!woRows.length) return null;
  const wo = woRows[0];

  // units in the WO + their location
  const { rows: units } = await pool.query(`
    SELECT wou.id AS wou_id, u.id AS unit_id, u.asset_code, u.name AS unit_name,
           u.family, u.capacity_btu, u.refrigerant, u.equipment_type,
           wou.has_repair, wou.repair_notes,
           r.name AS room_name, f.name AS floor_name, b.name AS building_name
    FROM work_order_units wou
    JOIN units u        ON wou.unit_id = u.id
    LEFT JOIN rooms r   ON u.room_id = r.id
    LEFT JOIN floors f  ON r.floor_id = f.id
    LEFT JOIN buildings b ON f.building_id = b.id
    WHERE wou.work_order_id = $1
    ORDER BY wou.id
  `, [woId]);

  const wouIds = units.map((u) => u.wou_id);

  // inspection values joined with template metadata (category/label/type/unit)
  const inspByWou = {};
  if (wouIds.length) {
    const { rows: insp } = await pool.query(`
      SELECT iv.work_order_unit_id, iv.value_before, iv.value_after, iv.checked, iv.note,
             iv.val_r_before, iv.val_s_before, iv.val_t_before,
             iv.val_r_after, iv.val_s_after, iv.val_t_after,
             iv.val_ln_before, iv.val_l_before, iv.val_ln_after, iv.val_l_after,
             iv.val_suction, iv.val_discharge, iv.refrigerant_type, iv.val_text, iv.power_system,
             ti.id AS template_item_id, ti.category, ti.item_label, ti.value_type,
             ti.unit_label, ti.sort_order
      FROM inspection_values iv
      JOIN inspection_template_items ti ON iv.template_item_id = ti.id
      WHERE iv.work_order_unit_id = ANY($1)
      ORDER BY ti.sort_order, ti.id
    `, [wouIds]);
    for (const r of insp) (inspByWou[r.work_order_unit_id] ||= []).push(r);
  }

  // photos grouped by wou + phase, with uploader name
  const photosByWou = {};
  if (wouIds.length) {
    const { rows: photos } = await pool.query(`
      SELECT p.work_order_unit_id, p.phase, p.point_no, p.label, p.url, p.taken_at,
             us.name AS uploaded_by_name
      FROM work_order_photos p
      LEFT JOIN users us ON p.uploaded_by = us.id
      WHERE p.work_order_unit_id = ANY($1)
      ORDER BY p.phase, p.point_no
    `, [wouIds]);
    for (const p of photos) {
      const g = (photosByWou[p.work_order_unit_id] ||= { before: [], after: [], measurement: [] });
      (g[p.phase] ||= []).push(p);
    }
  }

  for (const u of units) {
    u.inspections = inspByWou[u.wou_id] || [];
    u.photos = photosByWou[u.wou_id] || { before: [], after: [], measurement: [] };
  }

  // signatures keyed by role
  const { rows: sigRows } = await pool.query(`
    SELECT role, signer_name, signature_data, signed_at FROM signatures WHERE work_order_id = $1
  `, [woId]);
  const signatures = {};
  for (const s of sigRows) signatures[s.role] = s;

  // assignees
  const { rows: assignees } = await pool.query(`
    SELECT u.name, u.role FROM work_order_assignees wa
    JOIN users u ON wa.user_id = u.id WHERE wa.work_order_id = $1
  `, [woId]);

  // QR → online WO detail (bottom-right of each page)
  const woUrl = `${publicBaseUrl}/work-orders/${woId}`;
  const qrDataUrl = await QRCode.toDataURL(woUrl, { width: 96, margin: 0 });

  // Chrome renders server-side; photos are served from this backend's static
  // /uploads, so absolute-prefix them with the local origin for puppeteer.
  const imageBase = `http://localhost:${process.env.PORT || 3001}`;

  return { wo, units, signatures, assignees, brand: BRAND, qr: qrDataUrl, woUrl, imageBase };
}

module.exports = { getReportData, BRAND };
