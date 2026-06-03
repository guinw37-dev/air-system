import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileText, Download } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api, { uploadsBase } from '../api/client'

const WORK_TYPE_LABEL = {
  major: 'ล้างใหญ่',
  minor: 'ล้างย่อย',
  fan:   'ล้างพัดลม',
}

const RESULT_LABEL = {
  ok:     { label: 'เรียบร้อย',     color: 'badge-success' },
  not_ok: { label: 'ไม่เรียบร้อย', color: 'badge-danger' },
}

function photoSrc(url) {
  if (!url) return ''
  if (/^https?:|^data:/.test(url)) return url
  return `${uploadsBase || ''}${url.startsWith('/') ? '' : '/'}${url}`
}

export default function SimpleWoDetail() {
  const { id } = useParams()

  const [wo, setWo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get(`/simple-wo/${id}`)
      .then((r) => setWo(r.data))
      .catch((e) => setError(e.response?.data?.error || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false))
  }, [id])

  const downloadPdf = async () => {
    setBusy(true)
    try {
      const res = await api.get(`/simple-wo/${id}/pdf`, { responseType: 'blob' })
      // Backend may return an HTML fallback (X-PDF-Fallback) — blob is still openable
      const blob = res.data
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
    } catch {
      alert('ดาวน์โหลด PDF ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const exportExcel = async () => {
    setBusy(true)
    try {
      const d = wo.work_date ? dayjs(wo.work_date).format('YYYY-MM-DD') : ''
      const params = new URLSearchParams()
      if (d) { params.append('date_from', d); params.append('date_to', d) }
      const qs = params.toString()
      const res = await api.get(`/simple-wo/export/excel${qs ? `?${qs}` : ''}`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${wo.wo_number || `simple-wo-${id}`}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      alert('ดาวน์โหลด Excel ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <PageSpinner />
  if (!wo) return <div className="p-4 text-danger">{error || 'ไม่พบใบงาน'}</div>

  const cv = wo.checklist_values || {}
  const tc = wo.team_comment || {}
  const photos = Array.isArray(wo.photo_urls) ? wo.photo_urls : []
  const result = RESULT_LABEL[wo.result]
  const dateVal = wo.work_date || wo.created_at

  return (
    <Layout
      title={wo.wo_number || `ใบงาน #${id}`}
      back="/simple-wo"
      actions={
        <button onClick={downloadPdf} disabled={busy} className="p-1 rounded-lg text-ink-muted hover:bg-page">
          <FileText className="h-5 w-5" />
        </button>
      }
    >
      <div className="px-4 pt-4 pb-8 flex flex-col gap-4 max-w-2xl mx-auto w-full">

        {/* WO number badge */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="badge badge-primary text-sm px-3 py-1">{wo.wo_number || `#${id}`}</span>
          {result && <span className={`badge ${result.color}`}>{result.label}</span>}
        </div>

        {/* Header info */}
        <div className="card">
          <InfoRow label="ช่าง" value={wo.tech_name} />
          <InfoRow label="วันที่" value={dateVal ? dayjs(dateVal).format('DD/MM/YYYY') : '-'} />
          <InfoRow label="ลูกค้า" value={wo.client_name} />
          <InfoRow label="อาคาร" value={wo.building} />
          <InfoRow label="ชั้น" value={wo.floor} />
          <InfoRow label="ห้อง" value={wo.room} />
          <InfoRow label="เลขเครื่อง" value={wo.asset_code} />
          <InfoRow label="ประเภทงาน" value={WORK_TYPE_LABEL[wo.work_type] || wo.work_type} />
          <InfoRow label="ระบบไฟ" value={wo.power_system ? `${wo.power_system}V` : '-'} />
          <InfoRow label="เวลาเริ่ม" value={wo.start_time} />
          <InfoRow label="เวลาเสร็จ" value={wo.end_time} />
        </div>

        {/* Checklist values */}
        {Object.keys(cv).length > 0 && (
          <div className="card">
            <h2 className="section-header mb-3">รายการตรวจ</h2>
            <div className="flex flex-col gap-2">
              {Object.entries(cv).map(([fid, val]) => (
                <div key={fid} className="text-sm border-b border-line last:border-0 pb-2 last:pb-0">
                  <p className="text-xs text-ink-muted mb-0.5">{fid}</p>
                  <p className="text-ink break-words">{summarizeValue(val)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Team comment */}
        <div className="card">
          <h2 className="section-header mb-3">ความเห็นทีมช่าง</h2>
          <div className="flex flex-col gap-1.5 text-sm">
            <Flag on={tc.ac_degraded} label="แอร์เสื่อมสภาพ" />
            <Flag on={tc.ac_old_5_7yr} label="แอร์อายุ 5-7 ปี" />
            <Flag on={tc.external_degraded} label={`คอยล์ร้อนเสื่อม${tc.external_detail ? ` — ${tc.external_detail}` : ''}`} />
            <Flag on={tc.internal_degraded} label={`คอยล์เย็นเสื่อม${tc.internal_detail ? ` — ${tc.internal_detail}` : ''}`} />
          </div>
        </div>

        {/* Photos */}
        {photos.length > 0 && (
          <div className="card">
            <h2 className="section-header mb-3">รูปภาพ ({photos.length})</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {photos.map((p, i) => (
                <a key={i} href={photoSrc(p.url)} target="_blank" rel="noreferrer" className="relative block">
                  <img src={photoSrc(p.url)} alt="" className="w-full aspect-square object-cover rounded-lg border border-line" />
                  {p.label && <span className="absolute top-1 left-1 badge badge-primary text-[10px] px-1.5 py-0">{p.label}</span>}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Signatures */}
        <div className="card">
          <h2 className="section-header mb-3">ลายเซ็น</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SigBox label="วิศวกรรม" name={wo.sig_engineer_name} data={wo.sig_engineer} />
            <SigBox label="หน่วยงาน" name={wo.sig_department_name} data={wo.sig_department} />
            <SigBox label="ทีมช่าง" name={wo.sig_team_name} data={wo.sig_team} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={downloadPdf} disabled={busy} className="btn-primary flex-1 flex items-center justify-center gap-2">
            <FileText className="h-5 w-5" /> ดาวน์โหลด PDF
          </button>
          <button onClick={exportExcel} disabled={busy} className="btn-secondary flex-1 flex items-center justify-center gap-2">
            <Download className="h-4 w-4" /> Export Excel แถวนี้
          </button>
        </div>
      </div>
    </Layout>
  )
}

function summarizeValue(val) {
  if (!val || typeof val !== 'object') return String(val ?? '-')
  if ('checked' in val) return `${val.checked ? '✓' : '✗'}${val.note ? ` — ${val.note}` : ''}`
  const parts = Object.entries(val)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}: ${v}`)
  return parts.length ? parts.join(' · ') : '-'
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-line last:border-0">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-xs text-ink font-medium text-right max-w-[60%] truncate">{value || '-'}</span>
    </div>
  )
}

function Flag({ on, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className={on ? 'text-success' : 'text-ink-muted'}>{on ? '✓' : '—'}</span>
      <span className={on ? 'text-ink' : 'text-ink-muted'}>{label}</span>
    </div>
  )
}

function SigBox({ label, name, data }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-ink-muted">{label}</p>
      {data ? (
        <img src={data} alt="sig" className="h-16 w-full object-contain border border-line rounded-lg bg-white" />
      ) : (
        <div className="h-16 w-full border border-dashed border-line rounded-lg flex items-center justify-center text-xs text-ink-muted">
          ยังไม่ได้เซ็น
        </div>
      )}
      {name && <p className="text-xs text-ink text-center font-medium">{name}</p>}
    </div>
  )
}
