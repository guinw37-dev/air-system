// washRangePptx — deck รายงานล้างแอร์ตามช่วงวันที่ (Theme3: TW Corporate Infographic)
// โครงหน้าแบบ infographic (แบนเนอร์มุมมน + KPI การ์ด + กราฟ + กล่องสรุป) คุมด้วย
// เอกลักษณ์ Theme1: navy 002060 ตัวเหลือง FFC000, หัวตาราง 2F5597, กราฟจริงน้ำเงิน
// 0033CC, footer TECHNICAL WATER + "ที่มา:" ใต้ตาราง/กราฟทุกตัว. ฟอนต์ Prompt.
const PptxGenJS = require('pptxgenjs');

const C = {
  navy: '002060', yellow: 'FFC000', head: '2F5597', bg: 'F1F5FA',
  border: 'D9E2EF', line: 'E1E8F2', rowAlt: 'F7FAFD',
  blue: '4472C4', blueSoft: 'DEEBF7', orange: 'ED7D31', orangeSoft: 'FBE5D6',
  green: '548235', greenSoft: 'E2F0D9', gold: 'FFC000', goldSoft: 'FFF2CC',
  red: 'C00000', redSoft: 'FDEBEB', ok: '00B050', gray: 'A5A5A5',
  actual: '0033CC', text: '1F2937', sub: '64748B',
};
const FONT = 'Prompt';
const W = 13.33, H = 7.5;

const WT = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลมระบายอากาศ' };
const WT_COLOR = { major: '002060', minor: '4472C4', fan: 'A5A5A5' };
const ISSUE_LABEL = {
  insulation: 'ฉนวนเสื่อมสภาพ', drain_pan: 'ถาดน้ำทิ้งเสื่อมสภาพ', pipe_rust: 'ท่อเป็นสนิม',
  coil: 'คอยล์ผุ/เสื่อม', fan_motor: 'มอเตอร์/พัดลมเสื่อม', capacitor: 'แคปาซิเตอร์เสื่อม',
  electrical: 'แผงไฟ/สายไฟเสื่อม', compressor: 'คอมเพรสเซอร์เสื่อม', refrigerant: 'น้ำยารั่ว/ขาด',
  remote: 'รีโมท/คอนโทรลเสีย', age_5_7: 'อายุ 5-7 ปี', age_over_7: 'อายุเกิน 7 ปี',
};
const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thDate = (ymd) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${TH_M[m - 1]} ${y + 543}`;
};
const thDateShort = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${TH_M[m - 1]} ${String(y + 543).slice(2)}`;
};
const pctOf = (done, total) => (total > 0 ? Math.round((done / total) * 100) : 0);
const nf = (n) => Number(n || 0).toLocaleString('en-US');

