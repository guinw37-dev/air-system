// Centralized server-error response — log the real error server-side, but never
// leak pg/internal messages (column/constraint/schema names) to the client in
// production. In dev the message is kept to aid debugging. (audit M-3)
const isProd = process.env.NODE_ENV === 'production';

function serverError(res, err, fallback = 'เกิดข้อผิดพลาดภายในระบบ') {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: isProd ? fallback : (err && err.message) || fallback });
}

module.exports = { serverError };
