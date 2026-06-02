import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import {
  ClipboardList, Clock, CheckCircle, Wrench, Building2, Wind, Plus
} from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api from '../api/client'
import { useAuthStore } from '../store/auth'
import { STATUS_LABEL, TYPE_LABEL } from '../lib/config'

export default function Dashboard() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [stats, setStats] = useState(null)
  const [recentWos, setRecentWos] = useState([])
  const [loading, setLoading] = useState(true)

  // Daily view
  const [dailyDate, setDailyDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [dailyWos, setDailyWos] = useState([])
  const [dailyLoading, setDailyLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get('/stats'),
      api.get('/work-orders?limit=8'),
    ]).then(([s, w]) => {
      setStats(s.data)
      setRecentWos(w.data)
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    setDailyLoading(true)
    api.get(`/stats/daily?date=${dailyDate}`)
      .then((r) => setDailyWos(r.data))
      .finally(() => setDailyLoading(false))
  }, [dailyDate])

  if (loading) return <PageSpinner />

  const isOwnerAdmin = ['approver', 'admin', 'central_admin'].includes(user?.role)

  const statCards = [
    { icon: ClipboardList, label: 'กำลังดำเนินการ', value: stats?.in_progress ?? 0,  color: 'text-yellow-600', bg: 'bg-yellow-50' },
    { icon: Clock,         label: 'รออนุมัติ',        value: stats?.pending ?? 0,       color: 'text-orange-600', bg: 'bg-orange-50' },
    { icon: CheckCircle,   label: 'อนุมัติแล้ว',      value: stats?.approved ?? 0,      color: 'text-green-600',  bg: 'bg-green-50'  },
    { icon: Wrench,        label: 'แจ้งซ่อมค้าง',     value: stats?.open_repairs ?? 0,  color: 'text-red-500',    bg: 'bg-red-50'    },
    { icon: Building2,     label: 'โรงพยาบาล',         value: stats?.hospitals ?? 0,     color: 'text-blue-600',   bg: 'bg-blue-50'   },
    { icon: Wind,          label: 'เครื่องแอร์',        value: stats?.ac_units ?? 0,      color: 'text-teal-600',   bg: 'bg-teal-50'   },
  ]

  const monthData = (stats?.by_month || []).map((r) => ({
    month: r.month,
    ใบงาน: r.count,
  }))

  const typeData = (stats?.by_type || []).map((r) => ({
    name: TYPE_LABEL[r.type]?.label || r.type,
    count: r.count,
  }))

  return (
    <Layout title="Dashboard">
      <div className="p-6 flex flex-col gap-6">

        {/* Greeting + action */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">สวัสดี, {user?.name}</h2>
            <p className="text-sm text-gray-500">{dayjs().format('dddd DD MMMM YYYY')}</p>
          </div>
          {!isOwnerAdmin && (
            <button
              onClick={() => navigate('/work-orders/new')}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="h-4 w-4" /> เปิดใบงาน
            </button>
          )}
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {statCards.map(({ icon: Icon, label, value, color, bg }) => (
            <div key={label} className={`${bg} rounded-2xl p-4 flex flex-col gap-2`}>
              <Icon className={`h-5 w-5 ${color}`} />
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-600 leading-snug">{label}</p>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* WO by month */}
          <div className="card lg:col-span-2">
            <h3 className="font-semibold text-gray-800 mb-4">ใบงานรายเดือน (6 เดือนล่าสุด)</h3>
            {monthData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthData} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#eff6ff' }} />
                  <Bar dataKey="ใบงาน" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">ยังไม่มีข้อมูล</div>
            )}
          </div>

          {/* WO by type */}
          <div className="card">
            <h3 className="font-semibold text-gray-800 mb-4">แบ่งตามประเภท</h3>
            <div className="flex flex-col gap-3">
              {typeData.map((t) => (
                <div key={t.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">{t.name}</span>
                    <span className="font-semibold text-gray-900">{t.count}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${Math.min(100, (t.count / (stats?.approved + stats?.in_progress + stats?.pending || 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
              {typeData.length === 0 && <p className="text-sm text-gray-400">ยังไม่มีข้อมูล</p>}
            </div>
          </div>
        </div>

        {/* Daily view */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h3 className="font-semibold text-gray-800">ใบงานรายวัน</h3>
            <input
              type="date"
              className="input w-auto text-sm"
              value={dailyDate}
              onChange={(e) => setDailyDate(e.target.value)}
            />
          </div>
          {dailyLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-200 border-t-blue-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">เลขที่</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">โรงพยาบาล</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">ประเภท</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">สถานะ</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">ช่าง</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">เครื่อง</th>
                    <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">เวลา</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyWos.map((wo) => {
                    const s = STATUS_LABEL[wo.status] || { label: wo.status, color: 'bg-gray-100 text-gray-700' }
                    const t = TYPE_LABEL[wo.type]    || { label: wo.type,   color: 'bg-gray-100 text-gray-700' }
                    return (
                      <tr
                        key={wo.id}
                        onClick={() => navigate(`/work-orders/${wo.id}`)}
                        className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="py-2.5 px-3 font-medium text-blue-600">{wo.order_no}</td>
                        <td className="py-2.5 px-3 text-gray-700">{wo.hospital_name}</td>
                        <td className="py-2.5 px-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.color}`}>{t.label}</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.color}`}>{s.label}</span>
                        </td>
                        <td className="py-2.5 px-3 text-gray-600">{wo.tech1_name}</td>
                        <td className="py-2.5 px-3 text-gray-500">{wo.item_count}</td>
                        <td className="py-2.5 px-3 text-gray-400 text-xs">{dayjs(wo.created_at).format('HH:mm')}</td>
                      </tr>
                    )
                  })}
                  {dailyWos.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-gray-400 text-sm">
                        ไม่มีใบงานในวันที่ {dayjs(dailyDate).format('DD/MM/YYYY')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent WOs — table */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800">ใบงานล่าสุด</h3>
            <button onClick={() => navigate('/work-orders')} className="text-sm text-blue-600 hover:underline">
              ดูทั้งหมด →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">เลขที่</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">โรงพยาบาล</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">ประเภท</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">สถานะ</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">ช่าง</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-gray-500">วันที่</th>
                </tr>
              </thead>
              <tbody>
                {recentWos.map((wo) => {
                  const s = STATUS_LABEL[wo.status] || { label: wo.status, color: 'bg-gray-100 text-gray-700' }
                  const t = TYPE_LABEL[wo.type]    || { label: wo.type,   color: 'bg-gray-100 text-gray-700' }
                  return (
                    <tr
                      key={wo.id}
                      onClick={() => navigate(`/work-orders/${wo.id}`)}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="py-2.5 px-3 font-medium text-blue-600">{wo.order_no}</td>
                      <td className="py-2.5 px-3 text-gray-700">{wo.hospital_name}</td>
                      <td className="py-2.5 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.color}`}>{t.label}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.color}`}>{s.label}</span>
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">{wo.tech1_name}</td>
                      <td className="py-2.5 px-3 text-gray-400 text-xs">{dayjs(wo.created_at).format('DD/MM/YY HH:mm')}</td>
                    </tr>
                  )
                })}
                {recentWos.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-400 text-sm">ยังไม่มีใบงาน</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  )
}

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
