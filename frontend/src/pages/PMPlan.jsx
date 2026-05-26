import { useEffect, useState, useMemo } from 'react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api from '../api/client'

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

const TYPE_SHORT = { major: 'ใหญ่', minor: 'ย่อย', fan: 'พัดลม' }
const TYPE_COLOR = {
  major: 'bg-blue-500',
  minor: 'bg-teal-500',
  fan:   'bg-purple-500',
}

const PLAN_TYPES = [
  { value: 'major', label: 'ล้างใหญ่' },
  { value: 'minor', label: 'ล้างย่อย' },
  { value: 'fan',   label: 'ล้างพัดลม' },
]

function getCellForMonth(pmEntries = [], month /* 1-12 */) {
  return pmEntries.find((e) => {
    const d = e.actual_date || e.scheduled_date
    if (!d) return false
    return dayjs(d).month() + 1 === month
  }) || null
}

// Modal for adding a plan
function PlanModal({ ac, month, year, onClose, onSaved }) {
  const [type, setType] = useState('major')
  const [saving, setSaving] = useState(false)

  const scheduledDate = dayjs(`${year}-${String(month).padStart(2, '0')}-01`).format('YYYY-MM-DD')

  const save = async () => {
    setSaving(true)
    try {
      await api.post('/pm/plan', {
        ac_unit_id: ac.id,
        planned_type: type,
        scheduled_date: scheduledDate,
      })
      onSaved()
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">วางแผน PM</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 mb-4">
          <p className="text-sm font-medium text-gray-800">{ac.ac_code} — {ac.ac_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{ac.dept_name} · {MONTHS[month - 1]} {year}</p>
        </div>
        <div className="mb-4">
          <label className="label">ประเภทการล้าง</label>
          <div className="flex gap-2">
            {PLAN_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  type === t.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
          <button onClick={save} disabled={saving} className="btn-primary flex-1">
            {saving ? 'กำลังบันทึก...' : 'บันทึกแผน'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function PMPlan() {
  const [hospitals, setHospitals] = useState([])
  const [selHospital, setSelHospital] = useState('')
  const [year, setYear] = useState(dayjs().year())
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState([])
  const [selBuilding, setSelBuilding] = useState('')

  // Plan modal
  const [planModal, setPlanModal] = useState(null) // { ac, month }

  const currentMonth = dayjs().month() + 1
  const currentYear  = dayjs().year()

  useEffect(() => {
    api.get('/master/hospitals').then((r) => setHospitals(r.data))
  }, [])

  const load = () => {
    if (!selHospital) return
    setLoading(true)
    api.get(`/pm/yearly-plan?hospital_id=${selHospital}&year=${year}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    setSelBuilding('')
    load()
  }, [selHospital, year])

  const buildings = useMemo(() => {
    const map = {}
    for (const ac of data) {
      if (!map[ac.building_id]) map[ac.building_id] = ac.building_name
    }
    return Object.entries(map).map(([id, name]) => ({ id, name }))
  }, [data])

  const filtered = useMemo(() =>
    selBuilding ? data.filter((ac) => String(ac.building_id) === selBuilding) : data
  , [data, selBuilding])

  const today = dayjs()

  const isOverdue = (ac) => {
    if (!ac.next_pm_date) return false
    return dayjs(ac.next_pm_date).isBefore(today, 'day')
  }

  const years = Array.from({ length: 4 }, (_, i) => currentYear - 1 + i)

  return (
    <Layout title="PM Plan ประจำปี">
      <div className="p-4 lg:p-6 flex flex-col gap-5">

        {/* Selectors */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-gray-700 shrink-0">โรงพยาบาล</label>
            <select className="input max-w-xs" value={selHospital} onChange={(e) => setSelHospital(e.target.value)}>
              <option value="">-- เลือก --</option>
              {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-gray-700 shrink-0">ปี</label>
            <select className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y + 543} (CE {y})</option>)}
            </select>
          </div>
          {selHospital && buildings.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-semibold text-gray-700 shrink-0">อาคาร</label>
              <select className="input max-w-xs" value={selBuilding} onChange={(e) => setSelBuilding(e.target.value)}>
                <option value="">ทั้งหมด ({data.length} เครื่อง)</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {!selHospital && (
          <div className="text-center text-gray-400 py-20 text-sm">เลือกโรงพยาบาลเพื่อดูแผน PM</div>
        )}

        {selHospital && loading && <PageSpinner />}

        {selHospital && !loading && (
          <>
            {/* Legend */}
            <div className="flex gap-4 flex-wrap text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> ล้างใหญ่ (เสร็จ)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-teal-500 inline-block" /> ล้างย่อย (เสร็จ)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-purple-500 inline-block" /> ล้างพัดลม (เสร็จ)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-gray-300 border border-dashed border-gray-400 inline-block" /> แผน (ยังไม่ล้าง)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-100 inline-block border border-red-300" /> เกินกำหนด PM</span>
            </div>

            {/* Table */}
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="text-xs border-collapse min-w-max w-full">
                  <thead>
                    <tr className="bg-gray-800 text-white">
                      <th className="text-left py-2.5 px-3 font-medium sticky left-0 bg-gray-800 z-10 min-w-[110px]">รหัส</th>
                      <th className="text-left py-2.5 px-3 font-medium min-w-[140px]">ชื่อ / แผนก</th>
                      <th className="text-left py-2.5 px-3 font-medium">รอบ</th>
                      {MONTHS.map((m, i) => (
                        <th
                          key={i}
                          className={`py-2.5 px-2 font-medium text-center w-14 ${
                            i + 1 === currentMonth && year === currentYear
                              ? 'bg-blue-700 text-white'
                              : ''
                          }`}
                        >
                          {m}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={15} className="py-16 text-center text-gray-400">ไม่พบข้อมูล</td>
                      </tr>
                    )}
                    {filtered.map((ac) => {
                      const overdue = isOverdue(ac)
                      const rowBg = overdue ? 'bg-red-50' : ''
                      const codeColor = overdue ? 'text-red-700 font-bold' : 'text-blue-700 font-semibold'

                      return (
                        <tr key={ac.id} className={`border-b border-gray-100 hover:bg-blue-50/50 ${rowBg}`}>
                          {/* Code */}
                          <td className={`py-2 px-3 sticky left-0 z-10 ${overdue ? 'bg-red-50' : 'bg-white'} ${codeColor}`}>
                            {ac.ac_code}
                            {overdue && <span className="ml-1 text-red-500">!</span>}
                          </td>
                          {/* Name + dept */}
                          <td className="py-2 px-3 text-gray-700">
                            <p className="truncate max-w-[130px]">{ac.ac_name || '-'}</p>
                            <p className="text-gray-400 truncate max-w-[130px]">{ac.dept_name}</p>
                          </td>
                          {/* Interval */}
                          <td className="py-2 px-3 text-gray-500 text-center">
                            {ac.pm_interval_months ? `${ac.pm_interval_months}ด.` : '-'}
                          </td>
                          {/* Month cells */}
                          {MONTHS.map((_, mi) => {
                            const month = mi + 1
                            const entry = getCellForMonth(ac.pm_entries, month)
                            const isFuture = year > currentYear || (year === currentYear && month > currentMonth)
                            const isCurrentMonth = year === currentYear && month === currentMonth

                            return (
                              <td
                                key={mi}
                                className={`py-2 px-1 text-center align-middle border-l border-gray-50 ${
                                  isCurrentMonth ? 'bg-blue-50' : ''
                                }`}
                              >
                                {entry ? (
                                  entry.status === 'done' ? (
                                    // Done: colored circle
                                    <span
                                      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-[10px] font-medium ${TYPE_COLOR[entry.planned_type] || 'bg-gray-400'}`}
                                      title={`${TYPE_SHORT[entry.planned_type]} - ${dayjs(entry.actual_date || entry.scheduled_date).format('DD/MM')}`}
                                    >
                                      {TYPE_SHORT[entry.planned_type]?.charAt(0)}
                                    </span>
                                  ) : (
                                    // Planned (not done): dashed circle
                                    <span
                                      className="inline-flex items-center justify-center w-7 h-7 rounded-full border-2 border-dashed border-gray-400 text-gray-400 text-[10px] cursor-pointer hover:border-red-400 hover:text-red-400"
                                      title={`วางแผน: ${TYPE_SHORT[entry.planned_type]} - ${dayjs(entry.scheduled_date).format('DD/MM')}\nคลิกเพื่อลบแผน`}
                                      onClick={() => {
                                        if (confirm('ลบแผนนี้?')) {
                                          api.delete(`/pm/plan/${entry.id}`).then(() => load())
                                        }
                                      }}
                                    >
                                      {TYPE_SHORT[entry.planned_type]?.charAt(0)}
                                    </span>
                                  )
                                ) : isFuture ? (
                                  // Future empty: clickable to add plan
                                  <button
                                    onClick={() => setPlanModal({ ac, month })}
                                    className="w-7 h-7 rounded-full border border-dashed border-gray-200 text-gray-200 hover:border-blue-400 hover:text-blue-400 transition-colors text-lg leading-none flex items-center justify-center mx-auto"
                                    title="คลิกเพื่อวางแผน PM"
                                  >
                                    +
                                  </button>
                                ) : (
                                  // Past empty: dash
                                  <span className="text-gray-200">—</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-gray-400">{filtered.length} เครื่อง · คลิก + เพื่อวางแผน PM · แถวสีแดง = เกินกำหนด</p>
          </>
        )}
      </div>

      {/* Plan Modal */}
      {planModal && (
        <PlanModal
          ac={planModal.ac}
          month={planModal.month}
          year={year}
          onClose={() => setPlanModal(null)}
          onSaved={() => { setPlanModal(null); load() }}
        />
      )}
    </Layout>
  )
}
