// check-grid-pdf — render ใบล้างย่อย/พัดลมทั้งชุด (1–14, 18 เครื่อง × พัดลม / ล้างย่อย /
// ล้างย่อยมีรูปวัดลม × มี-ไม่มีช่องเซ็นเจ้าของพื้นที่ + เคสพิเศษ) เป็น PDF จริง แล้วตรวจ
// ทุกหน้า: หน้าว่าง, ช่องเซ็นหลุดไปอยู่หน้าโดด ๆ, ช่องเซ็นแยกคนละหน้า, หัว "รูปถ่ายงาน…"
// หลุดท้ายหน้า + จำนวนหน้า/ความสูงรูป. ใช้ก่อน merge ทุกครั้งที่แก้ template ใบงาน:
// ตัวเลข "ไม่เปลี่ยน" ต้องมาจากทั้งชุด ไม่ใช่ตัวอย่างที่เลือกเอง (PR #279 เทส 13 แบบ
// แล้วพลาดใบ 9 เครื่องที่หน้าแรกว่าง — แก้ใน PR #280).
//
//   node scripts/check-grid-pdf.js                      ตรวจโค้ดใน working tree
//   node scripts/check-grid-pdf.js --base origin/main   + เทียบกับ commit อื่น (แสดง * ทุกเคสที่ต่าง)
//   node scripts/check-grid-pdf.js --ref <commit>       ตรวจ template ของ commit อื่นแทน working tree
//   ตัวเลือก: --cases <regex>  --keep <dir> (เก็บ PDF ไว้ดู)  --chrome <path>
// exit 1 = เจอหน้าว่าง/ช่องเซ็นหลุด/ช่องเซ็นแยกหน้า/หัวรูปหลุด ในโค้ดที่ตรวจ (ไม่ใช่ใน --base).
//
// วิธีอ่าน PDF โดยไม่ต้องลง dependency เพิ่ม: ฝังลิงก์ล่องหน (https://mark.invalid/<ชนิด>)
// ทับหัวเอกสาร แถวตาราง หัวรูป กล่องรูป กรอบรูป และช่องเซ็นแต่ละช่อง — Chrome เขียนลิงก์
// เป็น annotation พร้อมตำแหน่งแยกทีละหน้า แล้วอ่านด้วย pdf-lib. ลิงก์เป็น position:absolute
// จึงไม่ขยับ layout. Render ด้วย pdfRenderer.htmlToPdf ตัวเดียวกับ prod; ถ้า puppeteer-core
// โหลดไม่ได้ (เช่น Node 26 ในเครื่อง dev) ใช้ Chrome --print-to-pdf + @page margin เดียวกัน.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MM = 72 / 25.4;
const REPO = path.resolve(__dirname, '../..');

// ── วิเคราะห์ (pure, เทสใน test/gridPdfCheck.test.js) ─────────────────────────
// pages: [{ marks: [{ kind, top, h }] }] — top/h เป็น mm จากขอบบนหน้า
function analyzePages(pages) {
  const has = (p, kind) => p.marks.some((m) => m.kind === kind);
  const blank = [];
  pages.forEach((p, i) => { if (!p.marks.length) blank.push(i + 1); });
  const sigPages = [];
  pages.forEach((p, i) => { if (has(p, 'sigbox')) sigPages.push(i + 1); });
  const sigPage = sigPages.length ? sigPages[sigPages.length - 1] : null;
  const sp = sigPage ? pages[sigPage - 1] : null;
  const orphanSig = Boolean(sp && sigPage > 1 && !has(sp, 'block') && !has(sp, 'row'));
  const orphanHead = pages.some((p) => p.marks.some((h) => h.kind === 'photohead'
    && !p.marks.some((b) => b.kind === 'block' && b.top >= h.top)));
  const imgs = pages.flatMap((p) => p.marks.filter((m) => m.kind === 'img').map((m) => m.h));
  const sigTop = sp ? Math.min(...sp.marks.filter((m) => m.kind === 'sigbox').map((m) => m.top)) : null;
  return {
    pages: pages.length,
    blocksPerPage: pages.map((p) => p.marks.filter((m) => m.kind === 'block').length),
    blank,
    sigPage,
    sigSplit: sigPages.length > 1,
    orphanSig,
    orphanHead,
    photoH: imgs.length ? [Math.min(...imgs), Math.max(...imgs)].map((v) => Math.round(v * 10) / 10) : null,
    sigTop: sigTop == null ? null : Math.round(sigTop * 10) / 10,
  };
}
const isDefect = (r) => r.blank.length > 0 || r.orphanSig || r.sigSplit || r.orphanHead || !r.sigPage;

