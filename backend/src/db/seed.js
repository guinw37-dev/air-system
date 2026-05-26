require('dotenv').config();
const pool = require('./pool');
const bcrypt = require('bcryptjs');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Users ──────────────────────────────────────────────
    const passwordHash = await bcrypt.hash('admin1234', 10);
    await client.query(`
      INSERT INTO users (name, username, password_hash, role, phone)
      VALUES
        ('Administrator', 'admin', $1, 'admin', ''),
        ('Owner TW', 'owner', $1, 'owner', ''),
        ('ช่างทดสอบ 1', 'tech1', $1, 'technician', ''),
        ('ช่างทดสอบ 2', 'tech2', $1, 'technician', '')
      ON CONFLICT (username) DO NOTHING
    `, [passwordHash]);

    // ── Hospitals ──────────────────────────────────────────
    const h1 = await client.query(`
      INSERT INTO hospitals (name, slug, address)
      VALUES ('โรงพยาบาลพญาไท ศรีราชา 1', 'pts1',
        '90 ถนนศรีราชานคร 3 ต.ศรีราชา อ.ศรีราชา จ.ชลบุรี 20110')
      ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name
      RETURNING id
    `);
    const h2 = await client.query(`
      INSERT INTO hospitals (name, slug, address)
      VALUES ('โรงพยาบาลพญาไท ศรีราชา 2', 'pts2',
        '90/2 ถนนศรีราชานคร 3 ต.ศรีราชา อ.ศรีราชา จ.ชลบุรี 20110')
      ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name
      RETURNING id
    `);

    const pts1 = h1.rows[0].id;
    const pts2 = h2.rows[0].id;

    // ── Buildings PTS1 ─────────────────────────────────────
    const buildings = [
      { hospital_id: pts1, name: 'อาคาร A', code: 'A' },
      { hospital_id: pts1, name: 'อาคาร B', code: 'B' },
      { hospital_id: pts1, name: 'อาคาร G', code: 'G' },
      { hospital_id: pts2, name: 'อาคาร A', code: 'A' },
      { hospital_id: pts2, name: 'อาคาร B', code: 'B' },
    ];

    for (const b of buildings) {
      await client.query(`
        INSERT INTO buildings (hospital_id, name, code)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [b.hospital_id, b.name, b.code]);
    }

    // ── Floors PTS1 อาคาร A ───────────────────────────────
    const { rows: bldRows } = await client.query(
      `SELECT id, code, hospital_id FROM buildings WHERE hospital_id = $1 AND code = 'A'`,
      [pts1]
    );
    const bldA_pts1 = bldRows[0]?.id;

    if (bldA_pts1) {
      const floors = ['B', 'G', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
      for (const f of floors) {
        await client.query(`
          INSERT INTO floors (building_id, name)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [bldA_pts1, `ชั้น ${f}`]);
      }
    }

    await client.query('COMMIT');
    console.log('Seed success');
    console.log('Default login: admin / admin1234');
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
