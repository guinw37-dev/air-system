// Schema-per-tenant DB helpers. Each branch (สาขา/ลูกค้า) lives in its own
// Postgres schema; tenant-bound queries run with that schema first on the
// search_path, so the same SQL is hard-isolated per branch while still seeing
// the shared `public` tables (clients/users/inspection_template_items) via the
// public fallback on the search_path.
//
//   const { query, txClient } = require('../db');
//   await query('acme_co', 'SELECT * FROM work_orders WHERE id=$1', [id]);
//
// pool is re-exported so the existing `require('../db/pool')` callers and the
// global/public-only queries (auth super-admins, registry) keep working.
const pool = require('./pool');
const { slugToSchema } = require('../utils/schema');

// One-shot query inside a branch schema. Checks out a client, pins search_path,
// runs, and always releases.
async function query(schema, sql, params) {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${slugToSchema(schema)}", public`);
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// A schema-pinned client for multi-statement transactions (BEGIN/COMMIT). The
// CALLER owns release() — mirror the existing `pool.connect()` + try/finally
// pattern, just swap the connect line for this.
//
//   const client = await txClient(schema);
//   try { await client.query('BEGIN'); ...; await client.query('COMMIT'); }
//   catch (e) { await client.query('ROLLBACK'); throw e; }
//   finally { client.release(); }
async function txClient(schema) {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${slugToSchema(schema)}", public`);
    return client;
  } catch (err) {
    client.release();
    throw err;
  }
}

module.exports = { pool, query, txClient };
