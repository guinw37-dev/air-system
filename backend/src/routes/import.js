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

// ── POST /api/import/pts-excel  (custom format: สถานที่ล้างแอร์ + พัดลม.xlsx) ──
router.post('/pts-excel', authMiddleware, requireRole('admin', 'owner'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // column indices for work dates (0-based)
  const WORK_COLS = [
    { idx: 6, type: 'major' }, // ล้างใหญ่ ครั้งที่ 1
    { idx: 7, type: 'minor' }, // ล้างย่อย ครั้งที่ 1
    { idx: 8, type: 'minor' }, // ล้างย่อย ครั้งที่ 2
    { idx: 9, type: 'major' }, // ล้างใหญ่ ครั้งที่ 2
    { idx: 10, type: 'minor' },// ล้างย่อย ครั้งที่ 3
    { idx: 11, type: 'minor' },// ล้างย่อย ครั้งที่ 4
  ];
  const SKIP_VALS  = new Set(['แอร์เสีย', 'ไม่มีฟิลเตอร์', 'ถอดออก', 'รื้อถอน', '-', '']);
  const BROKEN_VALS = new Set(['แอร์เสีย', 'ถอดออก', 'รื้อถอน']);
  const PM_INTERVAL = 2;

  function parseType(s) {
    s = (s || '').toUpperCase();
    if (s.includes('AHU'))   return 'AHU';
    if (s.includes('VRF'))   return 'VRF';
    if (s.includes('SPLIT')) return 'Split';
    if (s.includes('FCU'))   return 'FCU';
    return 'FCU';
  }

  function parseBtu(s) {
    const m = /([0-9,]+)\s*BTU/i.exec(String(s || ''));
    return m ? String(parseInt(m[1].replace(/,/g, ''))) : null;
  }

  function parseCeDate(val) {
    if (val == null) return null;
    const s = String(val).trim();
    if (!s || SKIP_VALS.has(s)) return null;

    // "2569-01-27"
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) {
      let y = +m[1]; if (y > 2300) y -= 543;
      return `${y}-${m[2]}-${m[3]}`;
    }
    // "27/01/2569"
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) {
      let y = +m[3]; if (y > 2300) y -= 543;
      return `${y}-${String(+m[2]).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}`;
    }
    return null;
  }

  function addMonths(dateStr, n) {
    const d = new Date(dateStr);
    d.setMonth(d.getMonth() + n);
    return d.toISOString().slice(0, 10);
  }

  function extractHospital(text) {
    const m = /(?:เครื่องปรับอากาศ|พัดลม)\s+(.+?)\s+อาคาร\s+\w/.exec(String(text || '').trim());
    return m ? m[1].trim() : null;
  }

  async function getOrCreateH(hCache, bCache, fCache, dCache, name) {
    const k = name.toLowerCase();
    if (hCache[k]) return hCache[k];
    const { rows } = await pool.query('SELECT id FROM hospitals WHERE LOWER(name)=LOWER($1)', [name]);
    if (rows.length) { hCache[k] = rows[0].id; return rows[0].id; }
    const slug = name.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase().slice(0, 40) + '-' + Date.now();
    const ins = await pool.query('INSERT INTO hospitals (name,slug) VALUES ($1,$2) RETURNING id', [name, slug]);
    hCache[k] = ins.rows[0].id;
    return ins.rows[0].id;
  }

  async function gocBuilding(cache, hId, name) {
    const k = `${hId}:${name.toLowerCase()}`;
    if (cache[k]) return cache[k];
    const { rows } = await pool.query(
      'SELECT id FROM buildings WHERE hospital_id=$1 AND LOWER(name)=LOWER($2)', [hId, name]);
    if (rows.length) { cache[k] = rows[0].id; return rows[0].id; }
    const ins = await pool.query(
      'INSERT INTO buildings (hospital_id,name,code) VALUES ($1,$2,$3) RETURNING id', [hId, name, name.slice(0,20)]);
    cache[k] = ins.rows[0].id; return ins.rows[0].id;
  }

  async function gocFloor(cache, bId, name) {
    const k = `${bId}:${name.toLowerCase()}`;
    if (cache[k]) return cache[k];
    const { rows } = await pool.query(
      'SELECT id FROM floors WHERE building_id=$1 AND LOWER(name)=LOWER($2)', [bId, name]);
    if (rows.length) { cache[k] = rows[0].id; return rows[0].id; }
    const ins = await pool.query(
      'INSERT INTO floors (building_id,name) VALUES ($1,$2) RETURNING id', [bId, name]);
    cache[k] = ins.rows[0].id; return ins.rows[0].id;
  }

  async function gocDept(cache, fId, name) {
    const k = `${fId}:${name.toLowerCase()}`;
    if (cache[k]) return cache[k];
    const { rows } = await pool.query(
      'SELECT id FROM departments WHERE floor_id=$1 AND LOWER(name)=LOWER($2)', [fId, name]);
    if (rows.length) { cache[k] = rows[0].id; return rows[0].id; }
    const ins = await pool.query(
      'INSERT INTO departments (floor_id,name) VALUES ($1,$2) RETURNING id', [fId, name]);
    cache[k] = ins.rows[0].id; return ins.rows[0].id;
  }

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer', raw: true });
    const results = { ac_created: 0, ac_updated: 0, wos_created: 0, errors: [] };
    const hCache = {}, bCache = {}, fCache = {}, dCache = {};

    // (hospId, type, dateStr) → Set of acIds
    const woGroups = new Map();

    for (const sheetName of wb.SheetNames) {
      const ws  = wb.Sheets[sheetName];
      const isFan = sheetName.includes('พัดลม');
      const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

      let hospId = null;

      for (const row of rows) {
        if (!row || row.every(v => v == null)) continue;

        const col0s = row[0] != null ? String(row[0]).trim() : '';

        // Hospital header: col0 has text, col1-5 all null
        if (row[0] != null && row.slice(1, 6).every(v => v == null)) {
          const h = extractHospital(col0s);
          if (h) {
            hospId = await getOrCreateH(hCache, bCache, fCache, dCache, h);
          }
          continue;
        }

        // Skip header rows
        if (col0s === 'ลำดับ' || col0s === 'ลำดับที่' || col0s === 'อาคาร') continue;

        // Data row: col5 must be AC-*
        const acCodeRaw = row[5];
        if (!acCodeRaw) continue;
        const acCode = String(acCodeRaw).trim();
        if (!/^AC-/.test(acCode)) continue;
        if (!hospId) { results.errors.push(`No hospital for ${acCode}`); continue; }

        const bldRaw  = row[1] != null ? String(row[1]).trim() : 'A';
        const flRaw   = row[2] != null ? String(row[2]).trim() : '1';
        const deptRaw = row[3] != null ? String(row[3]).trim() : acCode;
        const typeRaw = row[4] != null ? String(row[4]).trim() : '';

        const bldName   = `อาคาร ${bldRaw}`;
        const floorName = `ชั้น ${flRaw}`;
        const acType    = isFan ? 'Fan' : parseType(typeRaw);
        const btuStr    = parseBtu(typeRaw);

        const isBroken = WORK_COLS.some(({ idx }) =>
          row[idx] != null && BROKEN_VALS.has(String(row[idx]).trim()));

        const bId  = await gocBuilding(bCache, hospId, bldName);
        const fId  = await gocFloor(fCache, bId, floorName);
        const dId  = await gocDept(dCache, fId, deptRaw);

        // Upsert AC unit
        const { rows: ex } = await pool.query('SELECT id FROM ac_units WHERE ac_code=$1', [acCode]);
        let acId;
        if (ex.length) {
          if (isBroken) {
            await pool.query("UPDATE ac_units SET status='broken',updated_at=NOW() WHERE id=$1", [ex[0].id]);
          }
          acId = ex[0].id;
          results.ac_updated++;
        } else {
          const ins = await pool.query(`
            INSERT INTO ac_units
              (department_id,ac_code,name,type,capacity_btu,pm_interval_months,status)
            VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
          `, [dId, acCode, deptRaw, acType, btuStr, PM_INTERVAL, isBroken ? 'broken' : 'active']);
          acId = ins.rows[0].id;
          results.ac_created++;
        }

        // Collect WO dates
        for (const { idx, type: wtype } of WORK_COLS) {
          if (idx >= row.length) continue;
          const cellStr = row[idx] != null ? String(row[idx]).trim() : '';
          if (SKIP_VALS.has(cellStr) || !cellStr) continue;
          const dateStr = parseCeDate(row[idx]);
          if (!dateStr) continue;

          const gtype = isFan ? 'fan' : wtype;
          const gkey  = `${hospId}|${gtype}|${dateStr}`;
          if (!woGroups.has(gkey)) {
            woGroups.set(gkey, { hospId, type: gtype, date: dateStr, items: new Set() });
          }
          woGroups.get(gkey).items.add(acId);
        }
      }
    }

    // Create work orders
    for (const [, g] of woGroups) {
      try {
        const ds = g.date.replace(/-/g, '');
        const { rows: cnt } = await pool.query(
          "SELECT COUNT(*)::int AS c FROM work_orders WHERE order_no LIKE $1", [`IMP-${ds}-%`]);
        const orderNo = `IMP-${ds}-${String(cnt[0].c + 1).padStart(4, '0')}`;

        const { rows: wo } = await pool.query(`
          INSERT INTO work_orders
            (order_no, hospital_id, type, status, started_at, completed_at, approved_at)
          VALUES ($1,$2,$3,'approved',$4,$4,$4) RETURNING id
        `, [orderNo, g.hospId, g.type, g.date]);
        const woId = wo[0].id;

        for (const acId of g.items) {
          await pool.query(`
            INSERT INTO work_order_items (work_order_id, ac_unit_id)
            SELECT $1,$2 WHERE NOT EXISTS (
              SELECT 1 FROM work_order_items WHERE work_order_id=$1 AND ac_unit_id=$2
            )
          `, [woId, acId]);

          const nextDate = addMonths(g.date, PM_INTERVAL);
          await pool.query(`
            UPDATE ac_units
            SET next_pm_date = GREATEST(COALESCE(next_pm_date,$1::date),$1::date), updated_at=NOW()
            WHERE id=$2
          `, [nextDate, acId]);
        }
        results.wos_created++;
      } catch (err) {
        results.errors.push(`WO ${g.date}/${g.type}: ${err.message}`);
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
