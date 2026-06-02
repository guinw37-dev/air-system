import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import {
  Cpu, Thermometer, Zap, Activity, Package, Clock, Wrench,
  ClipboardList, ChevronRight, AlertTriangle, CheckCircle, XCircle,
} from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api from '../api/client'
import { STATUS_LABEL, TYPE_LABEL } from '../lib/config'

// ── Color maps ────────────────────────────────────────────────────────────────
const KIND_CONFIG = {
  work_order: { label: 'ใบงาน', bg: 'bg-primary-soft', border: 'border-primary/20', dot: 'bg-primary', icon: ClipboardList, iconColor: 'text-primary' },
  repair:     { label: 'แจ้งซ่อม', bg: 'bg-warn-soft', border: 'border-warn/20', dot: 'bg-warn', icon: Wrench, iconColor: 'text-warn' },
  part:       { label: 'เบิกอะไหล่', bg: 'bg-success-soft', border: 'border-success/20', dot: 'bg-success', icon: Package, iconColor: 'text-success' },
}

const UNIT_STATUS_STYLE = {
  active:   { label: 'ปกติ',    className: 'badge badge-success' },
  broken:   { label: 'เสีย',    className: 'badge badge-danger' },
  inactive: { label: 'ปิดใช้', className: 'badge badge-gray' },
}

// ── Line colors for trend chart — aligned to palette ─────────────────────────
const LINE_COLORS = [
  '#1E7FC4', // primary
  '#10A56A', // success
  '#E8943A', // warn
  '#E8503A', // danger
  '#163E5E', // primary-dark
  '#0891b2', '#be185d', '#65a30d', '#ea580c', '#4338ca',
]

// ── Section tabs ──────────────────────────────────────────────────────────────
const TABS = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'trend',    label: 'Trend' },
  { key: 'parts',    label: 'อะไหล่' },
]

// ── Timeline Card ─────────────────────────────────────────────────────────────
function TimelineCard({ item }) {
  const navigate = useNavigate()
  const cfg = KIND_CONFIG[item.kind] || KIND_CONFIG.work_order

  const content = () => {
    if (item.kind === 'work_order') {
      const s = STATUS_LABEL[item.status] || { label: item.status, color: 'bg-page text-ink-muted' }
      const t = TYPE_LABEL[item.type]     || { label: item.type,   color: 'bg-page text-ink-muted' }
      return (
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.color}`}>{t.label}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.color}`}>{s.label}</span>
          {item.order_no && <span className="text-xs text-ink-muted font-mono">{item.order_no}</span>}
        </div>
      )
    }
    if (item.kind === 'repair') {
      return (
        <p className="text-xs text-ink-muted mt-1 line-clamp-2">
          {item.problem || 'ไม่ระบุปัญหา'}
          {item.status && <span className="ml-2 text-ink-muted/60">({item.status})</span>}
        </p>
      )
    }
    if (item.kind === 'part') {
      return (
        <p className="text-xs text-ink-muted mt-1">
          {item.part_name} × {item.qty}
        </p>
      )
    }
    return null
  }

  const handleClick = () => {
    if (item.kind === 'work_order' && item.id) navigate(`/work-orders/${item.id}`)
  }

  return (
    <div
      onClick={item.kind === 'work_order' && item.id ? handleClick : undefined}
      className={`relative pl-5 pb-5 last:pb-0 ${item.kind === 'work_order' && item.id ? 'cursor-pointer' : ''}`}
    >
      {/* Vertical line */}
      <div className="absolute left-1.5 top-3 bottom-0 w-px bg-line last:hidden" />
      {/* Dot */}
      <div className={`absolute left-0 top-2 h-3 w-3 rounded-full ${cfg.dot} ring-2 ring-white`} />

      <div className={`${cfg.bg} border ${cfg.border} rounded-xl p-3 hover:opacity-90 transition-opacity`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <cfg.icon className={`h-4 w-4 shrink-0 ${cfg.iconColor}`} />
            <span className="text-xs font-semibold text-ink">{cfg.label}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-ink-muted">{item.date ? dayjs(item.date).format('DD/MM/YY') : '-'}</span>
            {item.kind === 'work_order' && item.id && <ChevronRight className="h-3.5 w-3.5 text-ink-muted" />}
          </div>
        </div>
        {content()}
      </div>
    </div>
  )
}

