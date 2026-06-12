require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Behind Coolify/Traefik — honor X-Forwarded-Host so req.hostname is the
// original branch host (acme-co.<domain>), not the internal container host.
app.set('trust proxy', true);

const { resolveBranch } = require('./middleware/resolveBranch');

// No boot-time migrations — schema.sql is the single source of truth.
// Apply / update the schema with:  npm run migrate   (idempotent CREATE TABLE IF NOT EXISTS)
// Seed roles + template + clients with:  npm run seed

// Middleware — CORS for a cross-origin SPA (frontend on tw-carework.online +
// branch subdomains, backend on api.tw-carework.online). Reflect the request
// origin and explicitly allow the custom X-Branch header so the preflight passes.
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Branch'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
fs.mkdirSync(path.join(UPLOAD_DIR, 'photos'), { recursive: true });
console.log(`[upload] serving from ${UPLOAD_DIR}`);
app.use('/uploads', express.static(UPLOAD_DIR));

// Subdomain → branch resolution (PUBLIC, must run BEFORE resolveBranch so an
// unknown host doesn't 404 the SPA's own bootstrap call).
app.use('/api/resolve-host', require('./routes/resolve'));

// Branch resolution (schema-per-tenant): sets req.branch/req.schema/req.db/req.tx
// from the X-Branch header / subdomain. No branch (apex) → public fallback, so
// not-yet-converted routes that still use `pool` directly are unaffected.
app.use(resolveBranch);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/branches', require('./routes/branches'));
app.use('/api/master', require('./routes/master'));
app.use('/api/work-orders', require('./routes/workOrders'));
app.use('/api/simple-wo',   require('./routes/simpleWorkOrders'));
app.use('/api/ac-repair',   require('./routes/acRepair'));   // remote view of repair-system AC jobs
// /api/photos (legacy, unguarded) retired — secure photo endpoints live under
// /api/work-orders/:id/photos (audit H-1)
app.use('/api/repair-logs', require('./routes/repairLogs'));
app.use('/api/pdf',         require('./routes/pdf'));
app.use('/api/import',      require('./routes/import'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/deductions',  require('./routes/deductions'));
app.use('/api/sign',        require('./routes/sign'));   // PUBLIC — no auth (token-guarded)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'air-system', time: new Date() });
});

// Boot-time DB migration — apply public + every branch schema (idempotent) so a
// deploy never leaves a tenant missing a newly-added column/role. Best-effort:
// a migration hiccup logs loudly but still lets the API come up.
async function migrateOnBoot() {
  try {
    const { migratePublic, migrateBranchSchemas } = require('./db/provision');
    await migratePublic();
    const n = await migrateBranchSchemas();
    console.log(`✓ boot migration done (public + ${n} branch schemas)`);
  } catch (err) {
    console.error('⚠ boot migration failed (continuing):', err.message);
  }
}

migrateOnBoot().finally(() => {
  app.listen(PORT, () => {
    console.log(`Air System API running on port ${PORT}`);
  });
});
