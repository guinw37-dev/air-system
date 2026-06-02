const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');
const PHOTO_POINTS = require('../config/photoPoints');

// ── Storage ────────────────────────────────────────────────────────────────
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, 'photos', String(req.params.itemId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${req.body.phase}_${req.body.point_no}_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images only'));
  }
});

// ── GET /api/photos/points/:woType ─────────────────────────────────────────
// คืน photo point config ตาม work order type (major/minor/fan)
router.get('/points/:woType', authMiddleware, (req, res) => {
  const points = PHOTO_POINTS[req.params.woType];
  if (!points) return res.status(404).json({ error: 'Unknown work order type' });
  res.json(points);
});

// ── POST /api/photos/items/:itemId ─────────────────────────────────────────
// upload รูป (before/during/after) พร้อม label
// :itemId is now a work_order_unit_id (table renamed work_order_items → work_order_units)
router.post('/items/:itemId', authMiddleware, upload.single('photo'), async (req, res) => {
  let { phase, point_no, label } = req.body;
  if (!phase || !point_no || !req.file) {
    return res.status(400).json({ error: 'phase, point_no, and photo required' });
  }
  // NEW schema phases: before/after/measurement (old 'during' maps to 'measurement')
  if (phase === 'during') phase = 'measurement';
  if (!['before', 'after', 'measurement'].includes(phase)) {
    return res.status(400).json({ error: 'phase must be before, after, or measurement' });
  }
  try {
    const url = `/uploads/photos/${req.params.itemId}/${req.file.filename}`;
    const { rows } = await pool.query(`
      INSERT INTO work_order_photos (work_order_unit_id, uploaded_by, phase, point_no, label, url, filename)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [req.params.itemId, req.user.id, phase, parseInt(point_no), label || null, url, req.file.filename]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/photos/items/:itemId ──────────────────────────────────────────
router.get('/items/:itemId', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM work_order_photos WHERE work_order_unit_id = $1 ORDER BY phase, point_no',
    [req.params.itemId]
  );
  res.json(rows);
});

// ── DELETE /api/photos/:photoId ────────────────────────────────────────────
router.delete('/:photoId', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM work_order_photos WHERE id = $1 RETURNING *',
    [req.params.photoId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const filePath = path.join(UPLOAD_DIR, rows[0].url.replace('/uploads/', ''));
  fs.unlink(filePath, () => {});
  res.json({ message: 'deleted' });
});

module.exports = router;
