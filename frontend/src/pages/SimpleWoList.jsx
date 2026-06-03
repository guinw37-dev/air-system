import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, Camera, Trash2, FileText, PenLine, Printer } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import SignaturePad from '../components/SignaturePad'
import api from '../api/client'
import { useAuthStore } from '../store/auth'

const WORK_TYPE_LABEL = {
  major: { label: 'ล้างใหญ่',  color: 'badge-primary' },
  minor: { label: 'ล้างย่อย',  color: 'bg-indigo-50 text-indigo-600' },
  fan:   { label: 'ล้างพัดลม', color: 'badge-success' },
}

const RESULT_LABEL = {
  ok:     { label: 'เรียบร้อย',     color: 'badge-success' },
  not_ok: { label: 'ไม่เรียบร้อย', color: 'badge-danger' },
}

const SLOT_LABEL = { approver: 'วิศวกรรม', checker: 'หน่วยงาน', technician: 'ทีมช่าง' }

export default function SimpleWoList() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const role = user?.role
  const canSign = !!SLOT_LABEL[role]
  const canBill = role === 'admin' || role === 'central_admin'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState(false)

  // Multi-select
  const [selected, setSelected] = useState(() => new Set())

  // Batch sign
  const [signing, setSigning] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [signLoading, setSignLoading] = useState(false)

  // Batch bill (PDF)
  const [pdfUrl, setPdfUrl] = useState(null)
  const [billing, setBilling] = useState(false)
  const iframeRef = useRef(null)

  const load = () => {
    setLoading(true)
    api.get('/simple-wo')
      .then((r) => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const remove = async (e, id) => {
    e.stopPropagation() // don't trigger row navigate
    if (!window.confirm('ลบใบงานนี้? ลบแล้วกู้คืนไม่ได้')) return
    try {
      await api.delete(`/simple-wo/${id}`)
      setRows((prev) => prev.filter((row) => row.id !== id))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } catch (err) {
      alert(err.response?.data?.error || 'ลบใบงานไม่สำเร็จ')
    }
  }

  // ── Selection helpers ──────────────────────────────────────────────
  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleAll = () => {
    setSelected((prev) => {
      if (rows.length > 0 && rows.every((r) => prev.has(r.id))) return new Set()
      return new Set(rows.map((r) => r.id))
    })
  }

  const clearSelection = () => setSelected(new Set())

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

  // ── Batch bill (PDF) ───────────────────────────────────────────────
  const handleBatchPdf = async () => {
    setBilling(true)
    try {
      const res = await api.post('/simple-wo/batch-pdf', { ids: [...selected] }, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      setPdfUrl(url)
    } catch (err) {
      alert(err.response?.data?.error || 'ออกเอกสารไม่สำเร็จ')
    } finally {
      setBilling(false)
    }
  }

  const closePdf = () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    setPdfUrl(null)
  }

  // ── Batch sign ─────────────────────────────────────────────────────
  const openSign = () => {
    setSignerName(user?.name || '')
    setSigning(true)
  }

  const handleBatchSign = async (dataUrl) => {
    setSignLoading(true)
    try {
      const count = selected.size
      await api.post('/simple-wo/batch-sign', {
        ids: [...selected],
        signature_data: dataUrl,
        signer_name: signerName,
      })
      alert(`เซ็นแล้ว ${count} ใบ (${SLOT_LABEL[role]})`)
      setSigning(false)
      clearSelection()
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'เซ็นไม่สำเร็จ')
    } finally {
      setSignLoading(false)
    }
  }

  const showBar = selected.size > 0 && (canSign || canBill)

  return (
    <Layout
      title="ใบงาน"
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
        <div className="card flex flex-col gap-3">
          <h2 className="section-header">ส่งออก Excel</h2>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
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
              <Download className="h-4 w-4" /> {exporting ? 'กำลังสร้าง...' : 'ส่งออก Excel'}
            </button>
          </div>
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
                    <th className="py-3 px-4 w-10">
                      <input
                        type="checkbox"
                        className="accent-primary h-4 w-4"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="เลือกทั้งหมด"
                      />
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">เลขใบงาน</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">วันที่</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">ช่าง</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">ลูกค้า</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">เครื่อง</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">ประเภท</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">ผลงาน</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">รูป</th>
                    <th className="py-3 px-4"><span className="sr-only">ลบ</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-16">
                        <div className="flex flex-col items-center gap-3 text-ink-muted">
                          <FileText className="h-8 w-8 opacity-40" />
                          <p className="text-sm">ยังไม่มีใบงาน</p>
                          <button
                            onClick={() => navigate('/simple-wo/new')}
                            className="btn-secondary flex items-center gap-1.5 text-sm"
                          >
                            <Plus className="h-4 w-4" /> เปิดใบงานใหม่
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {rows.map((wo) => {
                    const t = WORK_TYPE_LABEL[wo.work_type] || { label: wo.work_type, color: 'badge-gray' }
                    const r = RESULT_LABEL[wo.result]
                    const dateVal = wo.work_date || wo.created_at
                    const checked = selected.has(wo.id)
                    return (
                      <tr
                        key={wo.id}
                        onClick={() => navigate(`/simple-wo/${wo.id}`)}
                        className={`hover:bg-primary-soft/40 cursor-pointer transition-colors ${checked ? 'bg-primary-soft/30' : ''}`}
                      >
                        <td className="py-3 px-4 w-10">
                          <input
                            type="checkbox"
                            className="accent-primary h-4 w-4"
                            checked={checked}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleOne(wo.id)}
                            aria-label={`เลือกใบงาน ${wo.wo_number || wo.id}`}
                          />
                        </td>
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
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => remove(e, wo.id)}
                            title="ลบใบงาน"
                            aria-label="ลบใบงาน"
                            className="p-1.5 rounded-lg text-ink-muted hover:bg-danger-soft hover:text-danger transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {rows.length > 0 && <p className="text-xs text-ink-muted">ทั้งหมด {rows.length} รายการ</p>}
      </div>

      {/* Sticky batch action bar */}
      {showBar && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-line bg-white/95 backdrop-blur px-4 py-3 shadow-[0_-2px_12px_rgba(0,0,0,0.08)]">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <span className="text-sm text-ink-muted">เลือก {selected.size} ใบ</span>
            <div className="flex-1" />
            <button onClick={clearSelection} className="text-sm text-ink-muted hover:text-ink px-2">
              ยกเลิก
            </button>
            {canBill ? (
              <button
                onClick={handleBatchPdf}
                disabled={billing}
                className="btn-primary flex items-center gap-1.5"
              >
                <FileText className="h-4 w-4" />
                {billing ? 'กำลังออกเอกสาร...' : `วางบิล (${selected.size})`}
              </button>
            ) : canSign ? (
              <button
                onClick={openSign}
                className="btn-primary flex items-center gap-1.5"
              >
                <PenLine className="h-4 w-4" />
                {`เซ็นชุด (${selected.size}) — ${SLOT_LABEL[role]}`}
              </button>
            ) : null}
          </div>
        </div>
      )}

      {/* Signature modal */}
      {signing && (
        <Modal title={`เซ็นชุด — ${SLOT_LABEL[role] || ''}`} onClose={() => setSigning(false)}>
          <div className="mb-3">
            <label className="label">ชื่อผู้ลงนาม</label>
            <input
              className="input"
              placeholder="ชื่อผู้ลงนาม"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
            />
          </div>
          <SignaturePad onSave={handleBatchSign} onCancel={() => setSigning(false)} />
          {signLoading && <p className="text-xs text-ink-muted mt-2 text-center">กำลังบันทึก...</p>}
        </Modal>
      )}

      {/* PDF preview modal */}
      {pdfUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={closePdf} />
          <div className="relative bg-white rounded-2xl w-full max-w-4xl p-5 max-h-[90vh] overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-ink">ตัวอย่างก่อนพิมพ์</h3>
              <button onClick={closePdf} className="text-ink-muted text-2xl leading-none">&times;</button>
            </div>
            <iframe
              ref={iframeRef}
              src={pdfUrl}
              className="w-full rounded-xl border border-line"
              style={{ height: '70vh' }}
              title="preview"
            />
            <div className="flex flex-wrap gap-2 mt-4">
              <button
                onClick={() => iframeRef.current?.contentWindow?.print()}
                className="btn-primary flex items-center gap-1.5"
              >
                <Printer className="h-4 w-4" /> พิมพ์
              </button>
              <a
                href={pdfUrl}
                download="วางบิล.pdf"
                className="btn-secondary flex items-center gap-1.5"
              >
                <Download className="h-4 w-4" /> ดาวน์โหลด
              </a>
              <button onClick={closePdf} className="btn-secondary ml-auto">ปิด</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-ink">{title}</h3>
          <button onClick={onClose} className="text-ink-muted text-2xl leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  )
}