// ── ชุดเคส ──────────────────────────────────────────────────────────────────
const svg = (w, h, fill) => `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${fill}"/></svg>`,
).toString('base64')}`;
const PHOTOS = (land, measure) => {
  const [w, h] = land ? [400, 300] : [300, 400];
  return { before: svg(w, h, '#b9c3c4'), after: svg(w, h, '#b7cfdc'), during: svg(w, h, '#c4d5c2'),
    ...(measure ? { measure: svg(w, h, '#ddd6b8') } : {}) };
};
const LONG_REC = 'พัดลมทำงานปกติ ใบพัดสะอาด มอเตอร์ไม่มีเสียงผิดปกติ แนะนำให้ล้างทุก 3 เดือน '.repeat(3);
function caseData({ type, n, photosOn = n, dept = false, measure = false, land = false, rec = 'ปกติ' }) {
  const sig = (name) => ({ signer_name: name, signed_at: '2026-11-17T09:00:00Z' });
  const rows = Array.from({ length: n }, (_, i) => ({
    room: `ห้องน้ำชาย ชั้น ${i + 1}`, machine_no: `EF-${String(i + 1).padStart(2, '0')}`,
    checks: type === 'fan' ? [true, true] : [true, true, true, true], broken: '',
    ...(i < photosOn ? { photos: PHOTOS(land, measure) } : {}),
  }));
  return {
    wo: { order_no: 'SWO-CHECK', client_name: 'โรงพยาบาลทดสอบ', location: 'อาคาร 1', tech_name: 'ช่าง ทดสอบ',
      work_date: '2026-11-17', started_at: '2026-11-17T08:30:00Z', work_type: type,
      ac_type: type === 'fan' ? 'Exhaust Fan' : 'FCU' },
    unit: { building_name: 'อาคาร 1', floor_name: '1', photos: { before: [], after: [] } },
    sigs: { team: sig('ช่าง ทดสอบ'), supervisor: sig('หัวหน้า ทดสอบ'), building: sig('ช่างอาคาร'),
      engineer: sig('วิศวกร'), department: sig('เจ้าของพื้นที่') },
    ac: {}, brand: {}, qr: '', imageBase: '', gridRows: rows, recommendation: rec, require_department_sign: dept,
  };
}
function allCases() {
  const out = [];
  const NS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18];
  for (const n of NS) {
    for (const dept of [false, true]) {
      const d = dept ? '-dept' : '';
      out.push([`fan-${n}${d}`, { type: 'fan', n, dept }]);
      out.push([`minor-${n}${d}`, { type: 'minor', n, dept }]);
      out.push([`minor-${n}-measure${d}`, { type: 'minor', n, dept, measure: true }]);
    }
  }
  for (const n of [5, 6, 7]) out.push([`fan-${n}-longrec-dept`, { type: 'fan', n, dept: true, rec: LONG_REC }]);
  out.push(['fan-1-land', { type: 'fan', n: 1, land: true }]);
  out.push(['fan-0photo', { type: 'fan', n: 1, photosOn: 0 }]);
  out.push(['fan-10rows-1photo', { type: 'fan', n: 10, photosOn: 1 }]);
  out.push(['fan-40rows-0photo', { type: 'fan', n: 40, photosOn: 0 }]);
  out.push(['fan-40rows-0photo-dept', { type: 'fan', n: 40, photosOn: 0, dept: true }]);
  return out;
}

// ── ลิงก์ล่องหน (ฝังหลังฟอนต์โหลด = หลัง GRID_FIT_SCRIPT ตัดสิน .fit1 แล้ว) ─────────
const MARK_SCRIPT = `<script>(function () {
  var add = function (el, kind) {
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    var a = document.createElement('a');
    a.href = 'https://mark.invalid/' + kind;
    a.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;';
    el.appendChild(a);
  };
  var run = function () {
    document.querySelectorAll('.major-c').forEach(function (box) {
      if (box.firstElementChild) add(box.firstElementChild, 'head');
      box.querySelectorAll('div').forEach(function (d) {
        if (d.children.length === 0 && /^รูปถ่ายงาน/.test((d.textContent || '').trim())) add(d, 'photohead');
      });
      box.querySelectorAll('.grid-photo-block').forEach(function (b) { add(b, 'block'); });
      box.querySelectorAll('.grid-photo-block img').forEach(function (im) { add(im.parentNode, 'img'); });
      box.querySelectorAll('table.lmt tbody tr td:first-child').forEach(function (td) { add(td, 'row'); });
      box.querySelectorAll('.sign-row > *').forEach(function (s) { add(s, 'sigbox'); });
    });
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(run); else run();
})();</scr` + 'ipt>';

async function readMarks(pdfBuf) {
  const { PDFDocument, PDFName, PDFArray, PDFDict, PDFString } = require('pdf-lib');
  const doc = await PDFDocument.load(pdfBuf);
  return doc.getPages().map((p) => {
    const { height } = p.getSize();
    const annots = p.node.lookup(PDFName.of('Annots'));
    const marks = [];
    if (annots instanceof PDFArray) {
      for (let k = 0; k < annots.size(); k++) {
        const a = annots.lookup(k);
        if (!(a instanceof PDFDict)) continue;
        const act = a.lookup(PDFName.of('A'));
        const uri = act instanceof PDFDict ? act.lookup(PDFName.of('URI')) : null;
        const text = uri instanceof PDFString ? uri.decodeText() : (uri ? String(uri) : '');
        const m = /mark\.invalid\/(\w+)/.exec(text);
        const rect = a.lookup(PDFName.of('Rect'));
        if (!m || !(rect instanceof PDFArray)) continue;
        const [, y1, , y2] = rect.asArray().map((v) => v.asNumber());
        marks.push({ kind: m[1], top: (height - Math.max(y1, y2)) / MM, h: Math.abs(y2 - y1) / MM });
      }
    }
    return { marks };
  });
}

// ── template จาก working tree หรือ commit อื่น (git show ทีละไฟล์ ไม่ต้องใช้ tar) ─────
function loadTemplates(ref) {
  if (!ref) return require(path.join(REPO, 'backend/src/services/reportTemplates'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-pdf-'));
  const git = (args) => execFileSync('git', args, { cwd: REPO, maxBuffer: 256 * 1024 * 1024 });
  const files = git(['ls-tree', '-r', '--name-only', ref, 'backend/src']).toString().split('\n').filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const dest = path.join(dir, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, git(['show', `${ref}:${f}`]));
  }
  return require(path.join(dir, 'backend/src/services/reportTemplates'));
}

function findChrome(explicit) {
  const c = [explicit, process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  return c.find((p) => p && fs.existsSync(p)) || null;
}

// pdfRenderer.htmlToPdf (ทางเดียวกับ prod) ถ้าโหลดได้; ไม่งั้น Chrome CLI + margin ชุดเดียวกับ pdfRenderer
function makeRenderer(chrome) {
  if (chrome && !process.env.PUPPETEER_EXECUTABLE_PATH) process.env.PUPPETEER_EXECUTABLE_PATH = chrome;
  try {
    const { htmlToPdf } = require(path.join(REPO, 'backend/src/services/pdfRenderer'));
    require('puppeteer-core');
    return { name: 'pdfRenderer.htmlToPdf (puppeteer)', render: (html) => htmlToPdf(html) };
  } catch (err) {
    if (!chrome) throw new Error(`puppeteer-core โหลดไม่ได้ (${err.message.split('\n')[0]}) และหา Chrome ไม่เจอ — ใส่ --chrome <path>`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-pdf-cli-'));
    let i = 0;
    return {
      name: `Chrome --print-to-pdf (puppeteer-core โหลดไม่ได้: ${err.message.split('\n')[0].slice(0, 80)})`,
      render: async (html) => {
        const base = path.join(tmp, `c${i++}`);
        fs.writeFileSync(`${base}.html`, html.replace('</head>', '<style>@page{size:A4;margin:10mm 10mm 12mm 10mm}</style></head>'));
        execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=5000',
          `--user-data-dir=${path.join(tmp, 'profile')}`, `--print-to-pdf=${base}.pdf`,
          `file:///${`${base}.html`.replace(/\\/g, '/')}`], { stdio: 'ignore' });
        return fs.readFileSync(`${base}.pdf`);
      },
    };
  }
}

