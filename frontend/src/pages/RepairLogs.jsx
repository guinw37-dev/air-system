import { useEffect, useState } from 'react'
import { Plus, Wrench } from 'lucide-react'
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
  open:        'bg-red-100 text-red-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  done:        'bg-green-100 text-green-700',
}
const STATUS_TH = { open: 'รอซ่อม', in_progress: 'กำลังซ่อม', done: 'เสร็จแล้ว' }
const CLEANING_TYPES = [
  { value: '',      label: '— ไม่มี —' },
  { value: 'major', label: 'ล้างใหญ่' },
  { value: 'minor', label: 'ล้างย่อย' },
  { value: 'fan',   label: 'ล้างพัดลม' },
]
const CLEANING_COLOR = {
  major: 'bg-blue-100 text-blue-700',
  minor: 'bg-teal-100 text-teal-700',
  fan:   'bg-purple-100 text-purple-700',
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
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
  const [hospitals, setHospitals] = useState([])
  const [selHospital, setSelHospital] = useState('')
  const [acList, setAcList] = useState([])
  const [acSearch, setAcSearch] = useState('')
  const [createForm, setCreateForm] = useState({ ac_unit_id: '', problem: '' })
  const [creating, setCreating] = useState(false)

  const load = () => {
    setLoading(true)
    const params = status ? `?status=${status}` : ''
    api.get(`/repair-logs${params}`).then((r) => setLogs(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [status])

  useEffect(() => {
    if (!showCreate) return
    api.get('/master/hospitals').then((r) => setHospitals(r.data))
  }, [showCreate])

  useEffect(() => {
    if (!selHospital) { setAcList([]); setCreateForm((f) => ({ ...f, ac_unit_id: '' })); return }
    api.get(`/master/ac-units?hospital_id=${selHospital}`).then((r) => setAcList(r.data))
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
    if (!createForm.ac_unit_id || !createForm.problem.trim()) {
      alert('กรุณาเลือกเครื่องแอร์และระบุปัญหา')
      return
    }
    setCreating(true)
    try {
      await api.post('/repair-logs', createForm)
      setShowCreate(false)
      setSelHospital('')
      setCreateForm({ ac_unit_id: '', problem: '' })
      load()
    } catch (err) { alert(err.response?.data?.error || 'เกิดข้อผิดพลาด') }
    finally { setCreating(false) }
  }

  return (
    <Layout
      title="รายการแจ้งซ่อม"
      actions={
        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5 text-sm py-2">
          <Plus className="h-4 w-4" /> แจ้งซ่อมใหม่
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
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
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
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-blue-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">เครื่องแอร์</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">สถานที่</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ปัญหา</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">สถานะ</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ล้างด้วย</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ใบงาน</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">วันที่</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-gray-400">ไม่พบรายการ</td>
                    </tr>
                  )}
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      onClick={() => openDetail(log)}
                      className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Wrench className="h-4 w-4 text-gray-400 shrink-0" />
                          <div>
                            <p className="font-medium text-gray-900">{log.ac_code}</p>
                            <p className="text-xs text-gray-500">{log.ac_name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-600 text-xs">
                        <p>{log.dept_name}</p>
                        <p className="text-gray-400">{log.floor_name} / {log.building_name}</p>
                      </td>
                      <td className="py-3 px-4 text-gray-700 max-w-xs">
                        <p className="truncate">{log.problem || '-'}</p>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[log.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_TH[log.status] || log.status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {log.cleaning_type ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CLEANING_COLOR[log.cleaning_type]}`}>
                            {CLEANING_TYPES.find((t) => t.value === log.cleaning_type)?.label}
                          </span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="py-3 px-4 text-blue-600 text-xs">{log.order_no || '-'}</td>
                      <td className="py-3 px-4 text-gray-400 text-xs">{dayjs(log.created_at).format('DD/MM/YY')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400">{logs.length} รายการ</p>
      </div>

      {/* Edit modal */}
      {selected && (
        <Modal title={`${selected.ac_code} — ${selected.ac_name}`} onClose={() => setSelected(null)}>
          <div className="flex flex-col gap-4">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-500 mb-1">ปัญหา</p>
              <p className="text-sm text-gray-900">{selected.problem || '-'}</p>
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
                <p className="text-xs text-green-600 mt-1">✓ บันทึกแล้วจะอัปเดต next_pm_date อัตโนมัติ</p>
              )}
              {editForm.cleaning_type && editForm.status !== 'done' && (
                <p className="text-xs text-orange-500 mt-1">* ต้องตั้งสถานะ "เสร็จแล้ว" ถึงจะตัด PM</p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSelected(null)} className="btn-secondary flex-1">ยกเลิก</button>
              <button onClick={saveEdit} disabled={saving} className="btn-primary flex-1">{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal title="แจ้งซ่อมใหม่" onClose={() => { setShowCreate(false); setSelHospital('') }}>
          <div className="flex flex-col gap-4">
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
                <div className="border border-gray-200 rounded-xl max-h-48 overflow-y-auto">
                  {acList
                    .filter((a) => !acSearch || [a.ac_code, a.ac_name, a.dept_name, a.floor_name].join(' ').toLowerCase().includes(acSearch.toLowerCase()))
                    .map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => { setCreateForm((f) => ({ ...f, ac_unit_id: a.id })); setAcSearch(`${a.ac_code} — ${a.ac_name}`) }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-50 last:border-0 ${
                          createForm.ac_unit_id === a.id ? 'bg-blue-100 text-blue-800 font-medium' : 'text-gray-700'
                        }`}
                      >
                        <span className="font-medium">{a.ac_code}</span>
                        {a.ac_name ? ` — ${a.ac_name}` : ''}
                        <span className="text-xs text-gray-400 ml-1">({a.dept_name})</span>
                      </button>
                    ))
                  }
                </div>
              )}
            </div>
            <div>
              <label className="label">รายละเอียดปัญหา *</label>
              <textarea className="input" rows={3} placeholder="อธิบายอาการ / ปัญหาที่พบ..." value={createForm.problem} onChange={(e) => setCreateForm({ ...createForm, problem: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setShowCreate(false); setSelHospital('') }} className="btn-secondary flex-1">ยกเลิก</button>
              <button onClick={submitCreate} disabled={creating} className="btn-primary flex-1">{creating ? 'กำลังบันทึก...' : 'แจ้งซ่อม'}</button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  )
}
