import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import Layout from '../components/Layout';
import { compressImage } from '../lib/image';

// ── Constants ────────────────────────────────────────────────────────────────
// Workflow ย่อ (20 Aug 2026): แจ้งซ่อม → กำลังซ่อม ⇄ รออะไหล่ → ซ่อมเสร็จ (=ปิดงาน).
// Assign/Close คงไว้แค่ label สำหรับใบเก่า — ไม่อยู่ใน flow ใหม่แล้ว.
const STATUS_LABEL = {
  Register:     'แจ้งซ่อม',
  Assign:       'รับงาน',
  'Work On':    'กำลังซ่อม',
  'Wait Parts': 'รออะไหล่',
  Clear:        'ซ่อมเสร็จ',
  Close:        'ปิดงาน',
  Cancel:       'ยกเลิก',
};
const STATUS_COLOR = {
  Register:     'bg-gray-100 text-gray-700 border-gray-300',
  Assign:       'bg-blue-100 text-blue-800 border-blue-300',
  'Work On':    'bg-yellow-100 text-yellow-800 border-yellow-300',
  'Wait Parts': 'bg-orange-100 text-orange-800 border-orange-300',
  Clear:        'bg-green-100 text-green-800 border-green-300',
  Close:        'bg-green-100 text-green-800 border-green-300',
  Cancel:       'bg-red-100 text-red-700 border-red-300',
};
const ALL_STATUSES = ['Register', 'Work On', 'Wait Parts', 'Clear', 'Cancel'];
// งานค้าง = ยังไม่ซ่อมเสร็จ. Clear(ซ่อมเสร็จ=ปิดงาน)/Cancel ไม่นับค้าง
const ACTIVE_STATUSES = ['Register', 'Assign', 'Work On', 'Wait Parts'];
const TERMINAL_STATUSES = ['Clear', 'Close', 'Cancel'];

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLOR[status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function fmt(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  const y = d.getFullYear() + 543;
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${y} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ── Parts editor (อะไหล่ list) ────────────────────────────────────────────────
function PartsEditor({ parts, onChange }) {
  const rows = Array.isArray(parts) ? parts : [];
  const setRow = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => onChange([...rows, { name: '', qty: '', unit_price: 0, note: '' }]);
  const delRow = (i) => onChange(rows.filter((_, j) => j !== i));

  const grandTotal = rows.reduce((sum, r) => {
    const qty = parseFloat(r.qty) || 0;
    const price = parseFloat(r.unit_price) || 0;
    return sum + qty * price;
  }, 0);

  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="space-y-2">
          {/* Column headers */}
          <div className="flex gap-2 items-center text-xs text-gray-400 font-medium px-0.5">
            <span className="flex-1">ชื่ออะไหล่</span>
            <span className="w-16 text-center">จำนวน</span>
            <span className="w-24 text-center">ราคา/หน่วย (บาท)</span>
            <span className="w-20 text-right">รวม (บาท)</span>
            <span className="w-24">หมายเหตุ</span>
            <span className="w-6" />
          </div>
          {rows.map((r, i) => {
            const lineCost = (parseFloat(r.qty) || 0) * (parseFloat(r.unit_price) || 0);
            return (
              <div key={i} className="flex gap-2 items-start">
                <input
                  className="flex-1 border rounded-lg px-2 py-1.5 text-sm"
                  value={r.name || ''}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                  placeholder="ชื่ออะไหล่"
                />
                <input
                  className="w-16 border rounded-lg px-2 py-1.5 text-sm text-center"
                  value={r.qty || ''}
                  onChange={(e) => setRow(i, { qty: e.target.value })}
                  placeholder="จำนวน"
                  type="number"
                  min="0"
                />
                <input
                  className="w-24 border rounded-lg px-2 py-1.5 text-sm text-right"
                  value={r.unit_price ?? 0}
                  onChange={(e) => setRow(i, { unit_price: e.target.value === '' ? 0 : parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                  type="number"
                  min="0"
                  step="0.01"
                />
                <div className="w-20 py-1.5 text-sm text-right text-gray-600 tabular-nums">
                  {lineCost > 0 ? lineCost.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '—'}
                </div>
                <input
                  className="w-24 border rounded-lg px-2 py-1.5 text-sm"
                  value={r.note || ''}
                  onChange={(e) => setRow(i, { note: e.target.value })}
                  placeholder="หมายเหตุ"
                />
                <button type="button" onClick={() => delRow(i)} className="text-red-400 hover:text-red-600 px-1.5 py-1.5 text-lg leading-none">&times;</button>
              </div>
            );
          })}
          {grandTotal > 0 && (
            <div className="flex justify-end pt-1 border-t mt-1">
              <span className="text-sm font-semibold text-gray-700">
                รวมงานนี้: ฿{grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>
      )}
      <button type="button" onClick={addRow} className="text-sm text-blue-600 hover:underline">+ เพิ่มอะไหล่</button>
    </div>
  );
}

// ── Create / Edit modal ──────────────────────────────────────────────────────
function JobFormModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState({
    building: '', floor: '', department: '', requester: '', telephone: '', asset_code: '',
    description: '', assign_name: '', issue_type: '', job_detail: '', parts: [],
    ...initial,
    parts: Array.isArray(initial?.parts) ? initial.parts : [],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // รูปแจ้งซ่อม (สร้างใบงานเท่านั้น) — สูงสุด 6 รูป, ย่อ + ประทับเวลาเหมือนรูปหลังซ่อม
  const [photos, setPhotos] = useState([]);   // [{base64, name}]
  const photoRef = useRef();
  async function pickPhotos(e) {
    const files = Array.from(e.target.files || []).slice(0, 6 - photos.length);
    e.target.value = '';
    const added = [];
    for (const file of files) {
      const stamped = await compressImage(file, { stamp: true });
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(stamped);
      });
      added.push({ base64, name: stamped.name || file.name });
    }
    setPhotos((p) => [...p, ...added].slice(0, 6));
  }

  // Master-data cascade for the อาคาร/ชั้น/แผนก comboboxes (same source as the
  // repair form). Uses the first site of the branch. Fields stay free-text:
  // these only supply <datalist> suggestions, so an empty master never blocks.
  const [buildings, setBuildings] = useState([]);
  const [floors, setFloors] = useState([]);
  const [rooms, setRooms] = useState([]);
  // Distinct locations already used on this branch's jobs — covers branches whose
  // master data is empty.
  const [locs, setLocs] = useState({ buildings: [], floors: [], departments: [] });
  const [acCodes, setAcCodes] = useState([]);
  useEffect(() => { api.get('/wash-units/codes').then((r) => setAcCodes(r.data || [])).catch(() => {}); }, []);

  useEffect(() => {
    let alive = true;
    api.get('/master/sites')
      .then((r) => (r.data[0]?.id
        ? api.get('/master/buildings', { params: { site_id: r.data[0].id } })
        : { data: [] }))
      .then((r) => { if (alive) setBuildings(r.data || []); })
      .catch(() => {});
    api.get('/ac-repair-jobs/locations')
      .then((r) => { if (alive) setLocs(r.data || { buildings: [], floors: [], departments: [] }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const uniq = (a) => [...new Set(a.filter(Boolean))];
  const buildingOpts = uniq([...buildings.map((b) => b.name), ...(locs.buildings || [])]);
  const floorOpts = uniq([...floors.map((f) => f.name), ...(locs.floors || [])]);
  const roomOpts = uniq([...rooms.map((r) => r.name), ...(locs.departments || [])]);

  const buildingId = buildings.find((b) => b.name === form.building)?.id;
  useEffect(() => {
    if (!buildingId) { setFloors([]); return; }
    let alive = true;
    api.get('/master/floors', { params: { building_id: buildingId } })
      .then((r) => { if (alive) setFloors(r.data || []); }).catch(() => setFloors([]));
    return () => { alive = false; };
  }, [buildingId]);

  const floorId = floors.find((f) => f.name === form.floor)?.id;
  useEffect(() => {
    if (!floorId) { setRooms([]); return; }
    let alive = true;
    api.get('/master/rooms', { params: { floor_id: floorId } })
      .then((r) => { if (alive) setRooms(r.data || []); }).catch(() => setRooms([]));
    return () => { alive = false; };
  }, [floorId]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.description.trim()) { setErr('กรุณาระบุรายละเอียด'); return; }
    setSaving(true); setErr('');
    try { await onSave(initial?.id ? form : { ...form, photosBase64: photos }); }
    catch (ex) { setErr(ex.response?.data?.error || ex.message); setSaving(false); }
  }

  const isEdit = !!initial?.id;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-bold">{isEdit ? 'แก้ไขใบงาน' : 'สร้างใบงานซ่อมแอร์'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit} className="overflow-y-auto p-6 space-y-4 flex-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">อาคาร</label>
              <input list="acr-buildings" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.building} onChange={set('building')} placeholder="เลือกหรือพิมพ์อาคาร" />
              <datalist id="acr-buildings">{buildingOpts.map((n) => <option key={n} value={n} />)}</datalist>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ชั้น</label>
              <input list="acr-floors" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.floor} onChange={set('floor')} placeholder="เลือกหรือพิมพ์ชั้น" />
              <datalist id="acr-floors">{floorOpts.map((n) => <option key={n} value={n} />)}</datalist>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">แผนก / ห้อง</label>
            <input list="acr-rooms" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.department} onChange={set('department')} placeholder="เลือกหรือพิมพ์แผนก/ห้อง" />
            <datalist id="acr-rooms">{roomOpts.map((n) => <option key={n} value={n} />)}</datalist>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ผู้แจ้ง</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.requester} onChange={set('requester')} placeholder="ชื่อผู้แจ้ง" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เบอร์โทร</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.telephone} onChange={set('telephone')} placeholder="เบอร์โทร" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เลขเครื่อง (ทะเบียนแอร์) <span className="text-gray-400 font-normal">— ถ้ามี ผูกประวัติเครื่อง</span></label>
            <input list="acr-assets" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.asset_code} onChange={set('asset_code')} placeholder="เลือก/พิมพ์เลขเครื่อง (ไม่บังคับ)" />
            <datalist id="acr-assets">{acCodes.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รายละเอียดอาการ <span className="text-red-500">*</span></label>
            <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={3} value={form.description} onChange={set('description')} placeholder="ระบุอาการหรือปัญหา" required />
          </div>
          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">รูปแจ้งซ่อม (ก่อน) <span className="text-gray-400 font-normal">(ไม่บังคับ สูงสุด 6 รูป)</span></label>
              <input ref={photoRef} type="file" accept="image/*" multiple className="hidden" onChange={pickPhotos} />
              <div className="flex flex-wrap gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative">
                    <img src={p.base64} alt={`photo-${i + 1}`} className="h-20 w-20 rounded-lg object-cover border" />
                    <button type="button" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 text-xs leading-none">&times;</button>
                  </div>
                ))}
                {photos.length < 6 && (
                  <button type="button" onClick={() => photoRef.current?.click()}
                    className="h-20 w-20 border-2 border-dashed rounded-lg text-gray-400 hover:text-gray-600 hover:border-gray-400 text-2xl">+</button>
                )}
              </div>
            </div>
          )}
          {isEdit && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ช่างผู้รับงาน</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.assign_name} onChange={set('assign_name')} placeholder="ชื่อช่าง" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ประเภทปัญหา</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.issue_type} onChange={set('issue_type')} placeholder="เช่น คอมแพรสเซอร์ / น้ำยา / แผงไฟ" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">รายละเอียดการซ่อม</label>
                <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} value={form.job_detail} onChange={set('job_detail')} placeholder="บันทึกเพิ่มเติม" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">อะไหล่ที่ต้องใช้ / สั่งของ</label>
                <PartsEditor parts={form.parts} onChange={(parts) => setForm((f) => ({ ...f, parts }))} />
              </div>
            </>
          )}
          {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
        </form>
        <div className="px-6 py-4 border-t flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border text-gray-700 hover:bg-gray-50 text-sm">ยกเลิก</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm disabled:opacity-50">
            {saving ? 'กำลังบันทึก…' : isEdit ? 'บันทึก' : 'สร้างใบงาน'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Memo modal — ออก MEMO ขออนุมัติจัดซื้ออะไหล่ (หัวส้ม ระบบ Air) ─────────────
function MemoModal({ job, onClose }) {
  const [memo, setMemo] = useState(null);        // memo ที่มีอยู่ (ถ้าเคยออกแล้ว)
  const [form, setForm] = useState(null);        // ฟอร์มพร้อมค่า template
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get(`/ac-memos/by-job/${job.id}`),
      api.get('/ac-memos/template'),
    ]).then(([mRes, tRes]) => {
      if (!alive) return;
      const existing = mRes.data;
      const tpl = tRes.data || {};
      setMemo(existing);
      setForm(existing ? {
        subject: existing.subject, reason: existing.reason || '',
        to_line: existing.to_line || '', from_line: existing.from_line || '',
        parts: Array.isArray(existing.parts) ? existing.parts : [],
        signers: existing.signers || tpl.signers || {},
      } : {
        subject: 'ขออนุมัติจัดซื้ออะไหล่เครื่องปรับอากาศ',
        reason: '',
        to_line: tpl.to_line || '', from_line: tpl.from_line || '',
        parts: Array.isArray(job.parts) ? job.parts : [],
        signers: tpl.signers || {},
      });
    }).catch((e) => setErr(e.response?.data?.error || e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [job]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setSigner = (slot, k) => (e) =>
    setForm((f) => ({ ...f, signers: { ...f.signers, [slot]: { ...(f.signers?.[slot] || {}), [k]: e.target.value } } }));

  async function save() {
    if (!form.subject.trim()) { setErr('ต้องระบุเรื่อง'); return; }
    setSaving(true); setErr('');
    try {
      const r = memo
        ? await api.put(`/ac-memos/${memo.id}`, form)
        : await api.post('/ac-memos', { ...form, job_id: job.id });
      setMemo(r.data);
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  }

  async function openPdf() {
    try {
      const res = await api.get(`/ac-memos/${memo.id}/pdf`, { responseType: 'blob' });
      window.open(URL.createObjectURL(res.data), '_blank');
    } catch { setErr('เปิด PDF ไม่สำเร็จ'); }
  }

  const SIGN_SLOTS = [
    ['requester', 'ผู้ขออนุมัติ (TW)'], ['inspector', 'ผู้ตรวจสอบ (TW)'],
    ['reviewer', 'ผู้เห็นชอบ (รพ.)'], ['approver', 'ผู้อนุมัติ (รพ.)'],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between bg-sky-50 rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-sky-700">📄 MEMO ขออะไหล่ — {job.job_number}</h2>
            {memo && <p className="text-xs text-sky-600 mt-0.5 font-mono">{memo.memo_number}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          {loading ? <p className="text-center text-gray-400 py-8">กำลังโหลด…</p> : form && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">เรื่อง <span className="text-red-500">*</span></label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.subject} onChange={set('subject')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">เรียน</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.to_line} onChange={set('to_line')} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">จาก</label>
                  <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.from_line} onChange={set('from_line')} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">รายการอะไหล่ (ดึงจากใบงาน แก้ได้)</label>
                <PartsEditor parts={form.parts} onChange={(parts) => setForm((f) => ({ ...f, parts }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">เหตุผลความจำเป็น</label>
                <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} value={form.reason} onChange={set('reason')} placeholder="เช่น อะไหล่เสื่อมสภาพ ไม่สามารถซ่อมต่อได้" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">ผู้เซ็น 4 ช่อง</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SIGN_SLOTS.map(([slot, label]) => (
                    <div key={slot} className="border rounded-xl p-3 space-y-1.5">
                      <p className="text-xs font-semibold text-gray-500">{label}</p>
                      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="ชื่อ"
                        value={form.signers?.[slot]?.name || ''} onChange={setSigner(slot, 'name')} />
                      <input className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder="ตำแหน่ง"
                        value={form.signers?.[slot]?.pos || ''} onChange={setSigner(slot, 'pos')} />
                    </div>
                  ))}
                </div>
              </div>
              {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
            </>
          )}
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border text-sm">ปิด</button>
          {memo && (
            <button onClick={openPdf} className="px-4 py-2 rounded-lg border border-sky-300 text-sky-700 bg-sky-50 hover:bg-sky-100 text-sm">
              🖨️ เปิด PDF
            </button>
          )}
          <button onClick={save} disabled={saving || loading}
            className="px-4 py-2 rounded-lg bg-sky-600 text-white hover:bg-sky-700 text-sm disabled:opacity-50">
            {saving ? 'กำลังบันทึก…' : memo ? 'บันทึกการแก้ไข' : 'ออก Memo'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Clear modal ───────────────────────────────────────────────────────────────
function ClearModal({ job, onSave, onClose }) {
  const [workDesc, setWorkDesc] = useState('');
  const [photos, setPhotos] = useState([]);   // รูปหลังซ่อม สูงสุด 6 [{base64, name}]
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef();

  async function pickPhotos(e) {
    const files = Array.from(e.target.files || []).slice(0, 6 - photos.length);
    e.target.value = '';
    const added = [];
    for (const file of files) {
      const stamped = await compressImage(file, { stamp: true });   // downscale + วัน/เวลา
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(stamped);
      });
      added.push({ base64, name: stamped.name || file.name });
    }
    setPhotos((p) => [...p, ...added].slice(0, 6));
  }

  async function submit(e) {
    e.preventDefault();
    if (!workDesc.trim()) { setErr('กรุณาระบุรายละเอียดการซ่อม'); return; }
    setSaving(true); setErr('');
    try {
      await onSave({
        work_desc: workDesc,
        afterPhotosBase64: photos.length ? photos : undefined,
      });
    } catch (ex) { setErr(ex.response?.data?.error || ex.message); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-bold">ซ่อมเสร็จ (ปิดงาน) — {job.job_number}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รายละเอียดการซ่อม <span className="text-red-500">*</span></label>
            <textarea autoFocus className="w-full border rounded-lg px-3 py-2 text-sm" rows={4} value={workDesc} onChange={(e) => setWorkDesc(e.target.value)} placeholder="อธิบายการซ่อมที่ทำ…" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รูปหลังซ่อม <span className="text-gray-400 font-normal">(ไม่บังคับ สูงสุด 6 รูป)</span></label>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={pickPhotos} />
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p.base64} alt={`หลังซ่อม ${i + 1}`} className="h-20 w-20 rounded-lg object-cover border" />
                  <button type="button" onClick={() => setPhotos((ps) => ps.filter((_, x) => x !== i))}
                    className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 text-xs leading-none">&times;</button>
                </div>
              ))}
              {photos.length < 6 && (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="h-20 w-20 border-2 border-dashed rounded-lg text-gray-400 hover:text-gray-600 hover:border-gray-400 text-2xl">+</button>
              )}
            </div>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border text-sm">ยกเลิก</button>
            <button disabled={saving} className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'ยืนยันซ่อมเสร็จ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Memo list modal — Memo ที่เคยเปิดทั้งหมด กดเข้าไปแก้ไขได้ ─────────────────
function MemoListModal({ onOpenMemo, onClose }) {
  const [memos, setMemos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/ac-memos')
      .then((r) => setMemos(Array.isArray(r.data) ? r.data : []))
      .catch((e) => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, []);

  const totalOf = (parts) => (Array.isArray(parts) ? parts : [])
    .reduce((s, p) => s + (parseFloat(p.qty) || 0) * (parseFloat(p.unit_price) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between bg-sky-50 rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-sky-700">📄 Memo ขออะไหล่ทั้งหมด</h2>
            <p className="text-xs text-gray-500 mt-0.5">กดรายการเพื่อเปิดดู / แก้ไข / พิมพ์ PDF</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          {loading ? <p className="text-center text-gray-400 py-8">กำลังโหลด…</p>
            : err ? <p className="text-center text-red-600 py-8">{err}</p>
            : memos.length === 0 ? <p className="text-center text-gray-400 py-8">ยังไม่เคยออก Memo</p>
            : (
              <div className="space-y-2">
                {memos.map((m) => {
                  const total = totalOf(m.parts);
                  return (
                    <button key={m.id} onClick={() => onOpenMemo(m)}
                      className="w-full text-left border rounded-xl p-3.5 hover:bg-sky-50 hover:border-sky-200 transition-colors flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-sky-700">{m.memo_number}</span>
                          {m.job_number && <span className="text-xs text-gray-400 border rounded px-1.5 py-0.5">{m.job_number}</span>}
                          {m.job_status && <StatusBadge status={m.job_status} />}
                        </div>
                        <p className="text-sm text-gray-700 mt-1 truncate">{m.subject}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {[m.building, m.floor, m.department].filter(Boolean).join(' › ') || '—'} · 🕒 {fmt(m.created_at)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        {total > 0 && <div className="text-sm font-bold text-sky-700 tabular-nums">฿{total.toLocaleString('th-TH')}</div>}
                        <div className="text-xs text-sky-600 mt-1">แก้ไข →</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
        </div>
        <div className="px-6 py-3 border-t flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border text-sm">ปิด</button>
        </div>
      </div>
    </div>
  );
}

// ── Detail modal ─────────────────────────────────────────────────────────────
function DetailModal({ job: initialJob, role, onClose, onRefresh }) {
  const [job, setJob] = useState(initialJob);
  const [editing, setEditing] = useState(false);
  const [showClear, setShowClear] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function transition(action, body = {}) {
    setBusy(true); setMsg('');
    try {
      const r = await api.put(`/ac-repair-jobs/${job.id}/status`, { action, ...body });
      setJob(r.data);
      onRefresh();
      setShowClear(false); setCancelling(false);
    } catch (e) { setMsg(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  }

  async function saveEdit(form) {
    const r = await api.put(`/ac-repair-jobs/${job.id}`, form);
    setJob(r.data);
    onRefresh();
    setEditing(false);
  }

  async function printPdf() {
    try {
      const res = await api.get(`/ac-repair-jobs/${job.id}/pdf`, { responseType: 'blob' });
      window.open(URL.createObjectURL(res.data), '_blank');
    } catch { alert('ปริ้นใบงานไม่สำเร็จ'); }
  }

  if (editing) return <JobFormModal initial={job} onSave={saveEdit} onClose={() => setEditing(false)} />;
  if (showClear) return <ClearModal job={job} onSave={(b) => transition('clear', b)} onClose={() => setShowClear(false)} />;
  if (showMemo) return <MemoModal job={job} onClose={() => setShowMemo(false)} />;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 flex items-start justify-between bg-gradient-to-r from-sky-600 to-blue-700 rounded-t-2xl">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-mono font-bold text-white text-lg">{job.job_number}</h2>
              <StatusBadge status={job.status} />
            </div>
            <p className="text-xs text-sky-100 mt-0.5">ใบแจ้งซ่อมแอร์ · ทีมช่างแอร์ TW</p>
          </div>
          <div className="flex items-center gap-1.5 ml-4">
            <button onClick={printPdf} title="ปริ้นใบงาน" className="text-white bg-white/15 border border-white/30 hover:bg-white/25 rounded-lg px-2.5 py-1 text-sm">🖨️ ปริ้น</button>
            <button onClick={onClose} className="text-sky-100 hover:text-white text-2xl leading-none px-1">&times;</button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">สถานที่</h3>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div><span className="text-gray-500 text-xs">อาคาร</span><p className="font-medium">{job.building || '—'}</p></div>
              <div><span className="text-gray-500 text-xs">ชั้น</span><p className="font-medium">{job.floor || '—'}</p></div>
              <div><span className="text-gray-500 text-xs">แผนก</span><p className="font-medium">{job.department || '—'}</p></div>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">ผู้แจ้ง</h3>
            <p className="text-sm font-medium">{job.requester || '—'} {job.telephone ? `(${job.telephone})` : ''}</p>
          </section>

          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">รายละเอียดอาการ</h3>
            <p className="text-sm whitespace-pre-wrap">{job.description}</p>
          </section>

          {Array.isArray(job.photo_urls) && job.photo_urls.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">รูปแจ้งซ่อม</h3>
              <div className="flex flex-wrap gap-2">
                {job.photo_urls.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noreferrer">
                    <img src={u} alt={`แจ้งซ่อม ${i + 1}`} className="h-28 rounded-xl border object-cover" />
                  </a>
                ))}
              </div>
            </section>
          )}

          {(job.assign_name || job.issue_type || job.job_detail || job.work_desc) && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">ข้อมูลการซ่อม</h3>
              <div className="space-y-1 text-sm">
                {job.assign_name && <p><span className="text-gray-500">ช่างผู้รับงาน: </span>{job.assign_name}</p>}
                {job.issue_type  && <p><span className="text-gray-500">ประเภทปัญหา: </span>{job.issue_type}</p>}
                {job.job_detail  && <p><span className="text-gray-500">บันทึกเพิ่มเติม: </span>{job.job_detail}</p>}
                {job.work_desc   && <p><span className="text-gray-500">รายละเอียดการซ่อม: </span>{job.work_desc}</p>}
              </div>
            </section>
          )}

          {Array.isArray(job.parts) && job.parts.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">อะไหล่ที่ต้องใช้ / สั่งของ</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b">
                    <th className="py-1 text-left font-normal">ชื่ออะไหล่</th>
                    <th className="py-1 w-16 text-center font-normal">จำนวน</th>
                    <th className="py-1 w-24 text-right font-normal">ราคา/หน่วย</th>
                    <th className="py-1 w-24 text-right font-normal">รวม</th>
                    <th className="py-1 w-24 text-left font-normal pl-2">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {job.parts.map((p, i) => {
                    const unitPrice = parseFloat(p.unit_price) || 0;
                    const lineCost = (parseFloat(p.qty) || 0) * unitPrice;
                    return (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5">{p.name}</td>
                        <td className="py-1.5 text-center text-gray-600">{p.qty || '—'}</td>
                        <td className="py-1.5 text-right text-gray-600 tabular-nums">
                          {unitPrice > 0 ? `฿${unitPrice.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '—'}
                        </td>
                        <td className="py-1.5 text-right tabular-nums font-medium">
                          {lineCost > 0 ? `฿${lineCost.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '—'}
                        </td>
                        <td className="py-1.5 text-gray-400 pl-2">{p.note || ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {(() => {
                  const jobTotal = job.parts.reduce((s, p) => s + (parseFloat(p.qty) || 0) * (parseFloat(p.unit_price) || 0), 0);
                  return jobTotal > 0 ? (
                    <tfoot>
                      <tr className="border-t">
                        <td colSpan={3} className="py-1.5 text-right text-xs text-gray-500 font-medium">รวมงานนี้</td>
                        <td className="py-1.5 text-right text-sm font-bold text-blue-700 tabular-nums">
                          ฿{jobTotal.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  ) : null;
                })()}
              </table>
            </section>
          )}

          {(() => {
            const afters = [
              ...(Array.isArray(job.after_photo_urls) ? job.after_photo_urls : []),
              ...(job.after_image_url ? [job.after_image_url] : []),
            ].filter(Boolean).slice(0, 6);
            return afters.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">รูปหลังซ่อม</h3>
                <div className="flex flex-wrap gap-2">
                  {afters.map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noreferrer">
                      <img src={u} alt={`หลังซ่อม ${i + 1}`} className="h-28 rounded-xl border object-cover" />
                    </a>
                  ))}
                </div>
              </section>
            );
          })()}

          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Timeline</h3>
            <div className="space-y-1 text-xs text-gray-600">
              {job.register_time && <p>📋 แจ้งซ่อม — {fmt(job.register_time)}</p>}
              {job.assign_time   && <p>👷 รับงาน — {fmt(job.assign_time)}</p>}
              {job.start_time    && <p>🔧 เริ่มซ่อม — {fmt(job.start_time)}</p>}
              {job.wait_parts_time && <p>📦 รออะไหล่ — {fmt(job.wait_parts_time)}</p>}
              {job.clear_time    && <p>✅ ซ่อมเสร็จ (ปิดงาน) — {fmt(job.clear_time)}</p>}
              {job.close_time    && <p>🏁 ปิดงาน — {fmt(job.close_time)}</p>}
              {job.cancel_time   && <p>❌ ยกเลิก — {fmt(job.cancel_time)} {job.cancel_reason ? `(${job.cancel_reason})` : ''}</p>}
            </div>
          </section>

          {cancelling && (
            <section className="border-t pt-4">
              <p className="text-sm font-medium text-red-700 mb-2">ยืนยันการยกเลิกใบงาน</p>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
                placeholder="เหตุผลยกเลิก (ถ้ามี)"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => setCancelling(false)} className="flex-1 px-3 py-2 border rounded-lg text-sm">ไม่ยกเลิก</button>
                <button disabled={busy} onClick={() => transition('cancel', { cancel_reason: cancelReason })}
                  className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg text-sm disabled:opacity-50">
                  {busy ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิก'}
                </button>
              </div>
            </section>
          )}

          {msg && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{msg}</p>}
        </div>

        {!TERMINAL_STATUSES.includes(job.status) && !cancelling && (
          <div className="px-6 py-4 border-t flex flex-wrap gap-2">
            <button onClick={() => setEditing(true)} className="px-3 py-1.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              แก้ไขรายละเอียด
            </button>
            {job.status !== 'Work On' && (
              <button disabled={busy} onClick={() => transition('start')}
                className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-sm hover:bg-yellow-600 disabled:opacity-50">
                {busy ? '…' : '🔧 เริ่มซ่อม'}
              </button>
            )}
            {job.status !== 'Wait Parts' && (
              <button disabled={busy} onClick={() => transition('wait_parts')}
                className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 disabled:opacity-50">
                {busy ? '…' : '📦 รออะไหล่'}
              </button>
            )}
            <button onClick={() => setShowClear(true)} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
              ✅ ซ่อมเสร็จ (ปิดงาน)
            </button>
            <button onClick={() => setShowMemo(true)} className="px-3 py-1.5 border border-sky-300 text-sky-700 bg-sky-50 rounded-lg text-sm hover:bg-sky-100">
              📄 Memo อะไหล่
            </button>
            <button onClick={() => setCancelling(true)} className="ml-auto px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50">
              ยกเลิกใบงาน
            </button>
          </div>
        )}
        {TERMINAL_STATUSES.includes(job.status) && job.status !== 'Cancel' && (
          <div className="px-6 py-4 border-t flex justify-end">
            <button onClick={() => setShowMemo(true)} className="px-3 py-1.5 border border-sky-300 text-sky-700 bg-sky-50 rounded-lg text-sm hover:bg-sky-100">
              📄 Memo อะไหล่
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AcRepair() {
  const { user } = useAuthStore();
  const role = user?.role || '';

  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState({});
  const [filter, setFilter] = useState('active');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showMemoList, setShowMemoList] = useState(false);
  const [memoJob, setMemoJob] = useState(null);   // job stub จากรายการ memo → เปิด MemoModal

  const ACR = '/ac-repair-jobs';

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const [jRes, sRes] = await Promise.all([
        api.get(`${ACR}/`, { params: { status: filter } }),
        api.get(`${ACR}/stats`),
      ]);
      setJobs(jRes.data);
      setStats(sRes.data);
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function createJob(form) {
    await api.post(`${ACR}/`, form);
    setShowCreate(false);
    load();
  }

  const totalActive = ACTIVE_STATUSES.reduce((s, k) => s + (stats[k] || 0), 0);

  return (
    <Layout>
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      {/* Header — แถบฟ้าเข้าธีมระบบ Air */}
      <div className="bg-gradient-to-r from-sky-600 to-blue-700 rounded-2xl px-5 py-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">❄ งานซ่อมแอร์</h1>
          <p className="text-sm text-sky-100 mt-0.5">ทีมช่างแอร์ TW · {totalActive} งานค้าง</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowMemoList(true)} className="px-3 py-2 bg-white/15 border border-white/30 text-white rounded-xl text-sm hover:bg-white/25 flex items-center gap-1.5">
            📄 Memo
          </button>
          <button onClick={() => setShowCreate(true)} className="px-3 py-2 bg-white text-blue-700 font-semibold rounded-xl text-sm hover:bg-sky-50 flex items-center gap-1.5">
            + แจ้งซ่อม
          </button>
        </div>
      </div>

      {/* Stats bar — การ์ดสีตามสถานะ */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {ALL_STATUSES.map((s) => {
          const tone = {
            Register:     { num: 'text-slate-700', dot: 'bg-slate-400', bg: 'bg-white' },
            'Work On':    { num: 'text-yellow-600', dot: 'bg-yellow-500', bg: 'bg-white' },
            'Wait Parts': { num: 'text-orange-600', dot: 'bg-orange-500', bg: 'bg-white' },
            Clear:        { num: 'text-green-600', dot: 'bg-green-500', bg: 'bg-white' },
            Cancel:       { num: 'text-red-500', dot: 'bg-red-400', bg: 'bg-white' },
          }[s] || { num: 'text-gray-800', dot: 'bg-gray-300', bg: 'bg-white' };
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-2xl border p-3 text-center transition-all shadow-sm ${filter === s ? 'ring-2 ring-offset-1 ring-sky-500 bg-sky-50 border-sky-200' : `${tone.bg} hover:shadow border-slate-100`}`}
            >
              <div className={`text-2xl font-bold tabular-nums ${tone.num}`}>{stats[s] || 0}</div>
              <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500 mt-1">
                <span className={`w-2 h-2 rounded-full ${tone.dot}`} />{STATUS_LABEL[s]}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {[
          { key: 'active', label: 'งานค้าง' },
          { key: 'all',    label: 'ทั้งหมด' },
          ...ALL_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s] })),
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-all ${filter === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Error */}
      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{err}</span>
          <button onClick={load} className="text-xs underline ml-4">ลองใหม่</button>
        </div>
      )}

      {/* Job list */}
      {loading ? (
        <p className="text-center text-gray-400 py-12">กำลังโหลด…</p>
      ) : jobs.length === 0 ? (
        <p className="text-center text-gray-400 py-12">ไม่มีใบงาน</p>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div
              key={job.id}
              onClick={() => setSelected(job)}
              className="bg-white border rounded-xl p-4 cursor-pointer hover:shadow-sm transition-shadow flex items-start gap-4"
            >
              <div className={`w-1.5 self-stretch rounded-full shrink-0 ${
                job.status === 'Register'     ? 'bg-gray-400' :
                job.status === 'Assign'       ? 'bg-blue-500' :
                job.status === 'Work On'      ? 'bg-yellow-500' :
                job.status === 'Wait Parts'   ? 'bg-orange-500' :
                job.status === 'Clear'        ? 'bg-green-500' :
                job.status === 'Close'        ? 'bg-green-500' : 'bg-red-400'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-sm font-bold text-gray-800">{job.job_number}</span>
                  <StatusBadge status={job.status} />
                  {job.repair_job_number && (
                    <span className="text-xs text-gray-400 border rounded px-1">{job.repair_job_number}</span>
                  )}
                </div>
                <p className="text-sm text-gray-700 line-clamp-2">{job.description}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-gray-500">
                  {(job.building || job.floor || job.department) && (
                    <span>{[job.building, job.floor, job.department].filter(Boolean).join(' › ')}</span>
                  )}
                  {job.requester  && <span>👤 {job.requester}</span>}
                  {job.assign_name && <span>🔧 {job.assign_name}</span>}
                  <span>🕒 {fmt(job.register_time)}</span>
                </div>
              </div>
              <div className="shrink-0 text-xs">
                {['Register', 'Assign'].includes(job.status) && <span className="text-yellow-600 font-medium">เริ่มซ่อม →</span>}
                {job.status === 'Work On'                    && <span className="text-green-600 font-medium">ซ่อมเสร็จ →</span>}
                {job.status === 'Wait Parts'                 && <span className="text-orange-600 font-medium">รออะไหล่ ⏳</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {showCreate && <JobFormModal onSave={createJob} onClose={() => setShowCreate(false)} />}
      {showMemoList && !memoJob && (
        <MemoListModal
          onOpenMemo={(m) => setMemoJob({ id: m.job_id, job_number: m.job_number, parts: [] })}
          onClose={() => setShowMemoList(false)}
        />
      )}
      {memoJob && <MemoModal job={memoJob} onClose={() => setMemoJob(null)} />}
      {selected && (
        <DetailModal
          job={selected}
          role={role}
          onClose={() => setSelected(null)}
          onRefresh={() => { load(); setSelected(null); }}
        />
      )}
    </div>
    </Layout>
  );
}