// ── Trend Chart ───────────────────────────────────────────────────────────────
function TrendChart({ trend }) {
  const [selectedItem, setSelectedItem] = useState('all')

  if (!trend || trend.length === 0) {
    return <p className="text-sm text-ink-muted text-center py-8">ยังไม่มีข้อมูล Trend</p>
  }

  // Get unique item labels
  const items = [...new Set(trend.map((d) => d.item_label))].filter(Boolean)

  const filteredTrend = selectedItem === 'all' ? trend : trend.filter((d) => d.item_label === selectedItem)

  // Build chart data: group by date → { date, [item_label]: value_after }
  const dateMap = {}
  filteredTrend.forEach((d) => {
    const dt = d.date ? dayjs(d.date).format('DD/MM') : '-'
    if (!dateMap[dt]) dateMap[dt] = { date: dt }
    dateMap[dt][d.item_label] = d.value_after
  })
  const chartData = Object.values(dateMap)

  const displayedItems = selectedItem === 'all' ? items : [selectedItem]

  return (
    <div>
      {/* Item selector */}
      {items.length > 1 && (
        <div className="flex gap-2 flex-wrap mb-4">
          <button
            onClick={() => setSelectedItem('all')}
            className={`px-3 py-1 rounded-input text-xs font-medium border transition-colors ${
              selectedItem === 'all'
                ? 'bg-primary text-white border-primary'
                : 'bg-surface text-ink-muted border-line hover:border-primary/40'
            }`}
          >
            ทั้งหมด
          </button>
          {items.map((item) => (
            <button
              key={item}
              onClick={() => setSelectedItem(item)}
              className={`px-3 py-1 rounded-input text-xs font-medium border transition-colors ${
                selectedItem === item
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface text-ink-muted border-line hover:border-primary/40'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      )}
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3EDF5" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip />
          {displayedItems.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {displayedItems.map((item, idx) => (
            <Line
              key={item}
              type="monotone"
              dataKey={item}
              stroke={LINE_COLORS[idx % LINE_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function UnitDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [unit, setUnit] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('timeline')

  useEffect(() => {
    Promise.all([
      api.get(`/master/units/${id}`),
      api.get(`/master/units/${id}/timeline`).catch(() => ({ data: [] })),
      api.get(`/master/units/${id}/stats`).catch(() => ({ data: {} })),
    ])
      .then(([unitRes, tlRes, statsRes]) => {
        setUnit(unitRes.data)
        setTimeline(tlRes.data || [])
        setStats(statsRes.data || {})
      })
      .catch((e) => setError(e.response?.data?.error || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <PageSpinner />
  if (error) return (
    <Layout title="Unit Detail" back="/master">
      <div className="p-6 text-center text-danger">{error}</div>
    </Layout>
  )
  if (!unit) return null

  const statusStyle = UNIT_STATUS_STYLE[unit.status] || { label: unit.status, className: 'badge badge-gray' }
  const counts = stats?.counts || {}
  const parts = stats?.parts || []
  const trend = stats?.trend || []

  const countBadges = [
    { label: 'ล้างใหญ่', value: counts.major ?? 0, bg: 'bg-primary-soft', textColor: 'text-primary' },
    { label: 'ล้างย่อย', value: counts.minor ?? 0, bg: 'bg-primary-soft/60', textColor: 'text-primary-dark' },
    { label: 'ล้างพัดลม', value: counts.fan ?? 0, bg: 'bg-success-soft', textColor: 'text-success' },
  ]

  return (
    <Layout title={unit.asset_code || 'Unit Detail'} back="/master">
      <div className="p-4 lg:p-6 flex flex-col gap-5">

        {/* Unit header card */}
        <div className="card">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-bold text-ink">{unit.asset_code}</h2>
                <span className={statusStyle.className}>
                  {statusStyle.label}
                </span>
                <span className={`badge ${unit.equipment_type === 'fan' ? 'badge-primary' : 'badge-primary'}`}>
                  {unit.equipment_type === 'fan' ? 'พัดลม' : 'แอร์'}
                </span>
              </div>
              <p className="text-ink-muted mt-1">{unit.name || '-'}</p>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-ink-muted flex-wrap">
                {unit.client_name && <span>{unit.client_name}</span>}
                {unit.building_name && <><span>·</span><span>{unit.building_name}</span></>}
                {unit.floor_name && <><span>·</span><span>{unit.floor_name}</span></>}
                {unit.room_name && <><span>·</span><span className="font-medium text-ink">{unit.room_name}</span></>}
              </div>
            </div>
          </div>

          {/* Spec pills */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            {unit.family && (
              <div className="bg-page rounded-xl p-2.5">
                <p className="text-xs text-ink-muted">Family</p>
                <p className="font-medium text-ink text-sm mt-0.5">{unit.family}</p>
              </div>
            )}
            {unit.capacity_btu && (
              <div className="bg-page rounded-xl p-2.5">
                <p className="text-xs text-ink-muted">BTU</p>
                <p className="font-medium text-ink text-sm mt-0.5">{Number(unit.capacity_btu).toLocaleString()}</p>
              </div>
            )}
            {unit.refrigerant && (
              <div className="bg-page rounded-xl p-2.5">
                <p className="text-xs text-ink-muted">สารทำความเย็น</p>
                <p className="font-medium text-ink text-sm mt-0.5">{unit.refrigerant}</p>
              </div>
            )}
            {unit.room_name && (
              <div className="bg-page rounded-xl p-2.5">
                <p className="text-xs text-ink-muted">ห้อง / แผนก</p>
                <p className="font-medium text-ink text-sm mt-0.5">{unit.room_name}</p>
              </div>
            )}
          </div>

          {/* Count badges */}
          <div className="flex gap-3 mt-4 flex-wrap">
            {countBadges.map((b) => (
              <div key={b.label} className={`${b.bg} rounded-xl px-4 py-2 text-center min-w-[80px]`}>
                <p className={`text-xl font-bold ${b.textColor}`}>{b.value}</p>
                <p className="text-xs text-ink-muted mt-0.5">{b.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-page rounded-xl p-1 w-fit border border-line">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-input text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Timeline */}
        {tab === 'timeline' && (
          <div className="card">
            <h3 className="font-semibold text-ink mb-4">ประวัติการใช้งาน</h3>
            {timeline.length === 0 ? (
              <p className="text-sm text-ink-muted text-center py-8">ยังไม่มีประวัติ</p>
            ) : (
              <div className="pl-2">
                {timeline.map((item, idx) => (
                  <TimelineCard key={idx} item={item} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Trend chart */}
        {tab === 'trend' && (
          <div className="card">
            <h3 className="font-semibold text-ink mb-4">Trend การวัดค่า</h3>
            <TrendChart trend={trend} />
          </div>
        )}

        {/* Parts */}
        {tab === 'parts' && (
          <div className="card">
            <h3 className="font-semibold text-ink mb-4">สรุปอะไหล่ที่เบิก</h3>
            {parts.length === 0 ? (
              <p className="text-sm text-ink-muted text-center py-8">ยังไม่มีประวัติเบิกอะไหล่</p>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {parts.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-ink-muted shrink-0" />
                      <span className="text-sm font-medium text-ink">{p.part_name}</span>
                    </div>
                    <span className="text-sm font-semibold text-ink-muted bg-page px-2.5 py-0.5 rounded-full border border-line">
                      {p.total_qty} ชิ้น
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </Layout>
  )
}
