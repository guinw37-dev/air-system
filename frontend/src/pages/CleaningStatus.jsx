import { useEffect, useState, useMemo } from 'react'
import { X, History, ChevronRight } from 'lucide-react'
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
  if (days === null) return { dot: 'bg-ink-muted/40', text: 'text-ink-muted', label: 'ไม่มีข้อมูล', code: 'none' }
  if (days > 300)   return { dot: 'bg-danger',    text: 'text-danger',    label: '>10 เดือน',  code: 'red' }
  if (days > 180)   return { dot: 'bg-warn', text: 'text-warn', label: '6-10 เดือน', code: 'yellow' }
  return               { dot: 'bg-success',   text: 'text-success',  label: '<6 เดือน',   code: 'green' }
}

function StatusDots({ acs }) {
  const c = { red: 0, yellow: 0, green: 0, none: 0 }
  for (const ac of acs) c[getStatus(ac.days).code]++
  return (
    <span className="flex items-center gap-2 text-xs">
      {c.red    > 0 && <span className="flex items-center gap-1 text-danger"><span className="w-2 h-2 rounded-full bg-danger inline-block" />{c.red}</span>}
      {c.yellow > 0 && <span className="flex items-center gap-1 text-warn"><span className="w-2 h-2 rounded-full bg-warn inline-block" />{c.yellow}</span>}
      {c.green  > 0 && <span className="flex items-center gap-1 text-success"><span className="w-2 h-2 rounded-full bg-success inline-block" />{c.green}</span>}
      {c.none   > 0 && <span className="flex items-center gap-1 text-ink-muted"><span className="w-2 h-2 rounded-full bg-ink-muted/40 inline-block" />{c.none}</span>}
    </span>
  )
}

