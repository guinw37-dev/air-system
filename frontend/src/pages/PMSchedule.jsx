import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, Clock, CheckCircle, CalendarDays, Plus, RefreshCw,
} from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api from '../api/client'

// ── constants ────────────────────────────────────────────────────────────────

const MONTHS_TH = [
  '', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
]

const TYPE_BADGE = {
  major: 'bg-orange-100 text-orange-800',
  minor: 'bg-blue-100 text-blue-800',
  fan:   'bg-teal-100  text-teal-800',
}
const TYPE_LABEL = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'ล้างพัดลม' }

const STATUS_BADGE = {
  pending:  'bg-yellow-100 text-yellow-800',
  done:     'bg-green-100  text-green-800',
  overdue:  'bg-red-100    text-red-800',
  skipped:  'bg-gray-100   text-gray-600',
}
const STATUS_LABEL = { pending: 'รอดำเนินการ', done: 'เสร็จแล้ว', overdue: 'เลยกำหนด', skipped: 'ข้าม' }

// ── helpers ───────────────────────────────────────────────────────────────────

function effectiveStatus(row) {
  if (row.status === 'done' || row.status === 'skipped') return row.status
  if (row.status === 'pending' && row.scheduled_date && dayjs(row.scheduled_date).isBefore(dayjs(), 'day')) {
    return 'overdue'
  }
  return row.status
}

// ── Reschedule / Skip modal ───────────────────────────────────────────────────

