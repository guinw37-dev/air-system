import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts'
import { CalendarDays, Sparkles, ClipboardCheck, Target, FileSpreadsheet, FileDown, AlertTriangle, ChevronRight, Wrench, Layers, GripVertical, ChevronDown, ChevronUp, Save, RotateCcw } from 'lucide-react'
import { WidthProvider, Responsive } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import dayjs from 'dayjs'
import api from '../api/client'
import Layout from '../components/Layout'
import { CONDITION_ISSUE_LABEL, PRIORITY_LABEL, PRIORITY_COLOR } from '../lib/condition'
import { useHasZones } from '../lib/zones'

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
  { i: 'daily', x: 0, y: 0, w: 6, h: 16, minW: 4, minH: 8 },
  { i: 'repair', x: 6, y: 0, w: 6, h: 7, minW: 3, minH: 4 },
  { i: 'monthly', x: 6, y: 7, w: 6, h: 12, minW: 3, minH: 5 },
  { i: 'yearly', x: 0, y: 9, w: 6, h: 14, minW: 4, minH: 6 },
  { i: 'weekly', x: 6, y: 9, w: 6, h: 14, minW: 4, minH: 6 },
  { i: 'bytype_year', x: 0, y: 23, w: 12, h: 9, minW: 3, minH: 4 },
  { i: 'coverage', x: 0, y: 32, w: 6, h: 9, minW: 3, minH: 4 },
  { i: 'target', x: 6, y: 32, w: 6, h: 9, minW: 3, minH: 4 },
  { i: 'condition', x: 0, y: 41, w: 12, h: 9, minW: 4, minH: 4 },
  { i: 'range', x: 0, y: 50, w: 12, h: 12, minW: 4, minH: 5 },
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

// ── ปฏิทินยอดล้างรายวัน — แต่ละช่อง = ยอดรวม + จุดสีต่อประเภท คลิกเลือกวัน ─────
const WT_DOT = { major: '#1e3a8a', minor: '#2563eb', fan: '#94a3b8' }
function DailyCalendar({ month, zone, selDate, onPickDate }) {
  const [days, setDays] = useState({})   // 'YYYY-MM-DD' → {major,minor,fan,total}
  useEffect(() => {
    if (!month) return
    const from = `${month}-01`
    const to = dayjs(from).endOf('month').format('YYYY-MM-DD')
    const params = { from, to }
    if (zone) params.zone = zone
    api.get('/dashboard/wash-report/range', { params })
      .then((r) => setDays(Object.fromEntries((r.data?.daily || []).map((d) => [d.date, d]))))
      .catch(() => setDays({}))
  }, [month, zone])

  const first = dayjs(`${month}-01`)
  const dim = first.daysInMonth()
  const lead = first.day()               // 0=อาทิตย์
  const today = dayjs().format('YYYY-MM-DD')
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: dim }, (_, i) => first.date(i + 1).format('YYYY-MM-DD')),
  ]
  const monthTotal = Object.values(days).reduce((s, d) => s + (d.total || 0), 0)
  return (
    <div>
      <div className="grid grid-cols-7 text-center text-[11px] text-slate-400 font-medium mb-1">
        {['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />
          const v = days[d]
          const isSel = selDate === d
          const isToday = d === today
          return (
            <button key={d} onClick={() => onPickDate(d)}
              className={`rounded-lg border p-1 min-h-[52px] flex flex-col items-center transition-all text-center
                ${isSel ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50'
                  : v?.total ? 'border-sky-100 bg-sky-50/60 hover:bg-sky-50' : 'border-slate-100 bg-white hover:bg-slate-50'}`}>
              <span className={`text-[10px] leading-3 ${isToday ? 'font-bold text-blue-700' : 'text-slate-400'}`}>{Number(d.slice(8))}</span>
              {v?.total ? (
                <>
                  <span className="text-sm font-bold text-blue-900 leading-4">{v.total}</span>
                  <span className="flex gap-0.5 mt-0.5">
                    {['major', 'minor', 'fan'].map((k) => v[k] > 0 && (
                      <span key={k} className="w-1.5 h-1.5 rounded-full" style={{ background: WT_DOT[k] }} />
                    ))}
                  </span>
                </>
              ) : <span className="text-[10px] text-slate-300 mt-1">—</span>}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500 flex-wrap">
        {Object.entries(WT).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: WT_DOT[k] }} />{label}</span>
        ))}
        <span className="ml-auto">รวมทั้งเดือน <b className="text-blue-900">{monthTotal}</b> เครื่อง</span>
      </div>
    </div>
  )
}

