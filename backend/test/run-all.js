// Backend test entry point (`npm test`). Runs EVERY test/*.test.js, each in its
// own node process, and exits non-zero if any of them failed.
//
// Why not `node a && node b && …`: the first red file stopped the chain, so every
// file after it silently never ran — roles.test.js was red from Aug to Nov 2026
// and new tests appended after it were never executed. Here a failing file is
// reported and the run continues, and a new test file needs no package.json edit.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_DIR = __dirname;
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS) || 120000;   // a hung file fails, not the whole run

const files = fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.js')).sort();
if (files.length === 0) {
  // an empty run must never read as green
  console.error(`run-all: no *.test.js found in ${TEST_DIR}`);
  process.exit(1);
}

const results = [];
for (const file of files) {
  console.log(`\n── ${file} ──`);
  const started = Date.now();
  const r = spawnSync(process.execPath, [...process.execArgv, path.join(TEST_DIR, file)], {
    cwd: path.dirname(TEST_DIR),   // backend/, same as `npm test`
    stdio: 'inherit',
    timeout: TIMEOUT_MS,
  });
  let rc;
  if (r.error && r.error.code === 'ETIMEDOUT') rc = `timeout ${TIMEOUT_MS / 1000}s`;
  else if (r.error) rc = `error ${r.error.message}`;
  else if (r.status === null) rc = `signal ${r.signal}`;
  else rc = r.status;
  results.push({ file, rc, ok: rc === 0, secs: ((Date.now() - started) / 1000).toFixed(1) });
}

const failed = results.filter((x) => !x.ok);
const width = Math.max(...files.map((f) => f.length));
console.log('\n── summary ──');
for (const x of results) {
  console.log(`${x.ok ? 'ok  ' : 'FAIL'}  ${x.file.padEnd(width)}  rc=${x.rc}  ${x.secs}s`);
}
console.log(`${results.length} files: ${results.length - failed.length} passed, ${failed.length} failed`);
process.exitCode = failed.length ? 1 : 0;
