// Tests for scripts/check-grid-pdf.js's page analyser (pure, no Chrome).
// analyzePages(pages) takes the per-page link markers read back from the PDF
// (kind + top/h in mm) and decides blank pages / orphan or split signatures /
// orphan photo heading. Run: node test/gridPdfCheck.test.js
const assert = require('assert');
const { analyzePages, isDefect, allCases } = require('../scripts/check-grid-pdf');

let passed = 0;
const ok = (n) => { passed++; console.log(`  ok - ${n}`); };

const m = (kind, top, h = 5) => ({ kind, top, h });
const head = m('head', 24);
const row = (top) => m('row', top, 3);
const block = (top) => m('block', top, 25);
const img = (top, h = 18.7) => m('img', top, h);
const sigs = (top, h = 20) => [1, 2, 3, 4].map(() => m('sigbox', top, h));

// หน้าเดียวปกติ
let r = analyzePages([{ marks: [head, row(80), m('photohead', 94), block(100), img(106, 54.2), ...sigs(238)] }]);
assert.deepStrictEqual([r.pages, r.blank, r.sigPage, r.orphanSig, r.sigSplit, r.orphanHead], [1, [], 1, false, false, false]);
assert.deepStrictEqual(r.photoH, [54.2, 54.2]);
assert.strictEqual(r.sigTop, 238);
assert.strictEqual(isDefect(r), false);
ok('one-page sheet: no defects, photo height and signature position reported');

// หน้าแรกว่าง (Chrome flex — พัดลม 9 เครื่อง บน 239ccb7)
r = analyzePages([{ marks: [] }, { marks: [head, row(80), block(120)] }, { marks: [block(10), ...sigs(90)] }]);
assert.deepStrictEqual(r.blank, [1]);
assert.strictEqual(isDefect(r), true);
ok('blank first page detected');

// หน้าว่างต่อท้าย (padding ล้น — 14 เครื่อง)
r = analyzePages([{ marks: [head, block(150)] }, { marks: [block(10), ...sigs(250)] }, { marks: [] }]);
assert.deepStrictEqual([r.blank, r.sigPage], [[3], 2]);
assert.strictEqual(isDefect(r), true);
ok('trailing blank page detected');

// ช่องเซ็นอยู่หน้าโดด ๆ + ช่องเซ็นถูกตัดกลาง (6 เครื่อง บน 239ccb7: ช่องว่างเซ็น 6.8mm ท้ายหน้า 1)
r = analyzePages([{ marks: [head, row(80), block(250), ...sigs(278.3, 6.8)] }, { marks: [...sigs(10.1, 11.5)] }]);
assert.deepStrictEqual([r.sigPage, r.orphanSig, r.sigSplit], [2, true, true]);
assert.strictEqual(isDefect(r), true);
ok('orphan signature page and split signature boxes detected');

// ช่องเซ็นหน้า 2 พร้อมเครื่องสุดท้าย = ไม่ใช่ orphan; มีแค่แถวตาราง (ไม่มีรูป) ก็ไม่ใช่
r = analyzePages([{ marks: [head, block(200)] }, { marks: [block(10), ...sigs(40)] }]);
assert.deepStrictEqual([r.orphanSig, r.sigSplit, isDefect(r)], [false, false, false]);
r = analyzePages([{ marks: [head, row(80)] }, { marks: [row(10), ...sigs(30)] }]);
assert.strictEqual(r.orphanSig, false);
ok('signatures with the last machine or table rows on page 2 are fine');

// หัว "รูปถ่ายงาน…" ท้ายหน้าโดยไม่มีกล่องรูปตามมาในหน้าเดียวกัน
r = analyzePages([{ marks: [head, row(80), block(100), m('photohead', 280)] }, { marks: [block(10), ...sigs(60)] }]);
assert.strictEqual(r.orphanHead, true);
r = analyzePages([{ marks: [head, m('photohead', 90), block(96)] }, { marks: [block(10), ...sigs(60)] }]);
assert.strictEqual(r.orphanHead, false);
ok('orphan photo heading detected only when no block follows it on that page');

// ไม่เจอช่องเซ็นเลย = ตรวจไม่ได้ → นับเป็น defect (กันลิงก์ล่องหนหาย แล้วรายงานว่าผ่าน)
r = analyzePages([{ marks: [head, block(100)] }]);
assert.strictEqual(r.sigPage, null);
assert.strictEqual(isDefect(r), true);
ok('missing signature markers count as a failure, not a pass');

// ชุดเคสครอบ 1–14 + 18 เครื่อง ทุกแบบ
const names = allCases().map(([n]) => n);
for (const n of [1, 5, 6, 7, 9, 14, 18]) {
  for (const t of ['fan', 'minor', 'minor-X-measure']) {
    const name = t.includes('X') ? t.replace('X', n) : `${t}-${n}`;
    assert(names.includes(name) && names.includes(`${name}-dept`), `case ${name}(+dept) present`);
  }
}
assert(new Set(names).size === names.length, 'case names unique');
assert(names.length >= 98, 'at least 98 cases');
ok('case matrix covers 1-14 and 18 machines for fan / minor / minor+measure, with and without dept sign');

console.log(`\n${passed} passed`);
