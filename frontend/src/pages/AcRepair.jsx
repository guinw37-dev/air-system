import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import Layout from '../components/Layout';

// ── Constants ────────────────────────────────────────────────────────────────
const STATUS_LABEL = {
  Register:  'แจ้งซ่อม',
  Assign:    'รับงาน',
  'Work On': 'กำลังซ่อม',
  Clear:     'ซ่อมเสร็จ',
  Close:     'ปิดงาน',
  Cancel:    'ยกเลิก',
};
const STATUS_COLOR = {
  Register:  'bg-gray-100 text-gray-700 border-gray-300',
  Assign:    'bg-blue-100 text-blue-800 border-blue-300',
  'Work On': 'bg-yellow-100 text-yellow-800 border-yellow-300',
  Clear:     'bg-teal-100 text-teal-800 border-teal-300',
  Close:     'bg-green-100 text-green-800 border-green-300',
  Cancel:    'bg-red-100 text-red-700 border-red-300',
};
const ALL_STATUSES = ['Register', 'Assign', 'Work On', 'Clear', 'Close', 'Cancel'];
const ACTIVE_STATUSES = ['Register', 'Assign', 'Work On', 'Clear'];

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

// ── Create / Edit modal ──────────────────────────────────────────────────────
function JobFormModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState({
    building: '', floor: '', department: '', requester: '', telephone: '',
    description: '', assign_name: '', issue_type: '', job_detail: '',
    ...initial,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Master-data cascade for the อาคาร/ชั้น/แผนก comboboxes (same source as the
  // repair form). Uses the first site of the branch. Fields stay free-text:
  // these only supply <datalist> suggestions, so an empty master never blocks.
  const [buildings, setBuildings] = useState([]);
  const [floors, setFloors] = useState([]);
  const [rooms, setRooms] = useState([]);
  // Distinct locations already used on this branch's jobs — covers branches whose
  // master data is empty (e.g. imported jobs on a fresh schema).
  const [locs, setLocs] = useState({ buildings: [], floors: [], departments: [] });
  // Full hospital location master from repair-system (อาคาร→ชั้น→แผนก, cascading).
  const [repairHier, setRepairHier] = useState([]);

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
    api.get('/ac-repair-jobs/repair-locations')
      .then((r) => { if (alive) setRepairHier(r.data?.buildings || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const uniq = (a) => [...new Set(a.filter(Boolean))];
  // Cascade off the repair-system hierarchy when the chosen อาคาร matches one.
  const hierB = repairHier.find((h) => h.name === form.building);
  const hierFloors = (hierB?.floors || []).map((f) => f.name);
  const hierDepts = (hierB?.departments || [])
    .filter((d) => !form.floor || d.floor_id === form.floor || d.floor_id === '')
    .map((d) => d.name);
  const buildingOpts = uniq([...buildings.map((b) => b.name), ...repairHier.map((h) => h.name), ...(locs.buildings || [])]);
  const floorOpts = uniq([...floors.map((f) => f.name), ...hierFloors, ...(locs.floors || [])]);
  const roomOpts = uniq([...rooms.map((r) => r.name), ...hierDepts, ...(locs.departments || [])]);

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
    try { await onSave(form); }
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
            <label className="block text-sm font-medium text-gray-700 mb-1">รายละเอียดอาการ <span className="text-red-500">*</span></label>
            <textarea className="w-full border rounded-lg px-3 py-2 text-sm" rows={3} value={form.description} onChange={set('description')} placeholder="ระบุอาการหรือปัญหา" required />
          </div>
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

// ── Assign modal ─────────────────────────────────────────────────────────────
function AssignModal({ job, onSave, onClose }) {
  const [assignName, setAssignName] = useState(job.assign_name || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try { await onSave({ assign_name: assignName }); }
    catch (ex) { setErr(ex.response?.data?.error || ex.message); setSaving(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-bold">รับงาน — {job.job_number}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ช่างผู้รับงาน</label>
            <input autoFocus className="w-full border rounded-lg px-3 py-2 text-sm" value={assignName} onChange={(e) => setAssignName(e.target.value)} placeholder="ชื่อช่าง" />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border text-sm">ยกเลิก</button>
            <button disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'รับงาน'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Clear modal ───────────────────────────────────────────────────────────────
function ClearModal({ job, onSave, onClose }) {
  const [workDesc, setWorkDesc] = useState('');
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef();

  function pickPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto({ base64: reader.result, name: file.name });
    reader.readAsDataURL(file);
  }

  async function submit(e) {
    e.preventDefault();
    if (!workDesc.trim()) { setErr('กรุณาระบุรายละเอียดการซ่อม'); return; }
    setSaving(true); setErr('');
    try {
      await onSave({
        work_desc: workDesc,
        afterImageBase64: photo?.base64 || undefined,
        afterImageName:   photo?.name   || undefined,
      });
    } catch (ex) { setErr(ex.response?.data?.error || ex.message); setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-bold">ปิดงาน — {job.job_number}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รายละเอียดการซ่อม <span className="text-red-500">*</span></label>
            <textarea autoFocus className="w-full border rounded-lg px-3 py-2 text-sm" rows={4} value={workDesc} onChange={(e) => setWorkDesc(e.target.value)} placeholder="อธิบายการซ่อมที่ทำ…" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รูปหลังซ่อม (ไม่บังคับ)</label>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
            <button type="button" onClick={() => fileRef.current?.click()} className="px-3 py-1.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              {photo ? `✓ ${photo.name}` : 'เลือกรูป'}
            </button>
            {photo && (
              <img src={photo.base64} alt="preview" className="mt-2 rounded-lg h-28 object-cover border" />
            )}
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border text-sm">ยกเลิก</button>
            <button disabled={saving} className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'ยืนยันปิดงาน'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Import from repair-system modal ─────────────────────────────────────────
function ImportModal({ onImport, onClose }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [importing, setImporting] = useState(null);

  useEffect(() => {
    api.get('/ac-repair-jobs/pending-repair')
      .then((r) => setJobs(r.data.jobs || []))
      .catch((e) => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, []);

  async function doImport(job) {
    setImporting(job.id);
    try {
      await onImport({
        repair_job_id:     job.id,
        repair_job_number: job.job_number,
        building:          job.building,
        floor:             job.floor,
        department:        job.department,
        requester:         job.requester,
        telephone:         job.telephone || '',
        description:       job.description,
        file_url:          job.file_url || '-',
      });
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally { setImporting(null); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">นำเข้างานจาก repair-system</h2>
            <p className="text-xs text-gray-500 mt-0.5">งาน AC ที่ยังค้างอยู่ฝั่งช่างอาคาร</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          {loading && <p className="text-center text-gray-500 py-8">กำลังโหลด…</p>}
          {err && <p className="text-center text-red-600 py-8">{err}</p>}
          {!loading && !err && jobs.length === 0 && (
            <p className="text-center text-gray-400 py-8">ไม่มีงาน AC ค้างอยู่ฝั่งช่างอาคาร</p>
          )}
          <div className="space-y-3">
            {jobs.map((job) => (
              <div key={job.id} className="border rounded-xl p-4 hover:bg-gray-50 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-bold text-gray-800">{job.job_number}</span>
                    <StatusBadge status={job.status} />
                  </div>
                  <p className="text-sm text-gray-700 line-clamp-2">{job.description}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {[job.building, job.floor, job.department].filter(Boolean).join(' › ')}
                    {job.requester && ` · ${job.requester}`}
                  </p>
                </div>
                <button
                  disabled={!!importing}
                  onClick={() => doImport(job)}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700 disabled:opacity-50"
                >
                  {importing === job.id ? 'กำลังนำเข้า…' : 'นำเข้า'}
                </button>
              </div>
            ))}
          </div>
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
  const [showAssign, setShowAssign] = useState(false);
  const [showClear, setShowClear] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const isAdmin = ['admin', 'super_admin'].includes(role);

  async function transition(action, body = {}) {
    setBusy(true); setMsg('');
    try {
      const r = await api.put(`/ac-repair-jobs/${job.id}/status`, { action, ...body });
      setJob(r.data);
      onRefresh();
      setShowAssign(false); setShowClear(false); setCancelling(false);
    } catch (e) { setMsg(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  }

  async function saveEdit(form) {
    const r = await api.put(`/ac-repair-jobs/${job.id}`, form);
    setJob(r.data);
    onRefresh();
    setEditing(false);
  }

  if (editing) return <JobFormModal initial={job} onSave={saveEdit} onClose={() => setEditing(false)} />;
  if (showAssign) return <AssignModal job={job} onSave={(b) => transition('assign', b)} onClose={() => setShowAssign(false)} />;
  if (showClear) return <ClearModal job={job} onSave={(b) => transition('clear', b)} onClose={() => setShowClear(false)} />;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-mono font-bold text-gray-800">{job.job_number}</h2>
              <StatusBadge status={job.status} />
            </div>
            {job.repair_job_number && (
              <p className="text-xs text-gray-400 mt-0.5">อ้างอิง repair: {job.repair_job_number}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none ml-4">&times;</button>
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

          {job.after_image_url && (
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">รูปหลังซ่อม</h3>
              <img src={job.after_image_url} alt="after" className="rounded-xl border max-h-48 object-contain" />
            </section>
          )}

          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Timeline</h3>
            <div className="space-y-1 text-xs text-gray-600">
              {job.register_time && <p>📋 แจ้งซ่อม — {fmt(job.register_time)}</p>}
              {job.assign_time   && <p>👷 รับงาน — {fmt(job.assign_time)}</p>}
              {job.start_time    && <p>🔧 เริ่มซ่อม — {fmt(job.start_time)}</p>}
              {job.clear_time    && <p>✅ ซ่อมเสร็จ — {fmt(job.clear_time)}</p>}
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

        {!['Close', 'Cancel'].includes(job.status) && !cancelling && (
          <div className="px-6 py-4 border-t flex flex-wrap gap-2">
            <button onClick={() => setEditing(true)} className="px-3 py-1.5 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              แก้ไขรายละเอียด
            </button>
            {job.status === 'Register' && (
              <button onClick={() => setShowAssign(true)} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                รับงาน
              </button>
            )}
            {job.status === 'Assign' && (
              <button disabled={busy} onClick={() => transition('start')}
                className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-sm hover:bg-yellow-600 disabled:opacity-50">
                {busy ? '…' : 'เริ่มงาน'}
              </button>
            )}
            {job.status === 'Work On' && (
              <button onClick={() => setShowClear(true)} className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700">
                ปิดงาน
              </button>
            )}
            {job.status === 'Clear' && isAdmin && (
              <button disabled={busy} onClick={() => transition('close')}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
                {busy ? '…' : 'ปิดสมบูรณ์'}
              </button>
            )}
            <button onClick={() => setCancelling(true)} className="ml-auto px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50">
              ยกเลิกใบงาน
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
  const [showImport, setShowImport] = useState(false);

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

  async function importJob(data) {
    await api.post(`${ACR}/import`, data);
    setShowImport(false);
    load();
  }

  const totalActive = ACTIVE_STATUSES.reduce((s, k) => s + (stats[k] || 0), 0);
  const isAdmin = ['admin', 'super_admin'].includes(role);

  return (
    <Layout>
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">งานซ่อมแอร์</h1>
          <p className="text-sm text-gray-500 mt-0.5">{totalActive} งานค้าง</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="px-3 py-2 border rounded-xl text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-1.5">
            📥 นำเข้างาน
          </button>
          <button onClick={() => setShowCreate(true)} className="px-3 py-2 bg-blue-600 text-white rounded-xl text-sm hover:bg-blue-700 flex items-center gap-1.5">
            + สร้างใบงาน
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {ALL_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-xl border p-2.5 text-center transition-all ${filter === s ? 'ring-2 ring-offset-1 ring-blue-500 bg-blue-50' : 'bg-white hover:bg-gray-50'}`}
          >
            <div className="text-lg font-bold text-gray-800">{stats[s] || 0}</div>
            <div className="text-xs text-gray-500 mt-0.5">{STATUS_LABEL[s]}</div>
          </button>
        ))}
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
                job.status === 'Register'  ? 'bg-gray-400' :
                job.status === 'Assign'    ? 'bg-blue-500' :
                job.status === 'Work On'   ? 'bg-yellow-500' :
                job.status === 'Clear'     ? 'bg-teal-500' :
                job.status === 'Close'     ? 'bg-green-500' : 'bg-red-400'
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
                {job.status === 'Register'              && <span className="text-blue-600 font-medium">รับงาน →</span>}
                {job.status === 'Assign'                && <span className="text-yellow-600 font-medium">เริ่มงาน →</span>}
                {job.status === 'Work On'               && <span className="text-teal-600 font-medium">ปิดงาน →</span>}
                {job.status === 'Clear' && isAdmin       && <span className="text-green-600 font-medium">ปิดสมบูรณ์ →</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {showCreate && <JobFormModal onSave={createJob} onClose={() => setShowCreate(false)} />}
      {showImport && <ImportModal onImport={importJob} onClose={() => setShowImport(false)} />}
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
