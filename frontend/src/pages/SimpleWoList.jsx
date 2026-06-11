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

// Approval workflow status. approved = locked + billable.
const STATUS_LABEL = {
  submitted: { label: 'รอตรวจ',  color: 'badge-warn' },
  checked:   { label: 'ตรวจแล้ว', color: 'badge-primary' },
  approved:  { label: 'อนุมัติ',  color: 'badge-success' },
  rejected:  { label: 'ส่งกลับ',  color: 'badge-danger' },
}

const SLOT_LABEL = { technician: 'ช่างแอร์', supervisor: 'หัวหน้าช่างแอร์', building: 'เจ้าหน้าที่ช่างอาคาร', approver: 'เจ้าหน้าวิศวกรรม' }

export default function SimpleWoList() {
  const navigate = useNavigate()
  const { user } = useAuthStore()

  const role = user?.role
  const canSign = !!SLOT_LABEL[role]
  const canBill = role === 'admin' || role === 'super_admin'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  // List filter + sort (client-side)
  const [fType, setFType] = useState('')     // '' | major | minor | fan
  const [fClient, setFClient] = useState('') // '' | client_name
  const [fResult, setFResult] = useState('') // '' | ok | not_ok
  const [fStatus, setFStatus] = useState('') // '' | submitted | checked | approved | rejected
  const [sortBy, setSortBy] = useState('date_desc') // date_desc|date_asc|wo_asc|wo_desc

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
  // Editable cover sheet
  const [coverOpen, setCoverOpen] = useState(false)
  const [cover, setCover] = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/simple-wo')
      .then((r) => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // Distinct client names for the filter dropdown.
  const clientOptions = [...new Set(rows.map((r) => r.client_name).filter(Boolean))].sort()

  // Apply filters + sort to produce the rows actually rendered.
  const visibleRows = rows
    .filter((r) => (!fType || r.work_type === fType)
      && (!fClient || r.client_name === fClient)
      && (!fResult || r.result === fResult)
      && (!fStatus || (r.status || 'submitted') === fStatus))
    .sort((a, b) => {
      if (sortBy === 'wo_asc') return String(a.wo_number || '').localeCompare(String(b.wo_number || ''))
      if (sortBy === 'wo_desc') return String(b.wo_number || '').localeCompare(String(a.wo_number || ''))
      const da = new Date(a.work_date || a.created_at || 0).getTime()
      const db = new Date(b.work_date || b.created_at || 0).getTime()
      return sortBy === 'date_asc' ? da - db : db - da
    })

  const hasFilter = fType || fClient || fResult || fStatus
  const clearFilters = () => { setFType(''); setFClient(''); setFResult(''); setFStatus('') }

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

  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id))
  const toggleAll = () => {
    setSelected((prev) => {
      if (visibleRows.length > 0 && visibleRows.every((r) => prev.has(r.id))) return new Set()
      return new Set(visibleRows.map((r) => r.id))
    })
  }

  const clearSelection = () => setSelected(new Set())

  // ── Batch bill (PDF) ───────────────────────────────────────────────
  // Open the editable cover sheet, prefilling from the selected rows.
  const openBillModal = () => {
    const sel = rows.filter((r) => selected.has(r.id))
    // วางบิลได้เฉพาะใบที่อนุมัติแล้ว (lock).
    const notApproved = sel.filter((r) => (r.status || 'submitted') !== 'approved')
    if (notApproved.length) {
      alert(`วางบิลได้เฉพาะใบที่อนุมัติแล้ว — ยังไม่อนุมัติ ${notApproved.length} ใบ:\n${notApproved.map((r) => r.wo_number || r.id).join(', ')}`)
      return
    }
    const clients = [...new Set(sel.map((r) => r.client_name).filter(Boolean))]
    const fmt = (v) => (v ? new Date(v).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '')
    const dates = sel.map((r) => r.work_date || r.created_at).filter(Boolean).sort()
    const range = dates.length
      ? (fmt(dates[0]) === fmt(dates[dates.length - 1]) ? fmt(dates[0]) : `${fmt(dates[0])} – ${fmt(dates[dates.length - 1])}`)
      : ''
    const today = new Date().toISOString().slice(0, 10)
    setCover({
      client_name: clients.length === 1 ? clients[0] : `${clients.length} โรงพยาบาล`,
      doc_no: '',
      issue_date: today,
      date_range: range,
      note: '',
    })
    setCoverOpen(true)
  }

  const handleBatchPdf = async () => {
    setBilling(true)
    try {
      const res = await api.post('/simple-wo/batch-pdf', { ids: [...selected], cover: cover || {} }, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      setPdfUrl(url)
      setCoverOpen(false)
    } catch (err) {
      // responseType:'blob' means an error body arrives as a Blob, so the real
      // server message is hidden — read it back out for a useful alert.
      let msg = 'ออกเอกสารไม่สำเร็จ'
      const data = err.response?.data
      if (data instanceof Blob) {
        try { msg = JSON.parse(await data.text()).error || msg } catch { /* not JSON */ }
      } else if (data?.error) {
        msg = data.error
      } else if (err.message) {
        msg = `ออกเอกสารไม่สำเร็จ (${err.message})`
      }
      alert(msg) // modal stays open so the user can retry without re-entering
    } finally {
      setBilling(false)
    }
  }

  const closePdf = () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    setPdfUrl(null)
  }

  const setCoverField = (k, v) => setCover((c) => ({ ...(c || {}), [k]: v }))

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

        {/* Filter + sort */}
        <div className="card flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="section-header">กรอง / เรียงลำดับ</h2>
            {hasFilter && (
              <button onClick={clearFilters} className="text-xs text-ink-muted hover:text-ink underline">
                ล้างตัวกรอง
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label className="label">สถานะ</label>
              <select className="input" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                <option value="">ทั้งหมด</option>
                <option value="submitted">รอตรวจ</option>
                <option value="checked">ตรวจแล้ว</option>
                <option value="approved">อนุมัติ</option>
                <option value="rejected">ส่งกลับ</option>
              </select>
            </div>
            <div>
              <label className="label">ประเภท</label>
              <select className="input" value={fType} onChange={(e) => setFType(e.target.value)}>
                <option value="">ทั้งหมด</option>
                <option value="major">ล้างใหญ่</option>
                <option value="minor">ล้างย่อย</option>
                <option value="fan">ล้างพัดลม</option>
              </select>
            </div>
            <div>
              <label className="label">ลูกค้า</label>
              <select className="input" value={fClient} onChange={(e) => setFClient(e.target.value)}>
                <option value="">ทั้งหมด</option>
                {clientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">ผลงาน</label>
              <select className="input" value={fResult} onChange={(e) => setFResult(e.target.value)}>
                <option value="">ทั้งหมด</option>
                <option value="ok">เรียบร้อย</option>
                <option value="not_ok">ไม่เรียบร้อย</option>
              </select>
            </div>
            <div>
              <label className="label">เรียงตาม</label>
              <select className="input" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="date_desc">วันที่ ใหม่→เก่า</option>
                <option value="date_asc">วันที่ เก่า→ใหม่</option>
                <option value="wo_desc">เลขใบงาน มาก→น้อย</option>
                <option value="wo_asc">เลขใบงาน น้อย→มาก</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-ink-muted">แสดง {visibleRows.length} จาก {rows.length} ใบงาน</p>
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
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">สถานะ</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">ผลงาน</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase tracking-wide">รูป</th>
                    <th className="py-3 px-4"><span className="sr-only">ลบ</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-16">
                        <div className="flex flex-col items-center gap-3 text-ink-muted">
                          <FileText className="h-8 w-8 opacity-40" />
                          <p className="text-sm">{rows.length === 0 ? 'ยังไม่มีใบงาน' : 'ไม่พบใบงานตามตัวกรอง'}</p>
                          {rows.length === 0 ? (
                            <button
                              onClick={() => navigate('/simple-wo/new')}
                              className="btn-secondary flex items-center gap-1.5 text-sm"
                            >
                              <Plus className="h-4 w-4" /> เปิดใบงานใหม่
                            </button>
                          ) : (
                            <button onClick={clearFilters} className="btn-secondary text-sm">ล้างตัวกรอง</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  {visibleRows.map((wo) => {
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
                          {(() => { const s = STATUS_LABEL[wo.status || 'submitted']; return s ? <span className={`badge ${s.color}`}>{s.label}</span> : <span className="text-ink-muted text-xs">-</span> })()}
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
                onClick={openBillModal}
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

      {/* Editable cover sheet modal */}
      {coverOpen && cover && (
        <Modal title="ใบปะหน้า — วางบิล" onClose={() => setCoverOpen(false)}>
          <div className="space-y-3">
            <div>
              <label className="label">ลูกค้า</label>
              <input className="input" value={cover.client_name} onChange={(e) => setCoverField('client_name', e.target.value)} />
            </div>
            <div>
              <label className="label">เลขที่เอกสาร</label>
              <input className="input" placeholder="เว้นว่าง = สร้างอัตโนมัติ" value={cover.doc_no} onChange={(e) => setCoverField('doc_no', e.target.value)} />
            </div>
            <div>
              <label className="label">วันที่ออกเอกสาร</label>
              <input type="date" className="input" value={cover.issue_date} onChange={(e) => setCoverField('issue_date', e.target.value)} />
            </div>
            <div>
              <label className="label">ช่วงปฏิบัติงาน</label>
              <input className="input" value={cover.date_range} onChange={(e) => setCoverField('date_range', e.target.value)} />
            </div>
            <div>
              <label className="label">หมายเหตุ</label>
              <textarea className="input" rows={3} placeholder="เว้นว่างได้" value={cover.note} onChange={(e) => setCoverField('note', e.target.value)} />
            </div>
            <button onClick={handleBatchPdf} disabled={billing} className="btn-primary w-full flex items-center justify-center gap-1.5">
              <FileText className="h-4 w-4" />
              {billing ? 'กำลังสร้าง...' : 'แสดงตัวอย่าง'}
            </button>
          </div>
        </Modal>
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
              <button
                onClick={() => { closePdf(); setCoverOpen(true) }}
                className="btn-secondary flex items-center gap-1.5"
              >
                แก้ไขใบปะหน้า
              </button>
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
