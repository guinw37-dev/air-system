import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import {
  ClipboardList, Clock, CheckCircle, Wrench, Building2, Wind, Plus,
  CalendarCheck, AlertTriangle, CalendarDays, Cpu, BarChart2, Activity,
  ChevronRight,
} from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api from '../api/client'
import { useAuthStore } from '../store/auth'
import { STATUS_LABEL, TYPE_LABEL } from '../lib/config'

// ── PM Widget (preserved from previous version) ───────────────────────────────

function effectivePmStatus(row) {
  if (row.status === 'done' || row.status === 'skipped') return row.status
  if (row.status === 'pending' && row.scheduled_date &&
      dayjs(row.scheduled_date).isBefore(dayjs(), 'day')) return 'overdue'
  return row.status
}

function PMWidget({ clientId }) {
  const navigate = useNavigate()
  const year = dayjs().year()
  const thisMonth = dayjs().month() + 1

  const [summary, setSummary] = useState(null)
  const [overdueCount, setOverdueCount] = useState(0)

  useEffect(() => {
    if (!clientId) return
    const p = new URLSearchParams({ client_id: clientId, year })
    Promise.all([
      api.get(`/pm/plan-summary?${p}`),
      api.get(`/pm/overdue?${p}`),
    ]).then(([sumRes, ovRes]) => {
      setSummary(sumRes.data || [])
      setOverdueCount((ovRes.data || []).length)
    }).catch(() => {})
  }, [clientId, year])

  const monthRow = (summary || []).find((r) => Number(r.month) === thisMonth) || {}
  const pendingThisMonth = (monthRow.pending || 0)
  const doneThisMonth    = (monthRow.done    || 0)

  return (
    <button
      onClick={() => navigate('/pm')}
      className="card text-left hover:bg-blue-50 transition-colors border border-transparent hover:border-blue-200"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarCheck className="h-5 w-5 text-blue-600" />
          <h3 className="font-semibold text-gray-800">PM เดือนนี้</h3>
        </div>
        <span className="text-xs text-blue-600 font-medium">ดูทั้งหมด →</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-yellow-50 rounded-xl p-3 text-center">
          <CalendarDays className="h-4 w-4 text-yellow-600 mx-auto mb-1" />
          <p className="text-xl font-bold text-gray-900">{pendingThisMonth}</p>
          <p className="text-xs text-gray-600 mt-0.5 leading-snug">ครบกำหนด<br/>เดือนนี้</p>
        </div>
        <div className="bg-red-50 rounded-xl p-3 text-center">
          <AlertTriangle className="h-4 w-4 text-red-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-gray-900">{overdueCount}</p>
          <p className="text-xs text-gray-600 mt-0.5 leading-snug">เลยกำหนด</p>
        </div>
        <div className="bg-green-50 rounded-xl p-3 text-center">
          <CheckCircle className="h-4 w-4 text-green-600 mx-auto mb-1" />
          <p className="text-xl font-bold text-gray-900">{doneThisMonth}</p>
          <p className="text-xs text-gray-600 mt-0.5 leading-snug">ทำแล้ว</p>
        </div>
      </div>
    </button>
  )
}

// ── Unit health pie colors ────────────────────────────────────────────────────
const HEALTH_COLORS = {
  active:   '#22c55e',
  broken:   '#ef4444',
  inactive: '#9ca3af',
}
const HEALTH_LABEL = {
  active:   'ปกติ',
  broken:   'เสีย / ชำรุด',
  inactive: 'ปิดใช้',
}

// ── WO trend bar colors ───────────────────────────────────────────────────────
const WO_COLORS = {
  major: '#2563eb',
  minor: '#7c3aed',
  fan:   '#0d9488',
}

// ── Custom tooltip for pie ────────────────────────────────────────────────────
function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div className="bg-white shadow rounded-xl px-3 py-2 text-sm border border-gray-100">
      <p className="font-medium text-gray-800">{HEALTH_LABEL[d.name] || d.name}</p>
      <p className="text-gray-500">{d.value} เครื่อง</p>
    </div>
  )
}

// ── WO status badge ───────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const s = STATUS_LABEL[status] || { label: status, color: 'bg-gray-100 text-gray-700' }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.color}`}>{s.label}</span>
}

