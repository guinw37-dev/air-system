// Shared creation logic for ac_repair_jobs — used by the manual create route,
// the manual import route, and the repair-system auto-import webhook. The caller
// supplies a schema-pinned client (req.tx() / txClient(schema)) and owns the
// surrounding BEGIN/COMMIT.
const dayjs = require('dayjs');

// Job number: AC-{พ.ศ.}-{MM}-{NNNN}, MAX-based so deletes don't recycle numbers.
async function genJobNumber(client) {
  const be = dayjs().year() + 543;
  const mm = dayjs().format('MM');
  const prefix = `AC-${be}-${mm}-`;
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(CAST(RIGHT(job_number, 4) AS INTEGER)), 0) AS maxn
       FROM ac_repair_jobs WHERE job_number LIKE $1`,
    [`${prefix}%`]
  );
  return `${prefix}${String(rows[0].maxn + 1).padStart(4, '0')}`;
}

// Insert one job. `client` MUST be pinned to the target branch schema.
// Returns { duplicate: existingRow } when data.repair_job_id was already
// imported (idempotent re-delivery), else { row: insertedRow }.
async function insertJob(client, data, createdBy) {
  if (data.repair_job_id) {
    const { rows: ex } = await client.query(
      'SELECT id, job_number FROM ac_repair_jobs WHERE repair_job_id = $1',
      [data.repair_job_id]
    );
    if (ex.length) return { duplicate: ex[0] };
  }
  const jobNumber = await genJobNumber(client);
  const { rows } = await client.query(
    `INSERT INTO ac_repair_jobs
       (job_number, repair_job_id, repair_job_number, asset_code,
        building, floor, department, requester, telephone, description, file_url, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [jobNumber, data.repair_job_id || null, data.repair_job_number || null, data.asset_code || null,
     data.building || '', data.floor || '', data.department || '', data.requester || '',
     data.telephone || '', (data.description || '').trim(), data.file_url || '-', createdBy || null]
  );
  return { row: rows[0] };
}

module.exports = { genJobNumber, insertJob };
