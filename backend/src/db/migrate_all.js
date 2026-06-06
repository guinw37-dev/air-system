// Run every ADDITIVE simple-wo migration in order, idempotently. One command to
// bring any environment (fresh or existing) up to the current schema — avoids
// the missing-column 500s that happen when a single migrate:* is forgotten.
// Each step is CREATE/ALTER ... IF NOT EXISTS / ON CONFLICT DO NOTHING, so
// re-running is always safe. Run: npm run migrate:all
const { execSync } = require('child_process');

const STEPS = [
  'migrate:simple-wo',          // base table (CREATE TABLE IF NOT EXISTS)
  'migrate:simple-wo-gallery',  // gallery_urls
  'migrate:simple-wo-acinfo',   // ac_info
  'migrate:air-quality',        // PM2.5 / CO2 / dB template items
  'migrate:building-sig',       // sig_supervisor + sig_building + role CHECK
  'migrate:grid',               // grid_rows + recommendation
  'migrate:soft-delete',        // deleted_at + updated_at
];

for (const step of STEPS) {
  console.log(`\n▶ ${step}`);
  try {
    execSync(`npm run ${step}`, { stdio: 'inherit' });
  } catch (err) {
    console.error(`✗ ${step} failed — stopping.`);
    process.exit(1);
  }
}
console.log('\n✓ all migrations applied');
