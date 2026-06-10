import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import api from '../api/client'
import { useAuthStore } from '../store/auth'
import { useTenantStore } from '../store/tenant'
import { STATUS_LABEL, TYPE_LABEL } from '../lib/config'

const STATUSES = [
  { value: '',                label: 'ทั้งหมด' },
  { value: 'draft',           label: 'ร่าง' },
  { value: 'in_progress',     label: 'กำลังทำ' },
  { value: 'pending_admin',   label: 'รอ Admin' },
  { value: 'pending_approval',label: 'รออนุมัติ' },
  { value: 'approved',        label: 'อนุมัติแล้ว' },
  { value: 'rejected',        label: 'ตีกลับ' },
]

const TYPES = [
  { value: '', label: 'ทุกประเภท' },
  { value: 'major', label: 'ล้างใหญ่' },
  { value: 'minor', label: 'ล้างย่อย' },
  { value: 'fan',   label: 'ล้างพัดลม' },
]

export default function WorkOrderList() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const tenant = useTenantStore()

  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [wos, setWos] = useState([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(searchParams.get('status') || '')
  const [type, setType]     = useState('')
  const [search, setSearch] = useState('')

  // Load clients once. On a branch, data is scoped by X-Branch — use the slug as
  // a truthy clientId (backend ignores it) and skip the picker.
  useEffect(() => {
    if (tenant.isBranch) { setClientId(tenant.slug); return }
    api.get('/master/clients').then((r) => {
      setClients(r.data)
      if (r.data.length === 1) setClientId(String(r.data[0].id))
    }).catch(() => {})
  }, [tenant.isBranch, tenant.slug])

  // Load work orders whenever filter changes
  const load = useCallback(() => {
    if (!clientId) { setWos([]); return }
    setLoading(true)
    const params = new URLSearchParams({ client_id: clientId, limit: 200 })
    if (status) params.append('status', status)
    if (type)   params.append('type', type)
    api.get(`/work-orders?${params}`)
      .then((r) => setWos(r.data))
      .catch(() => setWos([]))
      .finally(() => setLoading(false))
  }, [clientId, status, type])

  useEffect(() => { load() }, [load])

  const filtered = wos.filter((w) =>
    !search ||
    w.order_no?.toLowerCase().includes(search.toLowerCase()) ||
    w.site_name?.toLowerCase().includes(search.toLowerCase()) ||
    w.client_name?.toLowerCase().includes(search.toLowerCase()) ||
    w.hospital_name?.toLowerCase().includes(search.toLowerCase())
  )

  const canCreate = ['admin', 'technician'].includes(user?.role)

  return (
    <Layout
      title="ใบงานทั้งหมด"
      actions={
        canCreate && (
          <button
            onClick={() => navigate('/work-orders/new')}
            className="btn-primary flex items-center gap-1.5 text-sm py-2"
          >
            <Plus className="h-4 w-4" /> เปิดใบงาน
          </button>
        )
      }
    >
      <div className="p-4 flex flex-col gap-4">

        {/* Client selector — hidden on a branch (data scoped by X-Branch) */}
        {!tenant.isBranch && (
          <div>
            <label className="label">Client *</label>
            <select
              className="input max-w-xs"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">-- เลือก Client --</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
            <input
              className="input pl-9"
              placeholder="ค้นหาเลขที่ใบงาน, Site..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                onClick={() => setStatus(s.value)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  status === s.value
                    ? 'bg-primary text-white border-primary'
                    : 'bg-surface text-ink-muted border-line hover:border-primary'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setType(t.value)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  type === t.value
                    ? 'bg-primary text-white border-primary'
                    : 'bg-surface text-ink-muted border-line hover:border-primary'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-line border-t-primary" />
            </div>
          ) : !clientId ? (
            <p className="py-16 text-center text-ink-muted text-sm">เลือก Client ก่อนเพื่อดูใบงาน</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-page border-b border-line">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">เลขที่ใบงาน</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">Client / Site</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">ประเภท</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">สถานะ</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">เครื่อง</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">รูป</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">วันที่</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-ink-muted">ไม่พบใบงาน</td>
                    </tr>
                  )}
                  {filtered.map((wo) => {
                    const s = STATUS_LABEL[wo.status] || { label: wo.status, color: 'badge-gray' }
                    const t = TYPE_LABEL[wo.type]    || { label: wo.type,   color: 'badge-gray' }
                    return (
                      <tr
                        key={wo.id}
                        onClick={() => navigate(`/work-orders/${wo.id}`)}
                        className="hover:bg-primary-soft/40 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4 font-semibold text-primary">{wo.order_no || `#${wo.id}`}</td>
                        <td className="py-3 px-4 text-ink">
                          <p className="text-xs text-ink-muted">{wo.client_name || wo.hospital_name}</p>
                          <p>{wo.site_name || '-'}</p>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`badge ${t.color}`}>{t.label}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`badge ${s.color}`}>{s.label}</span>
                        </td>
                        <td className="py-3 px-4 text-ink-muted">{wo.item_count ?? (wo.items?.length ?? '-')}</td>
                        <td className="py-3 px-4 text-ink-muted">{wo.photo_count ?? '-'}</td>
                        <td className="py-3 px-4 text-ink-muted text-xs">{dayjs(wo.created_at).format('DD/MM/YY HH:mm')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="text-xs text-ink-muted">{filtered.length} รายการ</p>
      </div>
    </Layout>
  )
}
