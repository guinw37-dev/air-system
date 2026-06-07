// Tenant isolation helper.
//
// Model: TW staff (technician/central_admin/approver/admin) serve MULTIPLE
// clients, so users are NOT bound to a single client_id. Isolation here means:
// every endpoint that touches a tenant-bound table (units, work_orders,
// part_requisitions, repair_logs) MUST scope its rows to one client_id taken
// from the request — never return rows across clients by accident.
//
// Two ways the client is decided:
//   1. SUBDOMAIN (resolveTenant): a request on phayathai-1.<domain> is FORCED to
//      that branch's client_id; an explicit ?client_id that disagrees is 403'd.
//   2. EXPLICIT (apex domain / super-admin): no branch subdomain → the old
//      behavior, client_id comes from query/body and pages pick it.
//
// Usage:
//   router.get('/units', authMiddleware, requireClientId, async (req, res) => {
//     // req.clientId is a validated positive int here
//     ... WHERE client_id = req.clientId ...
//   });
// or pull it ad-hoc with getClientId(req) when it is optional.

const pool = require('../db/pool');

const SLUG_RE = /^[a-z0-9-]{1,63}$/;
// Hosts that are NOT a branch: apex, www, localhost, raw IPv4.
const NON_BRANCH = new Set(['www', 'localhost', 'api', 'app']);

// Leftmost DNS label of a hostname, or null when the host is apex/www/IP/local.
// "phayathai-1.pypl.online" → "phayathai-1"; "pypl.online" → null (apex, 2 labels);
// "127.0.0.1" / "localhost" → null.
function leftmostLabel(hostname) {
  const host = String(hostname || '').split(':')[0].toLowerCase().trim();
  if (!host || host === 'localhost') return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null; // raw IPv4
  const parts = host.split('.');
  if (parts.length < 3) return null;                     // apex (example.com) = no subdomain
  const label = parts[0];
  if (NON_BRANCH.has(label)) return null;
  return SLUG_RE.test(label) ? label : null;
}

// subdomain -> { id, slug, name } cache (active clients), TTL'd. Cheap and
// invalidated explicitly when a branch is created/updated.
const _cache = new Map();
const TTL_MS = 60 * 1000;

async function lookupClientBySubdomain(label) {
  if (!label || !SLUG_RE.test(label)) return null;
  const hit = _cache.get(label);
  if (hit && hit.exp > Date.now()) return hit.val;
  const { rows } = await pool.query(
    `SELECT id, slug, name FROM clients WHERE subdomain = $1 AND active = true LIMIT 1`,
    [label]
  );
  const val = rows[0] || null;
  _cache.set(label, { val, exp: Date.now() + TTL_MS });
  return val;
}

function invalidateTenantCache(label) {
  if (label) _cache.delete(label);
  else _cache.clear();
}

// GLOBAL middleware: resolve the branch from the request host. On a branch
// subdomain it FORCES req.clientId; an explicit conflicting client_id is 403'd.
// On apex/www/IP/localhost it is a no-op (req.tenant = null) — old behavior.
async function resolveTenant(req, res, next) {
  try {
    // Branch comes from the request host (same-origin deploy) OR an explicit
    // X-Branch slug header (air-system frontend + backend are separate origins,
    // so the backend host is NOT the branch — the SPA forwards its branch here).
    const hdr = req.headers['x-branch'];
    const label = (hdr && SLUG_RE.test(String(hdr).toLowerCase()) ? String(hdr).toLowerCase() : null)
      || leftmostLabel(req.hostname || req.headers['x-forwarded-host'] || req.headers.host);
    if (!label) { req.tenant = null; return next(); }
    const c = await lookupClientBySubdomain(label);
    if (!c) return res.status(404).json({ error: 'unknown branch' });
    req.tenant = c;
    req.clientId = c.id;                         // force tenant for downstream handlers
    // A branch request is authoritative: if a page also sent a different
    // client_id (query or body), the branch wins — overwrite it rather than
    // erroring, so existing multi-client pages keep working on a subdomain.
    if (req.query && 'client_id' in req.query) req.query.client_id = String(c.id);
    if (req.body && typeof req.body === 'object' && 'client_id' in req.body) req.body.client_id = c.id;
    next();
  } catch (err) {
    next(err);
  }
}

// Resolve the effective client_id. A subdomain-forced req.clientId wins (unless
// rawOnly, used by resolveTenant itself to detect mismatch). Otherwise read
// query/body.
function getClientId(req, rawOnly = false) {
  if (!rawOnly && Number.isInteger(req.clientId) && req.clientId > 0) return req.clientId;
  const raw = req.query.client_id ?? req.body?.client_id;
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Hard gate: 400 unless a usable client_id is present. Sets req.clientId.
function requireClientId(req, res, next) {
  const id = getClientId(req);
  if (!id) return res.status(400).json({ error: 'client_id required' });
  req.clientId = id;
  next();
}

// Guard a child row belongs to the expected client before mutating it.
// Returns true if (table.id == id) AND its client_id == clientId.
async function assertRowClient(pool, table, id, clientId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND client_id = $2`,
    [id, clientId]
  );
  return rows.length > 0;
}

module.exports = {
  getClientId, requireClientId, assertRowClient,
  resolveTenant, leftmostLabel, lookupClientBySubdomain, invalidateTenantCache,
};
