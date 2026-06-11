import { useEffect, useState } from 'react'
import { Wrench, Play, CheckCircle2, PackagePlus, Star, Download, RefreshCw, AlertTriangle, X } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import api from '../api/client'

// Air technician's view onto repair-system AC jobs (remote — data lives in
// repair-system). Mirrors the repair-system flow so it feels like the แจ้งซ่อม web:
// Assign → เริ่มงาน(เลย/ขอรองบ) → ปิดงาน(Clear) → ประเมิน(Clear1) → เบิกอะไหล่+ปิด(Close).
// Acting on a job updates the one shared record, so the building team sees it.
const STATUS = {
  Assign:    { label: 'รอเริ่มงาน',       color: 'badge-warn' },
  'Work On': { label: 'กำลังซ่อม',        color: 'badge-primary' },
  Clear:     { label: 'ซ่อมเสร็จ รอประเมิน', color: 'bg-indigo-50 text-indigo-600' },
  Clear1:    { label: 'ประเมินแล้ว รอปิด',  color: 'bg-indigo-50 text-indigo-600' },
}
const loc = (j) => [j.building, j.floor, j.department].filter((x) => x && x !== 'ไม่ระบุ').join(' / ')

// SLA / งานค้าง — อายุนับจากเวลาแจ้ง. เกิน 48ชม.=แดง, 24ชม.=เหลือง.
function aging(j) {
  const t = j.register_time || j.assign_time
  if (!t) return null
  const hrs = (Date.now() - new Date(t).getTime()) / 3.6e6
  const d = Math.floor(hrs / 24), h = Math.floor(hrs % 24)
  const label = d > 0 ? `ค้าง ${d} วัน ${h} ชม.` : `ค้าง ${h} ชม.`
  const color = hrs >= 48 ? 'text-danger' : hrs >= 24 ? 'text-amber-500' : 'text-ink-muted'
  return { label, color, hrs }
}

