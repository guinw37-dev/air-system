// Tiny in-memory IP rate limiter (no external deps). Suitable for the single
// backend instance here; swap for Redis if scaled horizontally.
//
//   router.get('/sign/:token', rateLimit({ windowMs: 60000, max: 5 }), handler)

function rateLimit({ windowMs = 60000, max = 5 } = {}) {
  const hits = new Map(); // ip -> [timestamps]
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      const retry = Math.ceil((windowMs - (now - arr[0])) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: 'คำขอถี่เกินไป ลองใหม่ภายหลัง' });
    }
    arr.push(now);
    hits.set(ip, arr);
    // opportunistic cleanup to bound memory
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      }
    }
    next();
  };
}

module.exports = rateLimit;
