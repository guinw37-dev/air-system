const express = require('express');
const router = express.Router();
const { leftmostLabel, lookupClientBySubdomain } = require('../middleware/tenant');

// PUBLIC — the frontend calls this on boot to learn which branch (สาขา) it is
// running under, from the browser hostname. No auth (no data leak beyond the
// branch's display name). apex/www/IP/localhost → { apex: true } (super-admin /
// multi-client mode). Unknown branch → 404 (no silent cross-tenant fallback).
//   GET /api/resolve-host?hostname=phayathai-1.pypl-engineering.online
router.get('/', async (req, res) => {
  try {
    // ?branch=<slug> is an explicit dev/override; else derive from hostname.
    const SLUG_RE = /^[a-z0-9-]{1,63}$/;
    const branch = req.query.branch && SLUG_RE.test(String(req.query.branch).toLowerCase())
      ? String(req.query.branch).toLowerCase() : null;
    const hostname = req.query.hostname || req.hostname || req.headers.host;
    const label = branch || leftmostLabel(hostname);
    if (!label) return res.json({ apex: true });
    const c = await lookupClientBySubdomain(label);
    if (!c) return res.status(404).json({ error: 'unknown branch' });
    res.json({ apex: false, clientId: c.id, slug: c.slug, name: c.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
