import { useEffect, useState } from 'react'
import { Plus, Wrench, Wind } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import api from '../api/client'

const STATUSES = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'open', label: 'รอซ่อม' },
  { value: 'in_progress', label: 'กำลังซ่อม' },
  { value: 'done', label: 'เสร็จแล้ว' },
]
const STATUS_COLOR = {
  open:        'badge-danger',
  in_progress: 'badge-warn',
  done:        'badge-success',
}
const STATUS_TH = { open: 'รอซ่อม', in_progress: 'กำลังซ่อม', done: 'เสร็จแล้ว' }
const CLEANING_TYPES = [
  { value: '',      label: '— ไม่มี —' },
  { value: 'major', label: 'ล้างใหญ่' },
  { value: 'minor', label: 'ล้างย่อย' },
  { value: 'fan',   label: 'ล้างพัดลม' },
]
const CLEANING_COLOR = {
  major: 'badge-primary',
  minor: 'badge-primary',
  fan:   'badge-success',
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-ink text-lg">{title}</h3>
          <button onClick={onClose} className="text-ink-muted text-2xl leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function RepairLogs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState(null)
  const [editForm, setEditForm] = useState({ cause: '', solution: '', status: '', cleaning_type: '' })
  const [saving, setSaving] = useState(false)

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [createType, setCreateType] = useState(null) // null | 'repair' | 'cleaning'
  const [hospitals, setHospitals] = useState([])
  const [selHospital, setSelHospital] = useState('')
  const [acList, setAcList] = useState([])
  const [acSearch, setAcSearch] = useState('')
  const [createForm, setCreateForm] = useState({ ac_unit_id: '', problem: '', cleaning_type: '' })
  const [creating, setCreating] = useState(false)

  const closeCreate = () => {
    setShowCreate(false)
    setCreateType(null)
    setSelHospital('')
    setAcSearch('')
    setCreateForm({ ac_unit_id: '', problem: '', cleaning_type: '' })
  }

  const load = () => {
    setLoading(true)
    const params = status ? `?status=${status}` : ''
    api.get(`/repair-logs${params}`).then((r) => setLogs(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [status])

  useEffect(() => {
    if (!showCreate) return
    api.get('/master/clients').then((r) => setHospitals(r.data))
  }, [showCreate])

  const CLEAN_LABEL = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'ล้างพัดลม' }

  useEffect(() => {
    if (!selHospital) { setAcList([]); setCreateForm((f) => ({ ...f, ac_unit_id: '' })); return }
    api.get(`/master/units?client_id=${selHospital}`).then((r) => setAcList(r.data))
    setAcSearch('')
    setCreateForm((f) => ({ ...f, ac_unit_id: '' }))
  }, [selHospital])

  const openDetail = (log) => {
    setSelected(log)
    setEditForm({ cause: log.cause || '', solution: log.solution || '', status: log.status, cleaning_type: log.cleaning_type || '' })
  }

  const saveEdit = async () => {
    setSaving(true)
    try {
      const res = await api.patch(`/repair-logs/${selected.id}`, {
        cause: editForm.cause || undefined,
        solution: editForm.solution || undefined,
        status: editForm.status || undefined,
        cleaning_type: editForm.cleaning_type || null,
      })
      setSelected(null)
      load()
      if (res.data?.pm_updated) alert('อัปเดตแผน PM เรียบร้อย')
    } catch (err) { alert(err.response?.data?.error || 'เกิดข้อผิดพลาด') }
    finally { setSaving(false) }
  }

  const submitCreate = async () => {
    if (!createForm.ac_unit_id) { alert('กรุณาเลือกเครื่องแอร์'); return }
    if (createType === 'repair' && !createForm.problem.trim()) { alert('กรุณาระบุปัญหา'); return }
    if (createType === 'cleaning' && !createForm.cleaning_type) { alert('กรุณาเลือกประเภทการล้าง'); return }

    const problem = createType === 'cleaning'
      ? `ขอล้างแอร์ — ${CLEAN_LABEL[createForm.cleaning_type]}${createForm.problem.trim() ? ' / ' + createForm.problem.trim() : ''}`
      : createForm.problem.trim()

    setCreating(true)
    try {
      await api.post('/repair-logs', {
        ac_unit_id: createForm.ac_unit_id,
        problem,
        cleaning_type: createType === 'cleaning' ? createForm.cleaning_type : undefined,
      })
      closeCreate()
      load()
    } catch (err) { alert(err.response?.data?.error || 'เกิดข้อผิดพลาด') }
    finally { setCreating(false) }
  }

  return (
    <Layout
      title="รายการแจ้งซ่อม"
      actions={
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5 text-sm py-2">
          <Plus className="h-4 w-4" /> แจ้งงานใหม่
        </button>
      }
    >
      <div className="p-6 flex flex-col gap-4">

        {/* Filter chips */}
        <div className="flex gap-2 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                status === s.value
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface text-ink-muted border-line hover:border-primary'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="card p-0 overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-line border-t-primary" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-page border-b border-line">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">เครื่องแอร์</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">สถานที่</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">ปัญหา</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">สถานะ</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">ล้างด้วย</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">ใบงาน</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">วันที่</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-ink-muted">ไม่พบรายการ</td>
                    </tr>
                  )}
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      onClick={() => openDetail(log)}
                      className="hover:bg-primary-soft/40 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Wrench className="h-4 w-4 text-ink-muted shrink-0" />
                          <div>
                            <p className="font-medium text-ink">{log.asset_code || log.ac_code}</p>
                            <p className="text-xs text-ink-muted">{log.ac_name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-ink-muted text-xs">
                        <p>{log.dept_name}</p>
                        <p className="text-ink-muted/60">{log.floor_name} / {log.building_name}</p>
                      </td>
                      <td className="py-3 px-4 text-ink max-w-xs">
                        <p className="truncate">{log.problem || '-'}</p>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`badge ${STATUS_COLOR[log.status] || 'badge-gray'}`}>
                          {STATUS_TH[log.status] || log.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {log.cleaning_type ? (
                          <span className={`badge ${CLEANING_COLOR[log.cleaning_type]}`}>
                            {CLEANING_TYPES.find((t) => t.value === log.cleaning_type)?.label}
                          </span>
                        ) : <span className="text-line text-xs">—</span>}
                      </td>
                      <td className="py-3 px-4 text-primary text-xs">{log.order_no || '-'}</td>
                      <td className="py-3 px-4 text-ink-muted text-xs">{dayjs(log.created_at).format('DD/MM/YY')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="text-xs text-ink-muted">{logs.length} รายการ</p>
      </div>

      {/* Edit modal */}
      {selected && (
        <Modal title={`${selected.ac_code} — ${selected.ac_name}`} onClose={() => setSelected(null)}>
          <div className="flex flex-col gap-4">
            <div className="bg-page rounded-xl p-3">
              <p className="text-xs text-ink-muted mb-1">ปัญหา</p>
              <p className="text-sm text-ink">{selected.problem || '-'}</p>
            </div>
            <div><label className="label">สาเหตุ</label>
              <textarea className="input" rows={2} value={editForm.cause} onChange={(e) => setEditForm({ ...editForm, cause: e.target.value })} /></div>
            <div><label className="label">วิธีแก้ไข</label>
              <textarea className="input" rows={2} value={editForm.solution} onChange={(e) => setEditForm({ ...editForm, solution: e.target.value })} /></div>
            <div>
              <label className="label">สถานะ</label>
              <select className="input" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                <option value="open">รอซ่อม</option>
                <option value="in_progress">กำลังซ่อม</option>
                <option value="done">เสร็จแล้ว</option>
              </select>
            </div>
            <div>
              <label className="label">ล้างแอร์ด้วย (ตัดแผน PM)</label>
              <select
                className="input"
                value={editForm.cleaning_type}
                onChange={(e) => setEditForm({ ...editForm, cleaning_type: e.target.value })}
              >
                {CLEANING_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              {editForm.cleaning_type && editForm.status === 'done' && (
                <p className="text-xs text-success mt-1">✓ บันทึกแล้วจะอัปเดต next_pm_date อัตโนมัติ</p>
              )}
              {editForm.cleaning_type && editForm.status !== 'done' && (
                <p className="text-xs text-warn mt-1">* ต้องตั้งสถานะ "เสร็จแล้ว" ถึงจะตัด PM</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSelected(null)} className="btn-secondary flex-1">ยกเลิก</button>
              <button onClick={saveEdit} disabled={saving} className="btn-primary flex-1">{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create modal — type picker */}
      {showCreate && !createType && (
        <Modal title="แจ้งงานใหม่" onClose={closeCreate}>
          <p className="text-sm text-ink-muted mb-4">เลือกประเภทงาน</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setCreateType('repair')}
              className="flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-line hover:border-danger hover:bg-danger-soft transition-colors group"
            >
              <span className="w-12 h-12 rounded-full bg-danger-soft flex items-center justify-center group-hover:bg-danger/20 transition-colors">
                <Wrench className="h-6 w-6 text-danger" />
              </span>
              <div className="text-center">
                <p className="font-semibold text-ink text-sm">แจ้งซ่อม</p>
                <p className="text-xs text-ink-muted mt-0.5">เสีย / ผิดปกติ / มีเสียง</p>
              </div>
            </button>
            <button
              onClick={() => setCreateType('cleaning')}
              className="flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-line hover:border-primary hover:bg-primary-soft transition-colors group"
            >
              <span className="w-12 h-12 rounded-full bg-primary-soft flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <Wind className="h-6 w-6 text-primary" />
              </span>
              <div className="text-center">
                <p className="font-semibold text-ink text-sm">ขอล้างแอร์</p>
                <p className="text-xs text-ink-muted mt-0.5">ล้างใหญ่ / ล้างย่อย / พัดลม</p>
              </div>
            </button>
          </div>
          <button onClick={closeCreate} className="btn-secondary w-full mt-4">ยกเลิก</button>
        </Modal>
      )}

      {/* Create modal — repair form */}
      {showCreate && createType === 'repair' && (
        <Modal title="แจ้งซ่อมปกติ" onClose={closeCreate}>
          <div className="flex flex-col gap-4">
            <button onClick={() => setCreateType(null)} className="text-xs text-primary hover:underline text-left">← เปลี่ยนประเภท</button>
            <div>
              <label className="label">โรงพยาบาล *</label>
              <select className="input" value={selHospital} onChange={(e) => setSelHospital(e.target.value)}>
                <option value="">-- เลือก --</option>
                {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">เครื่องแอร์ *</label>
              <input
                className="input mb-1"
                placeholder="ค้นหา รหัส / ชื่อ / แผนก..."
                value={acSearch}
                disabled={!selHospital}
                onChange={(e) => { setAcSearch(e.target.value); setCreateForm((f) => ({ ...f, ac_unit_id: '' })) }}
              />
              {selHospital && (
                <div className="border border-line rounded-xl max-h-40 overflow-y-auto">
                  {acList
                    .filter((a) => !acSearch || [(a.asset_code || a.ac_code), a.name, (a.room_name || a.dept_name), a.floor_name].join(' ').toLowerCase().includes(acSearch.toLowerCase()))
                    .map((a) => (
                      <button key={a.id} type="button"
                        onClick={() => { setCreateForm((f) => ({ ...f, ac_unit_id: a.id })); setAcSearch(`${a.asset_code || a.ac_code} — ${a.name}`) }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-primary-soft border-b border-line last:border-0 ${createForm.ac_unit_id === a.id ? 'bg-primary-soft text-primary font-medium' : 'text-ink'}`}
                      >
                        <span className="font-medium">{a.asset_code || a.ac_code}</span>{a.name ? ` — ${a.name}` : ''}
                        <span className="text-xs text-ink-muted ml-1">({a.room_name || a.dept_name})</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div>
              <label className="label">รายละเอียดปัญหา *</label>
              <textarea className="input" rows={3} placeholder="อธิบายอาการ / ปัญหาที่พบ..." value={createForm.problem} onChange={(e) => setCreateForm({ ...createForm, problem: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button onClick={closeCreate} className="btn-secondary flex-1">ยกเลิก</button>
              <button onClick={submitCreate} disabled={creating} className="btn-primary flex-1">{creating ? 'กำลังบันทึก...' : 'แจ้งซ่อม'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create modal — cleaning form */}
      {showCreate && createType === 'cleaning' && (
        <Modal title="ขอล้างแอร์" onClose={closeCreate}>
          <div className="flex flex-col gap-4">
            <button onClick={() => setCreateType(null)} className="text-xs text-primary hover:underline text-left">← เปลี่ยนประเภท</button>
            <div>
              <label className="label">โรงพยาบาล *</label>
              <select className="input" value={selHospital} onChange={(e) => setSelHospital(e.target.value)}>
                <option value="">-- เลือก --</option>
                {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">เครื่องแอร์ *</label>
              <input
                className="input mb-1"
                placeholder="ค้นหา รหัส / ชื่อ / แผนก..."
                value={acSearch}
                disabled={!selHospital}
                onChange={(e) => { setAcSearch(e.target.value); setCreateForm((f) => ({ ...f, ac_unit_id: '' })) }}
              />
              {selHospital && (
                <div className="border border-line rounded-xl max-h-40 overflow-y-auto">
                  {acList
                    .filter((a) => !acSearch || [(a.asset_code || a.ac_code), a.name, (a.room_name || a.dept_name), a.floor_name].join(' ').toLowerCase().includes(acSearch.toLowerCase()))
                    .map((a) => (
                      <button key={a.id} type="button"
                        onClick={() => { setCreateForm((f) => ({ ...f, ac_unit_id: a.id })); setAcSearch(`${a.asset_code || a.ac_code} — ${a.name}`) }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-primary-soft border-b border-line last:border-0 ${createForm.ac_unit_id === a.id ? 'bg-primary-soft text-primary font-medium' : 'text-ink'}`}
                      >
                        <span className="font-medium">{a.asset_code || a.ac_code}</span>{a.name ? ` — ${a.name}` : ''}
                        <span className="text-xs text-ink-muted ml-1">({a.room_name || a.dept_name})</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div>
              <label className="label">ประเภทการล้าง *</label>
              <div className="flex gap-2">
                {[
                  { value: 'major', label: 'ล้างใหญ่' },
                  { value: 'minor', label: 'ล้างย่อย' },
                  { value: 'fan',   label: 'ล้างพัดลม' },
                ].map((t) => (
                  <button key={t.value} type="button"
                    onClick={() => setCreateForm((f) => ({ ...f, cleaning_type: t.value }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${createForm.cleaning_type === t.value ? 'bg-primary text-white border-primary' : 'bg-surface text-ink-muted border-line'}`}
                  >{t.label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">หมายเหตุ (ถ้ามี)</label>
              <textarea className="input" rows={2} placeholder="รายละเอียดเพิ่มเติม..." value={createForm.problem} onChange={(e) => setCreateForm({ ...createForm, problem: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button onClick={closeCreate} className="btn-secondary flex-1">ยกเลิก</button>
              <button onClick={submitCreate} disabled={creating} className="btn-primary flex-1">{creating ? 'กำลังบันทึก...' : 'ส่งคำขอ'}</button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  )
}
