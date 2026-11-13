// Static guard: any runtime module that pins a search_path on a pooled client must hand
// that client back through db/cleanRelease (releaseClean / resetOnRelease). A plain
// client.release() after `SET search_path` leaves the branch pinned on the connection, and
// the next public-scope query on it reads the branch's tables (see dbSearchPath.test.js).
// Standalone CLI scripts (db/migrate_*.js, db/add_branch.js, db/seed.js) end the pool when
// they finish, so their connections never serve a request — they are exempt.
// Run: node test/searchPathGuard.test.js   (no database needed)
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src');
const CLI = /^db[\\/](migrate_[^\\/]*|add_branch|seed)\.js$/;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);

const offenders = [];
let pinning = 0;
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file);
  if (CLI.test(rel) || rel === path.join('db', 'cleanRelease.js')) continue;
  const code = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  if (!/SET\s+search_path\s+TO/i.test(code)) continue;
  pinning++;
  if (!/releaseClean|resetOnRelease/.test(code)) offenders.push(rel);
}

assert.ok(pinning >= 2, `guard found only ${pinning} module(s) that pin a search_path — the scan is broken, not the code clean`);
assert.deepStrictEqual(offenders, [], `pins a search_path but releases without db/cleanRelease: ${offenders.join(', ')}`);
console.log(`searchPathGuard: ${pinning} runtime module(s) pin a search_path, all release through db/cleanRelease`);
