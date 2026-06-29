import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { CalendarDays, Sparkles, ClipboardCheck, Target, FileSpreadsheet, AlertTriangle, ChevronRight, Wrench, Layers, GripVertical, ChevronDown, ChevronUp, Save, RotateCcw } from 'lucide-react'
import { WidthProvider, Responsive } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import dayjs from 'dayjs'
import api from '../api/client'
import Layout from '../components/Layout'
import { CONDITION_ISSUE_LABEL, PRIORITY_LABEL, PRIORITY_COLOR } from '../lib/condition'

const GridLayout = WidthProvider(Responsive)
const PREF_KEY = 'dashboard_washreport'

const TH_MONTHS = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const WT = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลม' }
const WT_LONG = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลมระบายอากาศ' }

function thaiDate(ymd) {
  if (!ymd) return ''
  const [y, m, d] = ymd.split('-').map(Number)
  return `${d} ${TH_MONTHS[m]} ${y + 543}`
}
const monthOptions = () => Array.from({ length: 12 }, (_, i) => dayjs().subtract(i, 'month').format('YYYY-MM'))
const monthLabel = (m) => `${m.slice(5)}/${Number(m.slice(0, 4)) + 543}`
const pctOf = (done, target) => (target > 0 ? Math.round((done / target) * 100) : 0)
const pctTone = (p) => (p >= 100 ? '#059669' : p >= 60 ? '#0ea5e9' : '#f59e0b')

// default grid (lg: 12 cols, rowHeight 30px)
const DEFAULT_LAYOUT = [
  { i: 'daily', x: 0, y: 0, w: 4, h: 9, minW: 3, minH: 4 },
  { i: 'repair', x: 4, y: 0, w: 4, h: 9, minW: 3, minH: 4 },
  { i: 'monthly', x: 8, y: 0, w: 4, h: 12, minW: 3, minH: 5 },
  { i: 'yearly', x: 0, y: 9, w: 6, h: 14, minW: 4, minH: 6 },
  { i: 'weekly', x: 6, y: 9, w: 6, h: 14, minW: 4, minH: 6 },
  { i: 'bytype_year', x: 0, y: 23, w: 12, h: 9, minW: 3, minH: 4 },
  { i: 'coverage', x: 0, y: 32, w: 6, h: 9, minW: 3, minH: 4 },
  { i: 'target', x: 6, y: 32, w: 6, h: 9, minW: 3, minH: 4 },
  { i: 'condition', x: 0, y: 41, w: 12, h: 9, minW: 4, minH: 4 },
]
const COLLAPSED_H = 1

// card shell — header is the drag handle + collapse toggle
function Card({ title, icon: Icon, children, chrome }) {
  const collapsed = chrome?.collapsed
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden h-full flex flex-col">
      <div className={`drag-handle flex items-center gap-2 px-4 py-3 bg-sky-50 border-b border-sky-100 ${chrome ? 'cursor-move' : ''}`}>
        {chrome && <GripVertical size={15} className="text-blue-300 shrink-0" />}
        {Icon && <Icon size={18} className="text-blue-800 shrink-0" />}
        <h2 className="font-bold text-blue-900 text-sm truncate">{title}</h2>
        {chrome && (
          <button onClick={chrome.onToggle} onMouseDown={(e) => e.stopPropagation()}
            className="ml-auto text-blue-400 hover:text-blue-700 shrink-0" title={collapsed ? 'ขยาย' : 'ย่อ'}>
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        )}
      </div>
      {!collapsed && <div className="p-4 flex-1 overflow-auto">{children}</div>}
    </div>
  )
}