function buildWashRangeDeck(model) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'TW', width: W, height: H });
  pptx.layout = 'TW';
  const rangeTxt = `${thDate(model.from)} – ${thDate(model.to)}`;
  const branch = model.branch?.name || '';
  let pageNo = 0;

  // ── ชิ้นส่วนใช้ซ้ำ ──────────────────────────────────────────────────────────
  const footer = (s) => {
    pageNo += 1;
    s.addShape('line', { x: 0.5, y: H - 0.52, w: W - 1.0, h: 0, line: { color: C.line, width: 1 } });
    s.addText(`TECHNICAL WATER CO., LTD. | ${branch} | รายงานงานล้างแอร์ ${rangeTxt}`, {
      x: 0.5, y: H - 0.48, w: 8.6, h: 0.3, fontFace: FONT, fontSize: 9, color: C.sub,
    });
    s.addText('* จัดทำเพื่อการบริหารจัดการภายในเท่านั้น', {
      x: 0.5, y: H - 0.28, w: 5, h: 0.22, fontFace: FONT, fontSize: 8, italic: true, color: C.gray,
    });
    s.addText(`📅 ข้อมูล ณ วันที่ ${thDate(model.to)}   หน้า ${pageNo}`, {
      x: W - 3.6, y: H - 0.48, w: 3.1, h: 0.3, align: 'right', fontFace: FONT, fontSize: 9,
      bold: true, color: C.navy,
    });
  };
  const banner = (s, title, sub) => {
    s.addShape('roundRect', { x: 0.5, y: 0.32, w: W - 1.0, h: 0.95, rectRadius: 0.09, fill: { color: C.navy } });
    s.addText(title, { x: 0.85, y: 0.36, w: W - 1.8, h: 0.52, fontFace: FONT, fontSize: 20, bold: true, color: C.yellow });
    s.addText(sub, { x: 0.85, y: 0.84, w: W - 1.8, h: 0.36, fontFace: FONT, fontSize: 11, color: 'E8EDF7' });
  };
  const source = (s, x, y, w) => s.addText('ที่มา: ระบบ Air System (ใบงานล้าง simple work orders)', {
    x, y, w, h: 0.22, fontFace: FONT, fontSize: 8, italic: true, color: C.gray,
  });
  const newSlide = () => { const s = pptx.addSlide(); s.background = { color: C.bg }; return s; };

  // ── Slide 1: ปก ─────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide();
    s.background = { color: C.navy };
    s.addShape('rect', { x: 0, y: 4.9, w: W, h: 0.06, fill: { color: C.yellow } });
    s.addText('Air Conditioner Cleaning Report', {
      x: 0.9, y: 2.1, w: W - 1.8, h: 0.8, fontFace: FONT, fontSize: 34, bold: true, color: C.yellow,
    });
    s.addText('รายงานสรุปงานล้างเครื่องปรับอากาศ พร้อมรายละเอียดส่งงาน', {
      x: 0.9, y: 2.95, w: W - 1.8, h: 0.5, fontFace: FONT, fontSize: 18, color: 'FFFFFF',
    });
    s.addText(branch, { x: 0.9, y: 3.75, w: W - 1.8, h: 0.45, fontFace: FONT, fontSize: 16, bold: true, color: 'FFFFFF' });
    s.addText(`ช่วงข้อมูล : ${rangeTxt}`, { x: 0.9, y: 4.25, w: W - 1.8, h: 0.4, fontFace: FONT, fontSize: 14, color: 'D6E0F0' });
    s.addText('TECHNICAL WATER CO., LTD.', {
      x: 0.9, y: 5.3, w: W - 1.8, h: 0.4, fontFace: FONT, fontSize: 12, bold: true, color: C.yellow,
    });
  }

  // ── Slide 2: Dashboard KPI ─────────────────────────────────────────────────
  {
    const s = newSlide();
    banner(s, 'Executive Dashboard | สรุปภาพรวมงานล้าง', `${branch} · ${rangeTxt} (${model.days} วัน)`);
    const t = Object.fromEntries(model.totals.map((x) => [x.work_type, x]));
    const okPct = pctOf(model.result.ok, model.result.ok + model.result.not_ok);
    const condTotal = model.conditionIssues.reduce((sum, i) => sum + i.count, 0);
    const kpis = [
      { icon: '🌀', label: 'ยอดล้างรวม (เครื่อง)', val: nf(model.grand.done), color: C.navy, soft: C.blueSoft },
      { icon: '🧰', label: `ล้างใหญ่ · ${nf(t.major?.orders)} ใบงาน`, val: nf(t.major?.done), color: C.blue, soft: C.blueSoft },
      { icon: '🧹', label: `ล้างย่อย · ${nf(t.minor?.orders)} ใบงาน`, val: nf(t.minor?.done), color: C.orange, soft: C.orangeSoft },
      { icon: '🌬️', label: `พัดลม · ${nf(t.fan?.orders)} ใบงาน`, val: nf(t.fan?.done), color: C.green, soft: C.greenSoft },
      { icon: '⚠️', label: 'พบอาการเสื่อม (รายการ)', val: nf(condTotal), color: condTotal ? C.red : C.ok, soft: condTotal ? C.redSoft : C.greenSoft },
    ];
    const cw = 2.35, gap = 0.13, x0 = 0.5;
    kpis.forEach((k, i) => {
      const x = x0 + i * (cw + gap);
      s.addShape('roundRect', { x, y: 1.55, w: cw, h: 1.55, rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: C.border, width: 1 } });
      s.addShape('ellipse', { x: x + 0.18, y: 1.75, w: 0.5, h: 0.5, fill: { color: k.soft } });
      s.addText(k.icon, { x: x + 0.18, y: 1.75, w: 0.5, h: 0.5, align: 'center', valign: 'middle', fontSize: 14 });
      s.addText(k.val, { x: x + 0.72, y: 1.7, w: cw - 0.8, h: 0.62, fontFace: FONT, fontSize: 26, bold: true, color: k.color });
      s.addText(k.label, { x: x + 0.15, y: 2.42, w: cw - 0.3, h: 0.55, fontFace: FONT, fontSize: 9.5, color: C.sub });
    });

    // ตารางสรุปต่อประเภท (ซ้าย) + กล่องสรุปภาพรวม (ขวา)
    const rows = [[
      { text: 'ประเภทงาน', options: { bold: true, color: 'FFFFFF', fill: { color: C.head } } },
      { text: 'จำนวนใบงาน', options: { bold: true, color: 'FFFFFF', fill: { color: C.head }, align: 'right' } },
      { text: 'จำนวนเครื่อง', options: { bold: true, color: 'FFFFFF', fill: { color: C.head }, align: 'right' } },
      { text: 'สัดส่วน', options: { bold: true, color: 'FFFFFF', fill: { color: C.head }, align: 'right' } },
    ]];
    model.totals.forEach((x, i) => rows.push([
      { text: WT[x.work_type] || x.work_type, options: { fill: { color: i % 2 ? C.rowAlt : 'FFFFFF' } } },
      { text: nf(x.orders), options: { align: 'right', fill: { color: i % 2 ? C.rowAlt : 'FFFFFF' } } },
      { text: nf(x.done), options: { align: 'right', bold: true, color: C.navy, fill: { color: i % 2 ? C.rowAlt : 'FFFFFF' } } },
      { text: `${pctOf(x.done, model.grand.done)}%`, options: { align: 'right', fill: { color: i % 2 ? C.rowAlt : 'FFFFFF' } } },
    ]));
    rows.push([
      { text: 'รวมทั้งหมด', options: { bold: true, color: 'FFFFFF', fill: { color: C.navy } } },
      { text: nf(model.grand.orders), options: { align: 'right', bold: true, color: 'FFFFFF', fill: { color: C.navy } } },
      { text: nf(model.grand.done), options: { align: 'right', bold: true, color: C.yellow, fill: { color: C.navy } } },
      { text: '100%', options: { align: 'right', bold: true, color: 'FFFFFF', fill: { color: C.navy } } },
    ]);
    s.addTable(rows, {
      x: 0.5, y: 3.4, w: 6.6, colW: [2.4, 1.4, 1.4, 1.4], fontFace: FONT, fontSize: 11,
      color: C.text, border: { type: 'solid', color: C.line, pt: 0.75 }, rowH: 0.34, valign: 'middle',
    });
    source(s, 0.5, 5.6, 6.6);

    const avgPerDay = model.days > 0 ? Math.round(model.grand.done / model.days) : 0;
    const topLoc = model.byLocation[0];
    const ap = model.approval || { approved: { done: 0 }, pending: { done: 0 } };
    const bullets = [
      `ช่วง ${rangeTxt} ล้างรวม ${nf(model.grand.done)} เครื่อง จาก ${nf(model.grand.orders)} ใบงาน (เฉลี่ย ${nf(avgPerDay)} เครื่อง/วัน)`,
      ap.pending.done > 0
        ? `ใบงานอนุมัติแล้ว ${nf(ap.approved.done)} เครื่อง · อยู่ระหว่างรอเซ็น/ตรวจ ${nf(ap.pending.done)} เครื่อง`
        : `ใบงานทั้งหมดอนุมัติครบแล้ว (${nf(ap.approved.done)} เครื่อง)`,
      `ผลการล้างผ่าน ${nf(model.result.ok)} ใบงาน (${okPct}%)` + (model.result.not_ok ? ` · ไม่ผ่าน ${nf(model.result.not_ok)} ใบงาน` : ''),
      topLoc ? `พื้นที่ที่ล้างมากที่สุด: ${topLoc.location} (${nf(topLoc.done)} เครื่อง)` : null,
      condTotal ? `ตรวจพบอาการเสื่อมสภาพ ${nf(condTotal)} รายการ — ดูรายละเอียดหน้าสภาพเครื่อง` : 'ไม่พบรายการแจ้งสภาพเสื่อมในช่วงนี้',
      model.orders_truncated ? `⚠ ใบงานเกิน ${model.order_cap} ใบ — ตารางรายละเอียดแสดง ${model.order_cap} ใบแรก` : null,
    ].filter(Boolean);
    s.addShape('roundRect', { x: 7.35, y: 3.4, w: 5.48, h: 2.5, rectRadius: 0.08, fill: { color: C.blueSoft } });
    s.addText('📋 สรุปภาพรวม', { x: 7.55, y: 3.5, w: 5.1, h: 0.34, fontFace: FONT, fontSize: 13, bold: true, color: C.navy });
    s.addText(bullets.map((b) => ({ text: b, options: { bullet: { characterCode: '2022', indent: 12 }, breakLine: true } })), {
      x: 7.55, y: 3.86, w: 5.15, h: 1.95, fontFace: FONT, fontSize: 10.5, color: C.text, valign: 'top', lineSpacing: 16,
    });
    footer(s);
  }

  // ── Slide 3: กราฟรายวัน ────────────────────────────────────────────────────
  {
    const s = newSlide();
    banner(s, 'Daily Output | ยอดล้างรายวัน', `${branch} · ${rangeTxt}`);
    // ช่วงยาว → รวมเป็นรายเดือนกันแกน x แน่น
    const byMonth = model.days > 62;
    let points = model.daily;
    if (byMonth) {
      const m = {};
      for (const d of model.daily) {
        const k = d.date.slice(0, 7);
        m[k] = m[k] || { label: `${TH_M[Number(k.slice(5)) - 1]} ${String(Number(k.slice(0, 4)) + 543).slice(2)}`, major: 0, minor: 0, fan: 0 };
        m[k].major += d.major; m[k].minor += d.minor; m[k].fan += d.fan;
      }
      points = Object.keys(m).sort().map((k) => m[k]);
    } else {
      points = model.daily.map((d) => ({ ...d, label: thDateShort(d.date) }));
    }
    s.addShape('roundRect', { x: 0.5, y: 1.55, w: W - 1.0, h: 4.55, rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: C.border, width: 1 } });
    if (points.length) {
      const chartData = ['major', 'minor', 'fan'].map((wt) => ({
        name: WT[wt], labels: points.map((p) => p.label), values: points.map((p) => p[wt]),
      }));
      s.addChart('bar', chartData, {
        x: 0.75, y: 1.75, w: W - 1.5, h: 4.0, barGrouping: 'stacked',
        chartColors: [WT_COLOR.major, WT_COLOR.minor, WT_COLOR.fan],
        catAxisLabelFontFace: FONT, catAxisLabelFontSize: points.length > 20 ? 7 : 9,
        valAxisLabelFontFace: FONT, valAxisLabelFontSize: 9,
        showLegend: true, legendPos: 'b', legendFontFace: FONT, legendFontSize: 10,
        dataLabelFontFace: FONT, showValue: points.length <= 14, dataLabelFontSize: 8,
        valGridLine: { color: C.line, style: 'solid', size: 1 }, catGridLine: { style: 'none' },
      });
    } else {
      s.addText('ไม่มีข้อมูลงานล้างในช่วงที่เลือก', { x: 0.75, y: 3.3, w: W - 1.5, h: 0.5, align: 'center', fontFace: FONT, fontSize: 14, color: C.sub });
    }
    source(s, 0.75, 6.14, 6);
    footer(s);
  }

  // ── Slide 4: แยกชนิดแอร์ + สถานที่ ─────────────────────────────────────────
  {
    const s = newSlide();
    banner(s, 'Breakdown | แยกชนิดเครื่อง และพื้นที่', `${branch} · ${rangeTxt}`);
    // ซ้าย: ac_type ต่อประเภทงาน
    const acRows = [[
      { text: 'ประเภทงาน / ชนิดเครื่อง', options: { bold: true, color: 'FFFFFF', fill: { color: C.head } } },
      { text: 'จำนวนเครื่อง', options: { bold: true, color: 'FFFFFF', fill: { color: C.head }, align: 'right' } },
    ]];
    for (const g of model.byAcType) {
      acRows.push([{
        text: WT[g.work_type] || g.work_type,
        options: { bold: true, color: C.navy, fill: { color: C.blueSoft }, colspan: 2 },
      }]);
      g.rows.forEach((r, i) => acRows.push([
        { text: `   ${r.ac_type}`, options: { fill: { color: i % 2 ? C.rowAlt : 'FFFFFF' } } },
        { text: nf(r.done), options: { align: 'right', bold: true, color: C.navy, fill: { color: i % 2 ? C.rowAlt : 'FFFFFF' } } },
      ]));
    }
    if (model.byAcType.length) {
      s.addTable(acRows, {
        x: 0.5, y: 1.55, w: 5.9, colW: [4.3, 1.6], fontFace: FONT, fontSize: 10,
        color: C.text, border: { type: 'solid', color: C.line, pt: 0.75 }, rowH: 0.28, valign: 'middle',
      });
      source(s, 0.5, Math.min(6.3, 1.55 + acRows.length * 0.3 + 0.1), 5.9);
    }
    // ขวา: สถานที่ top
    const locRows = [[
      { text: 'พื้นที่ / สถานที่', options: { bold: true, color: 'FFFFFF', fill: { color: C.head } } },
      { text: 'ใบงาน', options: { bold: true, color: 'FFFFFF', fill: { color: C.head }, align: 'right' } },
      { text: 'เครื่อง', options: { bold: true, color: 'FFFFFF', fill: { color: C.head }, align: 'right' } },
    ]];
    model.byLocation.forEach((r, i) => locRows.push([
      { text: r.location.length > 45 ? `${r.location.slice(0, 44)}…` : r.location, options: { fill: { color: i % 2 ? C.rowAlt : 'FFFFFF' } } },
      { text: nf(r.orders), options: { align: 'right', fill: { color: i % 2 ? C.rowAlt : 'FFFFFF' } } },
      { text: nf(r.done), options: { align: 'right', bold: true, color: C.navy, fill: { color: i % 2 ? C.rowAlt : 'FFFFFF' } } },
    ]));
    if (model.byLocation.length) {
      s.addTable(locRows, {
        x: 6.75, y: 1.55, w: 6.08, colW: [4.28, 0.9, 0.9], fontFace: FONT, fontSize: 10,
        color: C.text, border: { type: 'solid', color: C.line, pt: 0.75 }, rowH: 0.28, valign: 'middle',
      });
      source(s, 6.75, Math.min(6.3, 1.55 + locRows.length * 0.3 + 0.1), 6.08);
    }
    if (!model.byAcType.length && !model.byLocation.length) {
      s.addText('ไม่มีข้อมูลในช่วงที่เลือก', { x: 0.5, y: 3.3, w: W - 1, h: 0.5, align: 'center', fontFace: FONT, fontSize: 14, color: C.sub });
    }
    footer(s);
  }

  // ── Slide 5: สภาพเครื่องเสื่อม (ถ้ามี) ─────────────────────────────────────
  if (model.conditionIssues.length) {
    const s = newSlide();
    banner(s, 'Asset Condition | สภาพเครื่องที่ตรวจพบระหว่างล้าง', `${branch} · ${rangeTxt}`);
    const rows = [[
      { text: 'อาการที่ตรวจพบ', options: { bold: true, color: 'FFFFFF', fill: { color: C.head } } },
      { text: 'จำนวน (เครื่อง)', options: { bold: true, color: 'FFFFFF', fill: { color: C.head }, align: 'right' } },
    ]];
    model.conditionIssues.forEach((r, i) => rows.push([
      { text: ISSUE_LABEL[r.issue] || r.issue, options: { fill: { color: i % 2 ? C.rowAlt : 'FFFFFF' } } },
      { text: nf(r.count), options: { align: 'right', bold: true, color: C.red, fill: { color: i % 2 ? C.rowAlt : 'FFFFFF' } } },
    ]));
    s.addTable(rows, {
      x: 0.5, y: 1.55, w: 6.6, colW: [4.9, 1.7], fontFace: FONT, fontSize: 11,
      color: C.text, border: { type: 'solid', color: C.line, pt: 0.75 }, rowH: 0.32, valign: 'middle',
    });
    source(s, 0.5, Math.min(6.3, 1.55 + rows.length * 0.34 + 0.1), 6.6);
    const total = model.conditionIssues.reduce((sum, i) => sum + i.count, 0);
    s.addShape('roundRect', { x: 7.35, y: 1.55, w: 5.48, h: 1.9, rectRadius: 0.08, fill: { color: C.redSoft } });
    s.addText('⚠️ ข้อเสนอแนะ', { x: 7.55, y: 1.65, w: 5.1, h: 0.34, fontFace: FONT, fontSize: 13, bold: true, color: C.red });
    s.addText(
      `พบอาการเสื่อมรวม ${nf(total)} รายการในช่วงนี้ ควรพิจารณาวางแผนซ่อม/เปลี่ยนอะไหล่ `
      + 'ตามลำดับความเร่งด่วน โดยเฉพาะรายการที่กระทบความเย็นและความปลอดภัยระบบไฟฟ้า',
      { x: 7.55, y: 2.0, w: 5.15, h: 1.3, fontFace: FONT, fontSize: 10.5, color: C.text, valign: 'top', lineSpacing: 16 },
    );
    footer(s);
  }

  // ── Slide 6+: รายละเอียดใบงาน (ส่งงาน) — 14 แถว/สไลด์ ───────────────────────
  const PER_PAGE = 14;
  const pages = Math.ceil(model.orders.length / PER_PAGE) || 0;
  for (let p = 0; p < pages; p++) {
    const s = newSlide();
    banner(s, `Work Order Detail | รายละเอียดใบงานส่งมอบ (${p + 1}/${pages})`,
      `${branch} · ${rangeTxt} · ทั้งหมด ${nf(model.orders.length)} ใบงาน${model.orders_truncated ? ` (แสดง ${model.order_cap} ใบแรก)` : ''}`);
    const head = ['ลำดับ', 'เลขใบงาน', 'วันที่', 'สถานที่', 'ประเภทงาน', 'ชนิดเครื่อง', 'จำนวน', 'ผล', 'ทีม/ช่าง']
      .map((t, i) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: C.head }, align: i >= 6 && i <= 7 ? 'center' : 'left', fontSize: 9.5 } }));
    const rows = [head];
    model.orders.slice(p * PER_PAGE, (p + 1) * PER_PAGE).forEach((o, i) => {
      const fill = { color: i % 2 ? C.rowAlt : 'FFFFFF' };
      const okTxt = o.result === 'ok' ? { text: 'ผ่าน', color: C.ok } : o.result === 'not_ok' ? { text: 'ไม่ผ่าน', color: C.red } : { text: '-', color: C.sub };
      rows.push([
        { text: String(p * PER_PAGE + i + 1), options: { fill, align: 'center' } },
        { text: o.wo_number, options: { fill, bold: true, color: C.navy } },
        { text: thDateShort(o.work_date), options: { fill } },
        { text: o.place.length > 55 ? `${o.place.slice(0, 54)}…` : o.place, options: { fill } },
        { text: WT[o.work_type] || o.work_type || '-', options: { fill } },
        { text: o.ac_type, options: { fill } },
        { text: nf(o.units), options: { fill, align: 'center', bold: true, color: C.navy } },
        { text: okTxt.text, options: { fill, align: 'center', bold: true, color: okTxt.color } },
        { text: o.tech_name.length > 20 ? `${o.tech_name.slice(0, 19)}…` : o.tech_name, options: { fill } },
      ]);
    });
    s.addTable(rows, {
      x: 0.5, y: 1.5, w: W - 1.0, colW: [0.55, 1.35, 0.95, 3.85, 1.15, 1.35, 0.7, 0.75, 1.68],
      fontFace: FONT, fontSize: 8.5, color: C.text,
      border: { type: 'solid', color: C.line, pt: 0.5 }, rowH: 0.3, valign: 'middle',
    });
    source(s, 0.5, 6.35, 6);
    footer(s);
  }

  return pptx.write({ outputType: 'nodebuffer' });
}

module.exports = { buildWashRangeDeck };
