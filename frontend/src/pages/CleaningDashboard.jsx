import { useEffect, useState, useMemo } from 'react'
import { Pencil, Trash2, Plus, X } from 'lucide-react'
import dayjs from 'dayjs'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList, Cell,
} from 'recharts'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api from '../api/client'
import { useAuthStore } from '../store/auth'

const TABS = [
  { key: 'pts1', label: 'PTS 1' },
  { key: 'pts2', label: 'PTS 2' },
]

const TYPE_LABELS = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลม' }
// Aligned to palette: major→primary, minor→success, fan→primary-dark
const TYPE_COLORS = { major: '#1E7FC4', minor: '#10A56A', fan: '#163E5E' }

function pct(actual, plan) {
  if (!plan) return 0
  return Math.round((actual / plan) * 100)
}

function workingDaysLeft(year, month) {
  const now = dayjs()
  const endOfMonth = dayjs(`${year}-${String(month).padStart(2, '0')}-01`).endOf('month')
  let count = 0
  let d = now.isAfter(endOfMonth) ? endOfMonth : now
  while (d.isBefore(endOfMonth) || d.isSame(endOfMonth, 'day')) {
    const dow = d.day()
    if (dow !== 0 && dow !== 6) count++
    d = d.add(1, 'day')
  }
  return count
}