// แยกประเภทแอร์ (ac_type) — period: 'month'|'year'
function ByTypeCard({ title, byType, period, chrome }) {
  const dk = period === 'year' ? 'done_year' : 'done_month'
  const tk = period === 'year' ? 'target_year' : 'target_month'
  const groups = (byType || []).filter((g) => (g.rows || []).length)
  return (
    <Card title={title} icon={Layers} chrome={chrome}>
      {groups.length === 0 ? (
        <p className="text-sm text-slate-400 py-2">ยังไม่มีข้อมูลแยกประเภท</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.work_type}>
              <div className="text-sm font-semibold text-blue-900 mb-1">{WT[g.work_type] || g.work_type}</div>
              <div className="space-y-1.5">
                {g.rows.map((r) => {
                  const p = pctOf(r[dk], r[tk])
                  return (
                    <div key={r.ac_type}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600 truncate">{r.ac_type}</span>
                        <span className="shrink-0"><b className="text-blue-900">{r[dk]}</b><span className="text-slate-400">/{r[tk]}</span>
                          <b className="ml-2" style={{ color: pctTone(p) }}>{p}%</b></span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, p)}%`, background: pctTone(p) }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function TargetSection({ month, navigate, chrome }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    api.get('/targets/progress', { params: month ? { month } : {} }).then((r) => setData(r.data)).catch(() => {})
  }, [month])
  return (
    <Card title="เป้าหมายล้าง" icon={Target} chrome={chrome}>
      {!data || !data.targets?.length ? <p className="text-sm text-slate-400 py-2">ยังไม่ตั้งเป้าหมาย</p> : (
        <>
          <div className="space-y-3">
            {data.targets.map((t) => {
              const tone = pctTone(t.pct)
              return (
                <div key={t.id}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-slate-700">{t.zone} <span className="text-slate-400">· {WT[t.work_type || ''] || t.work_type || 'รวม'}</span></span>
                    <span className="text-slate-500"><b className="text-slate-800">{t.done}</b>/{t.effective_target}
                      <b className="ml-2" style={{ color: tone }}>{t.pct}%</b></span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, t.pct)}%`, background: tone }} />
                  </div>
                </div>
              )
            })}
          </div>
          <button onClick={() => navigate('/targets')} className="mt-3 text-xs text-blue-600 hover:underline">จัดการเป้าหมาย →</button>
        </>
      )}
    </Card>
  )
}