// ── donut % ต่อชนิดแอร์ (ยอดล้างสะสมปี vs เป้าปี) ─────────────────────────────
const AC_COLORS = ['#0284c7', '#0f6e56', '#f59e0b', '#6366f1', '#dc2626', '#0d9488', '#a855f7', '#64748b']
function AcTypeDonut({ label, done, target, color }) {
  const pct = target > 0 ? Math.round((done / target) * 100) : 0
  const filled = Math.min(done, target || done)
  const rest = Math.max(0, (target || done) - filled)
  const data = [
    { name: 'ล้างแล้ว', value: filled || 0.0001, color },
    { name: 'คงเหลือ', value: rest, color: '#e2e8f0' },
  ]
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: 104, height: 104 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={35} outerRadius={49}
              startAngle={90} endAngle={-270} paddingAngle={1} stroke="none">
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-base font-bold" style={{ color }}>{pct}%</span>
        </div>
      </div>
      <div className="text-sm font-semibold text-slate-700 -mt-1 text-center">{label}</div>
      <div className="text-xs text-slate-500 tabular-nums">{done.toLocaleString()} / {target.toLocaleString()}</div>
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

// สรุปตามช่วงวันที่ที่เลือกบนหัวรายงาน (จาก–ถึง เลือกที่ header ของหน้า)
function RangeSection({ from, to, zone, chrome }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!from || !to) return
    setLoading(true); setErr('')
    const params = { from, to }
    if (zone) params.zone = zone
    api.get('/dashboard/wash-report/range', { params })
      .then((r) => setData(r.data))
      .catch((e) => setErr(e.response?.data?.error || e.message))
      .finally(() => setLoading(false))
  }, [from, to, zone])

  const chart = (data?.daily || []).map((d) => ({
    name: dayjs(d.date).format('D/M'), ล้างใหญ่: d.major, ล้างย่อย: d.minor, พัดลม: d.fan,
  }))
  return (
    <Card title={`สรุปช่วง ${thaiDate(from)} – ${thaiDate(to)}${data ? ` · ${data.days} วัน · ${data.grand.orders} ใบงาน` : ''}`} icon={CalendarDays} chrome={chrome}>
      {err ? <p className="text-sm text-amber-600 py-2">{err}</p>
        : loading ? <p className="text-sm text-slate-400 py-2">กำลังโหลด…</p>
        : !data ? null : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center mb-3">
            <div className="bg-sky-50 rounded-xl p-3"><div className="text-2xl font-bold text-blue-900">{data.grand.done}</div><div className="text-xs text-slate-500 mt-1">รวมทุกประเภท (เครื่อง)</div></div>
            {data.totals.map((t) => (
              <div key={t.work_type} className="bg-slate-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-blue-800">{t.done}</div>
                <div className="text-xs text-slate-500 mt-1">{WT[t.work_type]} · {t.orders} ใบงาน</div>
              </div>
            ))}
          </div>
          {chart.length > 0 && (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chart} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="ล้างใหญ่" stackId="r" fill="#1e3a8a" /><Bar dataKey="ล้างย่อย" stackId="r" fill="#2563eb" />
                <Bar dataKey="พัดลม" stackId="r" fill="#94a3b8" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
            <span>ผลล้างผ่าน <b className="text-emerald-600">{data.result.ok}</b> ใบงาน</span>
            {data.result.not_ok > 0 && <span>ไม่ผ่าน <b className="text-red-500">{data.result.not_ok}</b> ใบงาน</span>}
            {data.orders_truncated && <span className="text-amber-600 text-xs">ใบงานเกิน {data.order_cap} — PPTX แสดง {data.order_cap} ใบแรก</span>}
          </div>
        </>
      )}
    </Card>
  )
}

