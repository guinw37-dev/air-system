// acMemoPdf — HTML สำหรับ MEMO ขออนุมัติจัดซื้ออะไหล่แอร์ (พิมพ์เป็น PDF ผ่าน
// pdfRenderer). โครงเดียวกับ Memo ฝั่ง repair-system (4 ช่องเซ็น TW/รพ.) แต่
// หัวเอกสารโทนฟ้า-ขาว + ระบุระบบ Air และเนื้อหาย่อกว่า (Worawit 20 Aug 2026).
const BLUE = '#0284C7';
const BLUE_SOFT = '#E0F2FE';
const BLUE_DEEP = '#075985';
const NAVY = '#1f2937';

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dash = (s) => (String(s ?? '').trim() ? esc(s) : '—');
const thDate = (d) => {
  const dt = d ? new Date(d) : new Date();
  return `${dt.getDate()} ${TH_MONTHS[dt.getMonth()]} ${dt.getFullYear() + 543}`;
};
const qtyOf = (v) => parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;
const priceOf = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const thb = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function signBox(title, signer) {
  const s = signer || {};
  return `<div class="sig">
    <div class="sig-t">${esc(title)}</div>
    <div class="sig-line"></div>
    <div class="sig-n">( ${dash(s.name)} )</div>
    <div class="sig-p">${dash(s.pos)}</div>
    <div class="sig-p">${dash(s.org)}</div>
    <div class="sig-p">วันที่ ............ / ............ / ............</div>
  </div>`;
}

function buildAcMemoHtml(memo, job, branch) {
  const m = memo || {};
  const j = job || {};
  const parts = Array.isArray(m.parts) ? m.parts : [];
  const total = parts.reduce((s, p) => s + qtyOf(p.qty) * priceOf(p.unit_price), 0);
  const signers = m.signers || {};
  const place = [j.building && `อาคาร ${j.building}`, j.floor && `ชั้น ${j.floor}`, j.department]
    .filter(Boolean).join(' ');
  const rows = parts.filter((p) => String(p.name || '').trim()).map((p, i) => `<tr>
    <td class="c">${i + 1}</td><td>${esc(p.name)}</td><td class="c">${dash(p.qty)}</td>
    <td class="r">${priceOf(p.unit_price) > 0 ? thb(priceOf(p.unit_price)) : '—'}</td>
    <td class="r">${qtyOf(p.qty) * priceOf(p.unit_price) > 0 ? thb(qtyOf(p.qty) * priceOf(p.unit_price)) : '—'}</td>
    <td>${esc(p.note || '')}</td></tr>`).join('')
    || `<tr><td colspan="6" class="c" style="color:#888">— ไม่มีรายการอะไหล่ —</td></tr>`;

  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"/>
<title>${esc(m.memo_number || 'MEMO')}</title>
<style>
  *{box-sizing:border-box} body{font-family:'Sarabun','TH Sarabun New',sans-serif;color:${NAVY};margin:0;padding:26px 30px;font-size:14px}
  .bar{background:${BLUE};color:#fff;border-radius:10px;padding:12px 18px;display:flex;justify-content:space-between;align-items:center}
  .bar .t1{font-size:20px;font-weight:700}
  .bar .t2{font-size:11px;opacity:.92}
  .bar .sys{background:#fff;color:${BLUE};font-weight:700;border-radius:8px;padding:4px 12px;font-size:13px}
  .meta{display:flex;justify-content:space-between;margin:12px 2px 4px;font-size:13px}
  .meta b{color:${BLUE}}
  .field{margin:7px 2px;font-size:14px}
  .field .k{font-weight:700;display:inline-block;min-width:52px}
  .refbox{background:${BLUE_SOFT};border:1px solid ${BLUE};border-radius:8px;padding:8px 12px;margin:10px 0;font-size:13px}
  .refbox b{color:${BLUE_DEEP}}
  table{width:100%;border-collapse:collapse;margin:10px 0 4px;font-size:13px}
  th{background:${BLUE};color:#fff;padding:6px 8px;font-weight:700;border:1px solid ${BLUE}}
  td{border:1px solid #ddd;padding:5px 8px}
  .c{text-align:center} .r{text-align:right}
  tr.total td{background:${BLUE_SOFT};font-weight:700;color:${BLUE_DEEP};border-color:${BLUE}}
  .reason{margin:8px 2px;font-size:14px}
  .sigs{display:grid;grid-template-columns:1fr 1fr;gap:14px 26px;margin-top:22px}
  .sig{text-align:center;font-size:13px}
  .sig-t{font-weight:700;margin-bottom:34px}
  .sig-line{border-bottom:1px dotted #555;width:78%;margin:0 auto 6px}
  .sig-n{font-weight:600}
  .sig-p{color:#555;font-size:12px;margin-top:2px}
  .foot{margin-top:20px;border-top:1px solid #eee;padding-top:6px;font-size:10.5px;color:#999;display:flex;justify-content:space-between}
</style></head><body>
  <div class="bar">
    <div>
      <div class="t1">MEMO | บันทึกข้อความ — ขออนุมัติจัดซื้ออะไหล่</div>
      <div class="t2">บริษัท เทคนิคอล วอเตอร์ จำกัด (TECHNICAL WATER CO., LTD.)</div>
    </div>
    <div class="sys">ระบบ Air ❄</div>
  </div>
  <div class="meta">
    <span>เลขที่ <b>${esc(m.memo_number || '')}</b></span>
    <span>วันที่ ${thDate(m.created_at)}</span>
  </div>
  <div class="field"><span class="k">เรียน</span> ${dash(m.to_line)}</div>
  <div class="field"><span class="k">จาก</span> ${dash(m.from_line)}</div>
  <div class="field"><span class="k">เรื่อง</span> ${dash(m.subject)}</div>
  <div class="refbox">
    <b>อ้างอิงใบงานซ่อมแอร์:</b> ${dash(j.job_number)} · ${dash(place)}<br/>
    <b>อาการ:</b> ${dash(j.description)}
  </div>
  <table>
    <thead><tr>
      <th style="width:6%">#</th><th>รายการอะไหล่</th><th style="width:10%">จำนวน</th>
      <th style="width:14%">ราคา/หน่วย</th><th style="width:14%">รวม (บาท)</th><th style="width:18%">หมายเหตุ</th>
    </tr></thead>
    <tbody>${rows}
      ${total > 0 ? `<tr class="total"><td colspan="4" class="r">รวมทั้งสิ้น (บาท)</td><td class="r">${thb(total)}</td><td></td></tr>` : ''}
    </tbody>
  </table>
  ${m.reason ? `<div class="reason"><b>เหตุผลความจำเป็น:</b> ${esc(m.reason)}</div>` : ''}
  <div class="reason">จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ</div>
  <div class="sigs">
    ${signBox('ผู้ขออนุมัติ', signers.requester)}
    ${signBox('ผู้เห็นชอบ', signers.reviewer)}
    ${signBox('ผู้ตรวจสอบ', signers.inspector)}
    ${signBox('ผู้อนุมัติ', signers.approver)}
  </div>
  <div class="foot">
    <span>TECHNICAL WATER CO., LTD. | ${esc(branch?.name || '')} | ระบบ Air — งานซ่อมเครื่องปรับอากาศ</span>
    <span>${esc(m.memo_number || '')}</span>
  </div>
</body></html>`;
}

module.exports = { buildAcMemoHtml };