async function runVersion(label, ref, renderer, cases, keepDir) {
  const { buildSimpleReportHtml } = loadTemplates(ref);
  const res = {};
  for (const [name, spec] of cases) {
    const html = buildSimpleReportHtml(caseData(spec)).replace('</body>', `${MARK_SCRIPT}</body>`);
    const pdf = await renderer.render(html);
    if (keepDir) {
      fs.mkdirSync(path.join(keepDir, label), { recursive: true });
      fs.writeFileSync(path.join(keepDir, label, `${name}.pdf`), pdf);
    }
    res[name] = analyzePages(await readMarks(pdf));
  }
  return res;
}

const fmt = (r) => {
  const flags = [r.blank.length && `BLANK${JSON.stringify(r.blank)}`, r.orphanSig && 'ORPHAN-SIG',
    r.sigSplit && 'SIG-SPLIT', r.orphanHead && 'ORPHAN-HEAD', !r.sigPage && 'NO-SIG'].filter(Boolean).join(' ');
  const ph = r.photoH ? `${r.photoH[0]}-${r.photoH[1]}mm` : 'no-photo';
  return `${r.pages}p ${JSON.stringify(r.blocksPerPage)} sig p${r.sigPage}@${r.sigTop} ${ph} ${flags}`.trim();
};
const summary = (label, res) => {
  const v = Object.values(res);
  return `${label}: ${v.length} cases · pages ${v.reduce((s, r) => s + r.pages, 0)} · blank pages `
    + `${v.reduce((s, r) => s + r.blank.length, 0)} · orphan sig ${v.filter((r) => r.orphanSig).length} · `
    + `sig split ${v.filter((r) => r.sigSplit).length} · orphan heading ${v.filter((r) => r.orphanHead).length}`;
};

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const ref = arg('--ref');
  const base = arg('--base');
  const filter = arg('--cases') ? new RegExp(arg('--cases')) : null;
  const keep = arg('--keep');
  const cases = allCases().filter(([n]) => !filter || filter.test(n));
  const renderer = makeRenderer(findChrome(arg('--chrome')));
  console.log(`renderer: ${renderer.name}`);
  const targetLabel = ref || 'working tree';
  const target = await runVersion('target', ref, renderer, cases, keep);
  const before = base ? await runVersion('base', base, renderer, cases, keep) : null;
  let changed = 0;
  for (const [name] of cases) {
    const now = fmt(target[name]);
    if (before) {
      const was = fmt(before[name]);
      const diff = was !== now;
      if (diff) changed++;
      console.log(`${diff ? '*' : ' '} ${name.padEnd(24)} ${was.padEnd(52)} → ${now}`);
    } else {
      console.log(`${isDefect(target[name]) ? '!' : ' '} ${name.padEnd(24)} ${now}`);
    }
  }
  if (before) console.log(summary(`base (${base})`, before));
  console.log(summary(`target (${targetLabel})`, target));
  if (before) console.log(`changed vs base: ${changed} of ${cases.length} cases`);
  const bad = Object.entries(target).filter(([, r]) => isDefect(r)).map(([n]) => n);
  if (bad.length) {
    console.log(`FAIL: ${bad.length} case(s) with blank page / orphan or split signatures / orphan heading: ${bad.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('OK: no blank pages, no orphan/split signatures, no orphan photo heading');
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err && err.stack ? err.stack : err); process.exitCode = 2; });
}

module.exports = { analyzePages, isDefect, allCases, readMarks };
