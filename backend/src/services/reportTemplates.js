// reportTemplates.js — pure (no DB, no I/O) HTML builder for AC-cleaning
// work-order reports. Rendered to PDF by Puppeteer/Chrome and also shown as an
// HTML preview. Self-contained: every document inlines the shared TW-brand
// <style> and links the Sarabun font from Google Fonts.
//
//   module.exports = { buildReportHtml }
//   buildReportHtml(data, type)   type ∈ 'minor' | 'major' | 'fan'
//
// Returns a COMPLETE <html> document string. All user-supplied text is escaped.

// ---------------------------------------------------------------------------
// Small helpers (defensive: tolerate null / undefined / wrong shape)
// ---------------------------------------------------------------------------

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Format a date-ish value as DD/MM/YYYY (Gregorian; BE intentionally skipped).
// Guards null / invalid input, returning '—'.
function fmtDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// HH:MM, guarded.
function fmtTime(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

// Fall back to an em dash for empty display values.
function dash(value) {
  if (value === null || value === undefined || value === '') return '—';
  return escapeHtml(value);
}

// Coerce a stored inspection value to a finite number, else null.
function toNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const TICK = '✓';
const BOX = '☐';

// ---------------------------------------------------------------------------
// Checklist helpers
// ---------------------------------------------------------------------------

// Group a unit's inspection rows by category, preserving first-seen order.
function groupByCategory(inspections) {
  const groups = [];
  const index = new Map();
  for (const insp of inspections || []) {
    const cat = insp.category || 'อื่นๆ';
    let g = index.get(cat);
    if (!g) {
      g = { category: cat, items: [] };
      index.set(cat, g);
      groups.push(g);
    }
    g.items.push(insp);
  }
  return groups;
}

// Does any inspection on this unit whose label matches one of `keywords`
// register as checked? Used to derive แบบ A / แบบ D tick columns.
// Returns true | false | null (null = no matching item at all → render ☐).
function tickFor(unit, keywords) {
  const insp = (unit && unit.inspections) || [];
  let matched = false;
  for (const it of insp) {
    const label = String(it.item_label || '');
    if (keywords.some((k) => label.includes(k))) {
      matched = true;
      if (it.checked) return true;
    }
  }
  return matched ? false : null;
}

// Render a tick cell from a tri-state (true→✓, false→empty, null→☐ box).
function tickCell(state) {
  if (state === true) return `<td class="tick on">${TICK}</td>`;
  if (state === false) return '<td class="tick"></td>';
  return `<td class="tick box">${BOX}</td>`; // unknown / no matching item
}

// Build the before/after comparison decoration for a numeric inspection row.
// Returns { before, after, arrow } where arrow is an HTML snippet (or '').
function compareValues(insp, unitLabel) {
  const before = toNum(insp.value_before);
  const after = toNum(insp.value_after);
  const ul = unitLabel ? ` ${escapeHtml(unitLabel)}` : '';

  const beforeHtml =
    before !== null ? `${escapeHtml(insp.value_before)}${ul}` : dash(insp.value_before);
  const afterHtml =
    after !== null ? `${escapeHtml(insp.value_after)}${ul}` : dash(insp.value_after);

  let arrow = '';
  if (before !== null && after !== null && before !== after) {
    // Simple numeric comparison: higher after → ▲ (treated favorable / green),
    // lower after → ▼. Kept intentionally simple per spec.
    if (after > before) arrow = '<span class="arrow up">▲</span>';
    else arrow = '<span class="arrow down">▼</span>';
  }
  return { beforeHtml, afterHtml, arrow };
}

// ---------------------------------------------------------------------------
// Shared chrome: <style>, page wrapper, QR badge, signature block
// ---------------------------------------------------------------------------

function styleBlock(brand) {
  const teal = brand && brand.teal ? brand.teal : '#0E7C86';
  const navy = brand && brand.navy ? brand.navy : '#0B3A47';
  return `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root { --teal: ${teal}; --navy: ${navy}; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Sarabun', 'Segoe UI', Tahoma, sans-serif;
      color: var(--navy); font-size: 12px; line-height: 1.5;
      background: #f4f6f7;
    }
    .page {
      position: relative;
      width: 210mm; min-height: 297mm;
      padding: 16mm 14mm 18mm;
      margin: 0 auto 8mm; background: #fff;
      page-break-after: always;
      overflow: hidden;
    }
    .page:last-child { page-break-after: auto; }
    @media print {
      body { background: #fff; }
      .page { margin: 0; box-shadow: none; }
    }
    @media screen {
      .page { box-shadow: 0 2px 14px rgba(11,58,71,.12); }
    }

    /* QR badge bottom-right of every page */
    .qr-badge {
      position: absolute; right: 12mm; bottom: 9mm;
      width: 64px; text-align: center;
    }
    .qr-badge img { width: 60px; height: 60px; display: block; }
    .qr-badge span { font-size: 7px; color: #6b7d82; letter-spacing: .5px; }

    /* Wordmark badge "TW" */
    .tw-badge {
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--teal); color: #fff; font-weight: 700;
      border-radius: 12px; letter-spacing: 1px;
    }
    .tw-badge.lg { width: 92px; height: 92px; font-size: 40px; border-radius: 22px; }
    .tw-badge.sm { width: 40px; height: 40px; font-size: 18px; border-radius: 10px; }

    /* Header band */
    .doc-header {
      display: flex; align-items: center; gap: 14px;
      border-bottom: 3px solid var(--teal); padding-bottom: 10px; margin-bottom: 14px;
    }
    .doc-header .brand-text { line-height: 1.25; }
    .doc-header .brand-text .th { font-weight: 700; font-size: 15px; color: var(--navy); }
    .doc-header .brand-text .en { font-size: 10px; color: var(--teal); letter-spacing: .5px; }
    .doc-header .doc-title {
      margin-left: auto; text-align: right; font-weight: 700; color: var(--navy); font-size: 14px;
    }
    .doc-title small { display: block; font-weight: 400; color: var(--teal); font-size: 10px; }

    /* Info grid (key/value meta under a header) */
    .meta-grid {
      display: grid; grid-template-columns: repeat(2, 1fr);
      gap: 4px 18px; margin-bottom: 12px;
    }
    .meta-grid .row { display: flex; gap: 6px; }
    .meta-grid .k { color: #5a6e73; min-width: 84px; font-weight: 600; }
    .meta-grid .v { color: var(--navy); }

    /* Cards / sections */
    .card {
      border: 1px solid #d9e2e4; border-radius: 10px;
      padding: 12px 14px; margin-bottom: 12px; background: #fff;
    }
    .card > h3 {
      margin: 0 0 8px; font-size: 12.5px; color: var(--navy);
      border-left: 4px solid var(--teal); padding-left: 8px;
    }
    .section-title {
      font-weight: 700; color: var(--navy); font-size: 13px;
      margin: 0 0 8px; padding-bottom: 4px; border-bottom: 2px solid #e1e9ea;
    }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #cdd9db; padding: 5px 7px; text-align: left; vertical-align: top; }
    thead th { background: var(--navy); color: #fff; font-weight: 600; text-align: center; }
    tbody tr:nth-child(even) { background: #f4f8f8; }
    td.tick, th.tick { text-align: center; width: 60px; }
    td.tick.on { color: var(--teal); font-weight: 700; }
    td.tick.box { color: #9fb0b4; }
    td.center, th.center { text-align: center; }

    .cat-row td {
      background: #e7f1f2; font-weight: 700; color: var(--navy);
    }

    .arrow { font-weight: 700; margin-left: 4px; }
    .arrow.up { color: #1f9d55; }
    .arrow.down { color: #c0392b; }

    /* Checkbox inline list (service types) */
    .checks { display: flex; flex-wrap: wrap; gap: 14px; margin: 6px 0 10px; }
    .checks .opt { display: inline-flex; align-items: center; gap: 5px; }
    .checks .bx {
      display: inline-block; width: 13px; height: 13px; border: 1.5px solid var(--navy);
      border-radius: 3px; text-align: center; line-height: 11px; font-size: 11px; color: var(--teal);
    }

    /* Signatures */
    .sign-row { display: flex; gap: 18px; margin-top: 14px; }
    .sign-box { flex: 1; text-align: center; }
    .sign-box .pad {
      height: 56px; border-bottom: 1px solid var(--navy);
      display: flex; align-items: flex-end; justify-content: center;
    }
    .sign-box .pad img { max-height: 52px; max-width: 100%; }
    .sign-box .role { font-weight: 600; color: var(--teal); margin-top: 4px; font-size: 11px; }
    .sign-box .nm { color: var(--navy); font-size: 11px; }
    .sign-box .dt { color: #6b7d82; font-size: 10px; }

    /* Photo gallery */
    .gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .photo {
      border: 1px solid #d9e2e4; border-radius: 8px; overflow: hidden; background: #fff;
    }
    .photo .img-wrap {
      height: 150px; background: #eef3f4; display: flex; align-items: center; justify-content: center;
    }
    .photo img { max-width: 100%; max-height: 150px; object-fit: cover; }
    .photo .cap { padding: 5px 7px; font-size: 9.5px; color: #5a6e73; }
    .photo .cap b { color: var(--navy); }

    .muted { color: #8a999d; }
    .notes-box {
      border: 1px dashed #c2d0d2; border-radius: 8px; min-height: 40px;
      padding: 8px 10px; background: #fbfdfd;
    }
    .pill {
      display: inline-block; padding: 1px 9px; border-radius: 999px;
      font-size: 10px; font-weight: 600; background: #e7f1f2; color: var(--teal);
    }
    .result-line { margin-top: 8px; }
    .result-line .opt { display: inline-flex; align-items: center; gap: 5px; margin-right: 18px; }
  </style>`;
}

// QR badge HTML (guards missing qr).
function qrBadge(data) {
  if (!data || !data.qr) return '';
  return `<div class="qr-badge"><img src="${escapeHtml(data.qr)}" alt="QR"><span>SCAN</span></div>`;
}

// Wrap inner HTML as one A4 page (with QR badge).
function page(data, inner) {
  return `<div class="page">${inner}${qrBadge(data)}</div>`;
}

// Standard header band used by content pages.
function docHeader(data, titleHtml) {
  const brand = data.brand || {};
  return `
  <div class="doc-header">
    <div class="tw-badge sm">TW</div>
    <div class="brand-text">
      <div class="th">${dash(brand.nameTh)}</div>
      <div class="en">${dash(brand.name)}</div>
    </div>
    <div class="doc-title">${titleHtml}</div>
  </div>`;
}

// Names of assignees as a comma list (operators / ผู้ปฏิบัติงาน).
function assigneeNames(data) {
  const a = (data.assignees || []).map((x) => escapeHtml(x.name)).filter(Boolean);
  return a.length ? a.join(', ') : '—';
}

function firstUnit(data) {
  return (data.units && data.units[0]) || {};
}

// Render one signature box (img + role + name + date). Graceful when missing.
function signatureBox(roleLabel, sig) {
  const inner = sig && sig.signature_data
    ? `<img src="${escapeHtml(sig.signature_data)}" alt="sign">`
    : '';
  const nm = sig && sig.signer_name ? dash(sig.signer_name) : '<span class="muted">ลงชื่อ ____________</span>';
  const dt = sig && sig.signed_at ? fmtDate(sig.signed_at) : '—';
  return `
  <div class="sign-box">
    <div class="pad">${inner}</div>
    <div class="role">${escapeHtml(roleLabel)}</div>
    <div class="nm">${nm}</div>
    <div class="dt">${dt}</div>
  </div>`;
}

// Common meta grid (client / building / floor / date / time / operators).
function metaGrid(data, { withTimes = true, withOperators = true } = {}) {
  const wo = data.wo || {};
  const u0 = firstUnit(data);
  const rows = [
    ['ลูกค้า', dash(wo.client_name)],
    ['สถานที่', dash(wo.site_name)],
    ['อาคาร', dash(u0.building_name)],
    ['ชั้น', dash(u0.floor_name)],
    ['เลขที่ใบงาน', dash(wo.order_no)],
    ['วันที่ปฏิบัติงาน', fmtDate(wo.started_at || wo.created_at)],
  ];
  if (withTimes) {
    rows.push(['เวลาเริ่ม', fmtTime(wo.started_at)]);
    rows.push(['เวลาเสร็จ', fmtTime(wo.completed_at)]);
  }
  if (withOperators) {
    rows.push(['ผู้ปฏิบัติงาน', assigneeNames(data)]);
  }
  const cells = rows
    .map(([k, v]) => `<div class="row"><span class="k">${escapeHtml(k)}</span><span class="v">${v}</span></div>`)
    .join('');
  return `<div class="meta-grid">${cells}</div>`;
}

// Service-type checkbox row (used in แบบ C).
function serviceTypeChecks(unit) {
  const opts = ['ตามสัญญา', 'ทดสอบ', 'ซ่อม', 'อื่นๆ'];
  // We have no explicit field, so default mark "ตามสัญญา"; "ซ่อม" if has_repair.
  const marked = new Set(['ตามสัญญา']);
  if (unit && unit.has_repair) marked.add('ซ่อม');
  const html = opts
    .map((o) => `<span class="opt"><span class="bx">${marked.has(o) ? TICK : ''}</span>${escapeHtml(o)}</span>`)
    .join('');
  return `<div class="checks">${html}</div>`;
}

function resultLine(unit) {
  const bad = unit && unit.has_repair;
  return `
  <div class="result-line">
    <span class="opt"><span class="bx" style="display:inline-block;width:13px;height:13px;border:1.5px solid #0B3A47;border-radius:3px;text-align:center;line-height:11px;">${bad ? '' : TICK}</span> เรียบร้อย</span>
    <span class="opt"><span class="bx" style="display:inline-block;width:13px;height:13px;border:1.5px solid #0B3A47;border-radius:3px;text-align:center;line-height:11px;">${bad ? TICK : ''}</span> ไม่เรียบร้อย</span>
  </div>`;
}

// Unit identity line (asset_code + family + room).
function unitTitle(u) {
  const bits = [u.asset_code, u.family, u.room_name].map((x) => x && escapeHtml(x)).filter(Boolean);
  return bits.join(' · ') || '—';
}

// ---------------------------------------------------------------------------
// Document wrapper
// ---------------------------------------------------------------------------

function htmlDoc(data, title, bodyPages) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${styleBlock(data.brand || {})}
</head>
<body>
${bodyPages.join('\n')}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Cover page (all types)
// ---------------------------------------------------------------------------

const TYPE_TITLES = {
  minor: 'รายงานการล้างแอร์ · ล้างเล็ก (แบบ A)',
  major: 'รายงานการล้างแอร์ · ล้างใหญ่ (แบบ B/C)',
  fan: 'รายงานบำรุงรักษา · พัดลมดูดอากาศ (แบบ D)',
};

function coverPage(data, type) {
  const brand = data.brand || {};
  const wo = data.wo || {};
  const u0 = firstUnit(data);
  const location = [u0.building_name, u0.floor_name]
    .map((x) => x && escapeHtml(x))
    .filter(Boolean)
    .join(' / ') || '—';
  const title = TYPE_TITLES[type] || 'รายงานการปฏิบัติงาน';

  const inner = `
  <div style="position:absolute;top:0;left:0;right:0;height:14mm;background:linear-gradient(90deg,var(--navy),var(--teal));"></div>
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:230mm;text-align:center;">
    <div class="tw-badge lg" style="margin-bottom:18px;">TW</div>
    <div style="font-size:22px;font-weight:700;color:var(--navy);">${dash(brand.nameTh)}</div>
    <div style="font-size:13px;color:var(--teal);letter-spacing:1px;margin-bottom:30px;">${dash(brand.name)}</div>

    <div style="width:64px;height:4px;background:var(--teal);border-radius:2px;margin-bottom:26px;"></div>

    <div style="font-size:18px;font-weight:700;color:var(--navy);margin-bottom:8px;">${escapeHtml(title)}</div>
    <div class="pill" style="font-size:11px;margin-bottom:30px;">เลขที่ใบงาน ${dash(wo.order_no)}</div>

    <div style="display:grid;grid-template-columns:auto auto;gap:8px 16px;text-align:left;font-size:13px;">
      <div style="color:#5a6e73;font-weight:600;">ลูกค้า</div><div style="color:var(--navy);">${dash(wo.client_name)}</div>
      <div style="color:#5a6e73;font-weight:600;">สถานที่</div><div style="color:var(--navy);">${dash(wo.site_name)}</div>
      <div style="color:#5a6e73;font-weight:600;">ตำแหน่ง</div><div style="color:var(--navy);">${location}</div>
      <div style="color:#5a6e73;font-weight:600;">วันที่ปฏิบัติงาน</div><div style="color:var(--navy);">${fmtDate(wo.started_at || wo.created_at)}</div>
    </div>
  </div>
  <div style="position:absolute;bottom:14mm;left:0;right:0;text-align:center;font-size:10px;color:#9fb0b4;">
    เอกสารนี้สร้างโดยระบบรายงานอัตโนมัติ — ${dash(brand.name)}
  </div>`;
  return page(data, inner);
}

// ---------------------------------------------------------------------------
// แบบ A — minor (single summary page)
// ---------------------------------------------------------------------------

// Tick keyword map for the 4 minor columns.
const MINOR_COLS = [
  { label: 'ตรวจเช็คระบบ', keys: ['ตรวจเช็ค', 'ตรวจสอบ', 'ระบบ'] },
  { label: 'ล้างหัวจ่าย', keys: ['หัวจ่าย', 'จ่ายลม', 'Supply'] },
  { label: 'ล้างช่องรีเทิร์น', keys: ['รีเทิร์น', 'Return', 'ช่องลม'] },
  { label: 'ล้างฟิลเตอร์', keys: ['ฟิลเตอร์', 'Filter', 'กรอง'] },
];

function minorReport(data) {
  const units = data.units || [];
  const rows = units.map((u, i) => {
    const ticks = MINOR_COLS.map((c) => tickCell(tickFor(u, c.keys))).join('');
    return `<tr>
      <td class="center">${i + 1}</td>
      <td>${unitTitle(u)}</td>
      ${ticks}
    </tr>`;
  }).join('') || `<tr><td colspan="${2 + MINOR_COLS.length}" class="center muted">ไม่มีรายการเครื่อง</td></tr>`;

  const headTicks = MINOR_COLS.map((c) => `<th class="tick">${escapeHtml(c.label)}</th>`).join('');

  const sig = (data.signatures || {}).area_owner;
  const inner = `
  ${docHeader(data, 'แบบ A<small>ใบบันทึกการล้างแอร์ (ล้างเล็ก)</small>')}
  ${metaGrid(data)}
  <table>
    <thead><tr><th style="width:36px;">ลำดับ</th><th>เครื่อง / ห้อง</th>${headTicks}</tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="card" style="margin-top:14px;">
    <h3>ข้อแนะนำ</h3>
    <div class="notes-box">${dash(data.wo && data.wo.reject_reason) === '—' ? '<span class="muted">—</span>' : dash(data.wo.reject_reason)}</div>
  </div>

  <div class="sign-row">
    ${signatureBox('ผู้ดูแลพื้นที่ (Area Owner)', sig)}
  </div>`;
  return page(data, inner);
}

// ---------------------------------------------------------------------------
// แบบ B — major cover sheet
// ---------------------------------------------------------------------------

function majorCoverSheet(data) {
  const wo = data.wo || {};
  const u0 = firstUnit(data);
  const units = data.units || [];
  const rows = units.map((u, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${dash(u.floor_name)}</td>
      <td>${dash(u.room_name)}</td>
      <td>${dash(u.asset_code)}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="center muted">ไม่มีรายการเครื่อง</td></tr>';

  const sig = (data.signatures || {}).area_owner;
  const inner = `
  ${docHeader(data, 'แบบ B<small>Cover Sheet</small>')}
  <div class="section-title">CUSTOMER SERVICE REPORT AIR · PREVENTIVE MAINTENANCE WORKING</div>
  <div class="meta-grid">
    <div class="row"><span class="k">ลูกค้า</span><span class="v">${dash(wo.client_name)}</span></div>
    <div class="row"><span class="k">สถานที่</span><span class="v">${dash(wo.site_name)}</span></div>
    <div class="row"><span class="k">อาคาร</span><span class="v">${dash(u0.building_name)}</span></div>
    <div class="row"><span class="k">ประเภทงาน</span><span class="v">ล้างแอร์ · ล้างใหญ่</span></div>
    <div class="row"><span class="k">เลขที่ใบงาน</span><span class="v">${dash(wo.order_no)}</span></div>
    <div class="row"><span class="k">วันที่ปฏิบัติงาน</span><span class="v">${fmtDate(wo.started_at || wo.created_at)}</span></div>
    <div class="row"><span class="k">เวลาเริ่ม</span><span class="v">${fmtTime(wo.started_at)}</span></div>
  </div>

  <table>
    <thead><tr><th style="width:48px;">ลำดับ</th><th>ชั้น</th><th>ห้อง</th><th>เลขเครื่อง</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="card" style="margin-top:14px;">
    <h3>สรุปการปฏิบัติงาน</h3>
    <div class="meta-grid" style="margin-bottom:0;">
      <div class="row"><span class="k">ผู้ปฏิบัติงาน</span><span class="v">${assigneeNames(data)}</span></div>
      <div class="row"><span class="k">เวลาเสร็จ</span><span class="v">${fmtTime(wo.completed_at)}</span></div>
    </div>
  </div>

  <div class="sign-row">
    ${signatureBox('ผู้ดูแลพื้นที่ (Area Owner)', sig)}
  </div>`;
  return page(data, inner);
}

// ---------------------------------------------------------------------------
// แบบ C — major: one (or more) page(s) per unit
// ---------------------------------------------------------------------------

const PHOTOS_PER_PAGE = 6;

function checklistTable(unit) {
  const groups = groupByCategory(unit.inspections);
  if (!groups.length) {
    return '<table><thead><tr><th>รายการ</th><th class="tick">ตรวจเช็ค</th><th class="center">ก่อน</th><th class="center">หลัง</th></tr></thead><tbody><tr><td colspan="4" class="center muted">ไม่มีรายการตรวจเช็ค</td></tr></tbody></table>';
  }
  const body = groups.map((g) => {
    const head = `<tr class="cat-row"><td colspan="4">${dash(g.category)}</td></tr>`;
    const items = g.items.map((it) => {
      const checked = it.checked ? `<span style="color:var(--teal);font-weight:700;">${TICK}</span>` : BOX;
      let beforeCell;
      let afterCell;
      const vt = it.value_type;
      if (vt === 'number' || vt === 'before_after') {
        const cmp = compareValues(it, it.unit_label);
        beforeCell = cmp.beforeHtml;
        afterCell = `${cmp.afterHtml}${cmp.arrow}`;
      } else if (vt === 'text') {
        beforeCell = dash(it.value_before);
        afterCell = dash(it.value_after);
      } else {
        // 'check' or unknown → no comparison values
        beforeCell = '<span class="muted">—</span>';
        afterCell = '<span class="muted">—</span>';
      }
      const note = it.note ? `<div class="muted" style="font-size:9.5px;">${escapeHtml(it.note)}</div>` : '';
      return `<tr>
        <td>${dash(it.item_label)}${note}</td>
        <td class="tick">${checked}</td>
        <td class="center">${beforeCell}</td>
        <td class="center">${afterCell}</td>
      </tr>`;
    }).join('');
    return head + items;
  }).join('');

  return `<table>
    <thead><tr><th>รายการตรวจเช็ค</th><th class="tick">ตรวจเช็ค</th><th class="center">ก่อน</th><th class="center">หลัง</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

// Render a list of photos as 2-col gallery cells.
function photoCells(photos, imageBase) {
  return (photos || []).map((p) => {
    const src = `${imageBase || ''}${p.url || ''}`;
    const cap = [p.label, fmtDate(p.taken_at) !== '—' ? fmtDate(p.taken_at) : '', p.uploaded_by_name]
      .filter(Boolean)
      .map((x) => escapeHtml(x))
      .join(' · ');
    return `<div class="photo">
      <div class="img-wrap"><img src="${escapeHtml(src)}" alt="photo"></div>
      <div class="cap"><b>${cap || '—'}</b></div>
    </div>`;
  }).join('');
}

// Build the photo gallery, splitting into extra pages when a unit has many
// photos. Returns an array of inner-HTML fragments (one per page).
function photoGalleryPages(unit, data) {
  const ph = unit.photos || {};
  const before = ph.before || [];
  const after = ph.after || [];
  const measurement = ph.measurement || [];
  const total = before.length + after.length + measurement.length;
  if (!total) return [];

  // Pair before/after side-by-side; flatten in interleaved order so the 2-col
  // grid naturally lines up before(left)/after(right).
  const pairs = [];
  const maxLen = Math.max(before.length, after.length);
  for (let i = 0; i < maxLen; i++) {
    if (before[i]) pairs.push(before[i]);
    if (after[i]) pairs.push(after[i]);
  }
  for (const m of measurement) pairs.push(m);

  const frags = [];
  for (let i = 0; i < pairs.length; i += PHOTOS_PER_PAGE) {
    const chunk = pairs.slice(i, i + PHOTOS_PER_PAGE);
    frags.push(`
      <div class="section-title">รูปภาพก่อน/หลัง — ${unitTitle(unit)}</div>
      <div class="gallery">${photoCells(chunk, data.imageBase)}</div>`);
  }
  return frags;
}

function majorUnitPages(data) {
  const units = data.units || [];
  const sigs = data.signatures || {};
  const pages = [];

  for (const u of units) {
    const inner = `
    ${docHeader(data, 'แบบ C<small>Service Report — รายเครื่อง</small>')}
    <div class="card">
      <h3>${unitTitle(u)}</h3>
      <div class="meta-grid" style="margin-bottom:0;">
        <div class="row"><span class="k">เลขเครื่อง</span><span class="v">${dash(u.asset_code)}</span></div>
        <div class="row"><span class="k">ห้อง</span><span class="v">${dash(u.room_name)}</span></div>
        <div class="row"><span class="k">รุ่น/ตระกูล</span><span class="v">${dash(u.family)}</span></div>
        <div class="row"><span class="k">ขนาด (BTU)</span><span class="v">${dash(u.capacity_btu)}</span></div>
        <div class="row"><span class="k">น้ำยา</span><span class="v">${dash(u.refrigerant)}</span></div>
        <div class="row"><span class="k">ประเภท</span><span class="v">${dash(u.equipment_type)}</span></div>
      </div>
    </div>

    <div class="section-title">ประเภทการให้บริการ</div>
    ${serviceTypeChecks(u)}

    <div class="section-title">รายการตรวจเช็ค</div>
    ${checklistTable(u)}

    ${resultLine(u)}

    <div class="sign-row">
      ${signatureBox('ผู้ดูแลพื้นที่', sigs.area_owner)}
      ${signatureBox('ส่วนกลาง (Central Admin)', sigs.central_admin)}
      ${signatureBox('ผู้อนุมัติ (Approver)', sigs.approver)}
    </div>`;
    pages.push(page(data, inner));

    // Photo gallery (own page(s); >6 photos paginates automatically).
    for (const frag of photoGalleryPages(u, data)) {
      pages.push(page(data, `${docHeader(data, 'แบบ C<small>รูปภาพประกอบ</small>')}${frag}`));
    }
  }

  if (!pages.length) {
    pages.push(page(data, `${docHeader(data, 'แบบ C<small>Service Report</small>')}<div class="center muted" style="margin-top:40px;">ไม่มีรายการเครื่อง</div>`));
  }
  return pages;
}

// ---------------------------------------------------------------------------
// แบบ D — fan (exhaust fans)
// ---------------------------------------------------------------------------

const FAN_COLS = [
  { label: 'ล้างหน้ากาก/มอเตอร์/ใบพัด', keys: ['ล้าง', 'หน้ากาก', 'มอเตอร์', 'ใบพัด'] },
  { label: 'ใส่น้ำมันหล่อลื่น', keys: ['น้ำมัน', 'หล่อลื่น', 'Lubricat'] },
  { label: 'เช็คกระแสไฟฟ้า', keys: ['กระแส', 'ไฟฟ้า', 'Current', 'Amp'] },
  { label: 'เช็คเสียงมอเตอร์/ใบพัด', keys: ['เสียง', 'Noise', 'Sound'] },
  { label: 'ใช้งานได้ปกติ', keys: ['ปกติ', 'ใช้งาน', 'Normal'] },
];

function fanReport(data) {
  const units = data.units || [];
  const rows = units.map((u, i) => {
    const ticks = FAN_COLS.map((c) => tickCell(tickFor(u, c.keys))).join('');
    // "ใช้งานได้ปกติ" — if the unit has_repair, force-empty that column.
    const repairCell = u.has_repair
      ? `<td>${dash(u.repair_notes)}</td>`
      : '<td class="center muted">—</td>';
    return `<tr>
      <td class="center">${i + 1}</td>
      <td>${dash(u.asset_code)}</td>
      <td>${dash(u.room_name)}</td>
      ${ticks}
      ${repairCell}
    </tr>`;
  }).join('') || `<tr><td colspan="${3 + FAN_COLS.length + 1}" class="center muted">ไม่มีรายการพัดลม</td></tr>`;

  const headTicks = FAN_COLS.map((c) => `<th class="tick">${escapeHtml(c.label)}</th>`).join('');
  const sigs = data.signatures || {};
  const supervisor = sigs.central_admin || sigs.approver;

  const inner = `
  ${docHeader(data, 'แบบ D<small>พัดลมดูดอากาศ</small>')}
  <div class="section-title">ใบบันทึกการบำรุงรักษาระบบปรับอากาศ · สำหรับ พัดลมดูดอากาศ (ขนาดเล็ก)</div>
  ${metaGrid(data)}

  <table>
    <thead><tr>
      <th style="width:36px;">ลำดับ</th><th>เลขเครื่อง</th><th>ห้อง</th>
      ${headTicks}
      <th>ชำรุดเนื่องจาก</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="card" style="margin-top:14px;">
    <h3>ข้อเสนอแนะ</h3>
    <div class="notes-box"><span class="muted">—</span></div>
  </div>

  <div class="sign-row">
    ${signatureBox('ผู้ปฏิบัติงาน', { signer_name: assigneeNames(data) === '—' ? '' : assigneeNames(data) })}
    ${signatureBox('ผู้ควบคุมงาน / ฝ่ายวิศวกรรม', supervisor)}
    <div class="sign-box">
      <div class="pad"><div class="tw-badge sm">TW</div></div>
      <div class="role">ตราประทับบริษัท</div>
      <div class="nm">&nbsp;</div>
      <div class="dt">&nbsp;</div>
    </div>
  </div>`;
  return page(data, inner);
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

function buildReportHtml(data, type) {
  const d = data || {};
  const pages = [coverPage(d, type)];

  if (type === 'minor') {
    pages.push(minorReport(d));
  } else if (type === 'major') {
    pages.push(majorCoverSheet(d));
    pages.push(...majorUnitPages(d));
  } else if (type === 'fan') {
    pages.push(fanReport(d));
  } else {
    // Unknown type → cover only + a notice page.
    pages.push(page(d, `${docHeader(d, 'รายงาน')}<div class="center muted" style="margin-top:40px;">ไม่รองรับประเภทรายงาน: ${dash(type)}</div>`));
  }

  return htmlDoc(d, TYPE_TITLES[type] || 'รายงานการปฏิบัติงาน', pages);
}

module.exports = { buildReportHtml };
