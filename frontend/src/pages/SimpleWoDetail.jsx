import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { FileText, Download, Trash2, Pencil } from 'lucide-react'
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
  const navigate = useNavigate()

  const [wo, setWo] = useState(null)
  const [schema, setSchema] = useState({ sections: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get(`/simple-wo/${id}`)
      .then((r) => setWo(r.data))
      .catch((e) => setError(e.response?.data?.error || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false))
  }, [id])

  // Load the checklist schema (labels + categories) for this WO's work_type so
  // the values render with their item names instead of raw template ids.
  useEffect(() => {
    if (!wo?.work_type) return
    api.get(`/simple-wo/form-schema?work_type=${wo.work_type}`)
      .then((r) => setSchema(r.data && Array.isArray(r.data.sections) ? r.data : { sections: [] }))
      .catch(() => setSchema({ sections: [] }))
  }, [wo?.work_type])

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

  const remove = async () => {
    if (!window.confirm('ลบใบงานนี้? ลบแล้วกู้คืนไม่ได้')) return
    setBusy(true)
    try {
      await api.delete(`/simple-wo/${id}`)
      navigate('/simple-wo')
    } catch (err) {
      alert(err.response?.data?.error || 'ลบใบงานไม่สำเร็จ')
      setBusy(false)
    }
  }

  if (loading) return <PageSpinner />
  if (!wo) return <div className="p-4 text-danger">{error || 'ไม่พบใบงาน'}</div>

  const cv = wo.checklist_values || {}
  const tc = wo.team_comment || {}
  const ac = wo.ac_info || {}
  const AC_KIND_LABEL = { water: 'แอร์น้ำ', refrigerant: 'แอร์น้ำยา', other: 'อื่นๆ' }
  const photos = Array.isArray(wo.photo_urls) ? wo.photo_urls : []
  const gallery = Array.isArray(wo.gallery_urls) ? wo.gallery_urls : []
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
          <h2 className="section-header mb-3">ข้อมูลทั่วไป</h2>
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

        {/* AC info (รายละเอียดเครื่องปรับอากาศ) */}
        <div className="card">
          <h2 className="section-header mb-3">รายละเอียดเครื่องปรับอากาศ</h2>
          <InfoRow label="รายละเอียดเครื่อง" value={ac.detail} />
          <InfoRow label="ตำแหน่งที่ติดตั้ง" value={ac.location} />
          <InfoRow label="ชนิดเครื่อง" value={AC_KIND_LABEL[ac.kind] || '-'} />
          <InfoRow label="ยี่ห้อ" value={ac.brand} />
          <InfoRow label="รุ่น" value={ac.model} />
          <InfoRow label="ขนาดทำความเย็น (BTU)" value={ac.cooling_size} />
        </div>

        {/* Checklist values — grouped by section, with item labels */}
        {schema.sections.map((section) => (
          <div key={section.key} className="card">
            <h2 className="section-header mb-3">{section.label}</h2>
            <div className="flex flex-col gap-2">
              {(section.fields || []).map((field) => (
                <div key={field.id} className="text-sm border-b border-line last:border-0 pb-2 last:pb-0">
                  <p className="text-ink mb-0.5">{field.item_label}{field.unit_label ? ` (${field.unit_label})` : ''}</p>
                  <p className="text-ink-muted break-words">{formatFieldValue(field, cv[field.id])}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        {schema.sections.length === 0 && Object.keys(cv).length > 0 && (
          <div className="card">
            <h2 className="section-header mb-3">รายการตรวจ</h2>
            <div className="flex flex-col gap-2">
              {Object.entries(cv).map(([fid, val]) => (
                <div key={fid} className="text-sm border-b border-line last:border-0 pb-2 last:pb-0">
                  <p className="text-ink-muted break-words">{summarizeValue(val)}</p>
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

        {/* Photos — grouped ก่อน / หลัง */}
        {photos.length > 0 && (
          <div className="card flex flex-col gap-4">
            <h2 className="section-header">รูปภาพ ({photos.length})</h2>
            <PhotoGroup title="ก่อน (Before)" tone="teal" items={photos.filter((p) => p.phase === 'before')} />
            <PhotoGroup title="หลัง (After)" tone="navy" items={photos.filter((p) => p.phase === 'after')} />
            <PhotoGroup title="อื่น ๆ" tone="muted" items={photos.filter((p) => !['before', 'after'].includes(p.phase))} />
          </div>
        )}

        {/* Gallery (คลังรูป) — extra album photos, not in the PDF */}
        {gallery.length > 0 && (
          <div className="card flex flex-col gap-3">
            <h2 className="section-header">คลังรูป (เพิ่มเติม) ({gallery.length})</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {gallery.map((p, i) => (
                <a key={i} href={photoSrc(p.url)} target="_blank" rel="noreferrer" className="block">
                  <img src={photoSrc(p.url)} alt="" className="w-full aspect-square object-cover rounded-lg border border-line" />
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
        <button
          onClick={() => navigate(`/simple-wo/${id}/edit`)}
          disabled={busy}
          className="btn-secondary w-full flex items-center justify-center gap-2"
        >
          <Pencil className="h-4 w-4" /> แก้ไขใบงาน
        </button>
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={downloadPdf} disabled={busy} className="btn-primary flex-1 flex items-center justify-center gap-2">
            <FileText className="h-5 w-5" /> ดาวน์โหลด PDF
          </button>
          <button onClick={exportExcel} disabled={busy} className="btn-secondary flex-1 flex items-center justify-center gap-2">
            <Download className="h-4 w-4" /> ส่งออก Excel ใบนี้
          </button>
        </div>

        {/* Delete */}
        <button
          onClick={remove}
          disabled={busy}
          className="btn-danger w-full flex items-center justify-center gap-2"
        >
          <Trash2 className="h-4 w-4" /> ลบใบงาน
        </button>
      </div>
    </Layout>
  )
}

// Format one checklist value by its field value_type → readable Thai string.
// Empty / unfilled → '—' (every item still shows, per the full-form rule).
function formatFieldValue(field, val) {
  const v = val || {}
  const g = (x) => (x === '' || x == null ? '—' : String(x))
  switch (field.value_type) {
    case 'check':
      return `${v.checked ? '✓ ผ่าน' : '— ไม่ได้ทำเครื่องหมาย'}${v.note ? ` · ${v.note}` : ''}`
    case 'number':
    case 'before_after':
      return `ก่อน ${g(v.value_before)} → หลัง ${g(v.value_after)}`
    case 'text':
      return g(v.val_text)
    case 'rst_amp': {
      const ps = v.power_system || '380'
      const ln = `LN/L — ก่อน ${g(v.val_ln_before)}V/${g(v.val_l_before)}A · หลัง ${g(v.val_ln_after)}V/${g(v.val_l_after)}A`
      if (String(ps) === '220') return `220V 1φ · ${ln}`
      const rst = `R/S/T — ก่อน ${g(v.val_r_before)}/${g(v.val_s_before)}/${g(v.val_t_before)} · หลัง ${g(v.val_r_after)}/${g(v.val_s_after)}/${g(v.val_t_after)} A`
      return `380V 3φ · ${rst} · ${ln}`
    }
    case 'ln_vi':
      return `LN ${g(v.val_ln_after)}V · L ${g(v.val_l_after)}A`
    case 'pressure_pair':
      return `น้ำยา ${g(v.refrigerant_type)} · Suction ${g(v.val_suction)} · Discharge ${g(v.val_discharge)} PSI`
    default:
      return summarizeValue(v)
  }
}

function summarizeValue(val) {
  if (!val || typeof val !== 'object') return String(val ?? '-')
  if ('checked' in val) return `${val.checked ? '✓' : '✗'}${val.note ? ` — ${val.note}` : ''}`
  const parts = Object.entries(val)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}: ${v}`)
  return parts.length ? parts.join(' · ') : '-'
}

function PhotoGroup({ title, tone, items }) {
  if (!items || items.length === 0) return null
  const bar = tone === 'teal' ? 'bg-primary' : tone === 'navy' ? 'bg-primary-dark' : 'bg-ink-muted'
  const text = tone === 'teal' ? 'text-primary' : tone === 'navy' ? 'text-primary-dark' : 'text-ink-muted'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={`inline-block w-1.5 h-4 rounded ${bar}`} />
        <span className={`text-sm font-semibold ${text}`}>{title}</span>
        <span className="text-xs text-ink-muted">({items.length})</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map((p, i) => (
          <a key={i} href={photoSrc(p.url)} target="_blank" rel="noreferrer" className="block">
            <img src={photoSrc(p.url)} alt="" className="w-full aspect-square object-cover rounded-xl border border-line" />
          </a>
        ))}
      </div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 border-b border-line last:border-0">
      <span className="text-xs text-ink-muted shrink-0">{label}</span>
      <span className="text-xs text-ink font-medium text-right max-w-[65%] break-words">{value || '-'}</span>
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