function TargetSection({ month, zone, navigate, chrome }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    // link กับหน้าเป้าหมายล้าง ตามเดือน + โซนที่เลือก (ศรีราชา 1/2 แยกตาม selector)
    const params = {}
    if (month) params.month = month
    if (zone) params.zone = zone
    api.get('/targets/progress', { params }).then((r) => setData(r.data)).catch(() => {})
  }, [month, zone])
  // เรียง ล้างใหญ่ → ล้างย่อย → พัดลม → รวม แล้วตามสถานที่
  const WT_ORDER = { major: 0, minor: 1, fan: 2, '': 3 }
  const rows = [...(data?.targets || [])].sort((a, b) =>
    (WT_ORDER[a.work_type || ''] ?? 9) - (WT_ORDER[b.work_type || ''] ?? 9)
    || String(a.location || '').localeCompare(String(b.location || '')))
  return (
    <Card title="เป้าหมายล้างประจำเดือน" icon={Target} chrome={chrome}>
      {!rows.length ? <p className="text-sm text-slate-400 py-2">ยังไม่ตั้งเป้าหมายเดือนนี้</p> : (
        <>
          <div className="space-y-2.5">
            {rows.map((t) => {
              const tone = pctTone(t.pct)
              return (
                <div key={t.id}>
                  <div className="flex items-center justify-between text-sm mb-1 gap-2">
                    <span className="text-slate-700 truncate">
                      <b>{WT[t.work_type || ''] || 'รวม'}</b>
                      <span className="text-slate-400"> · {t.location || 'ทุกที่'}{t.ac_type ? ` · ${t.ac_type}` : ''}</span>
                    </span>
                    <span className="text-slate-500 shrink-0"><b className="text-slate-800">{t.done}</b>/{t.effective_target}
                      <b className="ml-2" style={{ color: tone }}>{t.pct}%</b></span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
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

function CoverageSection({ month, zone, chrome }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    api.get('/wash-units/coverage', { params: month ? { month } : {} }).then((r) => setData(r.data)).catch(() => {})
  }, [month])
  const byZone = {}
  for (const g of (data?.groups || [])) {
    if (zone && g.zone !== zone) continue   // เคารพโซนที่เลือกบนหัวรายงาน
    ;(byZone[g.zone] ||= []).push(g)
  }
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
  // ช่วงเวลาหลักของหน้า (จาก–ถึง) — คุมการ์ดสรุปช่วง + Export PPTX;
  // เปลี่ยน "จาก" แล้วเดือนของการ์ดรายเดือน/ปฏิทินตามไปด้วย
  const [rangeFrom, setRangeFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'))
  const [rangeTo, setRangeTo] = useState(dayjs().format('YYYY-MM-DD'))
  const [exportingPptx, setExportingPptx] = useState(false)
  const pickFrom = (v) => {
    if (!v) return
    setRangeFrom(v)
    setSelMonth(v.slice(0, 7))
    if (v > rangeTo) setRangeTo(v)
  }
  const exportPptx = async () => {
    setExportingPptx(true)
    try {
      const params = { from: rangeFrom, to: rangeTo }
      if (selZone) params.zone = selZone
      const res = await api.get('/dashboard/wash-report/pptx', { params, responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url; a.download = `รายงานล้างแอร์_${rangeFrom}_${rangeTo}_TW.pptx`; a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ } finally { setExportingPptx(false) }
  }
  const [selZone, setSelZone] = useState('')   // '' = ทุกโซน
  const hasZones = useHasZones()               // โซนมีเฉพาะศรีราชา

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
    if (selZone) params.zone = selZone
    api.get('/dashboard/wash-report', { params })
      .then((r) => setData(r.data))
      .catch((e) => setErr(e.response?.status === 400 ? 'เลือกสาขาก่อนเพื่อดูรายงาน' : (e.response?.data?.error || e.message)))
      .finally(() => setLoading(false))
  }, [selDate, selMonth, selZone])

  useEffect(() => {
    api.get('/simple-wo/condition-summary').then((r) => setCond(r.data)).catch(() => {})
    api.get(`/auth/prefs/${PREF_KEY}`).then((r) => {
      const v = r.data?.value
      if (v?.layout?.length) {
        // การ์ดที่เพิ่มใหม่ภายหลัง (เช่น 'range') ไม่อยู่ใน layout ที่ user เคย save →
        // เติมจาก DEFAULT_LAYOUT ต่อท้าย ไม่งั้น react-grid-layout จะวางเป็นการ์ดจิ๋ว 1x1
        const missing = DEFAULT_LAYOUT.filter((d) => !v.layout.some((l) => l.i === d.i))
        setLayout([...v.layout, ...missing])
      }
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
        <Card title="ปฏิทินยอดล้างรายวัน" icon={CalendarDays} chrome={c}>
          <div className="flex items-center gap-2 mb-2">
            <select value={selMonth} onChange={(e) => setSelMonth(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1 text-slate-600">
              {monthOptions().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <span className="text-xs text-slate-400">คลิกวันเพื่อดูสรุปด้านล่าง</span>
          </div>
          <DailyCalendar month={selMonth} zone={selZone} selDate={selDate || data.date} onPickDate={setSelDate} />
          <div className="mt-3 border-t border-slate-100 pt-2">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm text-slate-500">สรุปวันที่ {thaiDate(data.date)}</span>
              <span><b className="text-2xl text-blue-900">{data.daily.total}</b>
                <span className="text-slate-400"> / {data.daily.target} ตัว</span></span>
            </div>
            <div className="space-y-2 text-sm">
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
              <Bar dataKey="major" stackId="w" name="ล้างใหญ่" fill="#1e3a8a" /><Bar dataKey="minor" stackId="w" name="ล้างย่อย" fill="#2563eb" /><Bar dataKey="fan" stackId="w" name="พัดลม" fill="#60a5fa" radius={[3, 3, 0, 0]} />
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
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-slate-400">{data.weekly?.custom ? 'ช่วงสัปดาห์กำหนดเอง' : 'สัปดาห์ตายตัว (ยังไม่ตั้งค่า)'}</span>
            <button onClick={() => navigate('/week-config')} className="text-xs text-blue-600 hover:underline">ตั้งค่าสัปดาห์ →</button>
          </div>
        </Card>
      )
      case 'bytype_month': return <ByTypeCard title={`แยกประเภทแอร์ — ประจำเดือน ${monthLabel(data.monthly?.month || selMonth)}`} byType={data.byType} period="month" chrome={c} />
      case 'bytype_year': {
        // รวมข้าม work_type → กราฟวงกลมต่อชนิดแอร์ (ยอดล้างสะสมปี vs เป้าปี)
        const byAc = {}
        for (const g of (data.byType || [])) for (const r of (g.rows || [])) {
          const k = r.ac_type || 'ไม่ระบุ'
          byAc[k] = byAc[k] || { done: 0, target: 0 }
          byAc[k].done += r.done_year || 0
          byAc[k].target += r.target_year || 0
        }
        const rows = Object.entries(byAc).filter(([, v]) => v.done > 0 || v.target > 0)
          .sort((a, b) => b[1].target - a[1].target)
        return (
          <Card title={`แยกชนิดแอร์ — สะสมประจำปี ${(data.yearly.year || 0) + 543} (กราฟต่อชนิด)`} icon={Layers} chrome={c}>
            {rows.length === 0 ? <p className="text-sm text-slate-400 py-2">ยังไม่มีข้อมูลแยกชนิด</p> : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {rows.map(([ac, v], i) => (
                  <AcTypeDonut key={ac} label={ac} done={v.done} target={v.target}
                    color={AC_COLORS[i % AC_COLORS.length]} />
                ))}
              </div>
            )}
          </Card>
        )
      }
      case 'range': return <RangeSection from={rangeFrom} to={rangeTo} zone={selZone} chrome={c} />
      case 'coverage': return <CoverageSection month={selMonth} zone={selZone} chrome={c} />
      case 'target': return <TargetSection month={selMonth} zone={selZone} navigate={navigate} chrome={c} />
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
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                {/* ช่วงเวลาหลักของหน้า — คุมการ์ดสรุปช่วง + รายเดือน/ปฏิทิน + Export */}
                <div className="flex items-center gap-1.5 bg-sky-50 border border-sky-100 rounded-lg px-2 py-1">
                  <span className="text-xs text-slate-500 font-normal">ช่วง</span>
                  <input type="date" value={rangeFrom} max={rangeTo} onChange={(e) => pickFrom(e.target.value)}
                    className="border border-slate-200 rounded px-1.5 py-0.5 text-xs text-slate-700 font-normal bg-white" />
                  <span className="text-xs text-slate-400 font-normal">–</span>
                  <input type="date" value={rangeTo} min={rangeFrom} onChange={(e) => e.target.value && setRangeTo(e.target.value)}
                    className="border border-slate-200 rounded px-1.5 py-0.5 text-xs text-slate-700 font-normal bg-white" />
                </div>
                {hasZones && (
                  <select value={selZone} onChange={(e) => setSelZone(e.target.value)}
                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-600">
                    <option value="">ทุกโซน</option>
                    <option value="PTS1">PTS1</option>
                    <option value="PTS2">PTS2</option>
                  </select>
                )}
                <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50"><RotateCcw size={15} /> รีเซ็ต</button>
                <button onClick={save} disabled={saving || !dirty} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white ${dirty ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-300'} disabled:opacity-60`}><Save size={15} /> {saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
                <button onClick={exportPptx} disabled={exportingPptx} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 text-white rounded-lg text-sm font-medium hover:bg-blue-800 disabled:opacity-50"><FileDown size={16} /> {exportingPptx ? 'กำลังสร้าง…' : 'Export PPTX'}</button>
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
