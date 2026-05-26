const express = require('express');
const router = express.Router();
const puppeteer = require('puppeteer-core');
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const dayjs = require('dayjs');
const { MEASUREMENT_FIELDS, CHECKLIST_ITEMS } = require('../config/measurements');

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

// ── GET /api/pdf/work-orders/:id ───────────────────────────────────────────
router.get('/work-orders/:id', authMiddleware, async (req, res) => {
  try {
    const { rows: [wo] } = await pool.query(`
      SELECT w.*, h.name hospital_name,
        t1.name tech1_name, t2.name tech2_name, o.name owner_name
      FROM work_orders w
      LEFT JOIN hospitals h ON w.hospital_id = h.id
      LEFT JOIN users t1    ON w.tech1_id = t1.id
      LEFT JOIN users t2    ON w.tech2_id = t2.id
      LEFT JOIN users o     ON w.owner_id  = o.id
      WHERE w.id = $1
    `, [req.params.id]);
    if (!wo) return res.status(404).json({ error: 'Not found' });

    const { rows: items } = await pool.query(`
      SELECT wi.*, a.ac_code, a.name ac_name, a.type ac_type, a.capacity_btu,
        d.name dept_name, f.name floor_name, b.name building_name
      FROM work_order_items wi
      JOIN ac_units a    ON wi.ac_unit_id = a.id
      JOIN departments d ON a.department_id = d.id
      JOIN floors f      ON d.floor_id = f.id
      JOIN buildings b   ON f.building_id = b.id
      WHERE wi.work_order_id = $1 ORDER BY wi.id
    `, [req.params.id]);

    const { rows: photos } = await pool.query(`
      SELECT p.* FROM ac_photos p
      JOIN work_order_items wi ON p.work_order_item_id = wi.id
      WHERE wi.work_order_id = $1
      ORDER BY p.work_order_item_id, p.phase, p.point_no
    `, [req.params.id]);

    const { rows: sigs } = await pool.query(`
      SELECT s.*, u.name user_name FROM signatures s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.work_order_id = $1
    `, [req.params.id]);

    const html = generateHtml(wo, items, photos, sigs);

    // Use env override, or nix-installed chromium (in PATH), or fallback paths
    const { execSync } = require('child_process');
    let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (!executablePath) {
      try { executablePath = execSync('which chromium').toString().trim(); } catch (_) {}
    }
    if (!executablePath) {
      try { executablePath = execSync('which chromium-browser').toString().trim(); } catch (_) {}
    }
    if (!executablePath) executablePath = '/usr/bin/chromium';

    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
      printBackground: true,
    });
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${wo.order_no}.pdf"`);
    res.end(pdf);
  } catch (err) {
    console.error('PDF error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── HTML generator ────────────────────────────────────────────────────────
function generateHtml(wo, items, photos, sigs) {
  // Group photos by item id → phase
  const photoMap = {};
  for (const p of photos) {
    if (!photoMap[p.work_order_item_id]) {
      photoMap[p.work_order_item_id] = { before: [], during: [], after: [] };
    }
    (photoMap[p.work_order_item_id][p.phase] ||= []).push(p);
  }

  const sigMap = {};
  for (const s of sigs) sigMap[s.role] = s;

  const typeLabel = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'ล้างพัดลม' };
  const dateStr = dayjs(wo.started_at || wo.created_at).format('DD/MM/YYYY');
  const isMajor = wo.type === 'major';

  const itemPages = items.map((item, idx) => {
    const p = photoMap[item.id] || { before: [], during: [], after: [] };
    const m = item.measurements || {};
    const c = item.checklist || {};
    return renderItemPage(wo, item, p, m, c, isMajor, typeLabel, dateStr, idx);
  }).join('\n');

  const sigPage = renderSigPage(wo, sigMap, typeLabel, dateStr, items.length);

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Sarabun', 'Noto Sans Thai', sans-serif;
    font-size: 9pt;
    color: #222;
  }
  .page { width: 100%; page-break-after: always; }
  .page:last-child { page-break-after: avoid; }

  /* Header */
  .hd {
    display: flex; align-items: center;
    border-bottom: 2px solid #1565C0;
    padding-bottom: 4px; margin-bottom: 5px;
    gap: 10px;
  }
  .hd-company { flex: 0 0 160px; }
  .hd-company .company-name { font-size: 9pt; font-weight: 700; color: #1565C0; }
  .hd-company .company-sub  { font-size: 7.5pt; color: #555; }
  .hd-title {
    flex: 1; text-align: center;
    font-size: 13pt; font-weight: 700; color: #1565C0;
  }
  .hd-meta { flex: 0 0 200px; font-size: 7.5pt; line-height: 1.6; text-align: right; }
  .hd-meta strong { color: #1565C0; }

  /* AC Info bar */
  .ac-bar {
    background: #E3F2FD;
    border: 1px solid #90CAF9;
    border-radius: 4px;
    padding: 3px 8px;
    display: flex; gap: 16px; flex-wrap: wrap;
    margin-bottom: 5px; font-size: 8pt;
  }
  .ac-bar .ac-field label { color: #555; }
  .ac-bar .ac-field span  { font-weight: 600; }

  /* Photos */
  .photos-row {
    display: flex; gap: 6px;
    margin-bottom: 5px;
  }
  .photos-col { flex: 1; min-width: 0; }
  .phase-label {
    font-size: 7.5pt; font-weight: 700; color: #fff;
    background: #1565C0; padding: 2px 6px;
    border-radius: 3px 3px 0 0; margin-bottom: 2px;
  }
  .photo-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 2px;
  }
  .photo-grid.cols3 { grid-template-columns: repeat(3, 1fr); }
  .photo-item { text-align: center; }
  .photo-item img {
    width: 100%; height: 62px;
    object-fit: cover;
    border: 1px solid #ddd;
    border-radius: 2px;
    background: #f0f0f0;
  }
  .photo-item .pt-label {
    font-size: 6pt; color: #444;
    line-height: 1.2; margin-top: 1px;
    word-break: break-word;
  }
  .no-photo { font-size: 8pt; color: #aaa; padding: 8px; text-align: center; }

  /* Measurements + Checklist row */
  .bottom-row { display: flex; gap: 6px; }
  .measure-box { flex: 1; min-width: 0; }
  .check-box   { flex: 0 0 200px; }
  .box-title {
    font-size: 7.5pt; font-weight: 700;
    border-bottom: 1px solid #1565C0;
    color: #1565C0; margin-bottom: 3px; padding-bottom: 1px;
  }
  .m-table { width: 100%; border-collapse: collapse; font-size: 7.5pt; }
  .m-table th {
    background: #1565C0; color: #fff;
    padding: 2px 4px; text-align: center; font-weight: 600;
  }
  .m-table td { padding: 2px 4px; border-bottom: 1px solid #eee; }
  .m-table td:nth-child(3), .m-table td:nth-child(4) { text-align: center; font-weight: 600; }
  .m-table tr:nth-child(even) td { background: #F5F5F5; }

  .cl-item { display: flex; align-items: center; gap: 4px; font-size: 7.5pt; margin-bottom: 2px; }
  .cl-box  { width: 10px; height: 10px; border: 1px solid #555; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 8pt; }
  .cl-box.checked { background: #1565C0; color: #fff; }

  /* Repair flag */
  .repair-flag {
    background: #FFF3E0; border: 1px solid #FFB74D;
    border-radius: 3px; padding: 3px 8px;
    font-size: 7.5pt; color: #E65100; margin-top: 4px;
  }

  /* Signature page */
  .sig-page { padding-top: 10px; }
  .sig-grid { display: flex; gap: 20px; margin-top: 20px; }
  .sig-col  { flex: 1; text-align: center; }
  .sig-col img { max-width: 180px; max-height: 80px; border-bottom: 1px solid #333; }
  .sig-line { border-bottom: 1px solid #333; height: 80px; margin: 0 20px; }
  .sig-name { margin-top: 4px; font-size: 8.5pt; }
  .sig-role { font-size: 7.5pt; color: #666; }
  .sig-date { font-size: 7pt; color: #888; }

  .item-no-badge {
    display: inline-block; background: #1565C0; color: #fff;
    font-size: 7pt; padding: 1px 5px; border-radius: 10px;
    margin-left: 6px; vertical-align: middle;
  }
</style>
</head>
<body>
${itemPages}
${sigPage}
</body>
</html>`;
}

function renderHeader(wo, typeLabel, dateStr, itemIdx, totalItems) {
  return `
  <div class="hd">
    <div class="hd-company">
      <div class="company-name">TECHNICAL WATER CO.,LTD</div>
      <div class="company-sub">บริการล้างเครื่องปรับอากาศ</div>
    </div>
    <div class="hd-title">
      ใบงานล้างทำความสะอาดเครื่องปรับอากาศ
    </div>
    <div class="hd-meta">
      เลขที่ใบงาน: <strong>${wo.order_no}</strong><br>
      ประเภท: <strong>${typeLabel[wo.type]}</strong><br>
      วันที่: <strong>${dateStr}</strong><br>
      โรงพยาบาล: <strong>${wo.hospital_name || '-'}</strong><br>
      แอร์ที่ ${itemIdx + 1}/${totalItems}
    </div>
  </div>`;
}

function renderPhotoGrid(phasePhotos, cols = 5) {
  if (!phasePhotos || !phasePhotos.length) {
    return '<div class="no-photo">ไม่มีรูป</div>';
  }
  return `<div class="photo-grid ${cols === 3 ? 'cols3' : ''}">
    ${phasePhotos.map(p => `
      <div class="photo-item">
        <img src="${BASE_URL}${p.url}" alt="${p.label || ''}"
          onerror="this.style.background='#ddd'">
        <div class="pt-label">${p.label || `จุด ${p.point_no}`}</div>
      </div>
    `).join('')}
  </div>`;
}

function renderItemPage(wo, item, phasePhotos, m, c, isMajor, typeLabel, dateStr, idx) {
  const fields = MEASUREMENT_FIELDS[wo.type] || [];
  const visibleFields = fields.filter(f =>
    !f.acTypes || f.acTypes.includes(item.ac_type)
  );
  const checkItems = CHECKLIST_ITEMS[wo.type] || [];
  const totalItems = 1; // Will use full count via outer call — placeholder

  const acBar = `
  <div class="ac-bar">
    <div class="ac-field"><label>รหัส: </label><span>${item.ac_code}</span></div>
    <div class="ac-field"><label>ชื่อ: </label><span>${item.ac_name}</span></div>
    <div class="ac-field"><label>ประเภท: </label><span>${item.ac_type}</span></div>
    <div class="ac-field"><label>BTU: </label><span>${item.capacity_btu || '-'}</span></div>
    <div class="ac-field"><label>แผนก: </label><span>${item.dept_name}</span></div>
    <div class="ac-field"><label>ชั้น: </label><span>${item.floor_name}</span></div>
    <div class="ac-field"><label>อาคาร: </label><span>${item.building_name}</span></div>
  </div>`;

  let photosSection = '';
  if (isMajor) {
    photosSection = `
    <div class="photos-row">
      <div class="photos-col">
        <div class="phase-label">📷 รูปก่อนล้าง (${phasePhotos.before.length} รูป)</div>
        ${renderPhotoGrid(phasePhotos.before, 5)}
      </div>
      <div class="photos-col">
        <div class="phase-label">📷 รูปหลังล้าง (${phasePhotos.after.length} รูป)</div>
        ${renderPhotoGrid(phasePhotos.after, 5)}
      </div>
    </div>`;
  } else {
    // minor/fan: before | during | after in one row
    photosSection = `
    <div class="photos-row">
      <div class="photos-col">
        <div class="phase-label">ก่อนล้าง</div>
        ${renderPhotoGrid(phasePhotos.before, 3)}
      </div>
      <div class="photos-col">
        <div class="phase-label">ขณะปฏิบัติงาน</div>
        ${renderPhotoGrid(phasePhotos.during, 3)}
      </div>
      <div class="photos-col">
        <div class="phase-label">หลังล้าง</div>
        ${renderPhotoGrid(phasePhotos.after, 3)}
      </div>
    </div>`;
  }

  const mTable = visibleFields.length ? `
    <div class="measure-box">
      <div class="box-title">ค่าที่วัด</div>
      <table class="m-table">
        <thead><tr>
          <th>รายการ</th><th>หน่วย</th><th>ก่อนล้าง</th><th>หลังล้าง</th>
        </tr></thead>
        <tbody>
          ${visibleFields.map(f => `
          <tr>
            <td>${f.label}</td>
            <td>${f.unit}</td>
            <td>${f.afterOnly ? '–' : ((m.before || {})[f.key] ?? '–')}</td>
            <td>${((m.after || {})[f.key] ?? '–')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';

  const clBox = checkItems.length ? `
    <div class="check-box">
      <div class="box-title">Checklist</div>
      ${checkItems.map(ci => `
        <div class="cl-item">
          <div class="cl-box ${c[ci.key] ? 'checked' : ''}">${c[ci.key] ? '✓' : ''}</div>
          <span>${ci.label}</span>
        </div>`).join('')}
    </div>` : '';

  const repairNote = item.has_repair ? `
    <div class="repair-flag">⚠ แจ้งซ่อม: ${item.repair_notes || 'ระบุในใบแจ้งซ่อม'}</div>` : '';

  const headerHtml = `
  <div class="hd">
    <div class="hd-company">
      <div class="company-name">TECHNICAL WATER CO.,LTD</div>
      <div class="company-sub">บริการล้างเครื่องปรับอากาศ</div>
    </div>
    <div class="hd-title">ใบงานล้างทำความสะอาดเครื่องปรับอากาศ</div>
    <div class="hd-meta">
      เลขที่ใบงาน: <strong>${wo.order_no}</strong><br>
      ประเภท: <strong>${typeLabel[wo.type]}</strong><br>
      วันที่: <strong>${dateStr}</strong><br>
      โรงพยาบาล: <strong>${wo.hospital_name || '-'}</strong><br>
      ช่าง: ${wo.tech1_name || '-'}${wo.tech2_name ? ' / ' + wo.tech2_name : ''}
    </div>
  </div>`;

  return `<div class="page${idx > 0 ? ' page-break' : ''}">
  ${headerHtml}
  ${acBar}
  ${photosSection}
  ${(mTable || clBox) ? `<div class="bottom-row">${mTable}${clBox}</div>` : ''}
  ${repairNote}
</div>`;
}

function renderSigPage(wo, sigMap, typeLabel, dateStr, itemCount) {
  const roles = [
    { role: 'tech1',  label: 'ช่างผู้ปฏิบัติงาน 1' },
    { role: 'tech2',  label: 'ช่างผู้ปฏิบัติงาน 2' },
    { role: 'owner',  label: 'ผู้ตรวจรับงาน' },
  ];

  const sigCols = roles.map(r => {
    const s = sigMap[r.role];
    const imgHtml = s?.signature_data
      ? `<img src="${s.signature_data}" alt="signature">`
      : '<div class="sig-line"></div>';
    const signedAt = s?.signed_at ? dayjs(s.signed_at).format('DD/MM/YYYY HH:mm') : '';
    return `
    <div class="sig-col">
      ${imgHtml}
      <div class="sig-name">${s?.user_name || '.................................'}</div>
      <div class="sig-role">(${r.label})</div>
      ${signedAt ? `<div class="sig-date">${signedAt}</div>` : ''}
    </div>`;
  }).join('');

  return `<div class="page sig-page">
  <div class="hd">
    <div class="hd-company">
      <div class="company-name">TECHNICAL WATER CO.,LTD</div>
      <div class="company-sub">บริการล้างเครื่องปรับอากาศ</div>
    </div>
    <div class="hd-title">ลายเซ็นรับรองผลงาน</div>
    <div class="hd-meta">
      เลขที่ใบงาน: <strong>${wo.order_no}</strong><br>
      ประเภท: <strong>${typeLabel[wo.type]}</strong><br>
      วันที่: <strong>${dateStr}</strong><br>
      โรงพยาบาล: <strong>${wo.hospital_name || '-'}</strong><br>
      จำนวนแอร์: <strong>${itemCount} เครื่อง</strong>
    </div>
  </div>
  <div style="margin-top:10px; font-size:8pt; color:#555;">
    ข้าพเจ้าได้ตรวจรับงานล้างทำความสะอาดเครื่องปรับอากาศ เลขที่ใบงาน <strong>${wo.order_no}</strong>
    จำนวน <strong>${itemCount}</strong> เครื่อง เรียบร้อยและถูกต้องครบถ้วนแล้ว
  </div>
  <div class="sig-grid">${sigCols}</div>
  <div style="margin-top:30px; font-size:7.5pt; color:#999; text-align:center;">
    สถานะใบงาน: ${wo.status} | พิมพ์เมื่อ: ${dayjs().format('DD/MM/YYYY HH:mm')}
  </div>
</div>`;
}

module.exports = router;
