require('dotenv').config();
const pool = require('./pool');

// TW checklist v2 — align the already-seeded inspection_template_items (global
// public table) with the revised TW Engineering form. Matches rows by their OLD
// item_label so it is idempotent: a second run updates 0 rows. Row ids are kept
// on UPDATE, so existing work orders' checklist_values (keyed by template id)
// stay intact.
//
// Run on Coolify Terminal:  node src/db/migrate_tw_checklist_v2.js
//
//   1) Blower แรงดัน/กระแส row  → relabel to "มอเตอร์คอยล์เย็น/ร้อน"
//   2) อุณหภูมิ °C row           → relabel to "ตรวจเช็คคอยล์ร้อน คอยล์เย็น ..."
//   3) Compressor (ln_vi) row    → DELETE (duplicate of the Blower row)
//   4) Pilot lamp row            → move category fcu → ahu (sort 280 → 305)
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Blower → คอยล์เย็น/ร้อน
    const r1 = await client.query(
      `UPDATE inspection_template_items
         SET item_label = $1
       WHERE equipment_type = 'ac'
         AND item_label = 'ตรวจสอบแรงดันไฟฟ้า และกระแสไฟฟ้าของมอเตอร์ Blower (380V/220V)'`,
      ['ตรวจสอบแรงดันไฟฟ้า และกระแสไฟฟ้าของมอเตอร์คอยล์เย็น(แอร์น้ำ) หรือมอเตอร์คอยล์ร้อน(แอร์น้ำยา)']
    );

    // 2) อุณหภูมิ °C → ตรวจเช็คคอยล์ร้อน/เย็น + ฉีดล้างรังผึ้ง
    const r2 = await client.query(
      `UPDATE inspection_template_items
         SET item_label = $1
       WHERE equipment_type = 'ac'
         AND item_label = 'ตรวจวัดอุณหภูมิ °C'`,
      ['ตรวจเช็คคอยล์ร้อน คอยล์เย็น และฉีดล้างทำความสะอาดรังผึ้งที่คอยล์ร้อน คอยล์เย็น']
    );

    // 3) Compressor ln_vi row — drop dependent inspection_values first (FK), then the item.
    const { rows: comp } = await client.query(
      `SELECT id FROM inspection_template_items
        WHERE equipment_type = 'ac' AND value_type = 'ln_vi'
          AND item_label = 'ตรวจวัดแรงดันไฟฟ้า และกระแสไฟฟ้าขณะที่ Compressor ทำงาน'`
    );
    let r3 = { rowCount: 0 };
    if (comp.length) {
      const ids = comp.map((c) => c.id);
      await client.query('DELETE FROM inspection_values WHERE template_item_id = ANY($1)', [ids]);
      r3 = await client.query('DELETE FROM inspection_template_items WHERE id = ANY($1)', [ids]);
    }

    // 4) Pilot lamp row — fcu → ahu
    const r4 = await client.query(
      `UPDATE inspection_template_items
         SET category = 'ahu', sort_order = 305
       WHERE equipment_type = 'ac' AND category = 'fcu'
         AND item_label = 'ตรวจสอบ Pilot lamp, Selector Switch และอุปกรณ์ภายในตู้ Starter'`
    );

    await client.query('COMMIT');
    console.log('TW checklist v2 migration complete:');
    console.log(`  1) Blower relabel:      ${r1.rowCount} row(s)`);
    console.log(`  2) อุณหภูมิ relabel:     ${r2.rowCount} row(s)`);
    console.log(`  3) Compressor removed:  ${r3.rowCount} row(s)`);
    console.log(`  4) Pilot lamp → AHU:    ${r4.rowCount} row(s)`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('TW checklist v2 migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
