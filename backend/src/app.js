require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pool = require('./db/pool');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Startup migration: fix signatures role constraint ─────────────────────
;(async () => {
  try {
    await pool.query(`
      ALTER TABLE signatures
        DROP CONSTRAINT IF EXISTS signatures_role_check;
    `);
    await pool.query(`
      ALTER TABLE signatures
        ADD CONSTRAINT signatures_role_check
        CHECK (role IN ('tech', 'area_owner', 'engineering'));
    `);
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'signatures_wo_role_unique'
        ) THEN
          ALTER TABLE signatures
            ADD CONSTRAINT signatures_wo_role_unique
            UNIQUE (work_order_id, role);
        END IF;
      END $$;
    `);
    console.log('[migration] signatures constraint updated');

    // Add cleaning_type to repair_logs
    await pool.query(`
      ALTER TABLE repair_logs
        ADD COLUMN IF NOT EXISTS cleaning_type VARCHAR(10)
        CHECK (cleaning_type IN ('major', 'minor', 'fan'));
    `);
    console.log('[migration] repair_logs.cleaning_type ready');

    // Add pm_cycle_pos to ac_units (0=major, 1=minor, 2=minor → cycles every 2 months)
    await pool.query(`
      ALTER TABLE ac_units
        ADD COLUMN IF NOT EXISTS pm_cycle_pos SMALLINT NOT NULL DEFAULT 0;
    `);
    console.log('[migration] ac_units.pm_cycle_pos ready');
  } catch (err) {
    console.error('[migration] error:', err.message);
  }
})();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
fs.mkdirSync(path.join(UPLOAD_DIR, 'photos'), { recursive: true });
console.log(`[upload] serving from ${UPLOAD_DIR}`);
app.use('/uploads', express.static(UPLOAD_DIR));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/master', require('./routes/master'));
app.use('/api/work-orders', require('./routes/workOrders'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/repair-logs', require('./routes/repairLogs'));
app.use('/api/pdf',         require('./routes/pdf'));
app.use('/api/stats',       require('./routes/stats'));
app.use('/api/pm',          require('./routes/pm'));
app.use('/api/import',      require('./routes/import'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'air-system', time: new Date() });
});

app.listen(PORT, () => {
  console.log(`Air System API running on port ${PORT}`);
});
