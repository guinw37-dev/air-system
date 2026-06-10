const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  // Allow token via query string for browser-opened endpoints (e.g. PDF download)
  const token = (header && header.startsWith('Bearer '))
    ? header.split(' ')[1]
    : req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    // Cross-branch guard (schema-per-tenant): a branch-scoped token (branchSlug
    // set, not a super-admin) may only be used on its own branch. Super-admins
    // (isSuper) and apex requests (no req.branch) pass through.
    if (req.branch && !payload.isSuper && payload.branchSlug && payload.branchSlug !== req.branch.slug) {
      return res.status(403).json({ error: 'cross-branch access denied' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
