const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── helpers ────────────────────────────────────────────────────────────────
function strVal(row, ...keys) {
  for (const k of keys) {
    const v = (row[k] || '').toString().trim();
    if (v) return v;
  }
  return '';
}

function intVal(row, ...keys) {
  for (const k of keys) {
    const v = parseInt((row[k] || '').toString().replace(/,/g, ''));
    if (!isNaN(v) && v > 0) return v;
  }
  return null;
}

async function getOrCreate(cache, key, queryFn, insertFn) {
  if (cache[key] !== undefined) return cache[key];
  const existing = await queryFn();
  if (existing.length) { cache[key] = existing[0].id; return existing[0].id; }
  const ins = await insertFn();
  cache[key] = ins[0].id;
  return ins[0].id;
}

// ── GET /api/import/template/ac-units  (download template) ────────────────
router.get('/template/ac-units', authMiddleware, (req, res) => {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet([
    ['hospital', 'building', 'floor', 'department', 'ac_code', 'ac_name', 'ac_type', 'brand', 'capacity_btu', 'pm_interval_months'],
    ['โรงพยาบาลพญาไท ศรีราชา 1', 'อาคาร A', 'ชั้น 1', 'แผนกอายุรกรรม', 'AC-001', 'เครื่องแอร์ห้องพยาบาล', 'FCU', 'Carrier', 36000, 3],
    ['โรงพยาบาลพญาไท ศรีราชา 1', 'อาคาร A', 'ชั้น 2', 'ICU', 'AC-002', '', 'AHU', 'Daikin', 48000, 2],
  ]);
  ws['!cols'] = [20, 15, 10, 20, 12, 20, 8, 12, 12, 12].map((w) => ({ wch: w }));
  xlsx.utils.book_append_sheet(wb, ws, 'AC Units');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="template_ac_units.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── GET /api/import/template/work-history ─────────────────────────────────
router.get('/template/work-history', authMiddleware, (req, res) => {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet([
    ['ac_code', 'work_type', 'work_date', 'tech1_name', 'tech2_name'],
    ['AC-001', 'major', '2024-01-15', 'tech1', 'tech2'],
    ['AC-002', 'minor', '2024-02-10', 'tech1', ''],
  ]);
  ws['!cols'] = [12, 10, 14, 16, 16].map((w) => ({ wch: w }));
  xlsx.utils.book_append_sheet(wb, ws, 'Work History');
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="template_work_history.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── POST /api/import/ac-units ──────────────────────────────────────────────
router.post('/ac-units', authMiddleware, requireRole('admin', 'owner'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws, { defval: '' });

    const results = { created: 0, updated: 0, skipped: 0, errors: [] };
    const hCache = {}, bCache = {}, fCache = {}, dCache = {};

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2;
      try {
        const hospitalName = strVal(row, 'hospital', 'โรงพยาบาล', 'Hospital');
        const buildingName = strVal(row, 'building', 'อาคาร', 'Building') || 'Main';
        const floorName    = strVal(row, 'floor', 'ชั้น', 'Floor') || 'ชั้น 1';
        const deptName     = strVal(row, 'department', 'แผนก', 'ห้อง', 'Department') || 'ทั่วไป';
        const acCode       = strVal(row, 'ac_code', 'รหัส', 'AC Code', 'ชื่อทรัพย์สิน');
        const acName       = strVal(row, 'ac_name', 'ชื่อ', 'Name');
        const acType       = strVal(row, 'ac_type', 'ประเภท', 'Type', 'ประเภททรัพย์สิน');
        const brand        = strVal(row, 'brand', 'ยี่ห้อ', 'Brand', 'ยี่ห้อ/Modal');
        const btu          = intVal(row, 'capacity_btu', 'btu', 'BTU');
        const pmInterval   = intVal(row, 'pm_interval_months', 'pm_interval') || 3;

        if (!acCode)       { results.skipped++; continue; }
        if (!hospitalName) { results.errors.push(`Row ${rowNum} (${acCode}): missing hospital`); continue; }

        // Hospital
        const hId = await getOrCreate(hCache, hospitalName,
          () => pool.query('SELECT id FROM hospitals WHERE LOWER(name)=LOWER($1)', [hospitalName]).then(r => r.rows),
          async () => {
            const slug = hospitalName.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase().slice(0, 50)
              + '-' + Date.now();
            return pool.query(
              'INSERT INTO hospitals (name, slug) VALUES ($1,$2) RETURNING id',
              [hospitalName, slug]
            ).then(r => r.rows);
          }
        );

        // Building
        const bId = await getOrCreate(bCache, `${hId}::${buildingName}`,
          () => pool.query('SELECT id FROM buildings WHERE hospital_id=$1 AND LOWER(name)=LOWER($2)',
            [hId, buildingName]).then(r => r.rows),
          () => pool.query('INSERT INTO buildings (hospital_id, name, code) VALUES ($1,$2,$3) RETURNING id',
            [hId, buildingName, buildingName.slice(0, 20)]).then(r => r.rows)
        );

        // Floor
        const fId = await getOrCreate(fCache, `${bId}::${floorName}`,
          () => pool.query('SELECT id FROM floors WHERE building_id=$1 AND LOWER(name)=LOWER($2)',
            [bId, floorName]).then(r => r.rows),
          () => pool.query('INSERT INTO floors (building_id, name) VALUES ($1,$2) RETURNING id',
            [bId, floorName]).then(r => r.rows)
        );

        // Department
        const dId = await getOrCreate(dCache, `${fId}::${deptName}`,
          () => pool.query('SELECT id FROM departments WHERE floor_id=$1 AND LOWER(name)=LOWER($2)',
            [fId, deptName]).then(r => r.rows),
          () => pool.query('INSERT INTO departments (floor_id, name) VALUES ($1,$2) RETURNING id',
            [fId, deptName]).then(r => r.rows)
        );

        // AC unit — upsert by ac_code
        const { rows: ex } = await pool.query('SELECT id FROM ac_units WHERE ac_code=$1', [acCode]);
        if (ex.length) {
          await pool.query(`
            UPDATE ac_units SET department_id=$1, name=$2, type=$3,
              capacity_btu=$4, pm_interval_months=$5, notes=$6, updated_at=NOW()
            WHERE id=$7
          `, [dId, acName || null, acType || null, btu, pmInterval, brand || null, ex[0].id]);
          results.updated++;
        } else {
          await pool.query(`
            INSERT INTO ac_units (department_id, ac_code, name, type, capacity_btu, pm_interval_months, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
          `, [dId, acCode, acName || null, acType || null, btu, pmInterval, brand || null]);
          results.created++;
        }
      } catch (err) {
        results.errors.push(`Row ${rowNum}: ${err.message}`);
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/import/work-history ─────────────────────────────────────────
router.post('/work-history', authMiddleware, requireRole('admin'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws, { defval: '' });

    const results = { created: 0, errors: [] };

    // Build lookup maps
    const { rows: allAcs } = await pool.query(`
      SELECT a.id, a.ac_code, a.pm_interval_months, a.next_pm_date,
        b.hospital_id
      FROM ac_units a
      JOIN departments d ON a.department_id = d.id
      JOIN floors f ON d.floor_id = f.id
      JOIN buildings b ON f.building_id = b.id
    `);
    const acMap = {};
    for (const a of allAcs) acMap[a.ac_code] = a;

    const { rows: allUsers } = await pool.query('SELECT id, name FROM users');
    const userByName = {};
    for (const u of allUsers) userByName[u.name.toLowerCase()] = u.id;

    // Group by date + type + tech1 + hospital → one WO per group
    const groups = {};
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const acCode   = strVal(row, 'ac_code', 'รหัส', 'AC Code');
      const workType = strVal(row, 'work_type', 'ประเภทงาน') || 'major';
      const workDate = strVal(row, 'work_date', 'วันที่');
      const tech1    = strVal(row, 'tech1_name', 'ช่าง', 'ช่าง1');
      const tech2    = strVal(row, 'tech2_name', 'ช่าง2');

      if (!acCode || !workDate) continue;

      const ac = acMap[acCode];
      if (!ac) { results.errors.push(`Row ${i + 2}: AC "${acCode}" not found`); continue; }

      const type = ['major', 'minor', 'fan'].includes(workType.toLowerCase())
        ? workType.toLowerCase() : 'major';

      const gKey = `${workDate}|${type}|${tech1.toLowerCase()}|${ac.hospital_id}`;
      if (!groups[gKey]) {
        groups[gKey] = { workDate, type, tech1, tech2, hospitalId: ac.hospital_id, items: [] };
      }
      groups[gKey].items.push(ac);
    }

    // Create one WO per group
    for (const [gKey, g] of Object.entries(groups)) {
      try {
        // Parse date — support multiple formats
        let dateObj = new Date(g.workDate);
        if (isNaN(dateObj)) {
          // try DD/MM/YYYY
          const parts = g.workDate.split('/');
          if (parts.length === 3) dateObj = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        }
        if (isNaN(dateObj)) {
          results.errors.push(`Invalid date "${g.workDate}"`); continue;
        }

        const tech1Id = g.tech1 ? (userByName[g.tech1.toLowerCase()] || null) : null;
        const tech2Id = g.tech2 ? (userByName[g.tech2.toLowerCase()] || null) : null;

        // Generate order_no
        const ds = dateObj.toISOString().slice(0, 10).replace(/-/g, '');
        const { rows: cnt } = await pool.query(
          "SELECT COUNT(*)::int AS c FROM work_orders WHERE order_no LIKE $1",
          [`IMP-${ds}-%`]
        );
        const orderNo = `IMP-${ds}-${String(cnt[0].c + 1).padStart(4, '0')}`;

        const { rows: wo } = await pool.query(`
          INSERT INTO work_orders
            (order_no, hospital_id, type, tech1_id, tech2_id, status, started_at, completed_at, approved_at)
          VALUES ($1,$2,$3,$4,$5,'approved',$6,$6,$6)
          RETURNING id
        `, [orderNo, g.hospitalId, g.type, tech1Id, tech2Id, dateObj]);

        const woId = wo[0].id;

        for (const ac of g.items) {
          await pool.query(
            'INSERT INTO work_order_items (work_order_id, ac_unit_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [woId, ac.id]
          );

          // Update next_pm_date only if would push it later
          const interval = ac.pm_interval_months || 3;
          const nextDate = new Date(dateObj);
          nextDate.setMonth(nextDate.getMonth() + interval);
          const nextStr = nextDate.toISOString().slice(0, 10);
          if (!ac.next_pm_date || new Date(ac.next_pm_date) < nextDate) {
            await pool.query(
              'UPDATE ac_units SET next_pm_date=$1, updated_at=NOW() WHERE id=$2',
              [nextStr, ac.id]
            );
          }
        }

        results.created++;
      } catch (err) {
        results.errors.push(`Group ${gKey}: ${err.message}`);
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
