import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import { WoCard } from './Dashboard'
import api from '../api/client'
import { useAuthStore } from '../store/auth'

const STATUSES = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'in_progress', label: 'กำลังทำ' },
  { value: 'pending_approval', label: 'รออนุมัติ' },
  { value: 'approved', label: 'อนุมัติ' },
  { value: 'rejected', label: 'ไม่อนุมัติ' },
]

export default function WorkOrderList() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [wos, setWos] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ limit: 100 })
    if (status) params.append('status', status)
    api.get(`/work-orders?${params}`).then((r) => setWos(r.data)).finally(() => setLoading(false))
  }, [status])

  const filtered = wos.filter((w) =>
    !search ||
    w.order_no.includes(search) ||
    w.hospital_name?.toLowerCase().includes(search.toLowerCase())
  )

  const isOwnerAdmin = ['owner', 'admin'].includes(user?.role)

  return (
    <Layout
      title="ใบงานทั้งหมด"
      actions={
        !isOwnerAdmin && (
          <button onClick={() => navigate('/work-orders/new')} className="p-1 rounded-lg active:bg-blue-600">
            <Plus className="h-6 w-6" />
          </button>
        )
      }
    >
      <div className="px-4 pt-4 flex flex-col gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="ค้นหาเลขที่ใบงาน, โรงพยาบาล..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Status filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                status === s.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-blue-600" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-12">ไม่พบใบงาน</p>
            )}
            {filtered.map((wo) => (
              <WoCard key={wo.id} wo={wo} onClick={() => navigate(`/work-orders/${wo.id}`)} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
