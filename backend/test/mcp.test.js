// /api/mcp — read-only MCP: protocol, tools, read-only guarantee, PII, auth/transport.
// Run: node test/mcp.test.js
const assert = require('assert');
const express = require('express');
const mcp = require('../src/routes/mcp');
const { buildMcp, buildRouter, TOOLS } = mcp;

let passed = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// fake db: records every branch query; returns canned rows (including fields that must be stripped)
function fakeDeps({ failWith } = {}) {
  const seen = [];
  return {
    seen,
    publicQuery: async (sql, params) => {
      if (/WHERE slug = \$1/.test(sql)) {
        return { rows: params[0] === 'test-branch' ? [{ slug: 'test-branch', name: 'สาขาทดสอบ', schema_name: 'test_branch' }] : [] };
      }
      return { rows: [{ slug: 'test-branch', name: 'สาขาทดสอบ' }] };
    },
    ro: async (schema, sql, params) => {
      seen.push({ schema, sql, params });
      if (failWith) throw new Error(failWith);
      if (/FROM ac_repair_jobs GROUP BY status/.test(sql)) return { rows: [{ status: 'Wait Quote', n: 2 }, { status: 'Clear', n: 5 }] };
      if (/FROM ac_repair_jobs/.test(sql)) {
        return { rows: [{ job_number: 'AC-1', status: 'Wait Quote', requester: 'สมศรี', telephone: '0812345678',
          sig_requester: 'data:image/png;base64,AAAA', photo_urls: ['/u/x.jpg'], requester_signed: true, tech_signed: false }] };
      }
      if (/COUNT\(\*\)::int AS n/.test(sql)) return { rows: [{ n: 3, machines: 7 }] };
      return { rows: [] };
    },
  };
}
const call = (h, name, args, id = 1) => h({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const textOf = (r) => r.result.content[0].text;

// ── protocol ─────────────────────────────────────────────────────────────────
t('initialize advertises tools and echoes the client protocol version', async () => {
  const h = buildMcp(fakeDeps());
  const r = await h({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.strictEqual(r.result.protocolVersion, '2025-03-26');
  assert.deepStrictEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.strictEqual(r.result.serverInfo.name, 'air-system');
});

t('tools/list = exactly the 5 read-only tools, strict schemas', async () => {
  const h = buildMcp(fakeDeps());
  const r = await h({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepStrictEqual(r.result.tools.map((x) => x.name).sort(),
    ['ac_repair_status', 'list_branches', 'wash_daily', 'wash_plan', 'wo_search']);
  for (const tool of TOOLS) assert.strictEqual(tool.inputSchema.additionalProperties, false, tool.name);
  assert.ok(!TOOLS.some((x) => /create|update|delete|set|write|sign|approve/i.test(x.name)), 'no write-sounding tool');
});

t('bad requests: invalid / unknown method / unknown tool / prototype names', async () => {
  const h = buildMcp(fakeDeps());
  assert.strictEqual((await h({ id: 1, method: 'x' })).error.code, -32600);
  assert.strictEqual((await h({ jsonrpc: '2.0', id: 1, method: 'resources/list' })).error.code, -32601);
  for (const n of ['drop_all', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.strictEqual((await call(h, n, {})).error.code, -32602, n);
  }
  assert.strictEqual(await h({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

// ── branch validation ────────────────────────────────────────────────────────
t('branch must be a known active slug; hostile values never reach a branch query', async () => {
  const d = fakeDeps(); const h = buildMcp(d);
  for (const bad of ['', 'Bad Slug', "x'; DROP SCHEMA public; --", '../public', 'a'.repeat(64)]) {
    const r = await call(h, 'wash_daily', { branch: bad });
    assert.ok(r.result.isError && /slug/.test(textOf(r)), JSON.stringify(bad));
  }
  const r = await call(h, 'wash_daily', { branch: 'no-such-branch' });
  assert.ok(r.result.isError && textOf(r).includes('ไม่พบสาขา'));
  assert.strictEqual(d.seen.length, 0, 'no branch-schema query for invalid/unknown branches');
});

// ── read-only by construction ────────────────────────────────────────────────
t('every branch query of every tool is a SELECT/WITH, in the resolved schema', async () => {
  const d = fakeDeps(); const h = buildMcp(d);
  await call(h, 'list_branches', {});
  await call(h, 'wash_daily', { branch: 'test-branch', date: '2026-11-09', zone: 'PTS1' });
  await call(h, 'wash_daily', { branch: 'test-branch', month: '2026-11' });
  await call(h, 'wo_search', { branch: 'test-branch', month: '2026-11', work_type: 'fan', ac_type: 'none', status: 'approved', zone: 'PTS2' });
  await call(h, 'ac_repair_status', { branch: 'test-branch', status: 'all' });
  await call(h, 'wash_plan', { branch: 'test-branch', date: '2026-11-10' });
  assert.ok(d.seen.length >= 10, `expected many queries, got ${d.seen.length}`);
  for (const q of d.seen) {
    assert.strictEqual(q.schema, 'test_branch');
    assert.ok(/^\s*(SELECT|WITH)\b/i.test(q.sql), q.sql.slice(0, 60));
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i.test(q.sql), q.sql.slice(0, 60));
  }
});

t('arguments are placeholders, never SQL text; limits are clamped', async () => {
  const d = fakeDeps(); const h = buildMcp(d);
  const evil = "FCU' OR '1'='1";
  await call(h, 'wo_search', { branch: 'test-branch', month: '2026-11', ac_type: evil, limit: 100000 });
  const list = d.seen[d.seen.length - 1];
  assert.ok(!list.sql.includes(evil) && list.params.includes(evil));
  assert.ok(/LIMIT 100\b/.test(list.sql), 'limit clamped to 100');
  const d2 = fakeDeps(); const h2 = buildMcp(d2);
  await call(h2, 'ac_repair_status', { branch: 'test-branch', limit: 999 });
  assert.ok(/LIMIT 50\b/.test(d2.seen[d2.seen.length - 1].sql), 'repair list clamped to 50');
});

t('input validation errors come back as tool errors, not crashes', async () => {
  const h = buildMcp(fakeDeps());
  for (const [tool, args] of [
    ['wo_search', { branch: 'test-branch', month: '2026-1' }],
    ['wo_search', { branch: 'test-branch', month: '2026-11', status: 'deleted' }],
    ['wash_daily', { branch: 'test-branch', date: '9/11/2026' }],
    ['wash_daily', { branch: 'test-branch', zone: 'PTS9' }],
    ['ac_repair_status', { branch: 'test-branch', status: 'Gone' }],
    ['wash_plan', { branch: 'test-branch', work_type: 'deep' }],
  ]) {
    const r = await call(h, tool, args);
    assert.ok(r.result && r.result.isError, `${tool} ${JSON.stringify(args)}`);
  }
});

// ── PII ──────────────────────────────────────────────────────────────────────
t('repair jobs never carry requester, phone, photos or signature images', async () => {
  const h = buildMcp(fakeDeps());
  const r = await call(h, 'ac_repair_status', { branch: 'test-branch' });
  const body = textOf(r);
  for (const leak of ['สมศรี', '0812345678', 'data:image', '/u/x.jpg', 'telephone', 'requester"']) {
    assert.ok(!body.includes(leak), `leaked ${leak}`);
  }
  const out = JSON.parse(body);
  assert.strictEqual(out.counts['Wait Quote'], 2);
  assert.strictEqual(out.open, 2, 'Wait Quote counts as open');
  assert.strictEqual(out.jobs[0].requester_signed, true);
});

t('database errors are not echoed back (no schema/SQL details)', async () => {
  const h = buildMcp(fakeDeps({ failWith: 'relation "secret_table" does not exist' }));
  const r = await call(h, 'wo_search', { branch: 'test-branch', month: '2026-11' });
  assert.ok(r.result.isError);
  assert.ok(!textOf(r).includes('secret_table'));
});

// ── auth + transport (real express + HTTP) ───────────────────────────────────
async function withServer(getKey, fn) {
  const app = express();
  app.use(express.json());
  app.use('/api/mcp', buildRouter({ getKey, deps: fakeDeps() }));
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const base = `http://127.0.0.1:${srv.address().port}/api/mcp`;
  try { await fn(base); } finally { srv.close(); }
}
const KEY = 'air_mcp_' + 'k'.repeat(40);
const post = (base, body, auth) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body) });

t('fail-closed: no key or a short key → 503 for everyone', async () => {
  for (const k of [undefined, '', 'short-key-123']) {
    await withServer(() => k, async (base) => {
      const r = await post(base, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, `Bearer ${k || 'x'}`);
      assert.strictEqual(r.status, 503, String(k));
    });
  }
});

t('auth: missing / wrong / non-Bearer token → 401; right key → 200', async () => {
  await withServer(() => KEY, async (base) => {
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    assert.strictEqual((await post(base, body)).status, 401);
    assert.strictEqual((await post(base, body, `Bearer ${KEY}x`)).status, 401);
    assert.strictEqual((await post(base, body, `Basic ${KEY}`)).status, 401);
    assert.strictEqual((await post(base, body, KEY)).status, 401);
    const ok = await post(base, body, `Bearer ${KEY}`);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await ok.json()).result.tools.length, 5);
  });
});

t('transport: GET 405, batch 400, notification 202', async () => {
  await withServer(() => KEY, async (base) => {
    assert.strictEqual((await fetch(base)).status, 405);
    assert.strictEqual((await post(base, [{ jsonrpc: '2.0', id: 1, method: 'ping' }], `Bearer ${KEY}`)).status, 400);
    assert.strictEqual((await post(base, { jsonrpc: '2.0', method: 'notifications/initialized' }, `Bearer ${KEY}`)).status, 202);
  });
});

(async () => {
  for (const [name, fn] of tests) { await fn(); passed++; console.log(`  ok - ${name}`); }
  console.log(`\n${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
