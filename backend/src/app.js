require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
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
  } catch (err) {
    console.error('[migration] signatures error:', err.message);
  }
})();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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