// ─── main page ───────────────────────────────────────────────────────────────
export default function CleaningStatus() {
  const [hospitals, setHospitals]   = useState([])
  const [selHospital, setSelHospital] = useState('')
  const [floorData, setFloorData]   = useState([])
  const [monthlyData, setMonthlyData] = useState([])
  const [loading, setLoading]       = useState(false)

  // Cascading selection
  const [selSite, setSelSite]         = useState(null)
  const [selBuilding, setSelBuilding] = useState(null)
  const [selFloor, setSelFloor]       = useState(null)
  const [selDept, setSelDept]         = useState(null)

  // AC History modal
  const [historyAc, setHistoryAc]         = useState(null)
  const [history, setHistory]             = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => {
    api.get('/master/clients').then((r) => setHospitals(r.data))
  }, [])

  useEffect(() => {
    if (!selHospital) return
    setLoading(true)
    setSelSite(null); setSelBuilding(null); setSelFloor(null); setSelDept(null)
    Promise.all([
      api.get(`/stats/floor-status?hospital_id=${selHospital}`),
      api.get(`/stats/monthly-detail?hospital_id=${selHospital}`),
    ]).then(([f, m]) => {
      setFloorData(f.data.map((ac) => ({ ...ac, days: daysSince(ac.last_cleaned_at) })))
      setMonthlyData(m.data)
    }).finally(() => setLoading(false))
  }, [selHospital])

  // Reset lower levels when upper changes
  const pickSite     = (s)  => { setSelSite(s); setSelBuilding(null); setSelFloor(null); setSelDept(null) }
  const pickBuilding = (id) => { setSelBuilding(id); setSelFloor(null); setSelDept(null) }
  const pickFloor    = (id) => { setSelFloor(id); setSelDept(null) }
  const pickDept     = (id) => { setSelDept(id) }

  // Unique lists (derived from full data)
  const sites = useMemo(() => {
    const set = new Set(floorData.map((ac) => ac.site).filter(Boolean))
    return Array.from(set).sort()
  }, [floorData])

  const buildings = useMemo(() => {
    const src = selSite ? floorData.filter((ac) => ac.site === selSite) : floorData
    const map = {}
    for (const ac of src) {
      if (!map[ac.building_id]) map[ac.building_id] = { id: ac.building_id, name: ac.building_name }
    }
    return Object.values(map)
  }, [floorData, selSite])

  const floors = useMemo(() => {
    const src = selBuilding ? floorData.filter((ac) => ac.building_id === selBuilding)
      : selSite ? floorData.filter((ac) => ac.site === selSite) : floorData
    const map = {}
    for (const ac of src) {
      if (!map[ac.floor_id]) map[ac.floor_id] = { id: ac.floor_id, name: ac.floor_name }
    }
    return Object.values(map)
  }, [floorData, selSite, selBuilding])

  const depts = useMemo(() => {
    const src = selFloor ? floorData.filter((ac) => ac.floor_id === selFloor)
      : selBuilding ? floorData.filter((ac) => ac.building_id === selBuilding)
      : selSite ? floorData.filter((ac) => ac.site === selSite)
      : floorData
    const map = {}
    for (const ac of src) {
      if (!map[ac.dept_id]) map[ac.dept_id] = { id: ac.dept_id, name: ac.dept_name }
    }
    return Object.values(map)
  }, [floorData, selSite, selBuilding, selFloor])

  // Filtered AC list for display
  const filteredAcs = useMemo(() => {
    let list = floorData
    if (selSite)     list = list.filter((ac) => ac.site === selSite)
    if (selBuilding) list = list.filter((ac) => ac.building_id === selBuilding)
    if (selFloor)    list = list.filter((ac) => ac.floor_id    === selFloor)
    if (selDept)     list = list.filter((ac) => ac.dept_id === selDept)
    return list
  }, [floorData, selSite, selBuilding, selFloor, selDept])

  // Status summary for filtered
  const statusCount = useMemo(() => {
    const c = { red: 0, yellow: 0, green: 0, none: 0 }
    for (const ac of filteredAcs) c[getStatus(ac.days).code]++
    return c
  }, [filteredAcs])

  const openHistory = async (ac) => {
    setHistoryAc(ac)
    setHistoryLoading(true)
    setHistory([])
    try {
      const r = await api.get(`/master/units/${ac.id}/history`)
      setHistory(r.data)
    } catch (err) {
      console.error('history error:', err)
    } finally {
      setHistoryLoading(false)
    }
  }

    // Breadcrumb labels
  const selSiteName     = selSite || null
  const selBuildingName = buildings.find((b) => b.id === selBuilding)?.name
  const selFloorName    = selBuilding ? floors.find((f) => f.id === selFloor)?.name : null
  const selDeptName     = selFloor    ? depts.find((d) => d.id === selDept)?.name   : null

  return (
    <Layout title="ติดตามสถานะการล้าง">
      <div className="p-4 lg:p-6 flex flex-col gap-5">

        {/* Hospital selector */}
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm font-semibold text-ink shrink-0">โรงพยาบาล</label>
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
          <div className="text-center text-ink-muted py-20 text-sm">เลือกโรงพยาบาลเพื่อดูข้อมูล</div>
        )}

        {selHospital && loading && <PageSpinner />}

        {selHospital && !loading && <>

          {/* ── Cascading Dropdowns ─────────────────────────────────── */}
          <div className="card">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Site */}
              <div>
                <label className="label">สถานที่</label>
                <select
                  className="input"
                  value={selSite || ''}
                  onChange={(e) => pickSite(e.target.value || null)}
                >
                  <option value="">ทั้งหมด ({floorData.length} เครื่อง)</option>
                  {sites.map((s) => {
                    const sAcs = floorData.filter((ac) => ac.site === s)
                    const c = { red: 0, yellow: 0, green: 0 }
                    for (const ac of sAcs) { const st = getStatus(ac.days).code; if (c[st] !== undefined) c[st]++ }
                    return (
                      <option key={s} value={s}>
                        {s} ({sAcs.length}) {c.red ? `🔴${c.red}` : ''}{c.yellow ? `🟡${c.yellow}` : ''}
                      </option>
                    )
                  })}
                </select>
              </div>

              {/* Building */}
              <div>
                <label className="label">อาคาร</label>
                <select
                  className="input"
                  value={selBuilding || ''}
                  onChange={(e) => pickBuilding(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{selSite ? `ทุกอาคาร (${buildings.length} อาคาร)` : '— เลือกสถานที่ก่อน'}</option>
                  {buildings.map((b) => {
                    const bAcs = floorData.filter((ac) => ac.building_id === b.id)
                    const c = { red: 0, yellow: 0, green: 0 }
                    for (const ac of bAcs) { const s = getStatus(ac.days).code; if (c[s] !== undefined) c[s]++ }
                    return (
                      <option key={b.id} value={b.id}>
                        {b.name} ({bAcs.length}) {c.red ? `🔴${c.red}` : ''}{c.yellow ? `🟡${c.yellow}` : ''}
                      </option>
                    )
                  })}
                </select>
              </div>

              {/* Floor */}
              <div>
                <label className="label">ชั้น</label>
                <select
                  className="input"
                  value={selFloor || ''}
                  disabled={!selBuilding}
                  onChange={(e) => pickFloor(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{selBuilding ? `ทุกชั้น (${floors.length} ชั้น)` : '— เลือกอาคารก่อน'}</option>
                  {floors.map((f) => {
                    const fAcs = floorData.filter((ac) => ac.floor_id === f.id && ac.building_id === selBuilding)
                    const c = { red: 0, yellow: 0 }
                    for (const ac of fAcs) { const s = getStatus(ac.days).code; if (c[s] !== undefined) c[s]++ }
                    return (
                      <option key={f.id} value={f.id}>
                        {f.name} ({fAcs.length}) {c.red ? `🔴${c.red}` : ''}{c.yellow ? `🟡${c.yellow}` : ''}
                      </option>
                    )
                  })}
                </select>
              </div>

              {/* Dept */}
              <div>
                <label className="label">แผนก / ห้อง</label>
                <select
                  className="input"
                  value={selDept || ''}
                  disabled={!selFloor}
                  onChange={(e) => pickDept(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{selFloor ? `ทุกแผนก (${depts.length} แผนก)` : '— เลือกชั้นก่อน'}</option>
                  {depts.map((d) => {
                    const dAcs = floorData.filter((ac) => ac.dept_id === d.id && ac.floor_id === selFloor)
                    return (
                      <option key={d.id} value={d.id}>
                        {d.name} ({dAcs.length})
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>

            {/* Breadcrumb */}
            {(selSite || selBuilding || selFloor || selDept) && (
              <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-line text-xs text-ink-muted flex-wrap">
                <span className="cursor-pointer hover:text-primary" onClick={() => { setSelSite(null); setSelBuilding(null); setSelFloor(null); setSelDept(null) }}>ทั้งหมด</span>
                {selSiteName     && <><ChevronRight className="h-3 w-3 text-line" /><span className="text-primary font-medium">{selSiteName}</span></>}
                {selBuildingName && <><ChevronRight className="h-3 w-3 text-line" /><span className="text-primary font-medium">{selBuildingName}</span></>}
                {selFloorName    && <><ChevronRight className="h-3 w-3 text-line" /><span className="text-primary font-medium">{selFloorName}</span></>}
                {selDeptName     && <><ChevronRight className="h-3 w-3 text-line" /><span className="text-primary-dark font-semibold">{selDeptName}</span></>}
                <button className="ml-2 text-ink-muted hover:text-danger text-xs" onClick={() => { setSelSite(null); setSelBuilding(null); setSelFloor(null); setSelDept(null) }}>✕ ล้าง</button>
              </div>
            )}
          </div>

          {/* ── Status summary for current selection ─────────────── */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-ink">
                สถานะการล้าง
                {selDeptName ? ` — ${selDeptName}`
                  : selFloorName ? ` — ${selFloorName}`
                  : selBuildingName ? ` — ${selBuildingName}`
                  : selSiteName ? ` — ${selSiteName}`
                  : ' — ทั้งหมด'}
                <span className="ml-1 text-xs font-normal text-ink-muted">({filteredAcs.length} เครื่อง)</span>
              </p>
            </div>
            <div className="flex gap-5 flex-wrap">
              {[
                { code: 'red',    dot: 'bg-danger',       label: '>10 เดือน',   count: statusCount.red },
                { code: 'yellow', dot: 'bg-warn',         label: '6-10 เดือน',  count: statusCount.yellow },
                { code: 'green',  dot: 'bg-success',      label: '<6 เดือน',    count: statusCount.green },
                { code: 'none',   dot: 'bg-ink-muted/40', label: 'ไม่มีข้อมูล', count: statusCount.none },
              ].map(({ dot, label, count }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full shrink-0 ${dot}`} />
                  <span className="text-lg font-bold text-ink">{count}</span>
                  <span className="text-xs text-ink-muted">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Monthly chart */}
          {monthlyData.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-ink mb-4">สถิติการล้างรายเดือน (12 เดือนล่าสุด)</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlyData} barGap={2} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3EDF5" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="ล้างใหญ่"  fill="#1E7FC4" radius={[3,3,0,0]} />
                  <Bar dataKey="ล้างย่อย"  fill="#10A56A" radius={[3,3,0,0]} />
                  <Bar dataKey="ล้างพัดลม" fill="#163E5E" radius={[3,3,0,0]} />
                  <Bar dataKey="ซ่อม"      fill="#E8943A" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── AC Table ──────────────────────────────────────────── */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-line bg-page">
              <p className="text-sm font-semibold text-ink">รายการเครื่องแอร์</p>
            </div>
            {filteredAcs.length === 0 ? (
              <p className="text-center text-ink-muted py-10 text-sm">ไม่มีข้อมูล</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-page text-ink-muted border-b border-line">
                      <th className="text-left py-2 px-4 font-medium">รหัส</th>
                      <th className="text-left py-2 px-3 font-medium">ประเภท</th>
                      <th className="text-left py-2 px-3 font-medium hidden md:table-cell">BTU</th>
                      <th className="text-left py-2 px-3 font-medium">ห้อง / แผนก</th>
                      <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">ชั้น</th>
                      <th className="text-left py-2 px-3 font-medium hidden lg:table-cell">อาคาร</th>
                      <th className="text-left py-2 px-3 font-medium">ล้างล่าสุด</th>
                      <th className="text-left py-2 px-3 font-medium">สถานะ</th>
                      <th className="py-2 px-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filteredAcs.map((ac) => {
                      const st = getStatus(ac.days)
                      return (
                        <tr
                          key={ac.id}
                          className="hover:bg-primary-soft/40 cursor-pointer transition-colors"
                          onClick={() => openHistory(ac)}
                        >
                          <td className="py-2.5 px-4 font-semibold text-primary">{ac.asset_code || ac.ac_code}</td>
                          <td className="py-2.5 px-3 text-ink-muted">{ac.family || ac.ac_type || '-'}</td>
                          <td className="py-2.5 px-3 text-ink-muted hidden md:table-cell">
                            {ac.capacity_btu && !isNaN(Number(ac.capacity_btu)) && Number(ac.capacity_btu) > 0
                              ? Number(ac.capacity_btu).toLocaleString()
                              : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-ink max-w-[140px] truncate">{ac.room_name || ac.dept_name}</td>
                          <td className="py-2.5 px-3 text-ink-muted hidden sm:table-cell">{ac.floor_name}</td>
                          <td className="py-2.5 px-3 text-ink-muted hidden lg:table-cell">{ac.building_name}</td>
                          <td className="py-2.5 px-3 text-ink-muted">
                            {ac.last_cleaned_at ? dayjs(ac.last_cleaned_at).format('DD/MM/YY') : '-'}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`flex items-center gap-1.5 ${st.text}`}>
                              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`} />
                              {st.label}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <History className="h-3.5 w-3.5 text-ink-muted" />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </>}
      </div>

      {/* AC History Modal */}
      {historyAc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setHistoryAc(null)} />
          <div className="relative bg-surface rounded-2xl w-full max-w-2xl max-h-[88vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="bg-primary-dark text-white px-5 py-4 flex items-start justify-between shrink-0">
              <div>
                <p className="font-bold text-base">{historyAc.asset_code || historyAc.ac_code}</p>
                <p className="text-xs text-primary-soft/70 mt-0.5">
                  {historyAc.family || historyAc.ac_type} · {historyAc.room_name || historyAc.dept_name} · {historyAc.floor_name} · {historyAc.building_name}
                </p>
                {historyAc.capacity_btu && !isNaN(Number(historyAc.capacity_btu)) && Number(historyAc.capacity_btu) > 0 && (
                  <p className="text-xs text-primary-soft/50">{Number(historyAc.capacity_btu).toLocaleString()} BTU</p>
                )}
              </div>
              <button onClick={() => setHistoryAc(null)} className="text-white ml-3 shrink-0">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-5">
              {historyLoading ? (
                <div className="flex justify-center py-10">
                  <div className="animate-spin rounded-full h-7 w-7 border-2 border-line border-t-primary" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-center text-ink-muted py-10 text-sm">ยังไม่มีประวัติการล้าง / ซ่อม</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {history.map((h) => {
                    const s = STATUS_LABEL[h.status] || { label: h.status, color: 'bg-page text-ink-muted' }
                    const t = TYPE_LABEL[h.type]    || { label: h.type,   color: 'bg-page text-ink-muted' }
                    const workDate = h.approved_at || h.completed_at || h.started_at
                    return (
                      <div key={h.id} className="border border-line rounded-xl overflow-hidden">
                        {/* Header: type + date */}
                        <div className="flex items-center justify-between px-4 py-2.5 bg-page border-b border-line">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.color}`}>{t.label}</span>
                            <span className="text-sm font-bold text-ink">
                              {workDate ? dayjs(workDate).format('DD MMM BBBB') : '-'}
                            </span>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.color}`}>{s.label}</span>
                        </div>
                        {/* Body */}
                        <div className="px-4 py-3 flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-mono text-primary mb-1">{h.order_no}</p>
                            {(h.tech1_name || h.tech2_name) && (
                              <p className="text-xs text-ink-muted">
                                ช่าง: {h.tech1_name}{h.tech2_name ? ` / ${h.tech2_name}` : ''}
                              </p>
                            )}
                            {h.has_repair && (
                              <div className="mt-2 bg-danger-soft rounded-lg px-2 py-1.5">
                                <p className="text-xs text-danger font-medium">⚠ แจ้งซ่อม{h.repair_notes ? ': ' + h.repair_notes : ''}</p>
                              </div>
                            )}
                          </div>
                          <div className="text-xs text-ink-muted shrink-0 text-right">
                            {h.photo_count > 0 && <p>📷 {h.photo_count} รูป</p>}
                          </div>
                        </div>
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
