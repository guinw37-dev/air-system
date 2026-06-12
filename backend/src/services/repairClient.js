// Client for the repair-system AC-repair bridge. air-system never stores repair
// data — it calls repair-system's /integration endpoints with a shared service
// key and forwards the acting air technician's name. The repair job record stays
// the single source of truth, so closing here shows on the building team's board.
//
// env: REPAIR_API_URL (e.g. https://api.repair...), REPAIR_SERVICE_KEY (shared).
const BASE = (process.env.REPAIR_API_URL || '').replace(/\/$/, '');
const KEY = process.env.REPAIR_SERVICE_KEY || '';

class RepairError extends Error {
  constructor(message, status) { super(message); this.status = status || 500; }
}

const configured = () => !!(BASE && KEY);

// Keep only printable chars in a header value (drop C0 controls 0-31 and DEL 127,
// incl. CR/LF) so the actor name can't inject extra headers upstream (audit L-1).
function safeHeader(v) {
  return [...String(v || '')]
    .filter((c) => { const n = c.charCodeAt(0); return n >= 32 && n !== 127; })
    .join('').trim().slice(0, 120);
}

// Call repair-system integration. expectBlob=true returns the raw Response (for
// streaming the Excel download); otherwise returns parsed JSON.
async function callRepair(method, repairSlug, subpath, { actor, body, expectBlob } = {}) {
  if (!configured()) throw new RepairError('AC-repair bridge ยังไม่ได้ตั้งค่า (REPAIR_API_URL / REPAIR_SERVICE_KEY)', 503);
  const url = `${BASE}/api/${encodeURIComponent(repairSlug)}/integration${subpath}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'X-Service-Key': KEY,
        'X-Actor-Name': safeHeader(actor),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new RepairError('ติดต่อระบบแจ้งซ่อมไม่ได้ (repair-system)', 502);
  }
  if (expectBlob) {
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new RepairError(t || 'export ไม่สำเร็จ', res.status);
    }
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new RepairError(data.error || `repair error (${res.status})`, res.status);
  return data;
}

module.exports = { callRepair, configured, RepairError };
