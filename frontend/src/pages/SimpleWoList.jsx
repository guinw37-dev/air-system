import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, Camera } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import api from '../api/client'

const WORK_TYPE_LABEL = {
  major: { label: 'ล้างใหญ่',  color: 'badge-primary' },
  minor: { label: 'ล้างย่อย',  color: 'bg-indigo-50 text-indigo-600' },
  fan:   { label: 'ล้างพัดลม', color: 'badge-success' },
}

const RESULT_LABEL = {
  ok:     { label: 'เรียบร้อย',     color: 'badge-success' },
  not_ok: { label: 'ไม่เรียบร้อย', color: 'badge-danger' },
}

export default function SimpleWoList() {
  const navigate = useNavigate()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState(false)

  const load = () => {
    setLoading(true)
    api.get('/simple-wo')
      .then((r) => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const exportExcel = async () => {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      if (dateFrom) params.append('date_from', dateFrom)
      if (dateTo)   params.append('date_to', dateTo)
      const qs = params.toString()
      const res = await api.get(`/simple-wo/export/excel${qs ? `?${qs}` : ''}`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `simple-wo-${dayjs().format('YYYYMMDD-HHmm')}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      alert('ดาวน์โหลด Excel ไม่สำเร็จ')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Layout
      title="ใบงาน (ง่าย)"
      actions={
        <button
          onClick={() => navigate('/simple-wo/new')}
          className="btn-primary flex items-center gap-1.5 text-sm py-2"
        >
          <Plus className="h-4 w-4" /> เปิดใบงานใหม่
        </button>
      }
    >
      <div className="p-4 flex flex-col gap-4">

        {/* Prominent open-new button */}
        <button
          onClick={() => navigate('/simple-wo/new')}
          className="btn-primary w-full flex items-center justify-center gap-2 text-base py-3"
        >
          <Plus className="h-5 w-5" /> เปิดใบงานใหม่
        </button>

        {/* Export Excel */}
        <div className="card flex flex-col sm:flex-row sm:items-end gap-3">
          <div>
            <label className="label">วันที่เริ่ม</label>
            <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">วันที่สิ้นสุด</label>
            <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <button
            onClick={exportExcel}
            disabled={exporting}
            className="btn-secondary flex items-center justify-center gap-1.5 sm:ml-auto"
          >
            <Download className="h-4 w-4" /> {exporting ? 'กำลังโหลด...' : 'Export Excel'}
          </button>
        </div>

        {/* Table */}
        <div className="card overflow-hidden p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-line border-t-primary" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-page border-b border-line">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">เลขใบงาน</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">วันที่</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">ช่าง</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">ลูกค้า</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">เครื่อง</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">ประเภท</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">ผลงาน</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">รูป</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-ink-muted">ไม่พบใบงาน</td>
                    </tr>
                  )}
                  {rows.map((wo) => {
                    const t = WORK_TYPE_LABEL[wo.work_type] || { label: wo.work_type, color: 'badge-gray' }
                    const r = RESULT_LABEL[wo.result]
                    const dateVal = wo.work_date || wo.created_at
                    return (
                      <tr
                        key={wo.id}
                        onClick={() => navigate(`/simple-wo/${wo.id}`)}
                        className="hover:bg-primary-soft/40 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4 font-semibold text-primary">{wo.wo_number || `#${wo.id}`}</td>
                        <td className="py-3 px-4 text-ink-muted text-xs">{dateVal ? dayjs(dateVal).format('DD/MM/YY') : '-'}</td>
                        <td className="py-3 px-4 text-ink">{wo.tech_name || '-'}</td>
                        <td className="py-3 px-4 text-ink">
                          <p>{wo.client_name || '-'}</p>
                          {wo.building && <p className="text-xs text-ink-muted">{wo.building}</p>}
                        </td>
                        <td className="py-3 px-4 text-ink-muted">{wo.asset_code || '-'}</td>
                        <td className="py-3 px-4">
                          <span className={`badge ${t.color}`}>{t.label}</span>
                        </td>
                        <td className="py-3 px-4">
                          {r ? <span className={`badge ${r.color}`}>{r.label}</span> : <span className="text-ink-muted text-xs">-</span>}
                        </td>
                        <td className="py-3 px-4 text-ink-muted">
                          <span className="inline-flex items-center gap-1">
                            <Camera className="h-3.5 w-3.5" /> {wo.photo_count ?? 0}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="text-xs text-ink-muted">{rows.length} รายการ</p>
      </div>
    </Layout>
  )
}
