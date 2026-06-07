require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Behind Coolify/Traefik — honor X-Forwarded-Host so req.hostname is the
// original branch host (phayathai-1.<domain>), not the internal container host.
app.set('trust proxy', true);

const { resolveTenant } = require('./middleware/tenant');

// No boot-time migrations — schema.sql is the single source of truth.
// Apply / update the schema with:  npm run migrate   (idempotent CREATE TABLE IF NOT EXISTS)
// Seed roles + template + clients with:  npm run seed

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
fs.mkdirSync(path.join(UPLOAD_DIR, 'photos'), { recursive: true });
console.log(`[upload] serving from ${UPLOAD_DIR}`);
app.use('/uploads', express.static(UPLOAD_DIR));

// Subdomain → branch resolution (PUBLIC, must run BEFORE resolveTenant)
app.use('/api/resolve-host', require('./routes/resolve'));

// GLOBAL tenant guard: on a branch subdomain, forces req.clientId + rejects a
// mismatched client_id. On apex/www/IP/localhost it is a no-op (req.tenant=null).
app.use(resolveTenant);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/master', require('./routes/master'));
app.use('/api/work-orders', require('./routes/workOrders'));
app.use('/api/simple-wo',   require('./routes/simpleWorkOrders'));
// /api/photos (legacy, unguarded) retired — secure photo endpoints live under
// /api/work-orders/:id/photos (audit H-1)
app.use('/api/repair-logs', require('./routes/repairLogs'));
app.use('/api/pdf',         require('./routes/pdf'));
app.use('/api/stats',       require('./routes/stats'));
app.use('/api/pm',          require('./routes/pm'));
app.use('/api/import',      require('./routes/import'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/parts',       require('./routes/parts'));
app.use('/api/deductions',  require('./routes/deductions'));
app.use('/api/sign',        require('./routes/sign'));   // PUBLIC — no auth (token-guarded)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'air-system', time: new Date() });
});

app.listen(PORT, () => {
  console.log(`Air System API running on port ${PORT}`);
});
