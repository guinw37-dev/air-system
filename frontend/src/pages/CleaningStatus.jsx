import { useEffect, useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, X, History } from 'lucide-react'
import dayjs from 'dayjs'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api from '../api/client'
import { TYPE_LABEL, STATUS_LABEL } from '../lib/config'

// ─── helpers ────────────────────────────────────────────────────────────────
function daysSince(dateStr) {
  if (!dateStr) return null
  return dayjs().diff(dayjs(dateStr), 'day')
}

function getStatus(days) {
  if (days === null) return { dot: 'bg-gray-300', text: 'text-gray-400', label: 'ไม่มีข้อมูล', code: 'none' }
  if (days > 300)   return { dot: 'bg-red-500',    text: 'text-red-600',    label: '>10 เดือน',  code: 'red' }
  if (days > 180)   return { dot: 'bg-yellow-400', text: 'text-yellow-600', label: '6-10 เดือน', code: 'yellow' }
  return               { dot: 'bg-green-500',   text: 'text-green-600',  label: '<6 เดือน',   code: 'green' }
}

// ─── main page ───────────────────────────────────────────────────────────────
export default function CleaningStatus() {
  const [hospitals, setHospitals]               = useState([])
  const [selHospital, setSelHospital]           = useState('')
  const [floorData, setFloorData]               = useState([])
  const [monthlyData, setMonthlyData]           = useState([])
  const [loading, setLoading]                   = useState(false)
  const [expandedBuildings, setExpandedBuildings] = useState({})
  const [expandedFloors, setExpandedFloors]     = useState({})

  // AC History modal
  const [historyAc, setHistoryAc]     = useState(null)
  const [history, setHistory]         = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    api.get('/master/hospitals').then((r) => setHospitals(r.data))
  }, [])

  useEffect(() => {
    if (!selHospital) return
    setLoading(true)
    setExpandedBuildings({})
    setExpandedFloors({})
    Promise.all([
      api.get(`/stats/floor-status?hospital_id=${selHospital}`),
      api.get(`/stats/monthly-detail?hospital_id=${selHospital}`),
    ]).then(([f, m]) => {
      setFloorData(f.data)
      setMonthlyData(m.data)
    }).finally(() => setLoading(false))
  }, [selHospital])

  const openHistory = async (ac) => {
    setHistoryAc(ac)
    setHistoryLoading(true)
    setHistory([])
    const r = await api.get(`/master/ac-units/${ac.id}/history`)
    setHistory(r.data)
    setHistoryLoading(false)
  }

  // Group: building → floor → [acs]
  const grouped = useMemo(() => {
    const map = {}
    for (const ac of floorData) {
      if (!map[ac.building_id]) {
        map[ac.building_id] = { id: ac.building_id, name: ac.building_name, floors: {} }
      }
      if (!map[ac.building_id].floors[ac.floor_id]) {
        map[ac.building_id].floors[ac.floor_id] = { id: ac.floor_id, name: ac.floor_name, acs: [] }
      }
      map[ac.building_id].floors[ac.floor_id].acs.push({
        ...ac,
        days: daysSince(ac.last_cleaned_at),
      })
    }
    return Object.values(map).map((b) => ({
      ...b,
      floors: Object.values(b.floors),
    }))
  }, [floorData])

  // Summary by AC type
  const summary = useMemo(() => {
    const out = {}
    for (const ac of floorData) {
      const t = ac.ac_type || 'อื่นๆ'
      if (!out[t]) out[t] = { count: 0, btu: 0 }
      out[t].count++
      out[t].btu += ac.capacity_btu || 0
    }
    return out
  }, [floorData])

  const totalBtu  = Object.values(summary).reduce((s, v) => s + v.btu, 0)
  const totalCount = floorData.length

  // Status summary
  const statusCount = useMemo(() => {
    const c = { red: 0, yellow: 0, green: 0, none: 0 }
    for (const ac of floorData) c[getStatus(daysSince(ac.last_cleaned_at)).code]++
    return c
  }, [floorData])

  const toggleB = (id) => setExpandedBuildings((p) => ({ ...p, [id]: !p[id] }))
  const toggleF = (id) => setExpandedFloors((p) => ({ ...p, [id]: !p[id] }))

  return (
    <Layout title="ติดตามสถานะการล้าง">
      <div className="p-4 lg:p-6 flex flex-col gap-5">

        {/* Hospital selector */}
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm font-semibold text-gray-700 shrink-0">โรงพยาบาล</label>
          <select
            className="input max-w-xs"
            value={selHospital}
            onChange={(e) => setSelHospital(e.target.value)}
          >
            <option value="">-- เลือก --</option>
            {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>

        {!selHospital && (
          <div className="text-center text-gray-400 py-20 text-sm">เลือกโรงพยาบาลเพื่อดูข้อมูล</div>
        )}

        {selHospital && loading && <PageSpinner />}

        {selHospital && !loading && <>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(summary).map(([t, v]) => (
              <div key={t} className="card">
                <p className="text-xs text-gray-500 mb-1 font-medium">{t}</p>
                <p className="text-2xl font-bold text-gray-900">{v.count} <span className="text-sm font-normal text-gray-400">unit</span></p>
                <p className="text-xs text-gray-400">{v.btu.toLocaleString()} BTU</p>
              </div>
            ))}
            <div className="card bg-blue-50">
              <p className="text-xs text-blue-600 mb-1 font-medium">รวมทั้งหมด</p>
              <p className="text-2xl font-bold text-blue-900">{totalCount} <span className="text-sm font-normal text-blue-400">unit</span></p>
              <p className="text-xs text-blue-400">{totalBtu.toLocaleString()} BTU</p>
            </div>
          </div>

          {/* Status summary */}
          <div className="card">
            <p className="text-sm font-semibold text-gray-700 mb-3">ยอดรวมสถานะการล้างล่าสุด</p>
            <div className="flex gap-5 flex-wrap">
              {[
                { code: 'red',    dot: 'bg-red-500',    label: '>10 เดือน',  count: statusCount.red },
                { code: 'yellow', dot: 'bg-yellow-400', label: '6-10 เดือน', count: statusCount.yellow },
                { code: 'green',  dot: 'bg-green-500',  label: '<6 เดือน',   count: statusCount.green },
                { code: 'none',   dot: 'bg-gray-300',   label: 'ไม่มีข้อมูล',count: statusCount.none },
              ].map(({ dot, label, count }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full shrink-0 ${dot}`} />
                  <span className="text-lg font-bold text-gray-900">{count}</span>
                  <span className="text-xs text-gray-500">{label}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              หมายเหตุ: 🔴 = มากกว่า 10 เดือน &nbsp;|&nbsp; 🟡 = ระหว่าง 6-10 เดือน &nbsp;|&nbsp; 🟢 = น้อยกว่า 6 เดือน
            </p>
          </div>

          {/* Monthly chart */}
          {monthlyData.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-800 mb-4">สถิติการล้างรายเดือน (12 เดือนล่าสุด)</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthlyData} barGap={2} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="ล้างใหญ่"  fill="#1d4ed8" radius={[3,3,0,0]} />
                  <Bar dataKey="ล้างย่อย"  fill="#0d9488" radius={[3,3,0,0]} />
                  <Bar dataKey="ล้างพัดลม" fill="#7c3aed" radius={[3,3,0,0]} />
                  <Bar dataKey="ซ่อม"      fill="#f97316" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Building / Floor accordion */}
          <div>
            <h3 className="font-semibold text-gray-800 mb-3">สถานะตามชั้น</h3>
            <div className="flex flex-col gap-3">
              {grouped.map((building) => (
                <div key={building.id} className="card p-0 overflow-hidden">
                  {/* Building header */}
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 bg-blue-900 text-white text-left"
                    onClick={() => toggleB(building.id)}
                  >
                    <span className="font-semibold text-sm">{building.name}</span>
                    <span className="flex items-center gap-2 text-blue-300 text-xs">
                      {building.floors.reduce((s, f) => s + f.acs.length, 0)} เครื่อง
                      {expandedBuildings[building.id]
                        ? <ChevronDown className="h-4 w-4" />
                        : <ChevronRight className="h-4 w-4" />}
                    </span>
                  </button>

                  {expandedBuildings[building.id] && (
                    <div className="divide-y divide-gray-100">
                      {building.floors.map((floor) => {
                        const sc = { red: 0, yellow: 0, green: 0, none: 0 }
                        for (const ac of floor.acs) sc[getStatus(ac.days).code]++
                        return (
                          <div key={floor.id}>
                            {/* Floor row */}
                            <button
                              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
                              onClick={() => toggleF(floor.id)}
                            >
                              <span className="text-sm font-medium text-gray-700 w-28 shrink-0">{floor.name}</span>
                              <div className="flex gap-2 items-center flex-1 flex-wrap">
                                {sc.red    > 0 && <span className="flex items-center gap-1 text-xs text-red-600"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{sc.red}</span>}
                                {sc.yellow > 0 && <span className="flex items-center gap-1 text-xs text-yellow-600"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />{sc.yellow}</span>}
                                {sc.green  > 0 && <span className="flex items-center gap-1 text-xs text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />{sc.green}</span>}
                                {sc.none   > 0 && <span className="flex items-center gap-1 text-xs text-gray-400"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />{sc.none}</span>}
                              </div>
                              <span className="text-xs text-gray-400 shrink-0">{floor.acs.length} เครื่อง</span>
                              {expandedFloors[floor.id]
                                ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                : <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
                            </button>

                            {/* AC table */}
                            {expandedFloors[floor.id] && (
                              <div className="overflow-x-auto bg-gray-50 border-t border-gray-100">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-gray-100 text-gray-500">
                                      <th className="text-left py-2 px-4 font-medium">รหัส</th>
                                      <th className="text-left py-2 px-3 font-medium">ประเภท</th>
                                      <th className="text-left py-2 px-3 font-medium">BTU</th>
                                      <th className="text-left py-2 px-3 font-medium">ห้อง / แผนก</th>
                                      <th className="text-left py-2 px-3 font-medium">ล้างล่าสุด</th>
                                      <th className="text-left py-2 px-3 font-medium">ใบงาน</th>
                                      <th className="text-left py-2 px-3 font-medium">สถานะ</th>
                                      <th className="py-2 px-3" />
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {floor.acs.map((ac) => {
                                      const st = getStatus(ac.days)
                                      return (
                                        <tr
                                          key={ac.id}
                                          className="hover:bg-blue-50 cursor-pointer transition-colors"
                                          onClick={() => openHistory(ac)}
                                        >
                                          <td className="py-2 px-4 font-semibold text-blue-700">{ac.ac_code}</td>
                                          <td className="py-2 px-3 text-gray-600">{ac.ac_type || '-'}</td>
                                          <td className="py-2 px-3 text-gray-500">{ac.capacity_btu ? Number(ac.capacity_btu).toLocaleString() : '-'}</td>
                                          <td className="py-2 px-3 text-gray-700">{ac.dept_name}</td>
                                          <td className="py-2 px-3 text-gray-500">
                                            {ac.last_cleaned_at ? dayjs(ac.last_cleaned_at).format('DD/MM/YY') : '-'}
                                          </td>
                                          <td className="py-2 px-3 text-gray-400">{ac.last_wo_no || '-'}</td>
                                          <td className="py-2 px-3">
                                            <span className={`flex items-center gap-1.5 ${st.text}`}>
                                              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`} />
                                              {st.label}
                                            </span>
                                          </td>
                                          <td className="py-2 px-3">
                                            <History className="h-3.5 w-3.5 text-gray-400" />
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>}
      </div>

      {/* AC History Modal */}
      {historyAc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setHistoryAc(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] overflow-hidden shadow-2xl flex flex-col">
            {/* Header */}
            <div className="bg-blue-900 text-white px-5 py-4 flex items-start justify-between shrink-0">
              <div>
                <p className="font-bold text-base">{historyAc.ac_code}</p>
                <p className="text-xs text-blue-300 mt-0.5">
                  {historyAc.ac_type} · {historyAc.dept_name} · {historyAc.floor_name} · {historyAc.building_name}
                </p>
                {historyAc.capacity_btu && (
                  <p className="text-xs text-blue-400">{Number(historyAc.capacity_btu).toLocaleString()} BTU</p>
                )}
              </div>
              <button onClick={() => setHistoryAc(null)} className="text-white text-2xl leading-none ml-3 shrink-0">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto flex-1 p-5">
              {historyLoading ? (
                <div className="flex justify-center py-10">
                  <div className="animate-spin rounded-full h-7 w-7 border-2 border-gray-200 border-t-blue-600" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-center text-gray-400 py-10 text-sm">ยังไม่มีประวัติการล้าง / ซ่อม</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {history.map((h) => {
                    const s = STATUS_LABEL[h.status] || { label: h.status, color: 'bg-gray-100 text-gray-700' }
                    const t = TYPE_LABEL[h.type]    || { label: h.type,   color: 'bg-gray-100 text-gray-700' }
                    return (
                      <div key={h.id} className="border border-gray-200 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm text-gray-900">{h.order_no}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {h.tech1_name}{h.tech2_name ? ` / ${h.tech2_name}` : ''}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.color}`}>{s.label}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.color}`}>{t.label}</span>
                          </div>
                        </div>
                        <div className="flex gap-4 mt-2 text-xs text-gray-400 flex-wrap">
                          <span>เริ่ม {dayjs(h.started_at).format('DD/MM/YY HH:mm')}</span>
                          {h.approved_at && <span>✓ อนุมัติ {dayjs(h.approved_at).format('DD/MM/YY')}</span>}
                          <span>📷 {h.photo_count} รูป</span>
                        </div>
                        {h.has_repair && (
                          <div className="mt-2 bg-red-50 rounded-lg px-3 py-2">
                            <p className="text-xs text-red-700 font-medium">⚠ แจ้งซ่อม</p>
                            {h.repair_notes && <p className="text-xs text-red-600 mt-0.5">{h.repair_notes}</p>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
