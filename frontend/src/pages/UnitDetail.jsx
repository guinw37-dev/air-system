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
  work_order: { label: 'ใบงาน', bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500', icon: ClipboardList, iconColor: 'text-blue-600' },
  repair:     { label: 'แจ้งซ่อม', bg: 'bg-orange-50', border: 'border-orange-200', dot: 'bg-orange-500', icon: Wrench, iconColor: 'text-orange-600' },
  part:       { label: 'เบิกอะไหล่', bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-500', icon: Package, iconColor: 'text-green-600' },
}

const UNIT_STATUS_STYLE = {
  active:   { label: 'ปกติ',    className: 'bg-green-100 text-green-700' },
  broken:   { label: 'เสีย',    className: 'bg-red-100 text-red-700' },
  inactive: { label: 'ปิดใช้', className: 'bg-gray-100 text-gray-600' },
}

// ── Line colors for trend chart ────────────────────────────────────────────────
const LINE_COLORS = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed',
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
      const s = STATUS_LABEL[item.status] || { label: item.status, color: 'bg-gray-100 text-gray-700' }
      const t = TYPE_LABEL[item.type]     || { label: item.type,   color: 'bg-gray-100 text-gray-700' }
      return (
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.color}`}>{t.label}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.color}`}>{s.label}</span>
          {item.order_no && <span className="text-xs text-gray-500 font-mono">{item.order_no}</span>}
        </div>
      )
    }
    if (item.kind === 'repair') {
      return (
        <p className="text-xs text-gray-600 mt-1 line-clamp-2">
          {item.problem || 'ไม่ระบุปัญหา'}
          {item.status && <span className="ml-2 text-gray-400">({item.status})</span>}
        </p>
      )
    }
    if (item.kind === 'part') {
      return (
        <p className="text-xs text-gray-600 mt-1">
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
      <div className="absolute left-1.5 top-3 bottom-0 w-px bg-gray-200 last:hidden" />
      {/* Dot */}
      <div className={`absolute left-0 top-2 h-3 w-3 rounded-full ${cfg.dot} ring-2 ring-white`} />

      <div className={`${cfg.bg} border ${cfg.border} rounded-xl p-3 hover:opacity-90 transition-opacity`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <cfg.icon className={`h-4 w-4 shrink-0 ${cfg.iconColor}`} />
            <span className="text-xs font-semibold text-gray-700">{cfg.label}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-xs text-gray-400">{item.date ? dayjs(item.date).format('DD/MM/YY') : '-'}</span>
            {item.kind === 'work_order' && item.id && <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
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
    return <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีข้อมูล Trend</p>
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
            className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
              selectedItem === 'all'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
            }`}
          >
            ทั้งหมด
          </button>
          {items.map((item) => (
            <button
              key={item}
              onClick={() => setSelectedItem(item)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                selectedItem === item
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      )}
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
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
      <div className="p-6 text-center text-red-500">{error}</div>
    </Layout>
  )
  if (!unit) return null

  const statusStyle = UNIT_STATUS_STYLE[unit.status] || { label: unit.status, className: 'bg-gray-100 text-gray-600' }
  const counts = stats?.counts || {}
  const parts = stats?.parts || []
  const trend = stats?.trend || []

  const countBadges = [
    { label: 'ล้างใหญ่', value: counts.major ?? 0, bg: 'bg-blue-50', textColor: 'text-blue-700' },
    { label: 'ล้างย่อย', value: counts.minor ?? 0, bg: 'bg-purple-50', textColor: 'text-purple-700' },
    { label: 'ล้างพัดลม', value: counts.fan ?? 0, bg: 'bg-teal-50', textColor: 'text-teal-700' },
  ]

  return (
    <Layout title={unit.asset_code || 'Unit Detail'} back="/master">
      <div className="p-6 flex flex-col gap-5">

        {/* Unit header card */}
        <div className="card">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-bold text-gray-900">{unit.asset_code}</h2>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${statusStyle.className}`}>
                  {statusStyle.label}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${unit.equipment_type === 'fan' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                  {unit.equipment_type === 'fan' ? 'พัดลม' : 'แอร์'}
                </span>
              </div>
              <p className="text-gray-600 mt-1">{unit.name || '-'}</p>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-400 flex-wrap">
                {unit.client_name && <span>{unit.client_name}</span>}
                {unit.building_name && <><span>·</span><span>{unit.building_name}</span></>}
                {unit.floor_name && <><span>·</span><span>{unit.floor_name}</span></>}
                {unit.room_name && <><span>·</span><span className="font-medium text-gray-600">{unit.room_name}</span></>}
              </div>
            </div>
          </div>

          {/* Spec pills */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            {unit.family && (
              <div className="bg-gray-50 rounded-xl p-2.5">
                <p className="text-xs text-gray-500">Family</p>
                <p className="font-medium text-gray-800 text-sm mt-0.5">{unit.family}</p>
              </div>
            )}
            {unit.capacity_btu && (
              <div className="bg-gray-50 rounded-xl p-2.5">
                <p className="text-xs text-gray-500">BTU</p>
                <p className="font-medium text-gray-800 text-sm mt-0.5">{Number(unit.capacity_btu).toLocaleString()}</p>
              </div>
            )}
            {unit.refrigerant && (
              <div className="bg-gray-50 rounded-xl p-2.5">
                <p className="text-xs text-gray-500">สารทำความเย็น</p>
                <p className="font-medium text-gray-800 text-sm mt-0.5">{unit.refrigerant}</p>
              </div>
            )}
            {unit.room_name && (
              <div className="bg-gray-50 rounded-xl p-2.5">
                <p className="text-xs text-gray-500">ห้อง / แผนก</p>
                <p className="font-medium text-gray-800 text-sm mt-0.5">{unit.room_name}</p>
              </div>
            )}
          </div>

          {/* Count badges */}
          <div className="flex gap-3 mt-4 flex-wrap">
            {countBadges.map((b) => (
              <div key={b.label} className={`${b.bg} rounded-xl px-4 py-2 text-center min-w-[80px]`}>
                <p className={`text-xl font-bold ${b.textColor}`}>{b.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{b.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Timeline */}
        {tab === 'timeline' && (
          <div className="card">
            <h3 className="font-semibold text-gray-800 mb-4">ประวัติการใช้งาน</h3>
            {timeline.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีประวัติ</p>
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
            <h3 className="font-semibold text-gray-800 mb-4">Trend การวัดค่า</h3>
            <TrendChart trend={trend} />
          </div>
        )}

        {/* Parts */}
        {tab === 'parts' && (
          <div className="card">
            <h3 className="font-semibold text-gray-800 mb-4">สรุปอะไหล่ที่เบิก</h3>
            {parts.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีประวัติเบิกอะไหล่</p>
            ) : (
              <div className="flex flex-col divide-y divide-gray-50">
                {parts.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-gray-400 shrink-0" />
                      <span className="text-sm font-medium text-gray-800">{p.part_name}</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-600 bg-gray-100 px-2.5 py-0.5 rounded-full">
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
