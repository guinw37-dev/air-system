const express = require('express');
const router = express.Router();
const { leftmostLabel, lookupBranch } = require('../middleware/resolveBranch');
const { serverError } = require('../utils/respond');

// PUBLIC — the SPA calls this on boot to learn which branch (ลูกค้า/สาขา) it is
// running under, from the browser hostname. apex/www/IP/localhost → { apex:true }
// (super-admin / multi-branch mode). Unknown branch → 404.
//   GET /api/resolve-host?hostname=acme-co.<domain>   (or ?branch=acme-co for dev)
router.get('/', async (req, res) => {
  try {
    const SLUG_RE = /^[a-z0-9-]{1,63}$/;
    const branch = req.query.branch && SLUG_RE.test(String(req.query.branch).toLowerCase())
      ? String(req.query.branch).toLowerCase() : null;
    const hostname = req.query.hostname || req.hostname || req.headers.host;
    const label = branch || leftmostLabel(hostname);
    if (!label) return res.json({ apex: true });
    const b = await lookupBranch(label);
    if (!b) return res.status(404).json({ error: 'unknown branch' });
    res.json({ apex: false, slug: b.slug, name: b.name, force_camera: !!b.force_camera });
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
