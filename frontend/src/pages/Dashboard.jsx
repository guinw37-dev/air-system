import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, ClipboardList, Clock, CheckCircle, Wrench } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api from '../api/client'
import { useAuthStore } from '../store/auth'
import { STATUS_LABEL, TYPE_LABEL } from '../lib/config'

export default function Dashboard() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [wos, setWos] = useState([])
  const [repairs, setRepairs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/work-orders?limit=20'),
      api.get('/repair-logs?status=open'),
    ]).then(([w, r]) => {
      setWos(w.data)
      setRepairs(r.data)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <PageSpinner />

  const inProgress = wos.filter((w) => w.status === 'in_progress').length
  const pending    = wos.filter((w) => w.status === 'pending_approval').length
  const approved   = wos.filter((w) => w.status === 'approved').length

  const recent = wos.slice(0, 5)

  const isOwnerAdmin = ['owner', 'admin'].includes(user?.role)

  return (
    <Layout title="หน้าหลัก">
      <div className="px-4 pt-4 pb-2">
        <p className="text-gray-500 text-sm">สวัสดี, <span className="font-medium text-gray-900">{user?.name}</span></p>
        <p className="text-xs text-gray-400">{dayjs().format('DD/MM/YYYY')}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 px-4 mt-2">
        <StatCard icon={<ClipboardList className="h-5 w-5 text-yellow-600" />}
          label="กำลังทำ" value={inProgress} color="bg-yellow-50" />
        <StatCard icon={<Clock className="h-5 w-5 text-orange-600" />}
          label="รออนุมัติ" value={pending} color="bg-orange-50" />
        <StatCard icon={<Wrench className="h-5 w-5 text-red-500" />}
          label="แจ้งซ่อม" value={repairs.length} color="bg-red-50" />
      </div>

      {/* Action */}
      {!isOwnerAdmin && (
        <div className="px-4 mt-4">
          <button
            onClick={() => navigate('/work-orders/new')}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <Plus className="h-5 w-5" /> เปิดใบงานใหม่
          </button>
        </div>
      )}

      {/* Recent WOs */}
      <div className="px-4 mt-5">
        <h2 className="font-semibold text-gray-800 mb-3">ใบงานล่าสุด</h2>
        <div className="flex flex-col gap-2">
          {recent.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีใบงาน</p>
          )}
          {recent.map((wo) => (
            <WoCard key={wo.id} wo={wo} onClick={() => navigate(`/work-orders/${wo.id}`)} />
          ))}
        </div>
        {wos.length > 5 && (
          <button onClick={() => navigate('/work-orders')} className="text-blue-600 text-sm mt-3 w-full text-center">
            ดูทั้งหมด →
          </button>
        )}
      </div>
    </Layout>
  )
}

function StatCard({ icon, label, value, color }) {
  return (
    <div className={`${color} rounded-2xl p-3 flex flex-col items-center gap-1`}>
      {icon}
      <span className="text-2xl font-bold text-gray-900">{value}</span>
      <span className="text-xs text-gray-600">{label}</span>
    </div>
  )
}

export function WoCard({ wo, onClick }) {
  const s = STATUS_LABEL[wo.status] || { label: wo.status, color: 'bg-gray-100 text-gray-700' }
  const t = TYPE_LABEL[wo.type]    || { label: wo.type,   color: 'bg-gray-100 text-gray-700' }
  return (
    <button onClick={onClick} className="card text-left w-full active:bg-gray-50">
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
