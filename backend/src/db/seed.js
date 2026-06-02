require('dotenv').config();
const pool = require('./pool');
const bcrypt = require('bcryptjs');
const { MEASUREMENT_FIELDS, CHECKLIST_ITEMS } = require('../config/measurements');

// Seed baseline data for the NEW schema (clients → sites → … → units).
// Does NOT import equipment from Excel — that lives in import.js / a dedicated
// import step (blocked on ac-data-clean.xlsx). This only sets up the data the
// app needs to boot: users (1 per role), clients PTS1/PTS2, a main site each,
// and the inspection_template_items derived from config/measurements.js.

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Users (1 per role) ─────────────────────────────────
    const passwordHash = await bcrypt.hash('admin1234', 10);
    await client.query(`
      INSERT INTO users (name, username, password_hash, role, phone)
      VALUES
        ('Administrator',   'admin',   $1, 'admin',         ''),
        ('Central Admin',   'cadmin',  $1, 'central_admin', ''),
        ('Approver',        'approver',$1, 'approver',      ''),
        ('ช่างทดสอบ 1',     'tech1',   $1, 'technician',    ''),
        ('ช่างทดสอบ 2',     'tech2',   $1, 'technician',    '')
      ON CONFLICT (username) DO NOTHING
    `, [passwordHash]);

    // ── Clients + main site ────────────────────────────────
    const clients = [
      { code: 'PTS1', name: 'โรงพยาบาลพญาไท ศรีราชา 1' },
      { code: 'PTS2', name: 'โรงพยาบาลพญาไท ศรีราชา 2' },
    ];
    for (const c of clients) {
      const { rows } = await client.query(`
        INSERT INTO clients (code, name)
        VALUES ($1, $2)
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `, [c.code, c.name]);
      const clientId = rows[0].id;
      // main site per client (รพ.หลัก) — fan import default target (see .env.example)
      await client.query(`
        INSERT INTO sites (client_id, code, name)
        VALUES ($1, $2, $3)
        ON CONFLICT (client_id, name) DO NOTHING
      `, [clientId, `${c.code}-MAIN`, c.name]);
    }

    // ── Inspection template items (config → DB) ────────────
    // category: acTypes=null → ใช้งานทั้ง3 ; acTypes set → แอร์น้ำยา (refrigerant AC)
    let sort = 0;
    for (const f of MEASUREMENT_FIELDS.major) {
      await client.query(`
        INSERT INTO inspection_template_items
          (equipment_type, category, item_label, value_type, unit_label,
           applies_major, applies_minor, sort_order)
        VALUES ('ac', $1, $2, $3, $4, true, false, $5)
        ON CONFLICT (equipment_type, category, item_label) DO NOTHING
      `, [
        f.acTypes ? 'แอร์น้ำยา' : 'ใช้งานทั้ง3',
        f.label,
        f.afterOnly ? 'number' : 'before_after',
        f.unit || null,
        sort++,
      ]);
    }

    // Checklist items per type → value_type 'check'
    for (const [type, items] of Object.entries(CHECKLIST_ITEMS)) {
      const equip = type === 'fan' ? 'fan' : 'ac';
      for (const it of items) {
        await client.query(`
          INSERT INTO inspection_template_items
            (equipment_type, category, item_label, value_type, unit_label,
             applies_major, applies_minor, sort_order)
          VALUES ($1, $2, $3, 'check', NULL, $4, $5, $6)
          ON CONFLICT (equipment_type, category, item_label) DO UPDATE SET
            applies_major = inspection_template_items.applies_major OR EXCLUDED.applies_major,
            applies_minor = inspection_template_items.applies_minor OR EXCLUDED.applies_minor
        `, [
          equip,
          type === 'fan' ? 'fan' : 'ใช้งานทั้ง3',
          it.label,
          type === 'major',
          type === 'minor',
          sort++,
        ]);
      }
    }

    await client.query('COMMIT');
    console.log('Seed success');
    console.log('Users: admin / cadmin / approver / tech1 / tech2  (password: admin1234)');
    console.log('Clients: PTS1, PTS2 (+ main site each)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
