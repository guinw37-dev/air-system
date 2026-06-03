require('dotenv').config();
const pool = require('./pool');

// ADDITIVE — adds gallery_urls to simple_work_orders.
// gallery_urls = extra photo storage (album uploads, unlimited, NOT in the PDF).
// photo_urls stays the report's ก่อน/หลัง set. Run: node src/db/migrate_simple_wo_gallery.js
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(
      `ALTER TABLE simple_work_orders ADD COLUMN IF NOT EXISTS gallery_urls JSONB DEFAULT '[]'::jsonb`
    );
    console.log('gallery_urls migration complete (no data dropped)');
  } catch (err) {
    console.error('gallery_urls migration error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
