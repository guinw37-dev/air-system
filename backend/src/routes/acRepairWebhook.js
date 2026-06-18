// /api/ac-repair-webhook — inbound auto-import from repair-system.
//
// When an AC job is assigned in repair-system, it fires a POST here so air-system
// can auto-create the matching ใบงานซ่อมแอร์ — no manual import. PUBLIC route
// (no user auth): guarded by a shared secret (X-Air-Webhook-Secret). The branch
// is resolved by reverse-lookup on clients.repair_slug (NOT X-Branch), so it is
// mounted BEFORE resolveBranch/requireBranch.
//
// env: AIR_WEBHOOK_SECRET (shared with repair-system's AIR_WEBHOOK_SECRET).
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool, txClient } = require('../db');
const { insertJob } = require('../services/acRepairCreate');

// Constant-time secret compare. Fail-closed: a blank expected secret rejects all
// (a missing AIR_WEBHOOK_SECRET must never mean "accept anything").
function secretMatches(got, expected) {
  if (!expected) return false;
  const a = Buffer.from(String(got || ''));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function secretOk(req) {
  return secretMatches(req.headers['x-air-webhook-secret'], process.env.AIR_WEBHOOK_SECRET || '');
}

// Reverse-map a repair-system hospital slug → this app's branch (schema).
async function branchForRepairSlug(repairSlug) {
  if (!repairSlug) return null;
  const { rows } = await pool.query(
    `SELECT slug, schema_name FROM clients
       WHERE active = true AND repair_slug = $1 LIMIT 1`,
    [repairSlug]
  );
  return rows[0] || null;
}

// POST / — body: { repairSlug, job: { id, job_number, building, floor, department,
//                   requester, telephone, description, file_url } }
router.post('/', async (req, res) => {
  if (!secretOk(req)) return res.status(401).json({ error: 'unauthorized' });
  const { repairSlug, job } = req.body || {};
  if (!repairSlug || !job || !job.id) {
    return res.status(400).json({ error: 'repairSlug + job{id} required' });
  }

  let branch;
  try {
    branch = await branchForRepairSlug(repairSlug);
  } catch (e) {
    console.error('[ac-webhook] branch lookup failed:', e.message);
    return res.status(500).json({ error: 'branch lookup failed' });
  }
  // No air-system branch maps to this hospital yet — ack (don't make repair retry).
  if (!branch) {
    console.warn(`[ac-webhook] no branch mapped to repair_slug=${repairSlug} — skipped`);
    return res.json({ ok: true, skipped: 'no mapped branch' });
  }

  const schema = branch.schema_name || branch.slug;
  const data = {
    repair_job_id:     job.id,
    repair_job_number: job.job_number,
    building:          job.building,
    floor:             job.floor,
    department:        job.department,
    requester:         job.requester,
    telephone:         job.telephone,
    description:       job.description,
    file_url:          job.file_url,
  };

  const c = await txClient(schema);
  try {
    await c.query('BEGIN');
    const { row, duplicate } = await insertJob(c, data, null);
    await c.query('COMMIT');
    if (duplicate) {
      return res.json({ ok: true, duplicate: true, job_number: duplicate.job_number });
    }
    console.log(`[ac-webhook] created ${row.job_number} in ${schema} from repair job ${job.job_number}`);
    return res.status(201).json({ ok: true, job_number: row.job_number });
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('[ac-webhook] insert failed:', e.message);
    return res.status(500).json({ error: 'insert failed' });
  } finally {
    c.release();
  }
});

module.exports = router;
module.exports._secretMatches = secretMatches;   // exported for unit tests
