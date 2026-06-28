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

const { resolveBranch, requireBranch } = require('./middleware/resolveBranch');

// No boot-time migrations — schema.sql is the single source of truth.
// Apply / update the schema with:  npm run migrate   (idempotent CREATE TABLE IF NOT EXISTS)
// Seed roles + template + clients with:  npm run seed

// CORS — allowlist instead of reflecting any origin (audit H-1). Allowed:
// the apex + any *.tw-carework.online subdomain, localhost (dev), and anything
// listed in CORS_ORIGINS (comma-separated). Same-origin / non-browser (no Origin)
// always passes. Add custom base domains via env without code change.
const EXTRA_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
function originAllowed(origin) {
  if (!origin) return true;                       // curl / server-to-server / same-origin
  if (EXTRA_ORIGINS.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (host === 'tw-carework.online' || host.endsWith('.tw-carework.online')) return true;
    if (host.endsWith('.sslip.io')) return true;   // Coolify-generated dev domains
  } catch { /* malformed origin → deny */ }
  return false;
}
app.use(cors({
  origin: (origin, cb) => cb(null, originAllowed(origin)),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Branch'],
}));
// Body limit: keep a modest default; signatures/base64 images fit well under 8mb.
// (audit L-3 — 50mb everywhere opened a memory-DoS surface.)
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
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

// Routes. requireBranch (audit M-1) blocks pure per-tenant modules from running
// on the apex/public fallback — a request without a resolved branch would
// otherwise read/write the public schema and orphan data. master + ac-repair are
// branch-aware on apex (user mgmt / super-dev aggregate) so they self-guard.
app.use('/api/auth', require('./routes/auth'));
app.use('/api/branches', require('./routes/branches'));
// Dashboard self-guards (branch → that branch; apex+super → aggregate all).
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/master', require('./routes/master'));
app.use('/api/work-orders', requireBranch, require('./routes/workOrders'));
app.use('/api/simple-wo',   requireBranch, require('./routes/simpleWorkOrders'));
// Inbound auto-import webhook from repair-system — PUBLIC (shared-secret guarded),
// branch resolved from the body's repairSlug, so NOT behind requireBranch.
app.use('/api/ac-repair-webhook', require('./routes/acRepairWebhook'));
app.use('/api/ac-repair-jobs', requireBranch, require('./routes/acRepairJobs'));
app.use('/api/repair-logs', requireBranch, require('./routes/repairLogs'));
app.use('/api/pdf',         require('./routes/pdf'));
app.use('/api/import',      requireBranch, require('./routes/import'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/deductions',  requireBranch, require('./routes/deductions'));
app.use('/api/targets',     requireBranch, require('./routes/serviceTargets'));
app.use('/api/wash-units',  requireBranch, require('./routes/washUnits'));
app.use('/api/wash-schedule', requireBranch, require('./routes/washSchedule'));
app.use('/api/attendance',  requireBranch, require('./routes/attendance'));
app.use('/api/sign',        require('./routes/sign'));   // PUBLIC — no auth (token-guarded)
app.use('/api/line',        require('./routes/line'));   // PUBLIC — LINE webhook
app.use('/api/line-admin',  require('./routes/lineAdmin')); // super-admin LINE config

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
    try { require('./jobs/lineDailyDigest').startLineDigestScheduler('08:45'); }
    catch (e) { console.error('line digest scheduler failed:', e.message); }
  });
});