function CoverageSection({ month, chrome }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    api.get('/wash-units/coverage', { params: month ? { month } : {} }).then((r) => setData(r.data)).catch(() => {})
  }, [month])
  const byZone = {}
  for (const g of (data?.groups || [])) (byZone[g.zone] ||= []).push(g)
  return (
    <Card title="ล้างได้ / เหลือ (เทียบทะเบียนแอร์)" icon={ClipboardCheck} chrome={chrome}>
      {!data || !data.groups?.length ? <p className="text-sm text-slate-400 py-2">ยังไม่มีทะเบียนแอร์</p> : (
        <div className="space-y-4">
          {Object.entries(byZone).map(([zone, rows]) => (
            <div key={zone}>
              <div className="text-sm font-semibold text-slate-700 mb-1.5">{zone}</div>
              <div className="space-y-2">
                {rows.map((g) => {
                  const p = pctOf(g.done, g.total)
                  return (
                    <div key={g.kind + g.label}>
                      <div className="flex items-center justify-between text-sm mb-0.5">
                        <span className="text-slate-600 truncate flex-1">{g.kind === 'clinic' && <span className="text-amber-600 mr-1">📍</span>}{g.label}</span>
                        <span className="text-slate-500 text-xs shrink-0"><b className="text-slate-800">{g.done}</b>/{g.total}
                          <b className="ml-2" style={{ color: pctTone(p) }}>{p}%</b></span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, p)}%`, background: pctTone(p) }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default function WashReport() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [openIssue, setOpenIssue] = useState(null)
  const [selPr, setSelPr] = useState(null)
  const [cond, setCond] = useState(null)
  const [selDate, setSelDate] = useState('')
  const [selMonth, setSelMonth] = useState(dayjs().format('YYYY-MM'))

  // layout state (per-account, saved to users.ui_prefs)
  const [layout, setLayout] = useState(DEFAULT_LAYOUT)
  const [collapsed, setCollapsed] = useState({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const expandedH = useRef({})
  const prefLoaded = useRef(false)

  useEffect(() => {
    setLoading(true)
    const params = {}
    if (selDate) params.date = selDate
    if (selMonth) params.month = selMonth
    api.get('/dashboard/wash-report', { params })
      .then((r) => setData(r.data))
      .catch((e) => setErr(e.response?.status === 400 ? 'เลือกสาขาก่อนเพื่อดูรายงาน' : (e.response?.data?.error || e.message)))
      .finally(() => setLoading(false))
  }, [selDate, selMonth])

  useEffect(() => {
    api.get('/simple-wo/condition-summary').then((r) => setCond(r.data)).catch(() => {})
    api.get(`/auth/prefs/${PREF_KEY}`).then((r) => {
      const v = r.data?.value
      if (v?.layout?.length) setLayout(v.layout)
      if (v?.collapsed) setCollapsed(v.collapsed)
      if (v?.expandedH) expandedH.current = v.expandedH
    }).catch(() => {}).finally(() => { prefLoaded.current = true })
  }, [])

  const onLayoutChange = useCallback((cur) => {
    if (!prefLoaded.current) return
    // keep expanded items' height; collapsed rows are forced short
    setLayout((prev) => cur.map((c) => ({ ...prev.find((p) => p.i === c.i), ...c })))
    setDirty(true)
  }, [])

  const toggle = (id) => {
    setLayout((prev) => prev.map((l) => {
      if (l.i !== id) return l
      if (collapsed[id]) return { ...l, h: expandedH.current[id] || 9, minH: 4 }
      expandedH.current[id] = l.h
      return { ...l, h: COLLAPSED_H, minH: COLLAPSED_H }
    }))
    setCollapsed((c) => ({ ...c, [id]: !c[id] }))
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/auth/prefs/${PREF_KEY}`, { value: { layout, collapsed, expandedH: expandedH.current } })
      setDirty(false)
    } catch (e) { setErr(e.response?.data?.error || e.message) } finally { setSaving(false) }
  }
  const reset = () => {
    if (!window.confirm('คืนค่าการจัดวางเริ่มต้น?')) return
    setLayout(DEFAULT_LAYOUT); setCollapsed({}); expandedH.current = {}; setDirty(true)
  }

  const [exporting, setExporting] = useState(false)
  const exportExcel = async () => {
    setExporting(true)
    try {
      const res = await api.get('/dashboard/wash-report/excel', { params: { month: selMonth }, responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url; a.download = `รายงานล้างแอร์-${data?.date || ''}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ } finally { setExporting(false) }
  }

  const barData = data?.monthly?.types?.map((t) => ({ name: WT[t.work_type] || t.work_type, เป้าหมาย: t.target, ยอดล้าง: t.done })) || []
  const condItems = cond?.items || []
  const issuePr = (it, k) => it.condition?.issue_priority?.[k] || it.condition?.priority || 'normal'
  const issueCounts = {}
  for (const it of condItems) for (const k of (it.condition?.issues || [])) {
    if (selPr && issuePr(it, k) !== selPr) continue
    issueCounts[k] = (issueCounts[k] || 0) + 1
  }
  const modalItems = openIssue
    ? condItems.filter((it) => (it.condition?.issues || []).includes(openIssue) && (!selPr || issuePr(it, openIssue) === selPr))
    : []
  const weeks = data?.weekly?.weeks || []
  const sum = (k) => weeks.reduce((s, w) => s + (w[k] || 0), 0)
  const sumTarget = sum('target'), sumDone = sum('done'), sumRem = sum('remaining')
  const sumPct = sumTarget > 0 ? Math.round((sumDone / sumTarget) * 100) : 0

  const chromeFor = (id) => ({ collapsed: !!collapsed[id], onToggle: () => toggle(id) })

  // render a block by id
  const block = (id) => {
    if (!data) return null
    const c = chromeFor(id)
    switch (id) {
      case 'daily': return (
        <Card title="สรุปงานล้างประจำวัน" icon={Sparkles} chrome={c}>
          <input type="date" value={selDate || data.date} onChange={(e) => setSelDate(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1 text-slate-600 w-full mb-3" />
          <div className="flex items-baseline justify-between mb-3">
            <div className="flex items-baseline gap-2"><span className="text-slate-500">รวม</span>
              <span className="text-4xl font-bold text-blue-900">{data.daily.total}</span><span className="text-slate-500">ตัว</span></div>
            <span className="text-xs text-slate-400">เป้า/วัน {data.daily.target}</span>
          </div>
          <div className="space-y-2.5 text-sm">
            {[['major', data.daily.major, data.daily.target_major], ['minor', data.daily.minor, data.daily.target_minor], ['fan', data.daily.fan, data.daily.target_fan]].map(([k, v, tg]) => {
              const pct = tg > 0 ? Math.min(100, Math.round((v / tg) * 100)) : 0
              return (
                <div key={k}>
                  <div className="flex items-center justify-between mb-0.5"><span className="text-slate-600">{WT[k]}</span>
                    <span><b className="text-blue-900">{v}</b><span className="text-slate-400"> / {tg} ตัว</span></span></div>
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: tg > 0 && v >= tg ? '#059669' : '#2563eb' }} /></div>
                </div>
              )
            })}
          </div>
        </Card>
      )
      case 'repair': return (
        <Card title="สรุปงานซ่อมประจำเดือน" icon={ClipboardCheck} chrome={c}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-emerald-50 rounded-xl p-3"><div className="text-2xl font-bold text-emerald-600">{data.repair.done}</div><div className="text-xs text-slate-500 mt-1">สำเร็จ ✓</div></div>
            <div className="bg-slate-50 rounded-xl p-3"><div className="text-2xl font-bold text-slate-700">{data.repair.total}</div><div className="text-xs text-slate-500 mt-1">ทั้งหมด</div></div>
            <div className="bg-red-50 rounded-xl p-3"><div className="text-2xl font-bold text-red-500">{data.repair.pending}</div><div className="text-xs text-slate-500 mt-1">คงค้าง ✗</div></div>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2">
            <Wrench size={15} className="text-amber-600 shrink-0" /><span className="text-sm text-slate-600">อะไหล่ที่ใช้</span>
            <b className="text-amber-700 ml-auto">{data.repair.parts_lines || 0}</b><span className="text-xs text-slate-400">รายการ · {data.repair.parts_jobs || 0} งาน</span>
          </div>
        </Card>
      )
      case 'monthly': return (
        <Card title="สรุปงานล้างประจำเดือน" icon={Target} chrome={c}>
          <select value={selMonth} onChange={(e) => setSelMonth(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1 text-slate-600 w-full mb-2">
            {monthOptions().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={barData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="เป้าหมาย" fill="#60a5fa" radius={[4, 4, 0, 0]} /><Bar dataKey="ยอดล้าง" fill="#1e3a8a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2 space-y-1 text-sm">
            {(data.monthly?.types || []).map((t) => { const p = pctOf(t.done, t.target); return (
              <div key={t.work_type} className="flex items-center justify-between"><span className="text-slate-600">{WT[t.work_type] || t.work_type}</span>
                <span><b className="text-blue-900">{t.done}</b><span className="text-slate-400">/{t.target}</span><b className="ml-2" style={{ color: pctTone(p) }}>{p}%</b></span></div>) })}
          </div>
        </Card>
      )
      case 'yearly': return (
        <Card title={`สรุปงานล้างสะสมประจำปี ${(data.yearly.year || 0) + 543}`} icon={Sparkles} chrome={c}>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={data.yearly.series || []} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 10 }} interval={0} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="target" name="เป้า/เดือน" fill="#60a5fa" radius={[3, 3, 0, 0]} /><Bar dataKey="total" name="ยอดล้าง" fill="#1e3a8a" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <table className="w-full text-sm mt-2">
            <thead><tr className="text-left text-slate-500 text-xs border-b"><th className="py-2">ประเภท</th><th className="py-2 text-right">เป้าหมาย</th><th className="py-2 text-right">ยอดล้าง</th><th className="py-2 text-right">เหลือ</th><th className="py-2 text-right">%</th></tr></thead>
            <tbody>{data.yearly.types.map((t) => { const rem = Math.max(0, t.target - t.done); const p = pctOf(t.done, t.target); return (
              <tr key={t.work_type} className="border-b last:border-0"><td className="py-2.5 text-slate-700">{WT_LONG[t.work_type] || t.work_type}</td>
                <td className="py-2.5 text-right tabular-nums text-slate-600">{t.target}</td><td className="py-2.5 text-right tabular-nums font-bold text-blue-900">{t.done}</td>
                <td className="py-2.5 text-right tabular-nums text-amber-600">{rem}</td><td className="py-2.5 text-right tabular-nums font-semibold" style={{ color: pctTone(p) }}>{p}%</td></tr>) })}</tbody>
          </table>
        </Card>
      )
      case 'weekly': return (
        <Card title="รวมยอดล้างแอร์รายสัปดาห์ (Weekly)" icon={Target} chrome={c}>
          {(() => { const cur = weeks.find((w) => w.no === data.weekly.current_no); if (!cur) return null
            const tone = pctTone(cur.pct); return (
            <div className="mb-3 rounded-xl bg-sky-50 border border-sky-100 p-3">
              <div className="flex items-center justify-between text-sm"><span className="font-semibold text-blue-900">สัปดาห์นี้ (Week {cur.no})</span><span className="text-xs text-slate-500">{cur.label}</span></div>
              <div className="flex items-center gap-4 mt-1.5 text-sm"><span>ยอด <b className="text-blue-900">{cur.done}</b>/{cur.target}</span><span className="text-amber-600">คงค้าง {cur.remaining}</span><span className="ml-auto font-bold" style={{ color: tone }}>{cur.pct}%</span></div>
            </div>) })()}
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-slate-500 text-xs border-b"><th className="py-2 text-left">รายการ</th>{weeks.map((w) => <th key={w.no} className={`py-2 text-center ${w.no === data.weekly.current_no ? 'text-blue-900 bg-sky-50 rounded' : ''}`}>Week {w.no}</th>)}<th className="py-2 text-center">รวม</th></tr></thead>
            <tbody>
              <tr className="border-b"><td className="py-2 text-slate-600">เป้าหมาย</td>{weeks.map((w) => <td key={w.no} className="py-2 text-center tabular-nums">{w.target}</td>)}<td className="py-2 text-center tabular-nums font-semibold">{sumTarget}</td></tr>
              <tr className="border-b"><td className="py-2 text-slate-600">ยอดล้าง</td>{weeks.map((w) => <td key={w.no} className="py-2 text-center tabular-nums font-bold text-blue-900">{w.done}</td>)}<td className="py-2 text-center tabular-nums font-bold text-blue-900">{sumDone}</td></tr>
              <tr className="border-b"><td className="py-2 text-slate-600">คงค้าง</td>{weeks.map((w) => <td key={w.no} className="py-2 text-center tabular-nums text-amber-600">{w.remaining}</td>)}<td className="py-2 text-center tabular-nums text-amber-600">{sumRem}</td></tr>
              <tr><td className="py-2 text-slate-600">% สำเร็จ</td>{weeks.map((w) => <td key={w.no} className="py-2 text-center tabular-nums font-semibold" style={{ color: pctTone(w.pct) }}>{w.pct}%</td>)}<td className="py-2 text-center tabular-nums font-semibold">{sumPct}%</td></tr>
            </tbody>
          </table></div>
        </Card>
      )
      case 'bytype_month': return <ByTypeCard title={`แยกประเภทแอร์ — ประจำเดือน ${monthLabel(data.monthly?.month || selMonth)}`} byType={data.byType} period="month" chrome={c} />
      case 'bytype_year': return <ByTypeCard title={`แยกประเภทแอร์ — สะสมประจำปี ${(data.yearly.year || 0) + 543}`} byType={data.byType} period="year" chrome={c} />
      case 'coverage': return <CoverageSection month={selMonth} chrome={c} />
      case 'target': return <TargetSection month={selMonth} navigate={navigate} chrome={c} />
      case 'condition': return (
        <Card title={`แอร์เสื่อมสภาพ / ต้องแก้ (${cond?.total || 0})`} icon={AlertTriangle} chrome={c}>
          <div className="flex gap-2 mb-3">
            {['urgent', 'normal', 'low'].filter((p) => cond?.byPriority?.[p]).map((p) => { const on = selPr === p; return (
              <button key={p} onClick={() => setSelPr(on ? null : p)} className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-all ${on ? 'text-white ring-2 ring-offset-1' : 'text-white opacity-80 hover:opacity-100'}`} style={{ background: PRIORITY_COLOR[p], borderColor: PRIORITY_COLOR[p] }}>{PRIORITY_LABEL[p]} {cond.byPriority[p]}</button>) })}
            {selPr && <button onClick={() => setSelPr(null)} className="text-xs text-slate-500 underline">ล้างตัวกรอง</button>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
            {Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <button key={k} onClick={() => setOpenIssue(k)} className="group flex items-center gap-1 text-sm border-b border-slate-50 py-1.5 px-1.5 rounded hover:bg-sky-50">
                <span className="text-slate-600 group-hover:text-blue-700 group-hover:underline truncate text-left">{CONDITION_ISSUE_LABEL[k] || k}</span>
                <span className="flex-1" /><b className="text-blue-900">{n}</b><ChevronRight size={14} className="text-slate-300 shrink-0" /></button>))}
            {!Object.keys(issueCounts).length && <p className="text-sm text-slate-400 col-span-full py-2">ไม่มีอาการในสถานะนี้</p>}
          </div>
        </Card>
      )
      default: return null
    }
  }

  // apply collapsed height override to the layout fed to the grid
  const displayLayout = layout.map((l) => (collapsed[l.i] ? { ...l, h: COLLAPSED_H, minH: COLLAPSED_H } : l))

  return (
    <Layout>
      <div className="space-y-4">
        <div className="bg-blue-900 rounded-2xl py-4 px-6 text-center">
          <h1 className="text-white font-bold text-lg md:text-xl">AIR Conditioner Cleaning Dashboard – งานล้างแอร์</h1>
        </div>

        {loading ? <p className="text-center text-slate-400 py-12">กำลังโหลด…</p>
          : err ? <p className="text-center text-amber-600 py-12">{err}</p>
          : !data ? null : (
          <>
            <div className="flex items-center gap-2 text-blue-900 font-semibold flex-wrap">
              <CalendarDays size={18} /><span>รายงานประจำวันที่ : {thaiDate(data.date)}</span>
              <span className="text-xs text-slate-400 font-normal">· ลากหัวการ์ดเพื่อย้าย · ลากมุมเพื่อขยาย</span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50"><RotateCcw size={15} /> รีเซ็ต</button>
                <button onClick={save} disabled={saving || !dirty} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white ${dirty ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-300'} disabled:opacity-60`}><Save size={15} /> {saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
                <button onClick={exportExcel} disabled={exporting} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"><FileSpreadsheet size={16} /> {exporting ? 'กำลังออก…' : 'Export Excel'}</button>
              </div>
            </div>

            <GridLayout className="layout" layouts={{ lg: displayLayout }}
              breakpoints={{ lg: 996, md: 768, sm: 0 }} cols={{ lg: 12, md: 12, sm: 1 }}
              rowHeight={30} margin={[16, 16]} draggableHandle=".drag-handle"
              onLayoutChange={onLayoutChange} compactType="vertical">
              {DEFAULT_LAYOUT.map((l) => <div key={l.i}>{block(l.i)}</div>)}
            </GridLayout>
          </>
        )}
      </div>

      {openIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpenIssue(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-3 border-b bg-sky-50 sticky top-0">
              <div><h3 className="font-bold text-blue-900">{CONDITION_ISSUE_LABEL[openIssue] || openIssue}</h3>
                <p className="text-xs text-slate-500">แอร์ที่มีอาการนี้ {modalItems.length} เครื่อง{selPr ? ` · ${PRIORITY_LABEL[selPr]}` : ''}</p></div>
              <button onClick={() => setOpenIssue(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
            </div>
            <div className="p-3 space-y-1">
              {modalItems.length === 0 ? <p className="text-sm text-slate-400 text-center py-6">ไม่มีงาน</p> : modalItems.map((it) => {
                const pr = it.condition?.issue_priority?.[openIssue] || it.condition?.priority
                return (
                  <button key={it.id} onClick={() => navigate(`/simple-wo/${it.id}`)} className="w-full flex items-center gap-2 text-sm hover:bg-blue-50 rounded-lg px-3 py-2 text-left border border-slate-100">
                    <div className="flex-1 min-w-0"><div className="text-slate-800 truncate font-medium">{it.asset_code || it.wo_number}</div>
                      <div className="text-xs text-slate-500 truncate">{[it.location, it.building, it.room].filter(Boolean).join(' › ') || '—'}</div></div>
                    {pr && <span className="text-[11px] font-medium text-white px-1.5 py-0.5 rounded shrink-0" style={{ background: PRIORITY_COLOR[pr] || '#94a3b8' }}>{PRIORITY_LABEL[pr] || pr}</span>}
                    <span className="text-blue-600 text-xs shrink-0">ดู →</span>
                  </button>)
              })}
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
