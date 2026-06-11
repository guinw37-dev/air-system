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

    /* ===================================================================== */
    /* TW แบบ C — compact per-unit page. All styles scoped to .major-c so   */
    /* the minor / cover / fan reports are unaffected.                        */
    /* ===================================================================== */
    @page { size: A4 portrait; }
    .major-c { font-size: 7.5pt; line-height: 1.2; color: var(--navy); display: flex; flex-direction: column; min-height: 258mm; }
    .major-c .lmt-head {
      display: flex; align-items: center; gap: 8px;
      border-bottom: 2px solid var(--teal); padding-bottom: 5px; margin-bottom: 6px;
    }
    .major-c .lmt-head .tw-badge.sm { width: 30px; height: 30px; font-size: 13px; border-radius: 7px; }
    .major-c .lmt-head .th { font-weight: 700; font-size: 9pt; color: var(--navy); line-height: 1.15; }
    .major-c .lmt-head .en { font-size: 6.5pt; color: var(--teal); letter-spacing: .4px; }
    .major-c .lmt-head .ttl { margin-left: auto; text-align: right; font-weight: 700; color: var(--navy); font-size: 9pt; }
    .major-c .lmt-head .ttl small { display: block; font-weight: 400; color: var(--teal); font-size: 6.5pt; }

    /* unit identity grid */
    .major-c .uhead {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 2px 10px; margin-bottom: 5px;
      border: 1px solid #cdd9db; border-radius: 5px; padding: 5px 7px; background: #f6faf9;
    }
    .major-c .uhead .row { display: flex; gap: 4px; }
    .major-c .uhead .k { color: #5a6e73; font-weight: 700; white-space: nowrap; }
    .major-c .uhead .v { color: var(--navy); }

    .major-c .svc-checks { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 5px; font-size: 7.5pt; }
    .major-c .svc-checks .opt { display: inline-flex; align-items: center; gap: 3px; }
    .major-c .svc-checks .bx {
      display: inline-block; width: 10px; height: 10px; border: 1px solid var(--navy);
      border-radius: 2px; text-align: center; line-height: 9px; font-size: 8px; color: var(--teal);
    }

    /* the one full-width checklist table */
    .major-c table.lmt { width: 100%; border-collapse: collapse; font-size: 7pt; table-layout: fixed; }
    .major-c table.lmt th, .major-c table.lmt td {
      border: 1px solid #b9c8ca; padding: 1px 4px; vertical-align: middle; text-align: left;
    }
    .major-c table.lmt thead th {
      background: var(--navy); color: #fff; font-weight: 600; text-align: center; font-size: 7pt; padding: 3px 4px;
    }
    .major-c table.lmt td.catlbl {
      background: #0E7C86; color: #fff; font-weight: 700; text-align: center; padding: 1px;
      width: 22px;
    }
    .major-c table.lmt td.catlbl span {
      writing-mode: vertical-rl; transform: rotate(180deg);
      white-space: nowrap; display: inline-block; font-size: 7.5pt; letter-spacing: .5px;
    }
    .major-c table.lmt td.tk { text-align: center; width: 30px; }
    .major-c table.lmt td.tk.on { color: var(--teal); font-weight: 700; }
    .major-c table.lmt td.ba { text-align: center; width: 64px; }
    .major-c table.lmt td.ba.bval { color: #0B3A47; font-weight: 600; }
    .major-c table.lmt td.ba.aval { color: #0E7C86; font-weight: 600; }
    .major-c table.lmt tr.na td { background: #eef1f1; color: #9fb0b4; }
    .major-c table.lmt tr.na td.catlbl { background: #0E7C86; color: #fff; }
    .major-c table.lmt .itnote { color: #8a999d; font-size: 6.5pt; }
    .major-c .subbox {
      margin-top: 2px; background: #f6faf9; border: 1px solid #d9e6e5; border-radius: 3px;
      padding: 2px 4px; font-size: 6.5pt; color: #45595d; line-height: 1.3;
    }
    .major-c .subbox .lbl { color: #0B3A47; font-weight: 700; }

    /* condition + result strip */
    .major-c .strip { display: flex; gap: 8px; margin-top: 4px; }
    .major-c .strip .col {
      flex: 1; border: 1px solid #cdd9db; border-radius: 5px; padding: 5px 7px; background: #fff;
    }
    .major-c .strip .col h4 {
      margin: 0 0 4px; font-size: 7.5pt; color: var(--navy);
      border-left: 3px solid var(--teal); padding-left: 6px; font-weight: 700;
    }
    .major-c .cond-opt { display: block; margin-bottom: 2px; }
    .major-c .cond-opt .bx {
      display: inline-block; width: 10px; height: 10px; border: 1px solid var(--navy);
      border-radius: 2px; text-align: center; line-height: 9px; font-size: 8px; color: var(--teal);
      margin-right: 4px;
    }
    .major-c .cond-opt .det { color: #5a6e73; font-size: 6.5pt; }
    .major-c .strip .times { margin-top: 5px; color: #5a6e73; }
    /* margin-top:auto pushes signatures to the bottom of the page (major-c is a flex column) */
    .major-c .sign-row { display: flex; gap: 12px; margin-top: auto; padding-top: 8px; }
    .major-c .sign-box .pad { height: 40px; }
    .major-c .sign-box .role { font-size: 7.5pt; margin-top: 3px; }
    .major-c .sign-box .nm { font-size: 7.5pt; }
    .major-c .sign-box .dt { font-size: 6.5pt; }

    /* page-2 by-point photo pairing */
    .pair-gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; }
    .pair-gallery .phcell {
      border: 1px solid #d9e2e4; border-radius: 6px; overflow: hidden; background: #fff;
    }
    .pair-gallery .phcell.before { border-top: 3px solid var(--teal); }
    .pair-gallery .phcell.after { border-top: 3px solid var(--navy); }
    .pair-gallery .phcell .img-wrap {
      height: 78px; background: #eef3f4; display: flex; align-items: center; justify-content: center;
    }
    .pair-gallery .phcell .img-wrap.empty { color: #9fb0b4; font-size: 10px; }
    .pair-gallery .phcell img { width: 100%; height: 78px; object-fit: cover; }
    .pair-gallery .phcell .cap { padding: 2px 6px; font-size: 8px; color: #5a6e73; line-height: 1.2; }
    .pair-gallery .phcell .cap b { color: var(--navy); }
    .pair-gallery .phcell.before .cap b { color: var(--teal); }
    .pair-gallery .gallery-head {
      grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
      font-weight: 700; font-size: 10px; margin-bottom: 2px;
    }
    .pair-gallery .gallery-head .gb { color: var(--teal); }
    .pair-gallery .gallery-head .ga { color: var(--navy); }
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

// TW แบบ C — fixed category order + Thai display labels.
const TW_CATEGORIES = [
  { key: 'all3', label: 'ใช้งานทั้ง 3 ประเภท' },
  { key: 'refrigerant', label: 'แอร์น้ำยา' },
  { key: 'fcu', label: 'FCU' },
  { key: 'ahu', label: 'AHU' },
  { key: 'other', label: 'อื่น ๆ' },
];

// Measurement value types do not get a simple ✓ tick.
const MEASUREMENT_TYPES = new Set(['rst_amp', 'ln_vi', 'pressure_pair']);

// Small "_" for a single missing scalar, "—" for an unfilled cell.
function blankOrNum(v, unitLabel) {
  const n = toNum(v);
  if (n === null) return '_';
  const ul = unitLabel ? ` ${escapeHtml(unitLabel)}` : '';
  return `${escapeHtml(v)}${ul}`;
}
function rawOrUnderscore(v) {
  if (v === null || v === undefined || v === '') return '_';
  return escapeHtml(v);
}

// Decide whether a category row applies to the given unit's family. FCU rows
// only apply to FCU-family units, AHU rows to AHU-family; the other three
// categories always apply. Returns false → render greyed "not applicable" row.
function categoryApplies(catKey, unit) {
  const fam = String((unit && unit.family) || '').toLowerCase();
  if (catKey === 'fcu') {
    if (fam.includes('ahu')) return false;
    return true;
  }
  if (catKey === 'ahu') {
    if (fam.includes('fcu')) return false;
    return true;
  }
  return true;
}

// Render the rst_amp / ln_vi / pressure_pair sub-box that lives under the
// รายการ cell. Returns '' for non-measurement rows.
function measurementSubBox(it) {
  const vt = it.value_type;
  if (vt === 'rst_amp') {
    // 220V (1φ) → LN/L only; 380V (3φ) → R/S/T only. Mutually exclusive.
    if (String(it.power_system) === '220') {
      const line = `<span class="lbl">ก่อน</span> LN=${rawOrUnderscore(it.val_ln_before)} V L=${rawOrUnderscore(it.val_l_before)} A · `
        + `<span class="lbl">หลัง</span> LN=${rawOrUnderscore(it.val_ln_after)} V L=${rawOrUnderscore(it.val_l_after)} A`;
      return `<div class="subbox"><span class="lbl" style="color:var(--teal)">220V 1φ</span> ${line}</div>`;
    }
    const line = `<span class="lbl">ก่อน</span> R=${rawOrUnderscore(it.val_r_before)} S=${rawOrUnderscore(it.val_s_before)} T=${rawOrUnderscore(it.val_t_before)} A · `
      + `<span class="lbl">หลัง</span> R=${rawOrUnderscore(it.val_r_after)} S=${rawOrUnderscore(it.val_s_after)} T=${rawOrUnderscore(it.val_t_after)} A`;
    return `<div class="subbox"><span class="lbl" style="color:var(--teal)">380V 3φ</span> ${line}</div>`;
  }
  if (vt === 'ln_vi') {
    if (String(it.power_system) === '380') {
      const ph = (lbl, v, a) => `${lbl}=${rawOrUnderscore(v)}V/${rawOrUnderscore(a)}A`;
      return `<div class="subbox"><span class="lbl" style="color:var(--teal)">3 เฟส</span> `
        + `${ph('R', it.val_r_v_after, it.val_r_after)} · ${ph('S', it.val_s_v_after, it.val_s_after)} · ${ph('T', it.val_t_v_after, it.val_t_after)}</div>`;
    }
    return `<div class="subbox"><span class="lbl" style="color:var(--teal)">1 เฟส</span> LN=${rawOrUnderscore(it.val_ln_after)} V · L=${rawOrUnderscore(it.val_l_after)} A</div>`;
  }
  if (vt === 'pressure_pair') {
    return `<div class="subbox">สาร: ${rawOrUnderscore(it.refrigerant_type)} · `
      + `Suction=${rawOrUnderscore(it.val_suction)} PSI (135-140) · `
      + `Discharge=${rawOrUnderscore(it.val_discharge)} PSI (&lt;450-500)</div>`;
  }
  return '';
}

// Build the ONE full-width TW checklist table for a unit. Renders all 5
// categories in fixed order with a vertical teal label column (rowspan).
function checklistTable(unit) {
  const groups = groupByCategory(unit && unit.inspections);
  const byCat = new Map();
  for (const g of groups) byCat.set(g.category, g.items);

  const bodyRows = [];
  for (const cat of TW_CATEGORIES) {
    const items = byCat.get(cat.key) || [];
    if (!items.length) continue; // template has no rows for this category → skip
    const applies = categoryApplies(cat.key, unit);
    const rowspan = items.length;

    items.forEach((it, idx) => {
      const vt = it.value_type;
      const isMeasure = MEASUREMENT_TYPES.has(vt);

      // ตรวจเช็ค column
      let tickCellHtml;
      if (!applies) {
        tickCellHtml = '<td class="tk">—</td>';
      } else if (isMeasure) {
        tickCellHtml = '<td class="tk"></td>'; // measurement rows leave tick blank
      } else if (it.checked) {
        tickCellHtml = `<td class="tk on">${TICK}</td>`;
      } else {
        tickCellHtml = '<td class="tk"></td>';
      }

      // ก่อน / หลัง columns
      let beforeCell = '<td class="ba">—</td>';
      let afterCell = '<td class="ba">—</td>';
      if (applies && (vt === 'number' || vt === 'before_after')) {
        beforeCell = `<td class="ba bval">${blankOrNum(it.value_before, it.unit_label)}</td>`;
        afterCell = `<td class="ba aval">${blankOrNum(it.value_after, it.unit_label)}</td>`;
      }

      // รายการ cell: label + (note/sub-detail for check/text) + measurement sub-box
      let detail = '';
      if (vt === 'check' || vt === 'text') {
        const sub = it.note || it.val_text;
        if (sub) detail += `<div class="itnote">${escapeHtml(sub)}</div>`;
      } else if (it.note) {
        detail += `<div class="itnote">${escapeHtml(it.note)}</div>`;
      }
      if (applies && isMeasure) detail += measurementSubBox(it);

      const labelCell = `<td>${dash(it.item_label)}${detail}</td>`;

      let row = `<tr class="${applies ? '' : 'na'}">`;
      if (idx === 0) {
        row += `<td class="catlbl" rowspan="${rowspan}"><span>${escapeHtml(cat.label)}</span></td>`;
      }
      row += `${labelCell}${tickCellHtml}${beforeCell}${afterCell}</tr>`;
      bodyRows.push(row);
    });
  }

  if (!bodyRows.length) {
    bodyRows.push('<tr><td colspan="5" style="text-align:center;color:#9fb0b4;">ไม่มีรายการตรวจเช็ค</td></tr>');
  }

  return `<table class="lmt">
    <thead><tr>
      <th style="width:22px;">หมวด</th>
      <th>รายการ</th>
      <th style="width:30px;">ตรวจเช็ค</th>
      <th style="width:64px;">ก่อน</th>
      <th style="width:64px;">หลัง</th>
    </tr></thead>
    <tbody>${bodyRows.join('')}</tbody>
  </table>`;
}

// Render one photo cell for the by-point pair gallery. `kind` ∈ 'before'|'after'.
// A null photo renders an empty placeholder cell so columns stay aligned.
function pairPhotoCell(p, kind, imageBase) {
  if (!p) {
    return `<div class="phcell ${kind}"><div class="img-wrap empty">— ไม่มีรูป —</div><div class="cap"><b>&nbsp;</b></div></div>`;
  }
  const src = `${imageBase || ''}${p.url || ''}`;
  const cap = [p.label, fmtDate(p.taken_at) !== '—' ? fmtDate(p.taken_at) : '', p.uploaded_by_name]
    .filter(Boolean)
    .map((x) => escapeHtml(x))
    .join(' · ');
  return `<div class="phcell ${kind}">
    <div class="img-wrap"><img src="${escapeHtml(src)}" alt="photo"></div>
    <div class="cap"><b>${cap || '—'}</b></div>
  </div>`;
}

// Build the photo gallery page(s). Photos are paired by point_no: one row per
// point — before(left, teal) / after(right, navy). Measurement photos are
// appended as their own rows (shown on the left). Returns inner-HTML fragments
// (one per page); empty array when the unit has no photos.
function photoGalleryPages(unit, data) {
  const ph = (unit && unit.photos) || {};
  const before = ph.before || [];
  const after = ph.after || [];
  const measurement = ph.measurement || [];
  if (!before.length && !after.length && !measurement.length) return [];

  // Collect the set of point_no values in first-seen order.
  const order = [];
  const seen = new Set();
  const beforeByPt = new Map();
  const afterByPt = new Map();
  const noPt = []; // [{kind, photo}] for photos lacking a point_no

  const register = (p, kind, map) => {
    const pt = p && p.point_no;
    if (pt === null || pt === undefined || pt === '') {
      noPt.push({ kind, photo: p });
      return;
    }
    const key = String(pt);
    if (!seen.has(key)) { seen.add(key); order.push(key); }
    if (!map.has(key)) map.set(key, p); // first photo for this point wins
  };
  for (const p of before) register(p, 'before', beforeByPt);
  for (const p of after) register(p, 'after', afterByPt);

  // Build rows: [beforePhoto|null, afterPhoto|null] per point_no.
  const rows = [];
  for (const key of order) {
    rows.push([beforeByPt.get(key) || null, afterByPt.get(key) || null]);
  }
  // Photos without a point_no: pair them positionally as extra rows.
  const npBefore = noPt.filter((x) => x.kind === 'before').map((x) => x.photo);
  const npAfter = noPt.filter((x) => x.kind === 'after').map((x) => x.photo);
  const npMax = Math.max(npBefore.length, npAfter.length);
  for (let i = 0; i < npMax; i++) {
    rows.push([npBefore[i] || null, npAfter[i] || null]);
  }
  // Measurement photos → own rows on the left.
  for (const m of measurement) rows.push([m, null]);

  const ROWS_PER_PAGE = 8; // all point-rows (7 points + extras) on one A4 page
  const frags = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    const chunk = rows.slice(i, i + ROWS_PER_PAGE);
    const cells = chunk
      .map(([b, a]) => pairPhotoCell(b, 'before', data.imageBase) + pairPhotoCell(a, 'after', data.imageBase))
      .join('');
    frags.push(`
      <div class="section-title">รูปภาพก่อน/หลัง — ${unitTitle(unit)}</div>
      <div class="pair-gallery">
        <div class="gallery-head"><div class="gb">ก่อน (Before)</div><div class="ga">หลัง (After)</div></div>
        ${cells}
      </div>`);
  }
  return frags;
}

// Compact header band for the .major-c TW page.
function lmtHeader(data, titleHtml) {
  const brand = data.brand || {};
  return `
  <div class="lmt-head">
    <div class="tw-badge sm">TW</div>
    <div class="brand-text">
      <div class="th">${dash(brand.nameTh)}</div>
      <div class="en">${dash(brand.name)}</div>
    </div>
    <div class="ttl">${titleHtml}</div>
  </div>`;
}

// LEFT-column "ความเห็นทีมช่าง" condition checkboxes, derived from data.wo.
function conditionOpts(wo) {
  const w = wo || {};
  const box = (on) => `<span class="bx">${on ? TICK : ''}</span>`;
  const det = (v) => (v ? ` <span class="det">(${escapeHtml(v)})</span>` : '');
  return `
    <div class="cond-opt">${box(w.cond_ac_degraded)}แอร์เสื่อมสภาพ</div>
    <div class="cond-opt">${box(w.cond_ac_old_5_7yr)}แอร์เก่า 5-7 ปี</div>
    <div class="cond-opt">${box(w.cond_external_degraded)}สภาพภายนอกเสื่อม${det(w.cond_external_detail)}</div>
    <div class="cond-opt">${box(w.cond_internal_degraded)}สภาพภายในเสื่อม${det(w.cond_internal_detail)}</div>`;
}

// "ผลงาน" result checkboxes (□เรียบร้อย □ไม่เรียบร้อย) for the .major-c strip.
function lmtResultOpts(unit) {
  const bad = unit && unit.has_repair;
  const box = (on) => `<span class="bx">${on ? TICK : ''}</span>`;
  return `
    <div class="cond-opt">${box(!bad)}เรียบร้อย</div>
    <div class="cond-opt">${box(bad)}ไม่เรียบร้อย</div>`;
}

function majorUnitPages(data) {
  const units = data.units || [];
  const sigs = data.signatures || {};
  const wo = data.wo || {};
  const pages = [];

  for (const u of units) {
    const uhead = `
    <div class="uhead">
      <div class="row"><span class="k">เลขเครื่อง:</span><span class="v">${dash(u.asset_code)}</span></div>
      <div class="row"><span class="k">ตำแหน่ง:</span><span class="v">${dash(u.room_name)}</span></div>
      <div class="row"><span class="k">ยี่ห้อ-รุ่น:</span><span class="v">${dash(u.family)}</span></div>
      <div class="row"><span class="k">BTU:</span><span class="v">${dash(u.capacity_btu)}</span></div>
      <div class="row"><span class="k">น้ำยา:</span><span class="v">${dash(u.refrigerant)}</span></div>
      <div class="row"><span class="k">ประเภทบำรุงรักษา:</span><span class="v">${dash(u.equipment_type)}</span></div>
    </div>`;

    const inner = `<div class="major-c">
    ${lmtHeader(data, 'แบบ C<small>Service Report — รายเครื่อง (TW)</small>')}
    ${uhead}
    ${serviceTypeChecks(u).replace('class="checks"', 'class="svc-checks"')}
    ${checklistTable(u)}

    <div class="strip">
      <div class="col">
        <h4>ความเห็นทีมช่าง</h4>
        ${conditionOpts(wo)}
      </div>
      <div class="col">
        <h4>ผลงาน</h4>
        ${lmtResultOpts(u)}
        <div class="times">เวลาเริ่ม: ${fmtTime(wo.started_at)} &nbsp; เวลาสิ้นสุด: ${fmtTime(wo.completed_at)}</div>
      </div>
    </div>

    <div class="sign-row">
      ${signatureBox('ทีมช่าง', { signer_name: assigneeNames(data) === '—' ? '' : assigneeNames(data) })}
      ${signatureBox('เจ้าของพื้นที่', sigs.area_owner)}
      ${signatureBox('ผู้อนุมัติ (Approver)', sigs.approver)}
    </div>
    </div>`;
    pages.push(page(data, inner));

    // Page 2+: by-point photo gallery (own page(s); skipped when no photos).
    for (const frag of photoGalleryPages(u, data)) {
      pages.push(page(data, `<div style="page-break-before:always;">${docHeader(data, 'แบบ C<small>รูปภาพประกอบ</small>')}${frag}</div>`));
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

// ---------------------------------------------------------------------------
// Simple Work Order report (phase 1) — single unit, no approval.
// Reuses the TW แบบ C chrome (lmtHeader / checklistTable / photoGalleryPages)
// but renders 3 image signatures (วิศวกรรม / หน่วยงาน / ทีมช่าง) collected
// directly on the device. Expects:
//   data = { brand, qr, imageBase,
//            wo:   { order_no, client_name, site_name, tech_name, work_date,
//                    started_at, completed_at, cond_*, ... },
//            unit: { asset_code, room_name, family, equipment_type, building_name,
//                    floor_name, has_repair, inspections:[], photos:{} },
//            sigs: { engineer, department, team }   // each {signer_name,signature_data,signed_at}
//          }
// Simple-WO photo pages (portrait): ก่อน 4×2 + หลัง 4×2 per A4 page,
// ~160px frames. Only ก่อน/หลัง (the report set) — the album gallery is excluded.
function simplePhotoPages(unit, data) {
  const ph = (unit && unit.photos) || {};
  const before = ph.before || [];
  const after = ph.after || [];
  if (!before.length && !after.length) return [];
  const base = data.imageBase || '';
  const PER = 8; // 4 cols × 2 rows per group

  const cell = (p) => {
    const src = `${base}${p.url || ''}`;
    const cap = [p.label, fmtDate(p.taken_at) !== '—' ? fmtDate(p.taken_at) : '']
      .filter(Boolean).map((x) => escapeHtml(x)).join(' · ');
    return `<div style="border:1px solid #d9e2e4;border-radius:8px;overflow:hidden;background:#fff;break-inside:avoid;">
      <div style="height:160px;background:#eef3f4;"><img src="${escapeHtml(src)}" alt="photo" style="width:100%;height:160px;object-fit:cover;display:block;"></div>
      <div style="padding:2px 7px;font-size:9px;color:#5a6e73;">${cap || '&nbsp;'}</div>
    </div>`;
  };
  const group = (title, color, items, total, pg) => {
    if (!items.length) return '';
    const part = total > PER ? ` — หน้า ${pg + 1}` : '';
    return `<div style="font-weight:700;color:${color};font-size:12px;margin:7px 0 6px;border-left:4px solid ${color};padding-left:7px;">${escapeHtml(title)} (${total})${part}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;">${items.map(cell).join('')}</div>`;
  };

  const npages = Math.max(Math.ceil(before.length / PER), Math.ceil(after.length / PER), 1);
  const frags = [];
  for (let pg = 0; pg < npages; pg++) {
    const b = before.slice(pg * PER, pg * PER + PER);
    const a = after.slice(pg * PER, pg * PER + PER);
    frags.push(
      group('ก่อน (Before)', 'var(--teal)', b, before.length, pg)
      + group('หลัง (After)', 'var(--navy)', a, after.length, pg)
    );
  }
  return frags;
}

// "รายละเอียดเครื่องปรับอากาศ" header block (simple-wo). ac = {detail,location,
// kind('water'|'refrigerant'|'other'),brand,model,cooling_size}.
function acDetailBlock(ac, wo, unit) {
  const a = ac || {};
  const cb = (on) => `<span style="display:inline-block;width:11px;height:11px;border:1.3px solid #0B3A47;border-radius:2px;text-align:center;line-height:9px;font-size:9px;margin-right:3px">${on ? TICK : ''}</span>`;
  const line = (k, v) => `<div style="display:flex;gap:6px;padding:1px 0"><span style="color:#5a6e73;min-width:118px">${k}</span><span style="border-bottom:1px dotted #9fb0b4;flex:1">${dash(v)}</span></div>`;
  const wt = String((wo || {}).work_type || (unit || {}).work_type || '');
  return `
  <div style="font-weight:700;color:var(--teal);font-size:12px;border-left:4px solid var(--teal);padding-left:6px;margin:8px 0 5px">รายละเอียดเครื่องปรับอากาศ</div>
  <div style="border:1px solid #e3eaec;border-radius:6px;padding:7px 10px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px">
      <div>
        <div style="padding:2px 0"><span style="color:#5a6e73">ชนิดเครื่อง</span> &nbsp; ${cb(a.kind === 'water')}แอร์น้ำ ${cb(a.kind === 'refrigerant')}แอร์น้ำยา ${cb(a.kind === 'other')}อื่นๆ</div>
      </div>
      <div>
        ${line('ยี่ห้อ', a.brand)}
        ${line('รุ่น', a.model)}
        ${line('หมายเลขเครื่อง', (unit || {}).asset_code)}
        ${line('ขนาดทำความเย็น (BTU)', a.cooling_size)}
      </div>
    </div>
    <div style="margin-top:4px"><span style="color:#5a6e73">ประเภทการบำรุงรักษา:</span> &nbsp; ${cb(wt === 'major')}S = ล้างใหญ่ &nbsp; ${cb(wt === 'minor')}ล้างย่อย &nbsp; ${cb(wt === 'fan')}พัดลม</div>
  </div>`;
}

// Grid columns per grid work_type (must match the form/detail GRID_COLS).
const GRID_COLS_PDF = {
  minor: ['ตรวจเช็คระบบการทำงาน', 'ล้างหัวจ่าย', 'ล้างช่องรีเทิร์น', 'ล้างฟิลเตอร์'],
  fan: ['ล้างหน้ากาก/มอเตอร์/ใบพัด', 'ใส่น้ำมันหล่อลื่นมอเตอร์', 'เช็คกระแสไฟฟ้า', 'เช็คความดังเสียง', 'ใช้งานได้ปกติ'],
};

// Full company letterhead for the grid forms (matches the paper documents).
const COMPANY = {
  th: 'บริษัท เทคนิคอล วอเตอร์ จำกัด',
  en: 'TECHNICAL WATER CO.,LTD',
  addr: '301/856 ซอยรามคำแหง 68 ถนนรามคำแหง แขวงหัวหมาก เขตบางกะปิ กรุงเทพ 10240',
  contact: 'โทร (Tel) 02-735-3022 · E-mail: Technicalwater2015@gmail.com',
};
function gridLetterhead(fan) {
  const titleMain = fan ? 'ใบบันทึกการบำรุงรักษาระบบปรับอากาศ' : 'CUSTOMER SERVICE REPORT AIR';
  const titleSub = fan ? 'สำหรับ พัดลมดูดอากาศ (ขนาดเล็ก)' : 'PREVENTIVE MAINTENANCE WORKING · ล้างแอร์ แบบล้างย่อย (FCU)';
  return `
    <div style="border-bottom:2px solid var(--teal);padding-bottom:6px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <div class="tw-badge sm">TW</div>
        <div style="line-height:1.3;">
          <div style="font-weight:700;font-size:10pt;color:var(--navy);">${COMPANY.th}</div>
          <div style="font-weight:700;font-size:7.5pt;color:var(--navy);letter-spacing:.3px;">${COMPANY.en}</div>
          <div style="font-size:6.5pt;color:#5a6e73;">${COMPANY.addr}</div>
          <div style="font-size:6.5pt;color:#5a6e73;">${COMPANY.contact}</div>
        </div>
      </div>
      <div style="text-align:center;margin-top:6px;">
        <div style="font-weight:700;font-size:11pt;color:var(--navy);letter-spacing:.5px;">${titleMain}</div>
        <div style="font-size:7pt;color:var(--teal);margin-top:1px;">${titleSub}</div>
      </div>
    </div>`;
}

// Per-machine photo block for ล้างย่อย: 3 รูป (ก่อน/หลัง/ขณะปฏิบัติงาน) per row.
// Renders only the rows that actually carry photos; returns '' if none do.
function gridPhotoSection(rows, title = 'รูปถ่ายงานล้างย่อย') {
  const PHASES = [['before', 'ก่อนล้าง'], ['after', 'หลังล้าง'], ['during', 'ขณะปฏิบัติงาน']];
  const withPhotos = (rows || []).filter((r) => r.photos && PHASES.some(([k]) => r.photos[k]));
  if (!withPhotos.length) return '';
  const cell = (src, label) => `
    <div style="flex:1;text-align:center">
      <div style="font-size:6.5pt;color:#5a6e73;margin-bottom:2px">${label}</div>
      ${src
        ? `<img src="${src}" style="width:100%;height:78px;object-fit:cover;border:1px solid #cdd9da;border-radius:3px"/>`
        : `<div style="width:100%;height:78px;border:1px dashed #cdd9da;border-radius:3px;display:flex;align-items:center;justify-content:center;color:#aab6b8;font-size:6.5pt">—</div>`}
    </div>`;
  const blocks = withPhotos.map((r, i) => {
    const id = [r.room, (r.machine_no || r.name)].filter(Boolean).join(' · ') || `เครื่องที่ ${i + 1}`;
    return `
      <div style="margin-bottom:7px;break-inside:avoid">
        <div style="font-size:7pt;font-weight:700;color:var(--navy);margin-bottom:2px">${escapeHtml(id)}</div>
        <div style="display:flex;gap:5px">${PHASES.map(([k, lbl]) => cell(r.photos[k], lbl)).join('')}</div>
      </div>`;
  }).join('');
  const secbar = `<div style="background:var(--navy);color:#fff;font-weight:700;font-size:8pt;padding:3px 9px;margin:10px 0 6px;border-radius:2px">${title}</div>`;
  return secbar + blocks;
}

// ล้างย่อย / พัดลม → multi-unit checkbox grid page (one A4, no photo pages).
function simpleGridPage(data, includePhotos = true) {
  const d = data || {};
  const wo = d.wo || {};
  const u = d.unit || {};
  const sigs = d.sigs || {};
  const fan = wo.work_type === 'fan';
  const cols = GRID_COLS_PDF[wo.work_type] || GRID_COLS_PDF.minor;
  const rows = Array.isArray(d.gridRows) ? d.gridRows : [];
  // both ล้างย่อย & พัดลม: ห้อง/แผนก + เลขเครื่อง (2 cols); fan adds ชำรุด.
  const nCols = 3 + cols.length + (fan ? 1 : 0);
  const checkW = `${Math.floor(50 / cols.length)}%`;
  const acType = wo.ac_type || (fan ? 'Exhaust Fan' : 'FCU');
  const jobLabel = fan ? 'ล้างพัดลมดูดอากาศ' : `ล้างแอร์ แบบล้างย่อย (${escapeHtml(acType)})`;

  const head = `<thead><tr>
    <th style="width:24px">ลำดับ</th>
    <th style="width:20%">ห้อง/แผนก</th><th style="width:16%">เลขเครื่อง</th>
    ${cols.map((c) => `<th style="width:${checkW}">${escapeHtml(c)}</th>`).join('')}
    ${fan ? '<th>ชำรุดเนื่องจาก</th>' : ''}
  </tr></thead>`;
  const body = rows.map((r, i) => `<tr>
    <td class="center">${i + 1}</td>
    <td>${dash(r.room)}</td><td>${dash(r.machine_no || r.name)}</td>
    ${cols.map((_, ci) => `<td class="tk ${(r.checks || [])[ci] ? 'on' : ''}">${(r.checks || [])[ci] ? TICK : ''}</td>`).join('')}
    ${fan ? `<td>${escapeHtml(r.broken || '')}</td>` : ''}
  </tr>`).join('') || `<tr><td colspan="${nCols}" class="center muted">ไม่มีรายการ</td></tr>`;

  const secbar = (t) => `<div style="background:var(--navy);color:#fff;font-weight:700;font-size:8pt;padding:3px 9px;margin:9px 0 5px;border-radius:2px">${t}</div>`;
  const fld = (label, val) => `<div style="border-bottom:1px dotted #b9c8ca;padding:2px 0"><span style="color:#5a6e73;font-weight:700;margin-right:5px">${label}</span>${dash(val)}</div>`;
  const meta = `
    ${secbar('ข้อมูลลูกค้า')}
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:2px 14px;font-size:8pt">
      ${fld('นามลูกค้า', wo.client_name)}
      ${fld('สถานที่', wo.location || wo.client_name)}
      ${fld('อาคาร', u.building_name)}
      ${fld('ชั้น', u.floor_name)}
      ${fld('ประเภทงาน', jobLabel)}
      ${fan ? fld('ประเภทพัดลม', acType) : ''}
      ${fld('วันที่', fmtDate(wo.work_date || wo.created_at))}
      ${fld('เวลาเริ่มงาน', fmtTime(wo.started_at))}
      ${fld('ช่างผู้ให้บริการ', wo.tech_name)}
    </div>`;

  // ล้างย่อย: 3 รูปต่อเครื่อง (ก่อน/หลัง/ขณะปฏิบัติงาน). ข้ามถ้าไม่มีรูปเลย.
  const photoSection = includePhotos ? gridPhotoSection(rows, fan ? 'รูปถ่ายงานล้างพัดลม' : 'รูปถ่ายงานล้างย่อย') : '';

  const inner = `<div class="major-c">
    ${gridLetterhead(fan)}
    ${meta}
    ${secbar('สำหรับพนักงานผู้ให้บริการ')}
    <table class="lmt" style="table-layout:fixed">${head}<tbody>${body}</tbody></table>
    <div style="margin-top:8px"><span style="color:#5a6e73;font-weight:700">ข้อแนะนำ:</span> ${dash(d.recommendation) === '—' ? '<span class="muted">—</span>' : escapeHtml(d.recommendation)}</div>
    ${photoSection}
    <div class="sign-row">
      ${signatureBox('ลงชื่อช่างแอร์', sigs.team)}
      ${signatureBox('ลงชื่อหัวหน้าช่างแอร์', sigs.supervisor)}
      ${signatureBox('ลงชื่อเจ้าหน้าที่ช่างอาคาร', sigs.building)}
      ${signatureBox('ลงชื่อเจ้าหน้าวิศวกรรม', sigs.engineer)}
    </div>
  </div>`;
  return [page(d, inner)];
}

// includePhotos=false → omit the photo pages / per-machine photo blocks. Used by
// the วางบิล batch so a 4-WO bundle (each with ~12 photos) doesn't blow past the
// PDF/proxy timeout; the photos still live in each WO's own PDF.
function simpleReportPages(data, includePhotos = true) {
  const d = data || {};
  const wo = d.wo || {};
  const u = d.unit || {};
  const sigs = d.sigs || {};

  // ล้างย่อย / พัดลม use the multi-unit grid layout instead.
  if (wo.work_type === 'minor' || wo.work_type === 'fan') return simpleGridPage(d, includePhotos);

  const meta = `
    <div class="uhead">
      <div class="row"><span class="k">ลูกค้า:</span><span class="v">${dash(wo.client_name)}</span></div>
      <div class="row"><span class="k">สถานที่:</span><span class="v">${dash(wo.location || wo.client_name)}</span></div>
      <div class="row"><span class="k">อาคาร:</span><span class="v">${dash(u.building_name)}</span></div>
      <div class="row"><span class="k">ชั้น:</span><span class="v">${dash(u.floor_name)}</span></div>
      <div class="row"><span class="k">ห้อง/แผนก:</span><span class="v">${dash(u.room_name)}</span></div>
      <div class="row"><span class="k">เลขเครื่อง:</span><span class="v">${dash(u.asset_code)}</span></div>
      <div class="row"><span class="k">ช่าง:</span><span class="v">${dash(wo.tech_name)}</span></div>
      <div class="row"><span class="k">วันที่:</span><span class="v">${fmtDate(wo.work_date || wo.created_at)}</span></div>
      <div class="row"><span class="k">ประเภทงาน:</span><span class="v">${dash(u.equipment_type)}</span></div>
      <div class="row"><span class="k">ประเภทเครื่องปรับอากาศ:</span><span class="v">${dash(wo.ac_type)}</span></div>
    </div>`;

  const inner = `<div class="major-c">
    ${lmtHeader(d, 'รายงานบริการ<small>Service Report (TW)</small>')}
    ${meta}
    ${acDetailBlock(d.ac, wo, u)}
    ${serviceTypeChecks(u).replace('class="checks"', 'class="svc-checks"')}
    ${checklistTable(u)}

    <div class="strip">
      <div class="col">
        <h4>ความเห็นทีมช่าง</h4>
        ${conditionOpts(wo)}
      </div>
      <div class="col">
        <h4>ผลงาน</h4>
        ${lmtResultOpts(u)}
        <div class="times">เวลาเริ่ม: ${fmtTime(wo.started_at)} &nbsp; เวลาสิ้นสุด: ${fmtTime(wo.completed_at)}</div>
      </div>
    </div>

    <div class="sign-row">
      ${signatureBox('ลงชื่อช่างแอร์', sigs.team)}
      ${signatureBox('ลงชื่อหัวหน้าช่างแอร์', sigs.supervisor)}
      ${signatureBox('ลงชื่อเจ้าหน้าที่ช่างอาคาร', sigs.building)}
      ${signatureBox('ลงชื่อเจ้าหน้าวิศวกรรม', sigs.engineer)}
    </div>
  </div>`;

  const pages = [page(d, inner)];
  if (includePhotos) {
    for (const frag of simplePhotoPages(u, d)) {
      pages.push(page(d, `<div style="page-break-before:always;">${docHeader(d, 'รายงานบริการ<small>รูปภาพประกอบ</small>')}${frag}</div>`));
    }
  }
  return pages;
}

function buildSimpleReportHtml(data) {
  const d = data || {};
  return htmlDoc(d, `ใบงาน ${(d.wo || {}).order_no || ''}`, simpleReportPages(d));
}

// Billing cover sheet for a batch of simple-WO reports (no "แบบ B").
function simpleBatchCover(data, items, meta) {
  const teal = 'var(--teal)', navy = 'var(--navy)';
  const rows = items.map((it, i) => `<tr>
    <td style="text-align:center">${i + 1}</td>
    <td>${dash(it.wo_number)}</td>
    <td style="text-align:center">${dash(it.building)}</td>
    <td>${dash(it.room)}</td>
    <td>${dash(it.asset_code)}</td>
    <td style="text-align:center">${dash(it.work_type)}</td>
    <td style="text-align:center">${fmtDate(it.work_date)}</td>
  </tr>`).join('') || `<tr><td colspan="7" style="text-align:center;color:#9fb0b4">ไม่มีรายการ</td></tr>`;
  const metaRows = [
    ['ลูกค้า', meta.client_name],
    ['เลขที่เอกสาร', meta.doc_no],
    ['วันที่ออกเอกสาร', fmtDate(meta.issue_date)],
    ['ช่วงปฏิบัติงาน', meta.date_range],
    ['รวมจำนวนเครื่อง', `${items.length} เครื่อง`],
    ['รวมใบงาน', `${meta.wo_count} ใบงาน`],
  ].map(([k, v]) => `<div style="display:flex;gap:8px;padding:3px 0"><div style="color:#5a6e73;font-weight:600;min-width:130px">${escapeHtml(k)}</div><div style="color:${navy}">${dash(v)}</div></div>`).join('');
  const inner = `
    ${docHeader(data, 'ใบปะหน้า — วางบิล<small>Cover Sheet · Service Report (TW)</small>')}
    <div style="font-weight:700;color:${teal};font-size:13px;margin:12px 0 8px;letter-spacing:.5px">สรุปงานล้างเครื่องปรับอากาศ · วางบิล</div>
    ${metaRows}
    <style>
      table.bcov{width:100%;border-collapse:collapse;margin-top:8px}
      table.bcov th{background:${navy};color:#fff;font-size:12px;padding:7px 8px}
      table.bcov td{border:1px solid #d9e2e4;padding:6px 8px;font-size:12px;color:${navy}}
      table.bcov tbody tr:nth-child(even) td{background:#f4f8f9}
    </style>
    <table class="bcov">
      <thead><tr>
        <th style="width:44px">ลำดับ</th><th>เลขใบงาน</th><th style="width:50px">อาคาร</th><th>ห้อง</th><th>เลขเครื่อง</th><th style="width:74px">ประเภท</th><th style="width:90px">วันที่</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:10px;text-align:right;font-weight:700;color:${navy}">รวมทั้งสิ้น ${items.length} เครื่อง · ${meta.wo_count} ใบงาน</div>
    ${meta.note && String(meta.note).trim() ? `<div style="margin-top:10px;padding:8px 10px;background:#f4f8f9;border-left:3px solid ${teal};font-size:12px;color:${navy};white-space:pre-wrap"><span style="color:#5a6e73;font-weight:600">หมายเหตุ:</span> ${escapeHtml(String(meta.note))}</div>` : ''}
    <div style="display:flex;justify-content:space-around;margin-top:54px;text-align:center">
      <div><div style="border-top:1px solid ${navy};width:200px;margin:0 auto;padding-top:6px">ผู้วางบิล (TW)</div><div style="font-size:11px;color:#5a6e73;margin-top:28px">วันที่ ___/___/____</div></div>
      <div><div style="border-top:1px solid ${navy};width:200px;margin:0 auto;padding-top:6px">ผู้รับวางบิล (โรงพยาบาล)</div><div style="font-size:11px;color:#5a6e73;margin-top:28px">วันที่ ___/___/____</div></div>
    </div>`;
  return page(data, inner);
}

function batchItems(arr) {
  return (arr || []).map((d) => ({
    wo_number: (d.wo || {}).order_no,
    building: (d.unit || {}).building_name,
    room: (d.unit || {}).room_name,
    asset_code: (d.unit || {}).asset_code,
    work_type: (d.unit || {}).equipment_type,
    work_date: (d.wo || {}).work_date || (d.wo || {}).created_at,
  }));
}

// Single combined doc, NO photo pages — the HTML fallback when Chrome is
// unavailable. The route normally renders the cover + each WO's full WITH-photos
// PDF separately and merges them (renderAndMerge), so photos ARE in the bundle.
function buildSimpleBatchHtml(dataArray, meta) {
  const arr = dataArray || [];
  const d0 = arr[0] || {};
  const pages = [simpleBatchCover(d0, batchItems(arr), meta || {})];
  for (const d of arr) pages.push(...simpleReportPages(d, false));
  return htmlDoc(d0, `วางบิล ${(meta || {}).doc_no || ''}`, pages);
}

// Just the billing cover page as its own doc, so the route can render it then
// append each WO's full report and merge the lot into one PDF.
function buildSimpleBatchCoverHtml(dataArray, meta) {
  const arr = dataArray || [];
  const d0 = arr[0] || {};
  return htmlDoc(d0, `วางบิล ${(meta || {}).doc_no || ''}`, [simpleBatchCover(d0, batchItems(arr), meta || {})]);
}

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

module.exports = { buildReportHtml, buildSimpleReportHtml, buildSimpleBatchHtml, buildSimpleBatchCoverHtml };
