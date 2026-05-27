require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pool = require('./db/pool');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Startup migrations (each step independent) ───────────────────────────
;(async () => {
  const run = async (label, fn) => {
    try { await fn(); console.log(`[migration] ${label} OK`); }
    catch (err) { console.error(`[migration] ${label} ERR:`, err.message); }
  };

  await run('signatures role constraint', async () => {
    await pool.query(`ALTER TABLE signatures DROP CONSTRAINT IF EXISTS signatures_role_check;`);
    await pool.query(`ALTER TABLE signatures ADD CONSTRAINT signatures_role_check CHECK (role IN ('tech', 'area_owner', 'engineering'));`);
  });

  await run('signatures unique constraint', async () => {
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'signatures_wo_role_unique') THEN
          ALTER TABLE signatures ADD CONSTRAINT signatures_wo_role_unique UNIQUE (work_order_id, role);
        END IF;
      END $$;
    `);
  });

  await run('repair_logs.cleaning_type', async () => {
    await pool.query(`ALTER TABLE repair_logs ADD COLUMN IF NOT EXISTS cleaning_type VARCHAR(10);`);
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'repair_logs_cleaning_type_check') THEN
          ALTER TABLE repair_logs ADD CONSTRAINT repair_logs_cleaning_type_check CHECK (cleaning_type IN ('major', 'minor', 'fan'));
        END IF;
      END $$;
    `);
  });

  await run('ac_units.pm_cycle_pos', async () => {
    await pool.query(`ALTER TABLE ac_units ADD COLUMN IF NOT EXISTS pm_cycle_pos SMALLINT NOT NULL DEFAULT 0;`);
  });

  await run('drop ac_units type check constraint', async () => {
    await pool.query(`ALTER TABLE ac_units DROP CONSTRAINT IF EXISTS ac_units_type_check;`);
  });

  await run('buildings.site', async () => {
    await pool.query(`ALTER TABLE buildings ADD COLUMN IF NOT EXISTS site VARCHAR(100);`);
  });

  await run('deduction_notes table', async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS deduction_notes (
        id         SERIAL PRIMARY KEY,
        hospital_id INT NOT NULL REFERENCES hospitals(id),
        month      CHAR(7) NOT NULL,
        notes      TEXT,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  });
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
