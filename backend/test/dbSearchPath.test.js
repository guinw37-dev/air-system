// Pooled connections must not carry a branch search_path into the next checkout.
// A branch query pins `SET search_path TO "<branch>", public` on a pooled client; if that
// client goes back to the pool unchanged, the next public-scope query (apex login,
// super-admin user management, ...) silently reads the BRANCH tables instead of public.
//
// Needs a real Postgres with at least one provisioned branch (the bug lives in pg session
// state, a fake DB cannot show it). Uses DB_* env like the app; without a reachable DB it
// prints SKIP and exits 0.
//   cd backend && source ../.localdb/env.sh && node test/dbSearchPath.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'db-search-path-test-secret';
const assert = require('assert');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');

const banner = (m) => console.log(`\n==== dbSearchPath: ${m} ====\n`);

(async () => {
  const pool = require('../src/db/pool');
  try { await pool.query('SELECT 1'); } catch (e) {
    banner(`SKIP — no database reachable (${e.code || e.message})`); await pool.end().catch(() => {}); return;
  }
  const { query, txClient } = require('../src/db');
  const { resolveBranch } = require('../src/middleware/resolveBranch');
  const { slugToSchema } = require('../src/utils/schema');

  const { rows: br } = await pool.query(
    `SELECT slug, COALESCE(schema_name, slug) AS schema FROM public.clients
      WHERE active = true AND schema_name IS NOT NULL ORDER BY id LIMIT 1`);
  if (!br.length) { banner('SKIP — no provisioned branch in public.clients'); await pool.end(); return; }
  const slug = br[0].slug, schema = slugToSchema(br[0].schema);
  const defaultPath = (await pool.query('SHOW search_path')).rows[0].search_path;   // fresh client = server default

  // test-only users: one that exists ONLY in the branch schema, one super-admin in public
  const tag = Date.now().toString(36);
  const BRANCH_USER = `sp_branch_${tag}`, SUPER_USER = `sp_super_${tag}`, PW = 'sp-test-pw-123';
  const hash = await bcrypt.hash(PW, 4);
  await query(schema, `INSERT INTO users (name, username, password_hash, role) VALUES ('sp test branch', $1, $2, 'technician')`, [BRANCH_USER, hash]);
  await pool.query(`INSERT INTO public.users (name, username, password_hash, role) VALUES ('sp test super', $1, $2, 'super_admin')`, [SUPER_USER, hash]);

  let server; let pass = 0; let fail = 0;
  const check = async (name, fn) => {
    try { await fn(); pass++; console.log('  ok   ', name); } catch (e) { fail++; console.log('  FAIL ', name, '\n       ', e.message); }
  };
  const publicPath = async () => (await pool.query('SHOW search_path')).rows[0].search_path;
  const leaks = (p) => p.includes(schema);
  // search_path of the next checkout of THIS client — a check that lands on another pooled
  // connection proves nothing, so wait for it to come back idle and insist on getting it.
  const pathOnNextCheckout = async (client) => {
    for (let i = 0; i < 50 && !pool._idle.some((x) => x === client); i++) await new Promise((r) => setTimeout(r, 10));
    const c2 = await pool.connect();
    try {
      assert.strictEqual(c2, client, 'next checkout returned a different connection — check is inconclusive');
      return (await c2.query('SHOW search_path')).rows[0].search_path;
    } finally { c2.release(); }
  };

  try {
    console.log(`branch=${slug} schema=${schema} default search_path=${defaultPath}`);

    // ── 1. helper layer: what a pooled client looks like after a branch query ──
    await check('branch query() sees its own schema (positive control)', async () => {
      const { rows } = await query(schema, 'SHOW search_path');
      assert.ok(leaks(rows[0].search_path), rows[0].search_path);
    });
    await check('after query(schema) the next pool.query is back on the default search_path', async () => {
      for (let i = 0; i < 5; i++) {
        await query(schema, 'SELECT 1');
        const before = pool.idleCount;
        const p = await publicPath();   // query() has returned its client already → it is the idle one pool.query takes
        assert.ok(before >= 1, 'no idle client after query() — check is inconclusive');
        assert.ok(!leaks(p), `pooled client still on "${p}" after a branch query`);
      }
    });
    await check('after txClient(schema) COMMIT + release the next pool.query is back on default', async () => {
      const c = await txClient(schema);
      await c.query('BEGIN');
      const inside = (await c.query('SHOW search_path')).rows[0].search_path;
      await c.query('COMMIT');
      c.release();
      assert.ok(leaks(inside), 'transaction client must be pinned to the branch while in use');
      const p = await pathOnNextCheckout(c);
      assert.ok(!leaks(p), `pooled client still on "${p}" after a branch transaction`);
    });
    await check('after txClient(schema) ROLLBACK + release the next pool.query is back on default', async () => {
      const c = await txClient(schema);
      await c.query('BEGIN');
      await c.query('SELECT 1');
      await c.query('ROLLBACK');
      c.release();
      const p = await pathOnNextCheckout(c);
      assert.ok(!leaks(p), `pooled client still on "${p}" after a rolled-back branch transaction`);
    });
    await check('provisionBranchSchema (boot + branch creation) leaves no branch path on the pool', async () => {
      const { provisionBranchSchema } = require('../src/db/provision');
      await provisionBranchSchema(br[0].schema);   // idempotent: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
      const p = await publicPath();
      assert.ok(!leaks(p), `pooled client still on "${p}" after provisioning`);
    });
    await check('releaseClean() resets a manually pinned client', async () => {
      const { releaseClean } = require('../src/db/cleanRelease');
      const c = await pool.connect();
      await c.query(`SET search_path TO "${schema}", public`);
      await releaseClean(c);
      const p = await pathOnNextCheckout(c);
      assert.ok(!leaks(p), `pooled client still on "${p}" after releaseClean`);
    });
    await check('public tables still resolve through pool.query (positive control)', async () => {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM users WHERE username = $1', [SUPER_USER]);
      assert.strictEqual(rows[0].n, 1);
    });

    // ── 2. request layer: real resolveBranch + real auth router over HTTP ──
    const app = express();
    app.use(express.json());
    app.use(resolveBranch);
    app.use('/api/auth', require('../src/routes/auth'));
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}/api/auth/login`;
    const login = (username, branch) => fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(branch ? { 'X-Branch': branch } : {}) },
      body: JSON.stringify({ username, password: PW }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));

    await check('branch login with X-Branch works and is NOT super (positive control)', async () => {
      const r = await login(BRANCH_USER, slug);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.user.isSuper, false);
      assert.strictEqual(r.body.user.branchSlug, slug);
    });
    await check('apex login (no X-Branch) with a branch-only account is refused right after branch traffic', async () => {
      for (let i = 0; i < 4; i++) await query(schema, 'SELECT 1');      // leave pooled clients the way branch requests do
      const r = await login(BRANCH_USER, null);
      assert.strictEqual(r.status, 401, `got ${r.status} ${JSON.stringify(r.body.user || r.body)}`);
    });
    await check('super-admin apex login works right after branch traffic (positive control)', async () => {
      for (let i = 0; i < 4; i++) await query(schema, 'SELECT 1');
      const r = await login(SUPER_USER, null);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.user.isSuper, true);
    });
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await query(schema, 'DELETE FROM users WHERE username = $1', [BRANCH_USER]).catch((e) => console.log('cleanup branch user:', e.message));
    await pool.query('DELETE FROM public.users WHERE username = $1', [SUPER_USER]).catch((e) => console.log('cleanup super user:', e.message));
    await pool.end();
  }
  banner(`${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
