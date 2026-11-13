// URL รูปจาก DB → URL ที่เบราว์เซอร์โหลดได้ (หน้าเว็บกับ API อยู่คนละโดเมนบน prod). รัน: npm run test
import assert from 'assert';
import { photoSrc } from '../src/lib/photoSrc.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok - ${name}`); };
const API = 'https://api.example.test';

t('path ของ backend ต่อด้วย base ของ API', () => {
  assert.strictEqual(photoSrc('/uploads/photos/ac-repair/b/x.jpg', API), `${API}/uploads/photos/ac-repair/b/x.jpg`);
  assert.strictEqual(photoSrc('uploads/photos/x.jpg', API), `${API}/uploads/photos/x.jpg`);
});

t('ไม่มี base (dev proxy / same-origin) = path เดิม', () => {
  assert.strictEqual(photoSrc('/uploads/x.jpg'), '/uploads/x.jpg');
  assert.strictEqual(photoSrc('/uploads/x.jpg', ''), '/uploads/x.jpg');
});

t('URL เต็มและ data: ไม่แตะ', () => {
  assert.strictEqual(photoSrc('https://cdn.example/x.jpg', API), 'https://cdn.example/x.jpg');
  assert.strictEqual(photoSrc('http://old.example/x.jpg', API), 'http://old.example/x.jpg');
  assert.strictEqual(photoSrc('data:image/png;base64,AAAA', API), 'data:image/png;base64,AAAA');
});

t('ค่าว่าง = ว่าง', () => {
  assert.strictEqual(photoSrc('', API), '');
  assert.strictEqual(photoSrc(null, API), '');
  assert.strictEqual(photoSrc(undefined, API), '');
});

console.log(`\n${pass} passed`);