export default function AcRepair() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [modal, setModal] = useState(null) // { kind: 'start'|'clear'|'eval'|'parts', job }

  const load = () => {
    setLoading(true); setError('')
    api.get('/ac-repair/jobs')
      .then((r) => setJobs(Array.isArray(r.data) ? r.data : []))
      .catch((e) => { setError(e.response?.data?.error || 'โหลดงานไม่สำเร็จ'); setJobs([]) })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  const done = () => { setModal(null); load() }

  // งานค้างนานสุดขึ้นก่อน (SLA focus) + นับตามสถานะ
  const sorted = [...jobs].sort((a, b) => new Date(a.register_time || 0) - new Date(b.register_time || 0))
  const counts = {
    total: jobs.length,
    overdue: jobs.filter((j) => (aging(j)?.hrs || 0) >= 48).length,
    Assign: jobs.filter((j) => j.status === 'Assign').length,
    'Work On': jobs.filter((j) => j.status === 'Work On').length,
    Clear: jobs.filter((j) => ['Clear', 'Clear1'].includes(j.status)).length,
  }

  const exportExcel = async () => {
    setBusy(true)
    try {
      const res = await api.get('/ac-repair/jobs/export/excel', { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a'); a.href = url; a.download = `งานซ่อมแอร์-${dayjs().format('YYYYMMDD')}.xlsx`
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch { alert('ดาวน์โหลด Excel ไม่สำเร็จ') } finally { setBusy(false) }
  }

  return (
    <Layout title="งานซ่อมแอร์" actions={
      <button onClick={load} className="p-1.5 rounded-lg text-ink-muted hover:bg-page"><RefreshCw className="h-5 w-5" /></button>
    }>
      <div className="p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-ink-muted flex items-center gap-1.5"><Wrench className="h-4 w-4" /> งาน AC จากระบบแจ้งซ่อม</p>
          <button onClick={exportExcel} disabled={busy} className="btn-secondary text-sm flex items-center gap-1.5"><Download className="h-4 w-4" /> ส่งออก Excel</button>
        </div>

        {/* สรุปงาน (dashboard) */}
        {!error && jobs.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {[
              ['ทั้งหมด', counts.total, 'text-ink'],
              ['ค้าง >48ชม.', counts.overdue, 'text-danger'],
              ['รอเริ่ม', counts.Assign, 'text-amber-500'],
              ['กำลังซ่อม', counts['Work On'], 'text-primary'],
              ['รอปิด', counts.Clear, 'text-indigo-500'],
            ].map(([label, n, color]) => (
              <div key={label} className="card py-3 text-center">
                <div className={`text-2xl font-bold ${color}`}>{n}</div>
                <div className="text-[11px] text-ink-muted mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="card flex items-start gap-3 text-danger">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
            <div><p className="font-medium">{error}</p>
              <p className="text-xs text-ink-muted mt-1">ถ้าสาขานี้ยังไม่ผูกโรงพยาบาล ให้ตั้ง repair_slug · หรือระบบแจ้งซ่อมเชื่อมต่อไม่ได้ชั่วคราว</p></div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-4 border-line border-t-primary" /></div>
        ) : (!error && jobs.length === 0) ? (
          <div className="card text-center text-ink-muted py-12"><Wrench className="h-8 w-8 mx-auto opacity-40 mb-2" /><p className="text-sm">ไม่มีงาน AC ค้างอยู่</p></div>
        ) : (
          <div className="flex flex-col gap-2">
            {sorted.map((j) => {
              const s = STATUS[j.status] || { label: j.status, color: 'badge-gray' }
              const pendingBudget = j.status === 'Work On' && j.status_work === 'Pending Budget'
              const age = aging(j)
              return (
                <div key={j.id} className="card flex flex-col gap-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-semibold text-primary">{j.job_number || `#${j.id}`}</span>
                    <div className="flex items-center gap-2">
                      {pendingBudget && <span className="badge badge-danger">รออนุมัติงบ</span>}
                      <span className={`badge ${s.color}`}>{s.label}</span>
                    </div>
                  </div>
                  <div className="text-sm text-ink">{loc(j) || '-'}</div>
                  <div className="text-sm text-ink-muted">{j.description || j.job_detail || '-'}</div>
                  <div className="text-xs text-ink-muted flex items-center gap-2 flex-wrap">
                    <span>แจ้งโดย {j.requester || '-'} · {j.register_time ? dayjs(j.register_time).format('DD/MM/YY HH:mm') : ''}{j.assign_name ? ` · ช่าง ${j.assign_name}` : ''}</span>
                    {age && <span className={`font-medium ${age.color}`}>· {age.label}</span>}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {j.status === 'Assign' && (
                      <button onClick={() => setModal({ kind: 'start', job: j })} disabled={busy} className="btn-primary text-sm flex items-center gap-1.5"><Play className="h-4 w-4" /> เริ่มงาน</button>
                    )}
                    {j.status === 'Work On' && (
                      <button onClick={() => setModal({ kind: 'clear', job: j })} disabled={busy} className="btn-primary text-sm flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> ปิดงาน (ซ่อมเสร็จ)</button>
                    )}
                    {j.status === 'Clear' && (
                      <button onClick={() => setModal({ kind: 'eval', job: j })} disabled={busy} className="btn-secondary text-sm flex items-center gap-1.5"><Star className="h-4 w-4" /> ประเมินงาน</button>
                    )}
                    {['Clear', 'Clear1'].includes(j.status) && (
                      <button onClick={() => setModal({ kind: 'parts', job: j })} disabled={busy} className="btn-primary text-sm flex items-center gap-1.5"><PackagePlus className="h-4 w-4" /> เบิกอะไหล่ + ปิดงาน</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {modal?.kind === 'start' && <StartModal job={modal.job} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'clear' && <ClearModal job={modal.job} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'eval'  && <EvalModal  job={modal.job} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'parts' && <PartsModal job={modal.job} onClose={() => setModal(null)} onDone={done} />}
    </Layout>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="text-ink-muted"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// เริ่มงาน — เริ่มเลย หรือ ขอรองบประมาณ (Pending Budget → ช่างอาคารอนุมัติ)
function StartModal({ job, onClose, onDone }) {
  const [mode, setMode] = useState('work') // work | budget
  const [budget, setBudget] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    setSaving(true)
    try {
      await api.put(`/ac-repair/jobs/${job.id}/status`, {
        action: 'START_WORK',
        statusWork: mode === 'budget' ? 'Pending Budget' : 'Start Working',
        workDesc: desc,
        ...(mode === 'budget' ? { budgetRequested: budget } : {}),
      })
      onDone()
    } catch (e) { alert(e.response?.data?.error || 'เริ่มงานไม่สำเร็จ') } finally { setSaving(false) }
  }
  return (
    <Modal title={`เริ่มงาน ${job.job_number || ''}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          {[['work', 'เริ่มงานเลย'], ['budget', 'ขอรองบประมาณ']].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)} className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${mode === v ? 'bg-primary text-white border-primary' : 'bg-white text-ink-muted border-line'}`}>{l}</button>
          ))}
        </div>
        {mode === 'budget' && (
          <div><label className="label">งบที่ขอ (บาท)</label><input className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
        )}
        <div><label className="label">บันทึกงาน (ถ้ามี)</label><textarea className="input" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        {mode === 'budget' && <p className="text-xs text-ink-muted">ขอรองบ → งานเข้าสถานะ "รออนุมัติงบ" ให้ช่างอาคาร/แอดมินอนุมัติก่อน</p>}
        <div className="flex gap-2 mt-1">
          <button onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
          <button onClick={submit} disabled={saving} className="btn-primary flex-1">{saving ? 'กำลังบันทึก...' : (mode === 'budget' ? 'ขอรองบ' : 'เริ่มงาน')}</button>
        </div>
      </div>
    </Modal>
  )
}

// ปิดงาน (Clear) — รายละเอียดการซ่อม + รูปหลังซ่อม
function ClearModal({ job, onClose, onDone }) {
  const [desc, setDesc] = useState('')
  const [photo, setPhoto] = useState(null)
  const [saving, setSaving] = useState(false)
  const pick = (e) => {
    const f = e.target.files?.[0]; if (!f) return
    const reader = new FileReader()
    reader.onload = () => setPhoto({ base64: String(reader.result).split(',')[1], name: f.name })
    reader.readAsDataURL(f)
  }
  const submit = async () => {
    if (!desc.trim()) { alert('กรุณาใส่รายละเอียดการปิดงาน'); return }
    setSaving(true)
    try {
      await api.put(`/ac-repair/jobs/${job.id}/status`, {
        action: 'CLEAR', clearDesc: desc,
        ...(photo ? { afterImageBase64: photo.base64, afterImageName: photo.name } : {}),
      })
      onDone()
    } catch (e) { alert(e.response?.data?.error || 'ปิดงานไม่สำเร็จ') } finally { setSaving(false) }
  }
  return (
    <Modal title={`ปิดงาน ${job.job_number || ''}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div><label className="label">รายละเอียดการซ่อม *</label><textarea className="input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="ซ่อมอะไร เปลี่ยนอะไร" /></div>
        <div><label className="label">รูปหลังซ่อม (ถ้ามี)</label><input type="file" accept="image/*" onChange={pick} className="text-sm" />{photo && <p className="text-xs text-ink-muted mt-1">แนบ: {photo.name}</p>}</div>
        <div className="flex gap-2 mt-1">
          <button onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
          <button onClick={submit} disabled={saving} className="btn-primary flex-1">{saving ? 'กำลังบันทึก...' : 'ปิดงาน'}</button>
        </div>
      </div>
    </Modal>
  )
}

// ประเมินงาน (Clear → Clear1) — คะแนน 4 ด้าน
function EvalModal({ job, onClose, onDone }) {
  const FIELDS = [['scorePolite', 'ความสุภาพ'], ['scoreSpeed', 'ความรวดเร็ว'], ['scoreSkill', 'ฝีมือ'], ['scoreSat', 'ความพึงพอใจ']]
  const [scores, setScores] = useState({ scorePolite: 5, scoreSpeed: 5, scoreSkill: 5, scoreSat: 5 })
  const [sug, setSug] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    setSaving(true)
    try {
      await api.post(`/ac-repair/jobs/${job.id}/evaluation`, { ...scores, suggestions: sug })
      onDone()
    } catch (e) { alert(e.response?.data?.error || 'ประเมินไม่สำเร็จ') } finally { setSaving(false) }
  }
  return (
    <Modal title={`ประเมินงาน ${job.job_number || ''}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {FIELDS.map(([k, l]) => (
          <div key={k}>
            <label className="label">{l}</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setScores((s) => ({ ...s, [k]: n }))}
                  className={`p-1.5 rounded ${scores[k] >= n ? 'text-amber-400' : 'text-line'}`}>
                  <Star className="h-6 w-6" fill={scores[k] >= n ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
          </div>
        ))}
        <div><label className="label">ข้อเสนอแนะ</label><textarea className="input" rows={2} value={sug} onChange={(e) => setSug(e.target.value)} /></div>
        <div className="flex gap-2 mt-1">
          <button onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
          <button onClick={submit} disabled={saving} className="btn-primary flex-1">{saving ? 'กำลังบันทึก...' : 'บันทึกประเมิน'}</button>
        </div>
      </div>
    </Modal>
  )
}

// เบิกอะไหล่ + ปิดงาน (Close) — อะไหล่ AC เท่านั้น
function PartsModal({ job, onClose, onDone }) {
  const [stock, setStock] = useState([])
  const [cart, setCart] = useState([])
  const [remark, setRemark] = useState('')
  const [noParts, setNoParts] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => { api.get('/ac-repair/stock').then((r) => setStock(r.data || [])).catch(() => {}) }, [])
  const addItem = (code) => {
    const s = stock.find((x) => x.code === code); if (!s || cart.some((c) => c.code === code)) return
    setCart((c) => [...c, { code: s.code, name: s.name, qty: 1, price: Number(s.price) || 0 }])
  }
  const setQty = (code, qty) => setCart((c) => c.map((it) => it.code === code ? { ...it, qty } : it))
  const removeItem = (code) => setCart((c) => c.filter((it) => it.code !== code))
  const submit = async () => {
    if (!remark.trim()) { alert('กรุณาระบุรายละเอียดการปิดงาน'); return }
    if (!noParts && cart.length === 0) { alert('เลือกอะไหล่ หรือเลือก "ไม่ใช้อะไหล่"'); return }
    setSaving(true)
    try {
      await api.post(`/ac-repair/jobs/${job.id}/spare-parts`, { cartItems: noParts ? [] : cart, remark, noSparePart: noParts })
      onDone()
    } catch (e) { alert(e.response?.data?.error || 'เบิกอะไหล่/ปิดงานไม่สำเร็จ') } finally { setSaving(false) }
  }
  return (
    <Modal title={`เบิกอะไหล่ + ปิดงาน ${job.job_number || ''}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="accent-primary h-4 w-4" checked={noParts} onChange={(e) => setNoParts(e.target.checked)} /> ไม่ใช้อะไหล่ในงานนี้
        </label>
        {!noParts && (
          <>
            <div><label className="label">เลือกอะไหล่ AC</label>
              <select className="input" value="" onChange={(e) => { addItem(e.target.value); e.target.value = '' }}>
                <option value="">+ เพิ่มอะไหล่</option>
                {stock.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name} (คงเหลือ {s.remaining})</option>)}
              </select>
            </div>
            {cart.map((it) => (
              <div key={it.code} className="flex items-center gap-2 text-sm">
                <span className="flex-1 min-w-0 truncate">{it.code} · {it.name}</span>
                <input type="number" min="1" className="input w-20" value={it.qty} onChange={(e) => setQty(it.code, e.target.value)} />
                <button onClick={() => removeItem(it.code)} className="text-danger"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </>
        )}
        <div><label className="label">รายละเอียดการปิดงาน *</label><textarea className="input" rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} /></div>
        <div className="flex gap-2 mt-1">
          <button onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
          <button onClick={submit} disabled={saving} className="btn-primary flex-1">{saving ? 'กำลังปิดงาน...' : 'ปิดงาน'}</button>
        </div>
      </div>
    </Modal>
  )
}
