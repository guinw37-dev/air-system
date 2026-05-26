import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Clock, CheckCircle, CalendarDays, Plus, Wind } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api from '../api/client'

const FILTERS = [
  { value: 'all',      label: 'ทั้งหมด',          icon: null },
  { value: 'overdue',  label: 'เกินกำหนด',         icon: AlertTriangle,  color: 'text-red-500' },
  { value: 'due_soon', label: 'ใกล้ถึง (30 วัน)',  icon: Clock,          color: 'text-orange-500' },
  { value: 'ok',       label: 'ยังไม่ถึง',          icon: CheckCircle,    color: 'text-green-500' },
  { value: 'no_date',  label: 'ยังไม่ได้ตั้ง',      icon: Wind,           color: 'text-gray-400' },
]

const PM_STATUS = {
  overdue:  { label: 'เกินกำหนด',        color: 'bg-red-100 text-red-700' },
  due_soon: { label: 'ใกล้ถึง',           color: 'bg-orange-100 text-orange-700' },
  ok:       { label: 'ปกติ',              color: 'bg-green-100 text-green-700' },
  no_date:  { label: 'ยังไม่ได้ตั้ง',    color: 'bg-gray-100 text-gray-500' },
}

const WO_TYPES = [
  { value: 'major', label: 'ล้างใหญ่' },
  { value: 'minor', label: 'ล้างย่อย' },
  { value: 'fan',   label: 'ล้างพัดลม' },
]

