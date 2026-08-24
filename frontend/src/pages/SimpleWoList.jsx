import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Download, Camera, Trash2, FileText, PenLine, Printer } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import SignaturePad from '../components/SignaturePad'
import api from '../api/client'
import { useAuthStore } from '../store/auth'
import { useHasZones } from '../lib/zones'
import { useTenantStore } from '../store/tenant'
import { waitingBadge } from '../lib/signStage'

const WORK_TYPE_LABEL = {
  major: { label: 'ล้างใหญ่',  color: 'badge-primary' },
  minor: { label: 'ล้างย่อย',  color: 'bg-indigo-50 text-indigo-600' },
  fan:   { label: 'ล้างพัดลม', color: 'badge-success' },
}

const RESULT_LABEL = {
  ok:     { label: 'เรียบร้อย',     color: 'badge-success' },
  not_ok: { label: 'ไม่เรียบร้อย', color: 'badge-danger' },
}

const STATUS_LABEL = {
  submitted: { label: 'รอเซ็น',  color: 'badge-warn' },
  checked:   { label: 'รอเซ็น',  color: 'badge-warn' },
  approved:  { label: 'วางบิลแล้ว', color: 'badge-success' },
  rejected:  { label: 'ส่งกลับ',  color: 'badge-danger' },
}
// Status shown in the list — ทุกช่องที่ยังค้าง รวมไว้ป้ายเดียว (ช่องคู่ขนานทำให้
// ใบเดียวรอได้หลายคน) ผ่าน helper กลางที่หน้าใบงานก็ใช้ตัวเดียวกัน
const DONE_BADGE = { label: 'ดำเนินการเสร็จสิ้น', color: 'badge-success' }
const statusBadge = (wo) => {
  const st = wo.status || 'submitted'
  if (st === 'approved') return STATUS_LABEL.approved   // วางบิลแล้ว (ล็อก)
  if (st === 'rejected') return STATUS_LABEL.rejected   // ส่งกลับให้แก้
  return waitingBadge(wo) || DONE_BADGE
}

// role → the signature slot label it batch-signs (mirrors backend ROLE_SLOT).
const SLOT_LABEL = { technician: 'ช่างแอร์', checker: 'หัวหน้าช่างแอร์', approve_building: 'เจ้าหน้าที่ช่างอาคาร', approve_engineer: 'เจ้าหน้าวิศวกรรม' }

// ?pending=<stage> quick views (from the ใบงาน sidebar group) — filter to ใบงาน
// waiting at a given signing step.
const PENDING_LABEL = { team: 'รอช่างแอร์เซ็น', supervisor: 'รอหัวหน้าช่างเซ็น', building: 'รอช่างอาคารเซ็น', department: 'รอเจ้าของพื้นที่เซ็น', engineer: 'รอวิศวกรรมเซ็น', building_engineer: 'รออาคาร/วิศวกรรมเซ็น' }

