// ข้อความที่ช่างพิมพ์เองในใบงาน (simple-wo) + ตัวหาคำต้องสงสัย (หยาบ/ไม่สุภาพ).
//
// ใช้กับแท็บ "ความเห็นช่าง" ใน Excel ใบงาน และ MCP tool wo_text_flags.
// คำต้องสงสัยเป็น "ป้ายให้คนอ่านตรวจ" ไม่ใช่ตัวบล็อก: ภาษาไทยไม่มีเว้นวรรคระหว่างคำ
// การจับแบบ substring จึงต้องกันคำปกติที่มีคำหยาบซ้อนอยู่ข้างใน (เชี่ยวชาญ, กู้, แม่งาน,
// สัดส่วน, หีบ ...) ด้วย lookahead ทีละคำ — เพิ่มคำใหม่ให้เทียบกับคำปกติที่ใช้ในงานแอร์ก่อน
// แล้วเพิ่มเคสใน test/woExport.test.js ทั้งฝั่งต้องจับและฝั่งต้องไม่จับ.

// [ป้ายที่แสดงใน Excel, regex บนข้อความที่ "บีบ" แล้ว (ตัดช่องว่าง/จุด/ขีด ที่ใช้เลี่ยงคำ)]
const SUSPECT_WORDS = [
  ['เหี้ย', /เหี้ย(?!ม)/],                    // ไม่จับ เหี้ยม
  ['เชี่ย', /เชี่ย(?!ว)/],                    // ไม่จับ เชี่ยวชาญ / น้ำเชี่ยว
  ['สัส', /สัส(?!ดี)/],                       // ไม่จับ สัสดี
  ['สัด', /สัด(?!ส่วน)/],                     // ไม่จับ สัดส่วน
  ['ควย', /ควย/],
  ['เย็ด', /เย็ด/],
  ['มึง', /มึง/],
  ['กู', /กู(?![่้๊๋]|เกิ|รู)/],               // ไม่จับ กู้/กู่, กูเกิล, กูรู
  ['แม่ง', /แม่ง(?!าน)/],                     // ไม่จับ แม่งาน
  ['พ่อง', /พ่อง(?!าน)/],                     // ไม่จับ "พ่อ งาน" ที่บีบช่องว่างแล้ว
  ['ชิบหาย', /[ชฉ]ิบหาย/],
  ['ระยำ', /ระยำ/],
  ['สันดาน', /สันดาน/],
  ['ส้นตีน', /ส้นตีน/],
  ['ตอแหล', /ตอแหล/],
  ['ไอ้สัตว์', /(?:ไอ้?|อี)สัตว์/],            // "สัตว์" เดี่ยว ๆ ไม่จับ (ซากสัตว์ในเครื่อง)
  ['ไอ้เวร', /(?:ไอ้?|อี)เวร/],               // "เวร" เดี่ยว ๆ ไม่จับ (เข้าเวร)
  ['ไอ้ห่า', /(?:ไอ้?|อี)ห่า(?!ง)|ห่าราก/],   // ไม่จับ ห่าง
  ['ควาย', /ควาย/],
  ['โง่', /โง่/],
  ['ปัญญาอ่อน', /ปัญญาอ่อน/],
  ['หี', /(?<!เ)หี(?![บ่้๊๋])/],                // ไม่จับ หีบ และ หี ใน เหี้ย/เหี่ยว/เหียน
  ['แตด', /แตด/],
  ['จัญไร', /จัญไร/],
  ['เสือก', /เสือก/],
  ['ดอกทอง', /ดอกทอง/],
  ['ร่าน', /ร่าน/],
  ['กะหรี่', /กะหรี่/],
  ['fuck', /f+u+c+k/i],
  ['shit', /shit/i],
  ['bitch', /bitch/i],
  ['asshole', /asshole/i],
  ['wtf', /wtf/i],
];

// ตัดช่องว่าง/อักษรล่องหน/เครื่องหมายที่ใช้คั่นตัวอักษรเพื่อเลี่ยงคำ (ม ึ ง, ม.ึ.ง, ม-ึ-ง)
const SQUEEZE = /[\s​-‍⁠﻿.,_\-*+~'"`|\\/!?()[\]{}<>@#$%^&=:;]+/g;
const squeeze = (t) => String(t).normalize('NFC').replace(SQUEEZE, '');

// ป้ายคำต้องสงสัยที่พบในข้อความ (ไม่ซ้ำ, ตามลำดับรายการ) — [] = ไม่พบ
function findSuspectWords(text) {
  if (text === null || text === undefined || text === '') return [];
  const t = squeeze(text);
  return SUSPECT_WORDS.filter(([, re]) => re.test(t)).map(([label]) => label);
}

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
// เฉพาะ string/ตัวเลข — ค่าแปลก (object) ไม่ใช่ข้อความที่คนพิมพ์
const textOf = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

// ทุกช่องข้อความอิสระที่ช่างพิมพ์ในใบงานหนึ่งใบ → [{ field, text }] (ข้ามช่องว่าง).
// itemLabel(id) = ชื่อรายการตรวจเช็คของ checklist id นั้น (ใบล้างใหญ่); itemOrder(id) = ลำดับ.
function collectWoTexts(wo, { itemLabel = (id) => `รายการ #${id}`, itemOrder = () => Infinity } = {}) {
  const out = [];
  const add = (field, v) => { const text = textOf(v); if (text) out.push({ field, text }); };
  const tc = obj(wo.team_comment);
  const cd = obj(wo.condition);
  const ac = obj(wo.ac_info);
  add('ข้อแนะนำ', wo.recommendation);
  add('ความเห็นทีมช่าง: ภายนอก รายละเอียด', tc.external_detail);
  add('ความเห็นทีมช่าง: ภายใน รายละเอียด', tc.internal_detail);
  add('สภาพแอร์: อื่นๆ (ระบุ)', cd.issues_other);
  add('สภาพแอร์: เหตุผล/รายละเอียด', cd.health_reason);
  add('แอร์: รายละเอียด', ac.detail);
  const cv = obj(wo.checklist_values);
  const ids = Object.keys(cv).sort((a, b) => (itemOrder(a) - itemOrder(b)) || (Number(a) - Number(b)));
  for (const id of ids) {
    const v = obj(cv[id]);
    add(`${itemLabel(id)} · ข้อความ`, v.val_text);
    add(`${itemLabel(id)} · หมายเหตุ`, v.note);
  }
  (Array.isArray(wo.grid_rows) ? wo.grid_rows : []).forEach((g, i) => {
    add(`แถว ${i + 1} · ชำรุดเนื่องจาก`, obj(g).broken);
  });
  return out;
}

// แถวใบงานเป็น jsonb โดยตัดรูปลายเซ็นออก (data URL ช่องละหลายสิบ KB × 5 ช่อง × พันใบ =
// หลายสิบ MB ที่ Excel/MCP ไม่ได้ใช้ — ใช้แค่ sig_*_name). "jsonb - คีย์" กับคีย์ที่ไม่มี
// ไม่ error จึงไม่ผูกกับคอลัมน์ที่บางสาขาอาจยังไม่ migrate.
const { SIG_SLOTS } = require('./roles');
const woDocSql = (alias = 's') => `to_jsonb(${alias})${SIG_SLOTS.map((k) => ` - 'sig_${k}'`).join('')}`;

module.exports = { SUSPECT_WORDS, findSuspectWords, collectWoTexts, squeeze, woDocSql };