function TypeBadge({ type }) {
  const t = TYPE_LABEL[type] || { label: type, color: 'bg-gray-100 text-gray-700' }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.color}`}>{t.label}</span>
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [overview, setOverview] = useState(null)
  const [woTrend, setWoTrend] = useState([])
  const [unitHealth, setUnitHealth] = useState([])
  const [topRepair, setTopRepair] = useState([])
  const [recentWos, setRecentWos] = useState([])
  const [loading, setLoading] = useState(true)

  // Load clients once
  useEffect(() => {
    api.get('/master/clients')
      .then((r) => {
        const list = r.data || []
        setClients(list)
        if (list.length > 0) setClientId(String(list[0].id))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Fetch all stats when clientId changes
  const fetchStats = useCallback(() => {
    if (!clientId) return
    const p = clientId ? `?client_id=${clientId}` : ''
    Promise.all([
      api.get(`/stats/overview${p}`).catch(() => ({ data: {} })),
      api.get(`/stats/wo-trend${p}&months=6`).catch(() => ({ data: [] })),
      api.get(`/stats/unit-health${p}`).catch(() => ({ data: [] })),
      api.get(`/stats/top-repair${p}&limit=10`).catch(() => ({ data: [] })),
      api.get(`/work-orders${p}&limit=5`).catch(() => ({ data: [] })),
    ]).then(([ov, trend, health, top, wos]) => {
      setOverview(ov.data || {})
      setWoTrend(trend.data || [])
      setUnitHealth(health.data || [])
      setTopRepair(top.data || [])
      setRecentWos(wos.data || [])
    })
  }, [clientId])

  useEffect(() => { fetchStats() }, [fetchStats])

  if (loading) return <PageSpinner />

  const isOwnerAdmin = ['approver', 'admin', 'central_admin'].includes(user?.role)

  // Summary cards
  const wo = overview?.wo || {}
  const units = overview?.units || {}
  const summaryCards = [
    {
      icon: ClipboardList,
      label: 'ใบงานเดือนนี้',
      value: wo.this_month ?? 0,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      icon: AlertTriangle,
      label: 'PM เลยกำหนด',
      value: overview?.pm_overdue ?? 0,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
    {
      icon: Wrench,
      label: 'เครื่องเสีย / ชำรุด',
      value: (units.broken ?? 0) + (units.inactive ?? 0),
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      icon: Clock,
      label: 'แจ้งซ่อมรอดำเนินการ',
      value: overview?.repairs_open ?? 0,
      color: 'text-yellow-600',
      bg: 'bg-yellow-50',
    },
  ]

  // WO trend chart data
  const trendData = woTrend.map((r) => ({
    month: r.month,
    'ล้างใหญ่': r.major || 0,
    'ล้างย่อย': r.minor || 0,
    'พัดลม':   r.fan   || 0,
  }))

  // Pie data
  const pieData = unitHealth
    .filter((d) => d.n > 0)
    .map((d) => ({ name: d.status, value: d.n }))

  const totalUnits = pieData.reduce((s, d) => s + d.value, 0)

  return (
    <Layout title="Dashboard">
      <div className="p-6 flex flex-col gap-6">

        {/* Greeting + client selector */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">สวัสดี, {user?.name}</h2>
            <p className="text-sm text-gray-500">{dayjs().format('dddd DD MMMM YYYY')}</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              className="input max-w-xs"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">-- ทุก Client --</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {!isOwnerAdmin && (
              <button
                onClick={() => navigate('/work-orders/new')}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="h-4 w-4" /> เปิดใบงาน
              </button>
            )}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {summaryCards.map(({ icon: Icon, label, value, color, bg }) => (
            <div key={label} className={`${bg} rounded-2xl p-4 flex flex-col gap-2`}>
              <Icon className={`h-5 w-5 ${color}`} />
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-600 leading-snug">{label}</p>
            </div>
          ))}
        </div>

        {/* PM widget */}
        {clientId && <PMWidget clientId={clientId} />}

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* WO Trend — stacked bar */}
          <div className="card lg:col-span-2">
            <h3 className="font-semibold text-gray-800 mb-4">ใบงานรายเดือน (6 เดือนล่าสุด)</h3>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trendData} barSize={18}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#eff6ff' }} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Bar dataKey="ล้างใหญ่" stackId="a" fill={WO_COLORS.major} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="ล้างย่อย" stackId="a" fill={WO_COLORS.minor} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="พัดลม"   stackId="a" fill={WO_COLORS.fan}   radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">ยังไม่มีข้อมูล</div>
            )}
          </div>

          {/* Unit health pie */}
          <div className="card flex flex-col">
            <h3 className="font-semibold text-gray-800 mb-3">สถานะเครื่อง</h3>
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={72}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={HEALTH_COLORS[entry.name] || '#9ca3af'} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-1.5 mt-2">
                  {pieData.map((d) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs text-gray-600">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ background: HEALTH_COLORS[d.name] || '#9ca3af' }}
                      />
                      <span className="flex-1">{HEALTH_LABEL[d.name] || d.name}</span>
                      <span className="font-semibold text-gray-800">{d.value}</span>
                      <span className="text-gray-400">({totalUnits > 0 ? Math.round(d.value / totalUnits * 100) : 0}%)</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">ยังไม่มีข้อมูล</div>
            )}
          </div>
        </div>

        {/* Bottom row — top repair + recent WOs */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Top repair units */}
          <div className="card">
            <h3 className="font-semibold text-gray-800 mb-4">เครื่องที่แจ้งซ่อมมากที่สุด</h3>
            {topRepair.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">ยังไม่มีข้อมูล</p>
            ) : (
              <div className="flex flex-col divide-y divide-gray-50">
                {topRepair.map((u, idx) => (
                  <button
                    key={u.unit_id}
                    onClick={() => navigate(`/units/${u.unit_id}`)}
                    className="flex items-center gap-3 py-2.5 hover:bg-gray-50 rounded-lg px-1 transition-colors text-left"
                  >
                    <span className="text-xs font-bold text-gray-400 w-5 text-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-blue-700 font-mono">{u.asset_code}</p>
                      <p className="text-xs text-gray-500 truncate">{u.unit_name} · {u.room_name || '-'}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-sm font-bold text-gray-700">{u.repair_count}</span>
                      <span className="text-xs text-gray-400">ครั้ง</span>
                      <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Recent WOs */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800">ใบงานล่าสุด</h3>
              <button
                onClick={() => navigate('/work-orders')}
                className="text-sm text-blue-600 hover:underline"
              >
                ดูทั้งหมด →
              </button>
            </div>
            {recentWos.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">ยังไม่มีใบงาน</p>
            ) : (
              <div className="flex flex-col divide-y divide-gray-50">
                {recentWos.map((wo) => (
                  <button
                    key={wo.id}
                    onClick={() => navigate(`/work-orders/${wo.id}`)}
                    className="flex items-center gap-3 py-2.5 hover:bg-gray-50 rounded-lg px-1 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-blue-600">{wo.order_no}</span>
                        <TypeBadge type={wo.type} />
                        <StatusBadge status={wo.status} />
                      </div>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{wo.client_name || wo.site_name || '-'}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-gray-400">
                        {wo.created_at ? dayjs(wo.created_at).format('DD/MM/YY') : '-'}
                      </p>
                      <ChevronRight className="h-3.5 w-3.5 text-gray-300 ml-auto mt-1" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </Layout>
  )
}

// ── WoCard export (kept for backward compat) ──────────────────────────────────
export function WoCard({ wo, onClick }) {
  const s = STATUS_LABEL[wo.status] || { label: wo.status, color: 'bg-gray-100 text-gray-700' }
  const t = TYPE_LABEL[wo.type]    || { label: wo.type,   color: 'bg-gray-100 text-gray-700' }
  return (
    <button onClick={onClick} className="card text-left w-full hover:bg-gray-50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 text-sm truncate">{wo.order_no}</p>
          <p className="text-xs text-gray-500 truncate mt-0.5">{wo.hospital_name}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.color}`}>{s.label}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.color}`}>{t.label}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
        <span>{wo.item_count} เครื่อง</span>
        <span>{wo.photo_count} รูป</span>
        <span className="ml-auto">{dayjs(wo.created_at).format('DD/MM/YY HH:mm')}</span>
      </div>
    </button>
  )
}