export default function SimpleWoList() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const pending = searchParams.get('pending') || ''   // '' | team | supervisor | building | engineer
  const view = searchParams.get('view') || ''          // '' (default=งานค้าง) | ready (รอวางบิล) | done (เซ็นครบ รวมวางบิลแล้ว) | all
  const { user } = useAuthStore()

  const role = user?.role
  const hasZones = useHasZones()   // โซนมีเฉพาะศรีราชา — สาขาอื่นซ่อน filter สัญญา/โซน
  const requireDeptSign = useTenantStore((s) => s.requireDeptSign)   // ช่องเจ้าของพื้นที่ (PTN)
  const canSign = !!SLOT_LABEL[role]
  const canBill = role === 'admin' || role === 'super_admin'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  // List filter + sort (client-side)
  const [fType, setFType] = useState('')     // '' | major | minor | fan
  const [fClient, setFClient] = useState('') // '' | client_name
  const [fPts, setFPts] = useState('')       // '' | pts_zone
  const [fResult, setFResult] = useState('') // '' | ok | not_ok
  const [fStatus, setFStatus] = useState('') // '' | submitted | checked | approved | rejected
  const [sortBy, setSortBy] = useState('date_desc') // date_desc|date_asc|wo_asc|wo_desc

  // Multi-select
  const [selected, setSelected] = useState(() => new Set())

  // Batch sign — signSlot: 'own' (ช่องของ role ตัวเอง) | 'department' (เซ็นแทน
  // เจ้าของพื้นที่ — คนของ รพ. พิมพ์ชื่อ/ตำแหน่งเอง เหมือนเซ็นทีละใบ)
  const [signing, setSigning] = useState(false)
  const [signSlot, setSignSlot] = useState('own')
  const [signerName, setSignerName] = useState('')
  const [signerPosition, setSignerPosition] = useState('')
  const [signLoading, setSignLoading] = useState(false)

  // Batch bill (PDF)
  const [pdfUrl, setPdfUrl] = useState(null)
  const [billing, setBilling] = useState(false)
  const iframeRef = useRef(null)
  // Editable cover sheet
  const [coverOpen, setCoverOpen] = useState(false)
  const [cover, setCover] = useState(null)

  const [error, setError] = useState('')
  const load = () => {
    setLoading(true); setError('')
    api.get('/simple-wo', { params: { limit: 1000 } })
      .then((r) => setRows(Array.isArray(r.data) ? r.data : []))
      .catch((e) => {
        setRows([])
        // Don't show an empty "ไม่มีใบงาน" when the request actually FAILED — surface it.
        setError(e.response?.status === 400
          ? 'ยังไม่ได้เลือกสาขา — เข้าผ่านลิงก์สาขา (subdomain) หรือเลือกสาขาก่อน'
          : (e.response?.data?.error || 'โหลดใบงานไม่สำเร็จ — ลองใหม่อีกครั้ง'))
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // Distinct client names / PTS zones for the filter dropdowns.
  const clientOptions = [...new Set(rows.map((r) => r.client_name).filter(Boolean))].sort()
  const ptsOptions = [...new Set(rows.map((r) => r.pts_zone).filter(Boolean))].sort()

  // Apply filters + sort to produce the rows actually rendered.
  // View scope (sidebar): default = งานค้าง (ยังไม่วางบิล; ช่าง = เฉพาะของตัวเอง);
  // ready = พร้อมวางบิล (เซ็นครบ ยังไม่วางบิล); all = ทุกใบ.
  const isApproved = (r) => (r.status || 'submitted') === 'approved'
  const inView = (r) => {
    // ?pending=<slot> ใช้ธง wait_<slot> จาก API (นิยามเดียวกับการ์ดหน้าภาพรวม).
    // ห้ามเทียบ pending_stage — ช่องคู่ขนาน (อาคาร/เจ้าของพื้นที่/วิศวกรรม) ทำให้
    // "ช่องแรกที่ยังว่าง" ไม่ใช่ใบที่รอช่องนั้น → การ์ดโชว์ 213 แต่ list ว่างเปล่า.
    // ใบเก่าจาก API รุ่นก่อน (ไม่มี wait_*) → fallback pending_stage เดิม
    if (pending) {
      const w = r[`wait_${pending}`]
      return (w === undefined ? r.pending_stage === pending : !!w) && !isApproved(r)
    }
    if (view === 'ready') return r.all_signed && !isApproved(r)
    if (view === 'done') return r.all_signed || isApproved(r)   // เสร็จสิ้น = เซ็นครบ รวมที่วางบิลแล้ว
    if (view === 'all') return true
    // default: งานที่ยังไม่เสร็จ (ยังไม่วางบิล); ช่าง = เฉพาะใบที่ตัวเองสร้าง
    if (isApproved(r)) return false
    if (user?.role === 'technician') return String(r.created_by) === String(user?.id)
    return true
  }
  const visibleRows = rows
    .filter((r) => (!fType || r.work_type === fType)
      && (!fClient || r.client_name === fClient)
      && (!fPts || r.pts_zone === fPts)
      && (!fResult || r.result === fResult)
      && (!fStatus || (r.status || 'submitted') === fStatus)
      && inView(r))
    .sort((a, b) => {
      if (sortBy === 'wo_asc') return String(a.wo_number || '').localeCompare(String(b.wo_number || ''))
      if (sortBy === 'wo_desc') return String(b.wo_number || '').localeCompare(String(a.wo_number || ''))
      const da = new Date(a.work_date || a.created_at || 0).getTime()
      const db = new Date(b.work_date || b.created_at || 0).getTime()
      return sortBy === 'date_asc' ? da - db : db - da
    })

  const hasFilter = fType || fClient || fPts || fResult || fStatus
  const clearFilters = () => { setFType(''); setFClient(''); setFPts(''); setFResult(''); setFStatus('') }

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
    // วางบิลได้เฉพาะใบที่เซ็นครบทุกช่อง (พร้อมวางบิล). การวางบิลจะ lock ใบงาน.
    const notReady = sel.filter((r) => !r.all_signed)
    if (notReady.length) {
      alert(`วางบิลได้เฉพาะใบที่เซ็นครบทุกช่อง — ยังเซ็นไม่ครบ ${notReady.length} ใบ:\n${notReady.map((r) => r.wo_number || r.id).join(', ')}`)
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
  const openSign = (slot = 'own') => {
    setSignSlot(slot)
    // เจ้าของพื้นที่ = คนนอกระบบ — ชื่อต้องพิมพ์เอง ห้าม default เป็นชื่อช่างที่ login
    setSignerName(slot === 'department' ? '' : (user?.name || ''))
    setSignerPosition('')
    setSigning(true)
  }

  const handleBatchSign = async (dataUrl) => {
    if (signSlot === 'department' && !signerName.trim()) { alert('กรอกชื่อเจ้าของพื้นที่ก่อน'); return }
    setSignLoading(true)
    try {
      const { data } = await api.post('/simple-wo/batch-sign', {
        ids: [...selected],
        signature_data: dataUrl,
        signer_name: signerName,
        ...(signSlot === 'department' ? { slot: 'department', signer_position: signerPosition } : {}),
      })
      const slotLabel = signSlot === 'department' ? 'เจ้าหน้าที่เจ้าของพื้นที่' : SLOT_LABEL[role]
      const skipMsg = data?.skipped ? ` · ข้าม ${data.skipped} ใบ (ยังไม่ถึงคิว/วางบิลแล้ว)` : ''
      alert(`เซ็นแล้ว ${data?.signed ?? 0} ใบ (${slotLabel})${skipMsg}`)
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

        {/* Quick view tabs (งานค้าง / ทั้งหมด / รอวางบิล) */}
        <div className="flex gap-2 overflow-x-auto -mx-1 px-1">
          {[
            { label: 'งานค้าง', to: '/simple-wo', active: !pending && !view },
            { label: 'ใบงานทั้งหมด', to: '/simple-wo?view=all', active: view === 'all' },
            ...(canBill ? [{ label: 'รอวางบิล', to: '/simple-wo?view=ready', active: view === 'ready' }] : []),
          ].map((t) => (
            <button
              key={t.to}
              onClick={() => navigate(t.to)}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                t.active ? 'bg-primary text-white shadow-sm' : 'bg-white text-ink-muted border border-line hover:border-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Load error — so a failed fetch never looks like "ไม่มีใบงาน" */}
        {error && (
          <div className="card flex items-center justify-between gap-3 bg-danger-soft border-danger/30">
            <span className="text-sm text-danger">{error}</span>
            <button onClick={load} className="btn-secondary text-xs">ลองใหม่</button>
          </div>
        )}

        {/* Active quick view (from the sidebar) */}
        {(() => {
          const label = pending ? PENDING_LABEL[pending]
            : view === 'ready' ? 'รอวางบิล (เซ็นครบ)'
            : view === 'done' ? 'ดำเนินการเสร็จสิ้น (เซ็นครบ รวมวางบิลแล้ว)'
            : view === 'all' ? 'ทั้งหมด'
            : null
          if (!label) return null
          return (
            <div className="card flex items-center justify-between gap-3 bg-primary-soft border-primary/30">
              <span className="text-sm font-medium text-primary">กำลังดู: {label} ({visibleRows.length})</span>
              <button onClick={() => navigate('/simple-wo')} className="text-xs text-ink-muted hover:text-primary underline">งานค้างของฉัน</button>
            </div>
          )
        })()}

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
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <div>
              <label className="label">สถานะ</label>
              <select className="input" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                <option value="">ทั้งหมด</option>
                <option value="submitted">รอเซ็น</option>
                <option value="approved">วางบิลแล้ว</option>
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
            {hasZones && (
              <div>
                <label className="label">สัญญา/โซน</label>
                <select className="input" value={fPts} onChange={(e) => setFPts(e.target.value)}>
                  <option value="">ทั้งหมด</option>
                  {ptsOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )}
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
                    <th className="py-2 px-2 w-12 text-center">
                      <input
                        type="checkbox"
                        className="accent-primary h-5 w-5 cursor-pointer align-middle"
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
                        {/* whole cell is the tap target (easier to hit than a tiny box) */}
                        <td
                          className="w-12 text-center cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); toggleOne(wo.id) }}
                        >
                          <input
                            type="checkbox"
                            className="accent-primary h-5 w-5 cursor-pointer align-middle pointer-events-none"
                            checked={checked}
                            readOnly
                            aria-label={`เลือกใบงาน ${wo.wo_number || wo.id}`}
                          />
                        </td>
                        <td className="py-3 px-4 font-semibold text-primary">{wo.wo_number || `#${wo.id}`}</td>
                        <td className="py-3 px-4 text-ink-muted text-xs">{dateVal ? dayjs(dateVal).format('DD/MM/YY') : '-'}</td>
                        <td className="py-3 px-4 text-ink">{wo.tech_name || '-'}</td>
                        <td className="py-3 px-4 text-ink">
                          <p className="flex items-center gap-1.5">
                            {wo.client_name || '-'}
                            {wo.pts_zone && <span className="badge bg-primary-soft text-primary text-[11px]">{wo.pts_zone}</span>}
                          </p>
                          {wo.building && <p className="text-xs text-ink-muted">{wo.building}</p>}
                        </td>
                        <td className="py-3 px-4 text-ink-muted">{wo.asset_code || '-'}</td>
                        <td className="py-3 px-4">
                          <span className={`badge ${t.color}`}>{t.label}</span>
                        </td>
                        <td className="py-3 px-4">
                          {(() => { const s = statusBadge(wo); return s ? <span className={`badge ${s.color}`}>{s.label}</span> : <span className="text-ink-muted text-xs">-</span> })()}
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
              <>
                {requireDeptSign && (
                  <button
                    onClick={() => openSign('department')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 text-sm"
                  >
                    <PenLine className="h-4 w-4" />
                    {`เจ้าของพื้นที่เซ็น (${selected.size})`}
                  </button>
                )}
                <button
                  onClick={() => openSign('own')}
                  className="btn-primary flex items-center gap-1.5"
                >
                  <PenLine className="h-4 w-4" />
                  {`เซ็นชุด (${selected.size}) — ${SLOT_LABEL[role]}`}
                </button>
              </>
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
        <Modal title={`เซ็นชุด — ${signSlot === 'department' ? 'เจ้าหน้าที่เจ้าของพื้นที่' : (SLOT_LABEL[role] || '')}`} onClose={() => setSigning(false)}>
          {signSlot === 'department' && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
              ยื่นแท็บเล็ตให้เจ้าหน้าที่เจ้าของพื้นที่ พิมพ์ชื่อ-ตำแหน่ง แล้วเซ็น — ลงครบทั้ง {selected.size} ใบที่เลือก
            </p>
          )}
          <div className="mb-3">
            <label className="label">ชื่อผู้ลงนาม {signSlot === 'department' && <span className="text-red-500">*</span>}</label>
            <input
              className="input"
              placeholder={signSlot === 'department' ? 'ชื่อเจ้าหน้าที่เจ้าของพื้นที่' : 'ชื่อผู้ลงนาม'}
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
            />
          </div>
          {signSlot === 'department' && (
            <div className="mb-3">
              <label className="label">ตำแหน่ง</label>
              <input
                className="input"
                placeholder="ตำแหน่ง (ไม่บังคับ)"
                value={signerPosition}
                onChange={(e) => setSignerPosition(e.target.value)}
              />
            </div>
          )}
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
