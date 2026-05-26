const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

// ── Storage ────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.env.UPLOAD_DIR || 'uploads', 'photos', String(req.params.itemId));
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

// ── POST /api/photos/items/:itemId ─────────────────────────────────────────
// upload รูป (before/after)
router.post('/items/:itemId', authMiddleware, upload.single('photo'), async (req, res) => {
  const { phase, point_no } = req.body;
  if (!phase || !point_no || !req.file) {
    return res.status(400).json({ error: 'phase, point_no, and photo required' });
  }
  if (!['before', 'after'].includes(phase)) {
    return res.status(400).json({ error: 'phase must be before or after' });
  }
  try {
    const url = `/uploads/photos/${req.params.itemId}/${req.file.filename}`;
    const { rows } = await pool.query(`
      INSERT INTO ac_photos (work_order_item_id, phase, point_no, url, filename)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [req.params.itemId, phase, parseInt(point_no), url, req.file.filename]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/photos/items/:itemId ──────────────────────────────────────────
router.get('/items/:itemId', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM ac_photos WHERE work_order_item_id = $1 ORDER BY phase, point_no',
    [req.params.itemId]
  );
  res.json(rows);
});

// ── DELETE /api/photos/:photoId ────────────────────────────────────────────
router.delete('/:photoId', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    'DELETE FROM ac_photos WHERE id = $1 RETURNING *',
    [req.params.photoId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  // delete file
  const filePath = path.join(process.env.UPLOAD_DIR || 'uploads', rows[0].url.replace('/uploads/', ''));
  fs.unlink(filePath, () => {});
  res.json({ message: 'deleted' });
});

module.exports = router;