export default function CleaningDashboard() {
  const user = useAuthStore((s) => s.user)
  const isOwnerAdmin = ['approver', 'admin', 'central_admin'].includes(user?.role)

  const [tab, setTab] = useState('pts1')
  const [hospitals, setHospitals] = useState([])
  const [year, setYear] = useState(String(dayjs().year()))
  const [dailyDate, setDailyDate] = useState(dayjs().format('YYYY-MM-DD'))

  const [summary, setSummary] = useState(null)
  const [dailyCount, setDailyCount] = useState(null)
  const [deductions, setDeductions] = useState([])
  const [loading, setLoading] = useState(false)

  // Deduction edit state
  const [editNote, setEditNote] = useState(null) // { id?, notes }
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => {
    api.get('/master/clients').then((r) => setHospitals(r.data))
  }, [])

  const currentHospital = useMemo(() => {
    if (!hospitals.length) return null
    return hospitals.find((h) =>
      tab === 'pts2' ? h.name.includes('2') : h.name.includes('1')
    ) || hospitals[0]
  }, [hospitals, tab])

  const currentMonth = dayjs().format('YYYY-MM')

  useEffect(() => {
    if (!currentHospital) return
    setLoading(true)
    setSummary(null)
    Promise.all([
      api.get(`/stats/contract-summary?hospital_id=${currentHospital.id}&year=${year}`),
      api.get(`/stats/deductions?hospital_id=${currentHospital.id}&month=${currentMonth}`),
    ]).then(([s, d]) => {
      setSummary(s.data)
      setDeductions(d.data)
    }).finally(() => setLoading(false))
  }, [currentHospital, year])

  useEffect(() => {
    if (!currentHospital) return
    api.get(`/stats/daily-count?hospital_id=${currentHospital.id}&date=${dailyDate}`)
      .then((r) => setDailyCount(r.data))
      .catch(() => setDailyCount({ major: 0, minor: 0, fan: 0 }))
  }, [currentHospital, dailyDate])

  const barData = useMemo(() => {
    if (!summary) return []
    return ['major', 'minor', 'fan'].map((t) => ({
      name: TYPE_LABELS[t],
      '%': pct(summary.woTypeTotals[t], summary.woPlan[t]),
      actual: summary.woTypeTotals[t],
      plan: summary.woPlan[t],
    }))
  }, [summary])

  const daysLeft = workingDaysLeft(
    dayjs().year(), dayjs().month() + 1
  )

  const dailyTarget = useMemo(() => {
    if (!summary) return { major: 0, minor: 0, fan: 0 }
    return {
      major: daysLeft > 0 ? ((summary.woPlan.major - summary.woTypeTotals.major) / daysLeft).toFixed(1) : 0,
      minor: daysLeft > 0 ? ((summary.woPlan.minor - summary.woTypeTotals.minor) / daysLeft).toFixed(1) : 0,
      fan:   daysLeft > 0 ? ((summary.woPlan.fan   - summary.woTypeTotals.fan)   / daysLeft).toFixed(1) : 0,
    }
  }, [summary, daysLeft])

  // Breakdown table grouped by site
  const siteRows = useMemo(() => {
    if (!summary) return []
    const map = {}
    for (const r of summary.breakdown) {
      if (!map[r.site]) map[r.site] = []
      map[r.site].push(r)
    }
    return Object.entries(map).map(([site, rows]) => ({ site, rows }))
  }, [summary])

  // Deduction handlers
  const saveNote = async () => {
    if (!editNote || !currentHospital) return
    setSavingNote(true)
    try {
      if (editNote.id) {
        const r = await api.put(`/stats/deductions/${editNote.id}`, { notes: editNote.notes })
        setDeductions((d) => d.map((x) => x.id === editNote.id ? r.data : x))
      } else {
        const r = await api.post('/stats/deductions', {
          hospital_id: currentHospital.id, month: currentMonth, notes: editNote.notes,
        })
        setDeductions((d) => [...d, r.data])
      }
      setEditNote(null)
    } finally { setSavingNote(false) }
  }

  const deleteNote = async (id) => {
    if (!confirm('ลบรายการนี้?')) return
    await api.delete(`/stats/deductions/${id}`)
    setDeductions((d) => d.filter((x) => x.id !== id))
  }

  return (
    <Layout title="สรุปยอดล้าง">
      <div className="p-4 lg:p-6 flex flex-col gap-5">

        {/* Tabs + year */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  tab === t.key ? 'bg-primary text-white' : 'bg-surface border border-line text-ink-muted hover:bg-page'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select className="input w-auto text-sm" value={year} onChange={(e) => setYear(e.target.value)}>
            {[0, 1, 2].map((i) => {
              const y = String(dayjs().year() - i)
              return <option key={y} value={y}>{y}</option>
            })}
          </select>
        </div>

        {loading && <PageSpinner />}

        {!loading && summary && <>

          {/* ── Bar chart ─────────────────────────────────────────── */}
          <div className="card">
            <h3 className="font-semibold text-ink mb-4">ความคืบหน้าการล้าง ปี {year}</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData} barSize={60} barGap={8}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3EDF5" />
                <XAxis dataKey="name" tick={{ fontSize: 13 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v, n, p) => [`${v}% (${p.payload.actual}/${p.payload.plan})`, 'ความคืบหน้า']} />
                <Bar dataKey="%" radius={[6, 6, 0, 0]}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={Object.values(TYPE_COLORS)[i]} />
                  ))}
                  <LabelList dataKey="%" position="top" formatter={(v) => `${v}%`} style={{ fontSize: 13, fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── Daily stats ───────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Target per day */}
            <div className="card">
              <p className="text-sm font-semibold text-ink mb-3">จำนวนที่ต้องล้าง/วัน
                <span className="text-xs font-normal text-ink-muted ml-1">({daysLeft} วันทำการที่เหลือ)</span>
              </p>
              <div className="flex gap-4">
                {['major', 'minor', 'fan'].map((t) => (
                  <div key={t} className="flex-1 bg-page rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold" style={{ color: TYPE_COLORS[t] }}>{dailyTarget[t]}</p>
                    <p className="text-xs text-ink-muted mt-1">{TYPE_LABELS[t]}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Actual per selected day */}
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-ink">จำนวนที่ล้างได้/วัน</p>
                <input
                  type="date"
                  className="input w-auto text-xs"
                  value={dailyDate}
                  onChange={(e) => setDailyDate(e.target.value)}
                />
              </div>
              <div className="flex gap-4">
                {['major', 'minor', 'fan'].map((t) => (
                  <div key={t} className="flex-1 bg-page rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold" style={{ color: TYPE_COLORS[t] }}>
                      {dailyCount?.[t] ?? '-'}
                    </p>
                    <p className="text-xs text-ink-muted mt-1">{TYPE_LABELS[t]}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Deduction notes ───────────────────────────────────── */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-ink">แอร์ที่ปรับลดค่าบริการ — {dayjs().format('MM/YYYY')}</p>
              {isOwnerAdmin && (
                <button
                  onClick={() => setEditNote({ notes: '' })}
                  className="btn-primary flex items-center gap-1 text-xs px-3 py-1.5"
                >
                  <Plus className="h-3.5 w-3.5" /> เพิ่ม
                </button>
              )}
            </div>
            {deductions.length === 0 ? (
              <p className="text-sm text-ink-muted">ยังไม่มีรายการ</p>
            ) : (
              <div className="flex flex-col gap-2">
                {deductions.map((d) => (
                  <div key={d.id} className="flex items-start gap-2 bg-warn-soft border border-warn/20 rounded-xl px-3 py-2">
                    <p className="flex-1 text-sm text-ink whitespace-pre-wrap">{d.notes}</p>
                    {isOwnerAdmin && (
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => setEditNote({ id: d.id, notes: d.notes })} className="text-ink-muted hover:text-primary">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => deleteNote(d.id)} className="text-ink-muted hover:text-danger">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Plan/Actual/Balance table ─────────────────────────── */}
          {['major', 'minor', 'fan'].map((woType) => {
            const totalPlan   = summary.woPlan[woType]
            const totalActual = summary.woTypeTotals[woType]
            const pctDone     = pct(totalActual, totalPlan)
            return (
              <div key={woType} className="card p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-line bg-page flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink">
                    {TYPE_LABELS[woType]}
                    <span className="ml-2 text-xs font-normal text-ink-muted">{pctDone}%</span>
                  </p>
                  <div className="flex gap-2 text-xs text-ink-muted">
                    <span>Plan: <strong className="text-ink">{totalPlan}</strong></span>
                    <span>Actual: <strong className="text-primary">{totalActual}</strong></span>
                    <span>Balance: <strong className="text-danger">{totalPlan - totalActual}</strong></span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-page text-ink-muted border-b border-line">
                        <th className="text-left py-2 px-4 font-medium">สถานที่</th>
                        <th className="text-left py-2 px-3 font-medium">ประเภทแอร์</th>
                        <th className="text-right py-2 px-3 font-medium">Plan</th>
                        <th className="text-right py-2 px-3 font-medium">Actual</th>
                        <th className="text-right py-2 px-4 font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {siteRows.map(({ site, rows }) => {
                        const sitePlan   = rows.reduce((s, r) => s + r.plan, 0)
                        const siteActual = rows.reduce((s, r) => s + (r[`${woType}_actual`] || 0), 0)
                        return rows.map((r, i) => (
                          <tr key={`${site}-${r.ac_type}`} className="hover:bg-primary-soft/40">
                            {i === 0 && (
                              <td rowSpan={rows.length} className="py-2 px-4 font-medium text-ink border-r border-line align-top">
                                {site}
                                <div className="text-ink-muted font-normal mt-0.5">
                                  {pct(siteActual, sitePlan)}%
                                </div>
                              </td>
                            )}
                            <td className="py-2 px-3 text-ink-muted">{r.ac_type}</td>
                            <td className="py-2 px-3 text-right text-ink">{r.plan}</td>
                            <td className="py-2 px-3 text-right text-primary font-medium">{r[`${woType}_actual`] || 0}</td>
                            <td className="py-2 px-4 text-right text-danger font-medium">{r.plan - (r[`${woType}_actual`] || 0)}</td>
                          </tr>
                        ))
                      })}
                      {/* Total row */}
                      <tr className="bg-page font-semibold border-t border-line">
                        <td className="py-2 px-4 text-ink" colSpan={2}>รวม</td>
                        <td className="py-2 px-3 text-right text-ink">{totalPlan}</td>
                        <td className="py-2 px-3 text-right text-primary">{totalActual}</td>
                        <td className="py-2 px-4 text-right text-danger">{totalPlan - totalActual}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

        </>}

      </div>

      {/* Deduction edit modal */}
      {editNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditNote(null)} />
          <div className="relative bg-surface rounded-2xl w-full max-w-lg shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-ink">{editNote.id ? 'แก้ไข' : 'เพิ่ม'}รายการปรับลด</p>
              <button onClick={() => setEditNote(null)}><X className="h-5 w-5 text-ink-muted" /></button>
            </div>
            <textarea
              className="input min-h-[100px] resize-none"
              placeholder="รายละเอียดแอร์ที่ปรับลดค่าบริการ..."
              value={editNote.notes}
              onChange={(e) => setEditNote({ ...editNote, notes: e.target.value })}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditNote(null)} className="btn-secondary">ยกเลิก</button>
              <button onClick={saveNote} disabled={savingNote} className="btn-primary">
                {savingNote ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
