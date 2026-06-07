// Resolve the branch (ลูกค้า/สาขา) for a request and hand handlers a
// schema-scoped DB. Schema-per-tenant: each branch's data lives in its own
// Postgres schema; this middleware decides which schema the request reads/writes.
//
// Slug source (Phase A): `X-Branch` header → host subdomain. (JWT `branchSlug`
// precedence + cross-tenant enforcement arrive with auth in Phase C.)
//
// Sets on req:
//   req.branch  = { id, slug, name, schema_name } | null (apex/super-admin)
//   req.schema  = schema_name | null
//   req.db(sql, params)  → runs in the branch schema, or public when apex
//   req.tx()             → schema-pinned tx client, or a plain pool client when apex
//
// NOT mounted yet (Phase A is additive groundwork). When mounted globally it is
// safe: with no branch it falls back to the current public-schema behavior.
const { pool, query, txClient } = require('../db');

const SLUG_RE = /^[a-z0-9-]{1,63}$/;
const NON_BRANCH = new Set(['www', 'localhost', 'api', 'app']);

// Leftmost DNS label, or null for apex/www/IP/localhost.
function leftmostLabel(hostname) {
  const host = String(hostname || '').split(':')[0].toLowerCase().trim();
  if (!host || host === 'localhost') return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split('.');
  if (parts.length < 3) return null;
  const label = parts[0];
  if (NON_BRANCH.has(label)) return null;
  return SLUG_RE.test(label) ? label : null;
}

// subdomain/slug → branch row, cached briefly.
const _cache = new Map();
const TTL_MS = 60 * 1000;
async function lookupBranch(label) {
  if (!label || !SLUG_RE.test(label)) return null;
  const hit = _cache.get(label);
  if (hit && hit.exp > Date.now()) return hit.val;
  const { rows } = await pool.query(
    `SELECT id, slug, name, schema_name FROM clients
     WHERE active = true AND (subdomain = $1 OR slug = $1) LIMIT 1`,
    [label]
  );
  const val = rows[0] || null;
  _cache.set(label, { val, exp: Date.now() + TTL_MS });
  return val;
}
function invalidateBranchCache(label) { label ? _cache.delete(label) : _cache.clear(); }

function attachPublicDb(req) {
  req.branch = null;
  req.schema = null;
  req.db = (sql, params) => pool.query(sql, params);  // public search_path
  req.tx = () => pool.connect();
}

async function resolveBranch(req, res, next) {
  try {
    const hdr = req.headers['x-branch'];
    const label = (hdr && SLUG_RE.test(String(hdr).toLowerCase()) ? String(hdr).toLowerCase() : null)
      || leftmostLabel(req.hostname || req.headers['x-forwarded-host'] || req.headers.host);
    if (!label) { attachPublicDb(req); return next(); }
    const b = await lookupBranch(label);
    if (!b) return res.status(404).json({ error: 'unknown branch' });
    const schema = b.schema_name || b.slug;
    req.branch = b;
    req.schema = schema;
    req.db = (sql, params) => query(schema, sql, params);
    req.tx = () => txClient(schema);
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { resolveBranch, leftmostLabel, lookupBranch, invalidateBranchCache };
