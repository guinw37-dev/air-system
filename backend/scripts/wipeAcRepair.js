// wipeAcRepair — ล้างใบงานซ่อมแอร์ + memo ทุกสาขา เริ่มต้นระบบใหม่ (Worawit 20 Aug 2026).
// รันบน server (Coolify terminal):  node scripts/wipeAcRepair.js          → dry-run (นับอย่างเดียว)
//                                   node scripts/wipeAcRepair.js --wipe   → backup เป็น JSON แล้วลบจริง
// backup เก็บที่ <UPLOAD_DIR>/backup/ac-repair-<timestamp>/<schema>.json — อยู่บน
// volume uploads ที่ persist ข้าม deploy.
const fs = require('fs');
const path = require('path');
const { pool, query } = require('../src/db');

const WIPE = process.argv.includes('--wipe');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');

async function main() {
  const { rows: clients } = await pool.query(
    `SELECT slug, COALESCE(schema_name, slug) AS schema, name FROM clients WHERE active = true ORDER BY slug`
  );
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(UPLOAD_DIR, 'backup', `ac-repair-${stamp}`);
  if (WIPE) fs.mkdirSync(backupDir, { recursive: true });

  let totalJobs = 0, totalMemos = 0;
  for (const c of clients) {
    let jobs = [], memos = [];
    try {
      ({ rows: jobs } = await query(c.schema, 'SELECT * FROM ac_repair_jobs ORDER BY id'));
    } catch { console.log(`- ${c.slug}: no ac_repair_jobs table, skip`); continue; }
    try {
      ({ rows: memos } = await query(c.schema, 'SELECT * FROM ac_memos ORDER BY id'));
    } catch { /* schema not yet migrated — no memos */ }

    totalJobs += jobs.length; totalMemos += memos.length;
    console.log(`- ${c.slug} (${c.name}): ${jobs.length} jobs, ${memos.length} memos`);
    if (!WIPE || (!jobs.length && !memos.length)) continue;

    fs.writeFileSync(
      path.join(backupDir, `${c.schema}.json`),
      JSON.stringify({ branch: c, exported_at: new Date().toISOString(), jobs, memos }, null, 1)
    );
    // ac_memos ลบก่อน (FK → ac_repair_jobs); ลบด้วย DELETE ธรรมดา + reset ลำดับ id
    try { await query(c.schema, 'DELETE FROM ac_memos'); } catch { /* no table */ }
    await query(c.schema, 'DELETE FROM ac_repair_jobs');
    await query(c.schema, `ALTER SEQUENCE ac_repair_jobs_id_seq RESTART WITH 1`);
    try { await query(c.schema, `ALTER SEQUENCE ac_memos_id_seq RESTART WITH 1`); } catch { /* no table */ }
    console.log(`  ✓ backed up + wiped`);
  }
  console.log(`\nTOTAL: ${totalJobs} jobs, ${totalMemos} memos across ${clients.length} branches`);
  console.log(WIPE ? `Backup at: ${backupDir}` : 'Dry-run only — รันซ้ำด้วย --wipe เพื่อลบจริง');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
