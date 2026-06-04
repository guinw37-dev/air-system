require('dotenv').config();
const pool = require('./pool');

// ADDITIVE — adds 3 air-quality measurement items (before/after) right under
// the airflow item (sort 20) in the AC checklist: PM2.5, CO2, noise [dB].
// Idempotent via UNIQUE(equipment_type, category, item_label).
// Run: node src/db/migrate_air_quality.js
const ITEMS = [
  { label: 'ตรวจวัดฝุ่น PM2.5 (µg/m³)', unit: 'µg/m³', sort: 21 },
  { label: 'ตรวจวัดก๊าซ CO₂ (ppm)',     unit: 'ppm',    sort: 22 },
  { label: 'ตรวจวัดระดับเสียง (dB)',    unit: 'dB',     sort: 23 },
];

async function migrate() {
  const client = await pool.connect();
  try {
    for (const it of ITEMS) {
      await client.query(`
        INSERT INTO inspection_template_items
          (equipment_type, category, item_label, value_type, unit_label, applies_major, applies_minor, sort_order)
        VALUES ('ac', 'all3', $1, 'number', $2, true, true, $3)
        ON CONFLICT (equipment_type, category, item_label) DO NOTHING
      `, [it.label, it.unit, it.sort]);
    }
    console.log(`air-quality items migration complete (${ITEMS.length} ensured, no data dropped)`);
  } catch (err) {
    console.error('air-quality migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
