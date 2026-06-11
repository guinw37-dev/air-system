require('dotenv').config();
const pool = require('./pool');
const { slugToSchema } = require('../utils/schema');
const { provisionBranchSchema } = require('./provision');

// Seed the 12 hospital branches into air-system (idempotent). Each maps 1:1 to a
// repair-system hospital via repair_slug (= the air-system branch slug), so the
// AC-repair remote view knows which hospital's jobs to pull. Provisioning each
// branch schema also readies it for the branch's own ล้างแอร์ data in future.
//   npm run migrate:seed-hospitals
const HOSPITALS = [
  ['PH1',  'โรงพยาบาลพญาไท 1',            'phayathai-1'],
  ['PH2',  'โรงพยาบาลพญาไท 2',            'phayathai-2'],
  ['PH3',  'โรงพยาบาลพญาไท 3',            'phayathai-3'],
  ['PHNM', 'โรงพยาบาลพญาไท นวมินทร์',     'phayathai-nawamin'],
  ['PHBW', 'โรงพยาบาลพญาไท บ่อวิน',        'phayathai-bowin'],
  ['PHPY', 'โรงพยาบาลพญาไท พหลโยธิน',     'phayathai-phaholyothin'],
  ['PHSR', 'โรงพยาบาลพญาไท ศรีราชา',       'phayathai-sriracha'],
  ['PLPP', 'โรงพยาบาลเปาโล พระประแดง',     'paolo-phrapradaeng'],
  ['PLRS', 'โรงพยาบาลเปาโล รังสิต',         'paolo-rangsit'],
  ['PLSP', 'โรงพยาบาลเปาโล สมุทรปราการ',   'paolo-samutprakan'],
  ['PLKS', 'โรงพยาบาลเปาโล เกษตร',         'paolo-kaset'],
  ['PLCK', 'โรงพยาบาลเปาโล โชคชัย 4',      'paolo-chokchai'],
];

(async () => {
  try {
    for (const [code, name, slug] of HOSPITALS) {
      const schema = slugToSchema(slug);
      const { rows } = await pool.query(
        `INSERT INTO clients (code, name, slug, subdomain, schema_name, repair_slug, active)
         VALUES ($1,$2,$3,$3,$4,$3,true)
         ON CONFLICT (code) DO UPDATE
           SET name=EXCLUDED.name, slug=EXCLUDED.slug, subdomain=EXCLUDED.subdomain,
               schema_name=EXCLUDED.schema_name, repair_slug=EXCLUDED.repair_slug, active=true
         RETURNING id, schema_name`,
        [code, name, slug, schema]);
      await provisionBranchSchema(rows[0].schema_name);
      console.log(`  ✓ ${name}  [${schema}]  → repair_slug=${slug}`);
    }
    console.log(`seeded ${HOSPITALS.length} hospital branches.`);
  } catch (err) {
    console.error('seed-hospitals error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
