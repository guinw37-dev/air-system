import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import api from '../api/client'
import { useAuthStore } from '../store/auth'
import { STATUS_LABEL, TYPE_LABEL } from '../lib/config'

const STATUSES = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'in_progress',      label: 'กำลังทำ' },
  { value: 'pending_approval', label: 'รออนุมัติ' },
  { value: 'approved',         label: 'อนุมัติ' },
  { value: 'rejected',         label: 'ไม่อนุมัติ' },
]

export default function WorkOrderList() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const [wos, setWos] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState(searchParams.get('status') || '')
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ limit: 200 })
    if (status) params.append('status', status)
    api.get(`/work-orders?${params}`).then((r) => setWos(r.data)).finally(() => setLoading(false))
  }, [status])

  const filtered = wos.filter((w) =>
    !search ||
    w.order_no?.toLowerCase().includes(search.toLowerCase()) ||
    w.hospital_name?.toLowerCase().includes(search.toLowerCase()) ||
    w.tech1_name?.toLowerCase().includes(search.toLowerCase())
  )

  const isOwnerAdmin = ['owner', 'admin'].includes(user?.role)

  return (
    <Layout
      title="ใบงานทั้งหมด"
      actions={
        !isOwnerAdmin && (
          <button onClick={() => navigate('/work-orders/new')} className="btn-primary flex items-center gap-1.5 text-sm py-2">
            <Plus className="h-4 w-4" /> เปิดใบงาน
          </button>
        )
      }
    >
      <div className="p-6 flex flex-col gap-4">

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="ค้นหาเลขที่ใบงาน, โรงพยาบาล, ช่าง..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                onClick={() => setStatus(s.value)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  status === s.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-blue-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">เลขที่ใบงาน</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">โรงพยาบาล</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">ประเภท</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">สถานะ</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">ช่าง</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">เครื่อง</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide">วันที่</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-gray-400">ไม่พบใบงาน</td>
                    </tr>
                  )}
                  {filtered.map((wo) => {
                    const s = STATUS_LABEL[wo.status] || { label: wo.status, color: 'bg-gray-100 text-gray-700' }
                    const t = TYPE_LABEL[wo.type]    || { label: wo.type,   color: 'bg-gray-100 text-gray-700' }
                    return (
                      <tr
                        key={wo.id}
                        onClick={() => navigate(`/work-orders/${wo.id}`)}
                        className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4 font-semibold text-blue-700">{wo.order_no}</td>
                        <td className="py-3 px-4 text-gray-700">{wo.hospital_name}</td>
                        <td className="py-3 px-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.color}`}>{t.label}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.color}`}>{s.label}</span>
                        </td>
                        <td className="py-3 px-4 text-gray-600">{wo.tech1_name}{wo.tech2_name ? `, ${wo.tech2_name}` : ''}</td>
                        <td className="py-3 px-4 text-gray-600">{wo.item_count}</td>
                        <td className="py-3 px-4 text-gray-400 text-xs">{dayjs(wo.created_at).format('DD/MM/YY HH:mm')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400">{filtered.length} รายการ</p>
      </div>
    </Layout>
  )
}