function CreateWoModal({ selected, onClose, onCreated }) {
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ type: 'major', tech1_id: '', tech2_id: '' })
  const [saving, setSaving] = useState(false)

  const hospitalId = selected[0]?.hospital_id
  const hospitalName = selected[0]?.hospital_name

  useEffect(() => {
    api.get('/master/users').then((r) => setUsers(r.data.filter((u) => ['technician', 'admin'].includes(u.role))))
  }, [])

  const submit = async () => {
    if (!form.tech1_id) { alert('กรุณาเลือกช่าง'); return }
    setSaving(true)
    try {
      // 1. Create WO
      const { data: wo } = await api.post('/work-orders', {
        hospital_id: hospitalId,
        type: form.type,
        tech1_id: form.tech1_id,
        tech2_id: form.tech2_id || undefined,
      })
      // 2. Add all selected AC units
      await Promise.all(
        selected.map((ac) => api.post(`/work-orders/${wo.id}/items`, { ac_unit_id: ac.id }))
      )
      navigate(`/work-orders/${wo.id}`)
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-gray-900 text-lg">สร้างใบงาน PM</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>

        <div className="bg-blue-50 rounded-xl p-3 mb-4">
          <p className="text-xs text-blue-600 font-medium">{hospitalName}</p>
          <p className="text-sm text-blue-900 mt-0.5">{selected.length} เครื่องที่เลือก</p>
          <div className="flex flex-wrap gap-1 mt-2">
            {selected.map((ac) => (
              <span key={ac.id} className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">{ac.ac_code}</span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="label">ประเภทงาน *</label>
            <div className="flex gap-2">
              {WO_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setForm({ ...form, type: t.value })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    form.type === t.value
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">ช่าง 1 *</label>
            <select className="input" value={form.tech1_id} onChange={(e) => setForm({ ...form, tech1_id: e.target.value })}>
              <option value="">-- เลือกช่าง --</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div>
            <label className="label">ช่าง 2 (ถ้ามี)</label>
            <select className="input" value={form.tech2_id} onChange={(e) => setForm({ ...form, tech2_id: e.target.value })}>
              <option value="">-- ไม่มี --</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div className="flex gap-2 mt-2">
            <button onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
            <button onClick={submit} disabled={saving} className="btn-primary flex-1">
              {saving ? 'กำลังสร้าง...' : 'สร้างใบงาน'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PMSchedule() {
  const [filter, setFilter] = useState('all')
  const [hospital, setHospital] = useState('')
  const [hospitals, setHospitals] = useState([])
  const [list, setList] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState([]) // array of ac objects
  const [showCreateWo, setShowCreateWo] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    api.get('/master/hospitals').then((r) => setHospitals(r.data))
    api.get('/pm/summary').then((r) => setSummary(r.data))
  }, [])

  useEffect(() => {
    setLoading(true)
    setSelected([])
    const params = new URLSearchParams({ filter })
    if (hospital) params.append('hospital_id', hospital)
    api.get(`/pm?${params}`).then((r) => setList(r.data)).finally(() => setLoading(false))
  }, [filter, hospital])

  const filtered = useMemo(() => list.filter((a) =>
    !search ||
    a.ac_code?.toLowerCase().includes(search.toLowerCase()) ||
    a.ac_name?.toLowerCase().includes(search.toLowerCase()) ||
    a.dept_name?.toLowerCase().includes(search.toLowerCase())
  ), [list, search])

  // O(1) lookup instead of O(n) find() per row
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected])

  const toggleSelect = (ac) => {
    // can only select same hospital
    if (selected.length > 0 && selected[0].hospital_id !== ac.hospital_id) {
      alert('เลือกได้เฉพาะเครื่องในโรงพยาบาลเดียวกัน')
      return
    }
    setSelected((prev) =>
      prev.find((s) => s.id === ac.id)
        ? prev.filter((s) => s.id !== ac.id)
        : [...prev, ac]
    )
  }

  const selectAll = () => {
    if (filtered.length === 0) return
    const firstHospital = filtered[0].hospital_id
    const sameHospital = filtered.filter((a) => a.hospital_id === firstHospital)
    setSelected(sameHospital)
  }

  const formatDays = (days) => {
    if (days === null || days === undefined) return '-'
    if (days < 0) return `เกิน ${Math.abs(days)} วัน`
    if (days === 0) return 'วันนี้'
    return `อีก ${days} วัน`
  }

  const summaryCards = [
    { key: 'overdue',  label: 'เกินกำหนด',  icon: AlertTriangle, bg: 'bg-red-50',    iconColor: 'text-red-500' },
    { key: 'due_soon', label: 'ใกล้ถึง',     icon: Clock,         bg: 'bg-orange-50', iconColor: 'text-orange-500' },
    { key: 'ok',       label: 'ปกติ',         icon: CheckCircle,   bg: 'bg-green-50',  iconColor: 'text-green-500' },
    { key: 'no_date',  label: 'ไม่มีกำหนด',  icon: CalendarDays,  bg: 'bg-gray-50',   iconColor: 'text-gray-400' },
  ]

  return (
    <Layout title="แผน PM">
      <div className="p-6 flex flex-col gap-5">

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {summaryCards.map(({ key, label, icon: Icon, bg, iconColor }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`${bg} rounded-2xl p-4 text-left transition-all ${filter === key ? 'ring-2 ring-blue-500' : ''}`}
              >
                <Icon className={`h-5 w-5 ${iconColor} mb-2`} />
                <p className="text-2xl font-bold text-gray-900">{summary[key] ?? 0}</p>
                <p className="text-xs text-gray-600 mt-0.5">{label}</p>
              </button>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            className="input max-w-xs"
            placeholder="ค้นหา รหัส / ชื่อ / แผนก..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="input max-w-xs" value={hospital} onChange={(e) => setHospital(e.target.value)}>
            <option value="">ทุกโรงพยาบาล</option>
            {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <div className="flex gap-2 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  filter === f.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action bar when selected */}
        {selected.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-blue-800 font-medium">
              เลือก {selected.length} เครื่อง — {selected[0].hospital_name}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setSelected([])} className="btn-secondary text-sm py-1.5">ยกเลิก</button>
              <button onClick={() => setShowCreateWo(true)} className="btn-primary text-sm py-1.5 flex items-center gap-1.5">
                <Plus className="h-4 w-4" /> สร้างใบงาน
              </button>
            </div>
          </div>
        )}

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
                    <th className="py-3 px-4 w-10">
                      <input type="checkbox" className="accent-blue-600"
                        checked={selectedIds.size === filtered.length && filtered.length > 0}
                        onChange={(e) => e.target.checked ? selectAll() : setSelected([])}
                      />
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">รหัส</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ชื่อ / ประเภท</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">สถานที่</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">โรงพยาบาล</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">กำหนด PM</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">สถานะ</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">รอบ (เดือน)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} className="py-16 text-center text-gray-400">ไม่พบข้อมูล</td></tr>
                  )}
                  {filtered.map((ac) => {
                    const isSelected = selectedIds.has(ac.id)
                    const pm = PM_STATUS[ac.pm_status] || { label: ac.pm_status, color: 'bg-gray-100 text-gray-600' }
                    return (
                      <tr
                        key={ac.id}
                        onClick={() => toggleSelect(ac)}
                        className={`cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            className="accent-blue-600"
                            checked={!!isSelected}
                            onChange={() => toggleSelect(ac)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="py-3 px-4 font-semibold text-blue-700">{ac.ac_code}</td>
                        <td className="py-3 px-4">
                          <p className="text-gray-800">{ac.ac_name || '-'}</p>
                          <p className="text-xs text-gray-400">{ac.ac_type}</p>
                        </td>
                        <td className="py-3 px-4 text-gray-600 text-xs">
                          <p>{ac.dept_name}</p>
                          <p className="text-gray-400">{ac.floor_name} / {ac.building_name}</p>
                        </td>
                        <td className="py-3 px-4 text-gray-600 text-xs">{ac.hospital_name}</td>
                        <td className="py-3 px-4">
                          <p className="text-gray-800">{ac.next_pm_date ? dayjs(ac.next_pm_date).format('DD/MM/YYYY') : '-'}</p>
                          <p className={`text-xs mt-0.5 ${ac.days_left < 0 ? 'text-red-500 font-medium' : ac.days_left <= 30 ? 'text-orange-500' : 'text-gray-400'}`}>
                            {formatDays(ac.days_left)}
                          </p>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pm.color}`}>{pm.label}</span>
                        </td>
                        <td className="py-3 px-4 text-gray-500 text-center">{ac.pm_interval_months || '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400">{filtered.length} เครื่อง · เลือก checkbox แล้วกด "สร้างใบงาน" เพื่อเปิดใบงาน PM</p>
      </div>

      {showCreateWo && selected.length > 0 && (
        <CreateWoModal
          selected={selected}
          onClose={() => setShowCreateWo(false)}
          onCreated={() => { setShowCreateWo(false); setSelected([]) }}
        />
      )}
    </Layout>
  )
}
