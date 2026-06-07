require('dotenv').config();
const pool = require('./pool');
const { migrateBranchSchemas } = require('./provision');

// Apply branch_schema.sql to every active branch schema (run per deploy so new
// tables/columns reach all tenants). Run: node src/db/migrate_branch_schemas.js
(async () => {
  try {
    const n = await migrateBranchSchemas();
    console.log(`branch schema migration complete (${n} branches)`);
  } catch (err) {
    console.error('branch schema migration error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
