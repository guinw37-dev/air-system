// คณิตของ SignaturePad — pure, ไม่ต้องมี DOM. รัน: npm run test
import assert from 'assert';
import { createRequire } from 'module';
import { SIG_W, SIG_H, padBitmapSize, toCanvasPoint } from '../src/lib/signaturePad.js';

const require = createRequire(import.meta.url);
const { SIG_MAX_CHARS } = require('../../backend/src/utils/signature.js');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok - ${name}`); };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// กล่องที่เจอจริงใน browser (วัดด้วย getBoundingClientRect): modal เซ็นบนคอม 468×234, มือถือ 375px 331×165.5
const DESKTOP = { left: 278, top: 292, width: 468, height: 234 };
const PHONE = { left: 22, top: 566, width: 331, height: 165.5 };

t('จุดที่นิ้วแตะ = จุดที่หมึกลง (เทียบเป็นสัดส่วนของกล่อง) ทุกขนาด bitmap', () => {
  for (const rect of [DESKTOP, PHONE]) {
    for (const [bw, bh] of [[320, 160], padBitmapSize(rect.width, 1), padBitmapSize(rect.width, 3)]) {
      for (const [fx, fy] of [[0, 0], [0.5, 0.5], [0.95, 0.8], [1, 1]]) {
        const [x, y] = toCanvasPoint(rect.left + fx * rect.width, rect.top + fy * rect.height, rect, bw, bh);
        near(x / bw, fx);
        near(y / bh, fy);
      }
    }
  }
});

t('บั๊กเดิม: กล่อง 468px + bitmap 320 — ขวาสุดของกล่องต้องได้ x = 320 ไม่ใช่ 468 (เลยขอบ = วาดไม่ติด)', () => {
  const [x, y] = toCanvasPoint(DESKTOP.left + 468, DESKTOP.top + 234, DESKTOP, 320, 160);
  near(x, 320);
  near(y, 160);
  const [mx] = toCanvasPoint(DESKTOP.left + 400, DESKTOP.top, DESKTOP, 320, 160);
  assert.ok(mx < 320, `x=${mx} ต้องอยู่ใน bitmap`);
});

t('กล่องยังไม่มีขนาด (width 0) ไม่หารศูนย์', () => {
  const [x, y] = toCanvasPoint(10, 20, { left: 0, top: 0, width: 0, height: 0 }, 320, 160);
  assert.deepStrictEqual([x, y], [10, 20]);
});

t('ขนาด bitmap: ตามจอ × dpr, อัตราส่วน 2:1, ไม่ต่ำกว่า 320×160, ไม่เกิน 4 เท่า', () => {
  assert.deepStrictEqual(padBitmapSize(468, 1), [468, 234]);
  assert.deepStrictEqual(padBitmapSize(331, 2), [662, 331]);
  assert.deepStrictEqual(padBitmapSize(331, 3), [993, 497]);
  assert.deepStrictEqual(padBitmapSize(200, 1), [320, 160]);      // กล่องเล็กกว่ารูปส่งออก
  assert.deepStrictEqual(padBitmapSize(700, 3), [1280, 640]);     // จอใหญ่ถูกจำกัด
  assert.deepStrictEqual(padBitmapSize(0, 2), [320, 160]);        // กล่องซ่อนอยู่
  assert.deepStrictEqual(padBitmapSize(NaN, undefined), [320, 160]);
  assert.deepStrictEqual(padBitmapSize(468, 0), [468, 234]);      // dpr แปลก ๆ = 1
});

t('รูปส่งออก 320×160 แย่สุด (PNG ไม่บีบอัด) ยังต่ำกว่าเพดานของ backend', () => {
  // PNG RGBA ไม่บีบอัดเลย: 1 byte filter + 4 byte/พิกเซล ต่อแถว, บวก overhead ของ zlib/chunk เผื่อ 1% + 1 KB
  const raw = SIG_H * (1 + SIG_W * 4);
  const worstPng = Math.ceil(raw * 1.01) + 1024;
  const worstChars = 'data:image/png;base64,'.length + Math.ceil(worstPng / 3) * 4;
  assert.ok(worstChars < SIG_MAX_CHARS, `${worstChars} >= ${SIG_MAX_CHARS}`);
});

console.log(`\n${pass} passed`);
