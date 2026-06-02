require('dotenv').config();
const pool = require('./pool');

// ADDITIVE phase-4 migration (TW form support). No data dropped.
// Run on Coolify Terminal:  node src/db/migrate_phase4.js  (or npm run migrate:phase4)
async function migrate() {
  const client = await pool.connect();
  try {
    // 1) allow the TW special value types on the template
    await client.query(`ALTER TABLE inspection_template_items DROP CONSTRAINT IF EXISTS inspection_template_items_value_type_check`);
    await client.query(`ALTER TABLE inspection_template_items
      ADD CONSTRAINT inspection_template_items_value_type_check
      CHECK (value_type IN ('check','number','before_after','text','rst_amp','ln_vi','pressure_pair'))`);

    // 2) inspection_values — extra structured columns for the special types
    await client.query(`ALTER TABLE inspection_values
      ADD COLUMN IF NOT EXISTS val_r_before DECIMAL(8,2), ADD COLUMN IF NOT EXISTS val_s_before DECIMAL(8,2), ADD COLUMN IF NOT EXISTS val_t_before DECIMAL(8,2),
      ADD COLUMN IF NOT EXISTS val_r_after  DECIMAL(8,2), ADD COLUMN IF NOT EXISTS val_s_after  DECIMAL(8,2), ADD COLUMN IF NOT EXISTS val_t_after  DECIMAL(8,2),
      ADD COLUMN IF NOT EXISTS val_ln_before DECIMAL(8,2), ADD COLUMN IF NOT EXISTS val_l_before DECIMAL(8,2),
      ADD COLUMN IF NOT EXISTS val_ln_after  DECIMAL(8,2), ADD COLUMN IF NOT EXISTS val_l_after  DECIMAL(8,2),
      ADD COLUMN IF NOT EXISTS val_suction DECIMAL(8,2), ADD COLUMN IF NOT EXISTS val_discharge DECIMAL(8,2),
      ADD COLUMN IF NOT EXISTS refrigerant_type VARCHAR(10), ADD COLUMN IF NOT EXISTS val_text TEXT`);

    // 3) work_orders — technician condition assessment (ความเห็นทีมช่าง)
    await client.query(`ALTER TABLE work_orders
      ADD COLUMN IF NOT EXISTS cond_ac_degraded BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS cond_ac_old_5_7yr BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS cond_external_degraded BOOLEAN DEFAULT FALSE, ADD COLUMN IF NOT EXISTS cond_external_detail TEXT,
      ADD COLUMN IF NOT EXISTS cond_internal_degraded BOOLEAN DEFAULT FALSE, ADD COLUMN IF NOT EXISTS cond_internal_detail TEXT`);

    // 4) photo_point_templates — required photo points per equipment/work type
    await client.query(`CREATE TABLE IF NOT EXISTS photo_point_templates (
      id SERIAL PRIMARY KEY,
      equipment_type VARCHAR(10) NOT NULL,
      work_type VARCHAR(10) NOT NULL,
      point_no INT NOT NULL,
      label VARCHAR(120) NOT NULL,
      required BOOLEAN DEFAULT TRUE,
      UNIQUE(equipment_type, work_type, point_no)
    )`);

    console.log('Phase-4 migration complete — TW value types + inspection_values cols + work_orders cond + photo_point_templates (no data dropped)');
  } catch (err) {
    console.error('Phase-4 migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
