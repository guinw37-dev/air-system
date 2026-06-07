require('dotenv').config();
const pool = require('./pool');
const { migratePublic } = require('./provision');

// Apply the GLOBAL (public) schema: registry (clients +slug/subdomain/schema_name),
// super-admin users, shared templates, notifications. Run once per deploy.
// Run: node src/db/migrate_public.js
(async () => {
  try {
    await migratePublic();
    console.log('public schema migration complete');
  } catch (err) {
    console.error('public schema migration error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
