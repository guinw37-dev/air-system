// Apex (no branch) is for Super Dev only. Any other account must sign in on its own
// branch, and a token that carries no branch must belong to a super_admin.
//
// Part A checks authMiddleware with signed JWTs (no DB). Part B runs the real
// resolveBranch + auth router over HTTP against Postgres; without a reachable DB it
// prints SKIP for that part.
//   cd backend && source ../.localdb/env.sh && node test/apexSuperOnly.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'apex-super-only-test-secret';
const assert = require('assert');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const banner = (m) => console.log(`\n==== apexSuperOnly: ${m} ====\n`);
let pass = 0; let fail = 0;
const check = async (name, fn) => {
  try { await fn(); pass++; console.log('  ok   ', name); } catch (e) { fail++; console.log('  FAIL ', name, '\n       ', e.message); }
};
const sign = (p) => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: '5m' });

(async () => {
  // ── A. authMiddleware ──
  const { authMiddleware } = require('../src/middleware/auth');
  const runAuth = (token, branch) => {
    let status = 200; let nexted = false;
    const res = { status(s) { status = s; return this; }, json() { return this; } };
    authMiddleware({ method: 'GET', headers: { authorization: `Bearer ${token}` }, query: {}, branch }, res, () => { nexted = true; });
    return { status, nexted };
  };

  await check('token without a branch and a non-super role is refused', async () => {
    const r = runAuth(sign({ id: 9, role: 'admin', branchSlug: null, isSuper: true }), null);
    assert.strictEqual(r.nexted, false, 'request went through');
    assert.strictEqual(r.status, 401);
  });
  await check('token without a branch and without a role is refused', async () => {
    const r = runAuth(sign({ work_order_id: 1, scope: 'area_owner_sign', branch: null }), null);
    assert.strictEqual(r.nexted, false, 'request went through');
    assert.strictEqual(r.status, 401);
  });
  await check('super_admin token without a branch passes (positive control)', async () => {
    const r = runAuth(sign({ id: 1, role: 'super_admin', branchSlug: null, isSuper: true }), null);
    assert.strictEqual(r.nexted, true);
  });
  await check('branch token on its own branch passes (positive control)', async () => {
    const r = runAuth(sign({ id: 2, role: 'technician', branchSlug: 'pts1', isSuper: false }), { slug: 'pts1' });
    assert.strictEqual(r.nexted, true);
  });

  // ── B. login + /me over HTTP ──
  const pool = require('../src/db/pool');
  let dbOk = true;
  try { await pool.query('SELECT 1'); } catch (e) { dbOk = false; banner(`part B SKIP — no database reachable (${e.code || e.message})`); }
  let br = [];
  if (dbOk) {
    ({ rows: br } = await pool.query(
      `SELECT slug, COALESCE(schema_name, slug) AS schema FROM public.clients
        WHERE active = true AND schema_name IS NOT NULL ORDER BY id LIMIT 1`));
    if (!br.length) banner('part B SKIP — no provisioned branch in public.clients');
  }
  if (dbOk && br.length) {
    const { resolveBranch } = require('../src/middleware/resolveBranch');
    const { slugToSchema } = require('../src/utils/schema');
    const slug = br[0].slug, schema = slugToSchema(br[0].schema);

    // Test-only accounts. Inserted with schema-qualified names so setup never changes a
    // pooled connection's search_path.
    const tag = Date.now().toString(36);
    const SUPER = `as_super_${tag}`, ADMIN = `as_admin_${tag}`, TECH = `as_tech_${tag}`, BRANCH = `as_branch_${tag}`;
    const PW = 'as-test-pw-123';
    const hash = await bcrypt.hash(PW, 4);
    const ins = (table, name, username, role) => pool.query(
      `INSERT INTO ${table} (name, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id`, [name, username, hash, role]);
    const superId = (await ins('public.users', 'as test super', SUPER, 'super_admin')).rows[0].id;
    const adminId = (await ins('public.users', 'as test admin', ADMIN, 'admin')).rows[0].id;
    await ins('public.users', 'as test tech', TECH, 'technician');
    await ins(`"${schema}".users`, 'as test branch', BRANCH, 'technician');

    const app = express();
    app.use(express.json());
    app.use(resolveBranch);
    app.use('/api/auth', require('../src/routes/auth'));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}/api/auth`;
    const call = (path, { method = 'GET', branch, token, body } = {}) => fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(branch ? { 'X-Branch': branch } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const login = (username, branch, password = PW) => call('/login', { method: 'POST', branch, body: { username, password } });

    try {
      console.log(`branch=${slug} schema=${schema}`);
      // apex first: no branch traffic has touched the pool yet
      let superToken = null;
      await check('central account with role admin cannot sign in on apex', async () => {
        const r = await login(ADMIN, null);
        assert.strictEqual(r.status, 401, `got ${r.status} ${JSON.stringify(r.body.user || r.body)}`);
        assert.strictEqual(r.body.token, undefined);
      });
      await check('refusal looks exactly like a wrong password', async () => {
        const right = await login(TECH, null);
        const wrong = await login(TECH, null, 'not-the-password');
        assert.deepStrictEqual([right.status, right.body], [wrong.status, wrong.body]);
      });
      await check('Super Dev can sign in on apex (positive control)', async () => {
        const r = await login(SUPER, null);
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.user.isSuper, true);
        assert.strictEqual(r.body.user.role, 'super_admin');
        superToken = r.body.token;
      });
      await check('apex token issued to a non-super account before the fix no longer works', async () => {
        const old = sign({ id: adminId, username: ADMIN, name: 'as test admin', role: 'admin', branchSlug: null, isSuper: true });
        const r = await call('/me', { token: old });
        assert.strictEqual(r.status, 401, `got ${r.status} ${JSON.stringify(r.body)}`);
      });
      await check('Super Dev token still reads /me on apex (positive control)', async () => {
        assert.ok(superToken, 'no Super Dev token from the login check');
        const r = await call('/me', { token: superToken });
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.id, superId);
        assert.strictEqual(r.body.isSuper, true);
      });
      await check('branch account signs in on its branch, not super (positive control)', async () => {
        const r = await login(BRANCH, slug);
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.user.isSuper, false);
        assert.strictEqual(r.body.user.branchSlug, slug);
        const me = await call('/me', { branch: slug, token: r.body.token });
        assert.strictEqual(me.status, 200, JSON.stringify(me.body));
        assert.strictEqual(me.body.username, BRANCH);
      });
    } finally {
      await new Promise((r) => server.close(r));
      await pool.query('DELETE FROM public.users WHERE username = ANY($1)', [[SUPER, ADMIN, TECH]]).catch((e) => console.log('cleanup public users:', e.message));
      await pool.query(`DELETE FROM "${schema}".users WHERE username = $1`, [BRANCH]).catch((e) => console.log('cleanup branch user:', e.message));
    }
  }
  await pool.end().catch(() => {});
  banner(`${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
