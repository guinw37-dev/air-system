// Tenant isolation helper.
//
// Model: TW staff (technician/central_admin/approver/admin) serve MULTIPLE
// clients, so users are NOT bound to a single client_id. Isolation here means:
// every endpoint that touches a tenant-bound table (units, work_orders,
// part_requisitions, repair_logs) MUST scope its rows to one client_id taken
// from the request — never return rows across clients by accident.
//
// Usage:
//   router.get('/units', authMiddleware, requireClientId, async (req, res) => {
//     // req.clientId is a validated positive int here
//     ... WHERE client_id = req.clientId ...
//   });
// or pull it ad-hoc with getClientId(req) when it is optional.

function getClientId(req) {
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

module.exports = { getClientId, requireClientId, assertRowClient };