function PlanRowModal({ row, onClose, onSaved }) {
  const [tab, setTab]         = useState('reschedule') // 'reschedule' | 'skip'
  const [date, setDate]       = useState(row.scheduled_date ? dayjs(row.scheduled_date).format('YYYY-MM-DD') : '')
  const [note, setNote]       = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const submit = async () => {
    setError('')
    if (tab === 'skip' && !note.trim()) { setError('กรุณาระบุเหตุผลที่ข้าม'); return }
    setSaving(true)
    try {
      if (tab === 'reschedule') {
        await api.put(`/pm/plan/${row.id}`, { scheduled_date: date, note: note || undefined })
      } else {
        await api.put(`/pm/plan/${row.id}/skip`, { note })
      }
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด')
      setSaving(false)
    }
  }

  const eff = effectiveStatus(row)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">จัดการแผน PM</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>

        {/* Info */}
        <div className="bg-gray-50 rounded-xl p-3 mb-4 text-sm">
          <p className="font-medium text-gray-800">{row.asset_code} — {row.unit_name || '-'}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {row.room_name} · {row.building_name}
          </p>
          <div className="flex gap-2 mt-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_BADGE[row.planned_type] || 'bg-gray-100 text-gray-700'}`}>
              {TYPE_LABEL[row.planned_type] || row.planned_type}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[eff] || 'bg-gray-100 text-gray-700'}`}>
              {STATUS_LABEL[eff] || eff}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden mb-4">
          {[['reschedule', 'เลื่อนวันนัด'], ['skip', 'ข้ามรายการ']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                tab === v ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        {tab === 'reschedule' ? (
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">วันนัดใหม่ *</label>
              <input
                type="date"
                className="input w-full"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">หมายเหตุ</label>
              <input
                type="text"
                className="input w-full"
                placeholder="ระบุหมายเหตุ (ถ้ามี)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">เหตุผลที่ข้าม *</label>
              <textarea
                className="input w-full resize-none"
                rows={3}
                placeholder="ระบุเหตุผล (จำเป็น)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
          <button
            onClick={submit}
            disabled={saving}
            className={`flex-1 py-2 rounded-xl text-sm font-medium text-white transition-colors ${
              tab === 'skip' ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'
            } disabled:opacity-50`}
          >
            {saving ? 'กำลังบันทึก...' : tab === 'skip' ? 'ยืนยันข้าม' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ msg, type = 'success', onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white max-w-sm ${
      type === 'success' ? 'bg-green-600' : 'bg-red-600'
    }`}>
      {msg}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PMSchedule() {
  const navigate = useNavigate()
  const currentYear = dayjs().year()

  // Master pickers
  const [clients,   setClients]   = useState([])
  const [sites,     setSites]     = useState([])
  const [buildings, setBuildings] = useState([])

  const [clientId,   setClientId]   = useState('')
  const [siteId,     setSiteId]     = useState('')
  const [year,       setYear]       = useState(currentYear)

  // Filters
  const [filterMonth,    setFilterMonth]    = useState('')
  const [filterBuilding, setFilterBuilding] = useState('')
  const [filterType,     setFilterType]     = useState('')
  const [filterStatus,   setFilterStatus]   = useState('')

  // Data
  const [plan,     setPlan]     = useState([])
  const [summary,  setSummary]  = useState([]) // [{month, done, pending, overdue, skipped}]
  const [loading,  setLoading]  = useState(false)
  const [generating, setGenerating] = useState(false)

  // Modal / toast
  const [modalRow, setModalRow] = useState(null)
  const [toast,    setToast]    = useState(null)

  // Load clients on mount
  useEffect(() => {
    api.get('/master/clients').then((r) => setClients(r.data || [])).catch(() => {})
  }, [])

  // Load sites when client changes
  useEffect(() => {
    setSiteId('')
    setSites([])
    if (!clientId) return
    api.get(`/master/sites?client_id=${clientId}`).then((r) => setSites(r.data || [])).catch(() => {})
  }, [clientId])

  // Load buildings when site changes
  useEffect(() => {
    setFilterBuilding('')
    setBuildings([])
    if (!siteId) return
    api.get(`/master/buildings?site_id=${siteId}`).then((r) => setBuildings(r.data || [])).catch(() => {})
  }, [siteId])

  // Load plan data
  const loadPlan = useCallback(() => {
    if (!clientId) return
    setLoading(true)
    const p = new URLSearchParams({ client_id: clientId, year })
    if (siteId)     p.set('site_id', siteId)
    Promise.all([
      api.get(`/pm/plan?${p}`),
      api.get(`/pm/plan-summary?${p}`),
    ]).then(([planRes, sumRes]) => {
      setPlan(planRes.data || [])
      setSummary(sumRes.data || [])
    }).catch(() => {
      setPlan([])
      setSummary([])
    }).finally(() => setLoading(false))
  }, [clientId, siteId, year])

  useEffect(() => { loadPlan() }, [loadPlan])

  // Generate plan
  const handleGenerate = async () => {
    if (!clientId) { setToast({ msg: 'กรุณาเลือก Client ก่อน', type: 'error' }); return }
    if (!confirm(`สร้างแผน PM ปี ${year + 543} (${year}) สำหรับ Client นี้?`)) return
    setGenerating(true)
    try {
      const p = new URLSearchParams({ client_id: clientId, year })
      if (siteId) p.set('site_id', siteId)
      const r = await api.post(`/pm/generate?${p}`)
      const d = r.data
      setToast({ msg: `สร้างแผนสำเร็จ: เพิ่ม ${d.inserted ?? 0} รายการ, ข้าม ${d.skipped ?? 0} รายการ (มีอยู่แล้ว)`, type: 'success' })
      loadPlan()
    } catch (err) {
      setToast({ msg: err.response?.data?.error || 'เกิดข้อผิดพลาด', type: 'error' })
    } finally {
      setGenerating(false)
    }
  }

  // Summary strip — aggregate by current year
  const totalSummary = useMemo(() => {
    const base = { done: 0, pending: 0, overdue: 0, skipped: 0 }
    ;(summary || []).forEach((r) => {
      base.done    += r.done    || 0
      base.pending += r.pending || 0
      base.overdue += r.overdue || 0
      base.skipped += r.skipped || 0
    })
    return base
  }, [summary])

  // Compute effective status + filter
  const rows = useMemo(() => {
    return (plan || []).map((r) => ({ ...r, _eff: effectiveStatus(r) }))
  }, [plan])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterMonth) {
        if (!r.scheduled_date) return false
        if (String(dayjs(r.scheduled_date).month() + 1) !== String(filterMonth)) return false
      }
      if (filterBuilding && r.building_name !== filterBuilding && String(r.building_id) !== String(filterBuilding)) return false
      if (filterType   && r.planned_type !== filterType)   return false
      if (filterStatus && r._eff          !== filterStatus) return false
      return true
    })
  }, [rows, filterMonth, filterBuilding, filterType, filterStatus])

  // Unique buildings from plan for filter dropdown
  const planBuildings = useMemo(() => {
    const map = new Map()
    ;(plan || []).forEach((r) => {
      if (r.building_name) map.set(r.building_name, r.building_name)
    })
    return Array.from(map.values())
  }, [plan])

  const years = Array.from({ length: 4 }, (_, i) => currentYear - 1 + i)

  return (
    <Layout title="PM Schedule">
      <div className="p-4 lg:p-6 flex flex-col gap-5">

        {/* ── Selectors ── */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Client <span className="text-red-500">*</span></label>
            <select
              className="input min-w-[180px]"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">— เลือก Client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {clientId && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Site</label>
              <select
                className="input min-w-[160px]"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
              >
                <option value="">ทุก Site</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">ปี</label>
            <select
              className="input w-28"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {years.map((y) => <option key={y} value={y}>{y + 543} ({y})</option>)}
            </select>
          </div>

          {clientId && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="btn-primary flex items-center gap-2 text-sm self-end"
            >
              {generating
                ? <><RefreshCw className="h-4 w-4 animate-spin" /> กำลังสร้าง...</>
                : <><Plus className="h-4 w-4" /> สร้างแผน PM</>
              }
            </button>
          )}
        </div>

        {!clientId && (
          <div className="text-center text-gray-400 py-20 text-sm">เลือก Client เพื่อดูแผน PM</div>
        )}

        {clientId && (
          <>
            {/* ── Summary strip ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { key: 'pending', label: 'รอดำเนินการ', icon: CalendarDays, bg: 'bg-yellow-50', ic: 'text-yellow-600' },
                { key: 'overdue', label: 'เลยกำหนด',    icon: AlertTriangle, bg: 'bg-red-50',    ic: 'text-red-600'    },
                { key: 'done',    label: 'เสร็จแล้ว',   icon: CheckCircle,   bg: 'bg-green-50',  ic: 'text-green-600'  },
                { key: 'skipped', label: 'ข้าม',         icon: Clock,         bg: 'bg-gray-50',   ic: 'text-gray-500'   },
              ].map(({ key, label, icon: Icon, bg, ic }) => (
                <button
                  key={key}
                  onClick={() => setFilterStatus(filterStatus === key ? '' : key)}
                  className={`${bg} rounded-2xl p-4 text-left transition-all ${filterStatus === key ? 'ring-2 ring-blue-500' : ''}`}
                >
                  <Icon className={`h-5 w-5 ${ic} mb-2`} />
                  <p className="text-2xl font-bold text-gray-900">{totalSummary[key]}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{label}</p>
                </button>
              ))}
            </div>

            {/* ── Filters ── */}
            <div className="flex flex-wrap gap-3 items-center">
              <select
                className="input text-sm"
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
              >
                <option value="">ทุกเดือน</option>
                {MONTHS_TH.slice(1).map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>

              <select
                className="input text-sm min-w-[140px]"
                value={filterBuilding}
                onChange={(e) => setFilterBuilding(e.target.value)}
              >
                <option value="">ทุกอาคาร</option>
                {(buildings.length > 0 ? buildings : planBuildings.map((n) => ({ id: n, name: n }))).map((b) => (
                  <option key={b.id ?? b} value={b.id ?? b}>{b.name ?? b}</option>
                ))}
              </select>

              <select
                className="input text-sm"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                <option value="">ทุกประเภท</option>
                <option value="major">ล้างใหญ่</option>
                <option value="minor">ล้างย่อย</option>
                <option value="fan">ล้างพัดลม</option>
              </select>

              <select
                className="input text-sm"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="">ทุกสถานะ</option>
                <option value="pending">รอดำเนินการ</option>
                <option value="overdue">เลยกำหนด</option>
                <option value="done">เสร็จแล้ว</option>
                <option value="skipped">ข้าม</option>
              </select>

              {(filterMonth || filterBuilding || filterType || filterStatus) && (
                <button
                  onClick={() => { setFilterMonth(''); setFilterBuilding(''); setFilterType(''); setFilterStatus('') }}
                  className="text-sm text-blue-600 hover:underline"
                >
                  ล้าง filter
                </button>
              )}
            </div>

            {/* ── Table ── */}
            {loading ? (
              <div className="flex justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-blue-600" />
              </div>
            ) : (
              <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">เลขเครื่อง</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ห้อง / อาคาร</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ประเภท</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">วันนัด</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">สถานะ</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">หมายเหตุ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-16 text-center text-gray-400">
                            {plan.length === 0 ? 'ยังไม่มีแผน PM — กด "สร้างแผน PM" เพื่อสร้าง' : 'ไม่พบรายการที่ตรงเงื่อนไข'}
                          </td>
                        </tr>
                      )}
                      {filtered.map((r) => {
                        const eff = r._eff
                        return (
                          <tr
                            key={r.id}
                            onClick={() => setModalRow(r)}
                            className="hover:bg-gray-50 cursor-pointer transition-colors"
                          >
                            <td className="py-3 px-4 font-semibold text-blue-700">{r.asset_code}</td>
                            <td className="py-3 px-4 text-xs text-gray-600">
                              <p>{r.room_name || '-'}</p>
                              <p className="text-gray-400">{r.floor_name ? `${r.floor_name} · ` : ''}{r.building_name || '-'}</p>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_BADGE[r.planned_type] || 'bg-gray-100 text-gray-700'}`}>
                                {TYPE_LABEL[r.planned_type] || r.planned_type}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-gray-700 text-xs">
                              {r.scheduled_date ? dayjs(r.scheduled_date).format('DD/MM/YYYY') : '-'}
                            </td>
                            <td className="py-3 px-4">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[eff] || 'bg-gray-100 text-gray-700'}`}>
                                {STATUS_LABEL[eff] || eff}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-xs text-gray-400 max-w-[180px] truncate">{r.note || '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="text-xs text-gray-400">{filtered.length} รายการ · คลิกแถวเพื่อเลื่อนวันหรือข้ามรายการ</p>
          </>
        )}
      </div>

      {/* Modal */}
      {modalRow && (
        <PlanRowModal
          row={modalRow}
          onClose={() => setModalRow(null)}
          onSaved={() => { setModalRow(null); loadPlan() }}
        />
      )}

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
    </Layout>
  )
}
