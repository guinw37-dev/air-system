import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Plus, FileText, CheckCircle, XCircle, ChevronRight,
  Camera, ClipboardCheck, PenLine, ChevronDown, ChevronUp, Wrench,
  QrCode, Copy, Clock, User
} from 'lucide-react'
import dayjs from 'dayjs'
import QRCode from 'qrcode'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import SignaturePad from '../components/SignaturePad'
import api, { uploadsBase } from '../api/client'
import { useAuthStore } from '../store/auth'
import { STATUS_LABEL, TYPE_LABEL } from '../lib/config'

export default function WorkOrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const [wo, setWo] = useState(null)
  const [photos, setPhotos] = useState({}) // keyed by work_order_unit_id
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)

  // Unit edit modal
  const [showAddUnit, setShowAddUnit] = useState(false)
  const [unitList, setUnitList]       = useState([])
  const [unitSearch, setUnitSearch]   = useState('')
  const [savingUnits, setSavingUnits] = useState(false)
  const [selectedUnitIds, setSelectedUnitIds] = useState([])

  // Signature modal
  const [sigRole, setSigRole]         = useState(null)
  const [signerName, setSignerName]   = useState('')
  const [savingSig, setSavingSig]     = useState(false)

  // Action states
  const [actionLoading, setActionLoading] = useState(false)
  const [rejectReason, setRejectReason]   = useState('')
  const [showReject, setShowReject]       = useState(false)

  // Sign-token modal (QR + countdown + polling)
  const [signModal, setSignModal]         = useState(null) // null | { token, sign_path, expires_at, qrDataUrl, link }
  const [signStatus, setSignStatus]       = useState(null) // null | { signed: bool, signer_name? }
  const [countdown, setCountdown]         = useState(0)   // seconds
  const signPollRef                       = useRef(null)
  const signCountRef                      = useRef(null)

  const load = useCallback(() => {
    Promise.all([
      api.get(`/work-orders/${id}`),
      api.get(`/work-orders/${id}/photos`).catch(() => ({ data: {} })),
      api.get(`/work-orders/${id}/history`).catch(() => ({ data: [] })),
    ]).then(([woRes, photosRes, histRes]) => {
      setWo(woRes.data)
      setPhotos(photosRes.data || {})
      setHistory(histRes.data || [])
    }).catch((e) => {
      setError(e.response?.data?.error || 'โหลดข้อมูลไม่สำเร็จ')
    }).finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])

  // Clear sign-modal poll/countdown intervals on unmount (audit Q-A)
  useEffect(() => () => {
    clearInterval(signPollRef.current)
    clearInterval(signCountRef.current)
  }, [])

  // Load units for edit
  useEffect(() => {
    if (!showAddUnit || !wo) return
    const clientId = wo.client_id || wo.hospital_id
    if (!clientId) return
    const eqType = wo.type === 'fan' ? 'fan' : 'ac'
    api.get(`/master/units?client_id=${clientId}&equipment_type=${eqType}`)
      .then((r) => {
        setUnitList(r.data)
        setSelectedUnitIds((wo.items || []).map((i) => i.unit_id).filter(Boolean))
      })
      .catch(() => {})
  }, [showAddUnit, wo])

  if (loading) return <PageSpinner />
  if (!wo) return <div className="p-4 text-danger">{error || 'ไม่พบใบงาน'}</div>

  const s = STATUS_LABEL[wo.status] || { label: wo.status, color: 'badge-gray' }
  const t = TYPE_LABEL[wo.type]    || { label: wo.type,   color: 'badge-gray' }

  const role = user?.role
  const isTech         = role === 'technician'
  const isCentralAdmin = role === 'admin'
  const isApprover     = ['approver', 'approve_building', 'approve_engineer'].includes(role)
  const isAdmin        = role === 'admin'
  const isChecker      = role === 'checker'
  const canEdit        = ['draft', 'in_progress'].includes(wo.status)
  const editableStatus = ['draft', 'in_progress', 'rejected'].includes(wo.status)

  // Action handlers
  const doStart = async () => {
    setActionLoading(true)
    try {
      await api.patch(`/work-orders/${id}/start`)
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally { setActionLoading(false) }
  }

  const doSubmit = async () => {
    if (!confirm('ส่งงานเพื่อรอ Admin ตรวจสอบ?')) return
    setActionLoading(true)
    try {
      await api.post(`/work-orders/${id}/submit`)
      load()
    } catch (err) {
      const missing = err.response?.data?.missing_units
      if (missing?.length) {
        alert(`ยังขาดรูปภาพ before/after:\n${missing.join(', ')}`)
      } else {
        alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
      }
    } finally { setActionLoading(false) }
  }

  const doAdminApprove = async () => {
    setActionLoading(true)
    try {
      await api.post(`/work-orders/${id}/admin-approve`)
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally { setActionLoading(false) }
  }

  const doFinalApprove = async () => {
    setActionLoading(true)
    try {
      await api.post(`/work-orders/${id}/final-approve`)
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally { setActionLoading(false) }
  }

  const doReject = async () => {
    if (!rejectReason.trim()) { alert('กรุณาระบุเหตุผล'); return }
    setActionLoading(true)
    try {
      await api.post(`/work-orders/${id}/reject`, { reason: rejectReason })
      setShowReject(false)
      setRejectReason('')
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally { setActionLoading(false) }
  }

  const doResubmit = async () => {
    if (!confirm('ส่งงานใหม่อีกครั้ง?')) return
    setActionLoading(true)
    try {
      await api.post(`/work-orders/${id}/resubmit`)
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally { setActionLoading(false) }
  }

  // ── Sign-token helpers ──────────────────────────────────────────────────
  const closeSignModal = () => {
    clearInterval(signPollRef.current)
    clearInterval(signCountRef.current)
    setSignModal(null)
    setSignStatus(null)
    setCountdown(0)
  }

  const openSignModal = async () => {
    try {
      const res = await api.post(`/work-orders/${id}/sign-token`)
      const { token, sign_path, expires_at } = res.data
      const link = `${window.location.origin}${sign_path}`
      const qrDataUrl = await QRCode.toDataURL(link, { width: 240, margin: 2 })

      const secsLeft = Math.max(0, Math.floor((new Date(expires_at) - Date.now()) / 1000))
      setCountdown(secsLeft)
      setSignStatus(null)
      setSignModal({ token, sign_path, expires_at, qrDataUrl, link })

      // Countdown timer
      signCountRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(signCountRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)

      // Poll sign status every 10s
      const poll = () => {
        api.get(`/work-orders/${id}/sign-status`)
          .then((r) => {
            setSignStatus(r.data)
            if (r.data.signed) {
              clearInterval(signPollRef.current)
              clearInterval(signCountRef.current)
              load() // refresh WO to show signature
            }
          })
          .catch(() => {})
      }
      poll()
      signPollRef.current = setInterval(poll, 10_000)
    } catch (err) {
      alert(err.response?.data?.error || 'ไม่สามารถสร้างลิงก์ลายเซ็นได้')
    }
  }

  const copyLink = () => {
    if (!signModal) return
    navigator.clipboard.writeText(signModal.link).then(() => alert('คัดลอกลิงก์แล้ว')).catch(() => {})
  }

  const fmtCountdown = (secs) => {
    const m = String(Math.floor(secs / 60)).padStart(2, '0')
    const s = String(secs % 60).padStart(2, '0')
    return `${m}:${s}`
  }

  const saveUnits = async () => {
    setSavingUnits(true)
    try {
      await api.put(`/work-orders/${id}/units`, { unit_ids: selectedUnitIds })
      setShowAddUnit(false)
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally { setSavingUnits(false) }
  }

  const saveSig = async (dataUrl) => {
    if (!signerName.trim()) { alert('กรุณาระบุชื่อ'); return }
    setSavingSig(true)
    try {
      await api.post(`/work-orders/${id}/signatures`, {
        role: sigRole,
        signer_name: signerName,
        signature_data: dataUrl,
      })
      setSigRole(null)
      setSignerName('')
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'บันทึกลายเซ็นไม่สำเร็จ')
    } finally { setSavingSig(false) }
  }

  const downloadPdf = () => {
    const base = uploadsBase || ''
    const token = useAuthStore.getState().token
    window.open(`${base}/api/pdf/work-orders/${id}?token=${token}`, '_blank')
  }

  const filteredUnitList = unitList.filter((u) =>
    !unitSearch ||
    u.asset_code?.toLowerCase().includes(unitSearch.toLowerCase()) ||
    u.name?.toLowerCase().includes(unitSearch.toLowerCase()) ||
    u.room_name?.toLowerCase().includes(unitSearch.toLowerCase())
  )

  const hasSig = (role) => wo.signatures?.some((s) => s.role === role)

  // Per-unit photo count from photos map
  const unitPhotoCount = (woUnitId) => {
    const arr = photos[woUnitId] || []
    return arr.length
  }

  // Per-unit inspection count
  const unitInspCount = (woUnitId) => {
    const insp = (wo.inspections || []).filter((i) => i.work_order_unit_id === woUnitId)
    return insp.filter((i) => i.checked || i.value_after || i.value_before).length
  }

  return (
    <Layout
      title={wo.order_no || `ใบงาน #${id}`}
      back="/work-orders"
      actions={
        <button onClick={downloadPdf} className="p-1 rounded-lg text-ink-muted hover:bg-page">
          <FileText className="h-5 w-5" />
        </button>
      }
    >
      <div className="px-4 pt-4 flex flex-col gap-4 pb-8">

        {/* Rejection banner */}
        {wo.status === 'rejected' && (
          <div className="bg-danger-soft border border-danger/30 rounded-xl px-4 py-3">
            <div className="flex items-start gap-2">
              <XCircle className="h-5 w-5 text-danger shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-danger">งานถูกตีกลับ</p>
                <p className="text-xs text-danger/80 mt-1">{wo.reject_reason || wo.owner_notes || '-'}</p>
              </div>
            </div>
            {(isTech || isCentralAdmin) && (
              <button
                onClick={doResubmit}
                disabled={actionLoading}
                className="btn-danger mt-3 w-full flex items-center justify-center gap-2"
              >
                <CheckCircle className="h-4 w-4" />
                {actionLoading ? 'กำลังส่ง...' : 'แก้ไขและส่งใหม่'}
              </button>
            )}
          </div>
        )}

        {/* WO Info Card */}
        <div className="card">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <span className={`badge ${s.color}`}>{s.label}</span>
            <span className={`badge ${t.color}`}>{t.label}</span>
          </div>
          <InfoRow label="Client"    value={wo.client_name || wo.hospital_name} />
          <InfoRow label="Site"      value={wo.site_name} />
          {(wo.assignees || []).length > 0 && (
            <InfoRow label="ผู้รับผิดชอบ" value={wo.assignees.map((a) => a.name).join(', ')} />
          )}
          {wo.tech1_name && <InfoRow label="ช่าง" value={wo.tech1_name} />}
          {wo.created_at && <InfoRow label="วันที่สร้าง" value={dayjs(wo.created_at).format('DD/MM/YYYY HH:mm')} />}
          {wo.started_at && <InfoRow label="เริ่มงาน"    value={dayjs(wo.started_at).format('DD/MM/YYYY HH:mm')} />}
          {wo.completed_at && <InfoRow label="เสร็จสิ้น" value={dayjs(wo.completed_at).format('DD/MM/YYYY HH:mm')} />}
        </div>

        {/* Units list */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-ink">อุปกรณ์ ({(wo.items || []).length} รายการ)</h2>
            {editableStatus && (isCentralAdmin || isTech) && (
              <button
                onClick={() => setShowAddUnit(true)}
                className="flex items-center gap-1 text-primary text-sm font-medium"
              >
                <Plus className="h-4 w-4" /> แก้ไข
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {(wo.items || []).map((item) => {
              const woUnitId = item.id
              const pCount  = unitPhotoCount(woUnitId)
              const iCount  = unitInspCount(woUnitId)
              return (
                <div key={woUnitId} className="card cursor-pointer active:bg-page"
                  onClick={() => navigate(`/work-orders/${id}/units/${woUnitId}`)}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink text-sm">{item.asset_code}</p>
                      <p className="text-xs text-ink-muted truncate">{item.unit_name}</p>
                      <p className="text-xs text-ink-muted/60 mt-0.5">
                        {item.room_name} {item.building_name ? `· ${item.building_name}` : ''}
                      </p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className={`flex items-center gap-1 text-xs ${pCount > 0 ? 'text-success' : 'text-ink-muted'}`}>
                          <Camera className="h-3.5 w-3.5" /> {pCount} รูป
                        </span>
                        <span className={`flex items-center gap-1 text-xs ${iCount > 0 ? 'text-success' : 'text-ink-muted'}`}>
                          <ClipboardCheck className="h-3.5 w-3.5" /> {iCount} รายการ
                        </span>
                        {item.has_repair && (
                          <span className="flex items-center gap-1 text-xs text-danger">
                            <Wrench className="h-3.5 w-3.5" /> แจ้งซ่อม
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-line shrink-0 mt-1" />
                  </div>
                </div>
              )
            })}
            {(wo.items || []).length === 0 && (
              <p className="text-sm text-ink-muted text-center py-8">ยังไม่มีอุปกรณ์ กด "แก้ไข" เพื่อเพิ่ม</p>
            )}
          </div>
        </div>

        {/* Signatures */}
        <div>
          <h2 className="font-semibold text-ink mb-2">ลายเซ็น</h2>
          <div className="flex flex-col gap-2">
            {/* Area owner signature — always show */}
            {(() => {
              const sig = wo.signatures?.find((s) => s.role === 'area_owner')
              const canSign = ['in_progress', 'pending_admin', 'pending_approval', 'approved'].includes(wo.status)
              return (
                <div className="card flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink">เจ้าของพื้นที่</p>
                    {sig && (
                      <p className="text-xs text-ink-muted mt-0.5">
                        {sig.signer_name} · {dayjs(sig.signed_at).format('DD/MM/YY HH:mm')}
                      </p>
                    )}
                  </div>
                  {sig ? (
                    <img src={sig.signature_data} alt="sig" className="h-12 w-24 object-contain border border-line rounded-lg" />
                  ) : canSign ? (
                    <button
                      onClick={() => { setSigRole('area_owner'); setSignerName('') }}
                      className="flex items-center gap-1 text-primary text-sm"
                    >
                      <PenLine className="h-4 w-4" /> เซ็น
                    </button>
                  ) : (
                    <span className="text-xs text-ink-muted">ยังไม่ได้เซ็น</span>
                  )}
                </div>
              )
            })()}
          </div>
        </div>

        {/* Action buttons by role+status */}
        <div className="flex flex-col gap-2">

          {/* Request area-owner signature via QR link */}
          {wo.status === 'in_progress' && (isCentralAdmin || isTech || isChecker ||
            (wo.assignees || []).some((a) => a.id === user?.id)) && (
            <button
              onClick={openSignModal}
              className="flex items-center justify-center gap-2 border border-primary/40 bg-primary-soft text-primary hover:bg-primary-soft/70 font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              <QrCode className="h-4 w-4" />
              ขอลายเซ็นเจ้าของพื้นที่
            </button>
          )}

          {/* Technician: Start draft */}
          {wo.status === 'draft' && (isTech || isCentralAdmin) && (
            <button onClick={doStart} disabled={actionLoading} className="btn-primary flex items-center justify-center gap-2">
              <CheckCircle className="h-5 w-5" />
              {actionLoading ? 'กำลังเริ่ม...' : 'เริ่มงาน'}
            </button>
          )}

          {/* Technician: Submit in_progress */}
          {wo.status === 'in_progress' && (isTech || isCentralAdmin) && (wo.items || []).length > 0 && (
            <button onClick={doSubmit} disabled={actionLoading} className="btn-primary flex items-center justify-center gap-2">
              <CheckCircle className="h-5 w-5" />
              {actionLoading ? 'กำลังส่ง...' : 'ส่งงาน (ขอ Admin ตรวจสอบ)'}
            </button>
          )}

          {/* Checker: pending_admin (ด่าน 1 ตรวจเอกสาร) */}
          {wo.status === 'pending_admin' && isChecker && (
            <div className="flex gap-2">
              <button
                onClick={doAdminApprove}
                disabled={actionLoading}
                className="btn-green flex-1 flex items-center justify-center gap-1"
              >
                <CheckCircle className="h-4 w-4" />
                {actionLoading ? '...' : 'ผ่าน (ส่ง Approver)'}
              </button>
              <button
                onClick={() => setShowReject(true)}
                className="btn-danger flex-1"
              >
                ส่งคืน
              </button>
            </div>
          )}

          {/* Approver: pending_approval (ด่าน 2 final-approve) */}
          {wo.status === 'pending_approval' && isApprover && (
            <div className="flex flex-col gap-2">
              <button
                onClick={doFinalApprove}
                disabled={actionLoading}
                className="btn-green flex items-center justify-center gap-1"
              >
                <CheckCircle className="h-4 w-4" />
                {actionLoading ? '...' : 'อนุมัติ'}
              </button>
              {/* Approver signature */}
              {!hasSig('approver') && (
                <button
                  onClick={() => { setSigRole('approver'); setSignerName(user?.name || '') }}
                  className="btn-secondary flex items-center justify-center gap-1"
                >
                  <PenLine className="h-4 w-4" /> ลงนามอนุมัติ
                </button>
              )}
              <button onClick={() => setShowReject(true)} className="btn-danger">
                ส่งคืนแก้ไข
              </button>
            </div>
          )}

          {/* Checker sign when pending_approval */}
          {wo.status === 'pending_approval' && isChecker && !hasSig('central_admin') && (
            <button
              onClick={() => { setSigRole('central_admin'); setSignerName(user?.name || '') }}
              className="btn-secondary flex items-center justify-center gap-1"
            >
              <PenLine className="h-4 w-4" /> ลงนาม (Checker)
            </button>
          )}
        </div>

        {/* Status Timeline */}
        {history.length > 0 && (
          <div>
            <button
              onClick={() => setHistoryOpen((o) => !o)}
              className="flex items-center gap-2 text-sm font-medium text-ink-muted hover:text-ink"
            >
              {historyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              ประวัติสถานะ ({history.length})
            </button>
            {historyOpen && (
              <div className="mt-3 relative">
                {/* vertical line */}
                <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-line" />
                <div className="flex flex-col gap-3">
                  {history.map((h, idx) => {
                    const toLabel   = STATUS_LABEL[h.to_status]
                    const fromLabel = STATUS_LABEL[h.from_status]
                    const isReject  = h.to_status === 'rejected'
                    return (
                      <div key={idx} className="flex items-start gap-3 relative">
                        {/* dot */}
                        <div className={`shrink-0 w-5 h-5 rounded-full border-2 z-10 mt-0.5 ${
                          isReject
                            ? 'bg-danger-soft border-danger'
                            : idx === history.length - 1
                            ? 'bg-primary border-primary'
                            : 'bg-surface border-line'
                        }`} />
                        <div className="flex-1 min-w-0 bg-page rounded-xl px-3 py-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {h.from_status && (
                              <span className={`badge ${
                                fromLabel?.color || 'badge-gray'
                              }`}>
                                {fromLabel?.label || h.from_status}
                              </span>
                            )}
                            {h.to_status && (
                              <>
                                <span className="text-xs text-ink-muted">→</span>
                                <span className={`badge ${
                                  toLabel?.color || 'badge-gray'
                                }`}>
                                  {toLabel?.label || h.to_status}
                                </span>
                              </>
                            )}
                          </div>
                          {h.reason && (
                            <p className="text-xs text-danger mt-1 flex items-start gap-1">
                              <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
                              {h.reason}
                            </p>
                          )}
                          <div className="flex items-center gap-1 mt-1 text-xs text-ink-muted">
                            <User className="h-3 w-3" />
                            <span>{h.changed_by_name || '-'}</span>
                            <span className="ml-1">{dayjs(h.changed_at).format('DD/MM/YY HH:mm')}</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit units modal */}
      {showAddUnit && (
        <Modal title="แก้ไขรายการอุปกรณ์" onClose={() => setShowAddUnit(false)}>
          <input
            className="input mb-3"
            placeholder="ค้นหา asset code / ชื่อ / ห้อง..."
            value={unitSearch}
            onChange={(e) => setUnitSearch(e.target.value)}
            autoFocus
          />
          <div className="flex flex-col gap-2 max-h-80 overflow-y-auto mb-4">
            {filteredUnitList.map((u) => {
              const checked = selectedUnitIds.includes(u.id)
              return (
                <label
                  key={u.id}
                  className={`flex items-center gap-3 border rounded-xl px-3 py-2.5 cursor-pointer ${
                    checked ? 'border-primary bg-primary-soft' : 'border-line'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={checked}
                    onChange={() =>
                      setSelectedUnitIds((ids) =>
                        ids.includes(u.id) ? ids.filter((x) => x !== u.id) : [...ids, u.id]
                      )
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink">{u.asset_code}</p>
                    <p className="text-xs text-ink-muted truncate">{u.name} · {u.room_name} · {u.building_name}</p>
                  </div>
                </label>
              )
            })}
            {filteredUnitList.length === 0 && (
              <p className="text-sm text-ink-muted text-center py-6">ไม่พบอุปกรณ์</p>
            )}
          </div>
          <p className="text-xs text-ink-muted mb-3">เลือก {selectedUnitIds.length} รายการ</p>
          <div className="flex gap-2">
            <button onClick={() => setShowAddUnit(false)} className="btn-secondary flex-1">ยกเลิก</button>
            <button onClick={saveUnits} disabled={savingUnits} className="btn-primary flex-1">
              {savingUnits ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </Modal>
      )}

      {/* Signature modal */}
      {sigRole && (
        <Modal
          title={sigRole === 'area_owner' ? 'ลายเซ็นเจ้าของพื้นที่' : sigRole === 'approver' ? 'ลายเซ็นผู้อนุมัติ' : 'ลายเซ็น Checker'}
          onClose={() => { setSigRole(null); setSignerName('') }}
        >
          <div className="mb-3">
            <label className="label">ชื่อ-นามสกุล *</label>
            <input
              className="input"
              placeholder="ชื่อผู้ลงนาม"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
            />
          </div>
          <SignaturePad
            onSave={saveSig}
            onCancel={() => { setSigRole(null); setSignerName('') }}
          />
          {savingSig && <p className="text-xs text-ink-muted mt-2 text-center">กำลังบันทึก...</p>}
        </Modal>
      )}

      {/* Reject modal */}
      {showReject && (
        <Modal title="ส่งคืน / ตีกลับ" onClose={() => setShowReject(false)}>
          <textarea
            className="input mb-3"
            placeholder="เหตุผล *"
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button onClick={() => setShowReject(false)} className="btn-secondary flex-1">ยกเลิก</button>
            <button onClick={doReject} disabled={actionLoading} className="btn-danger flex-1">ยืนยัน</button>
          </div>
        </Modal>
      )}

      {/* Sign-token modal (QR + countdown + live status) */}
      {signModal && (
        <Modal title="ขอลายเซ็นเจ้าของพื้นที่" onClose={closeSignModal}>
          <div className="flex flex-col items-center gap-4">
            {/* QR code */}
            <img
              src={signModal.qrDataUrl}
              alt="QR ลายเซ็น"
              className="w-48 h-48 rounded-xl border border-line"
            />

            {/* Countdown */}
            <div className={`flex items-center gap-1.5 text-sm font-medium ${
              countdown > 60 ? 'text-ink-muted' : 'text-danger'
            }`}>
              <Clock className="h-4 w-4" />
              {countdown > 0 ? `หมดอายุใน ${fmtCountdown(countdown)}` : 'ลิงก์หมดอายุแล้ว'}
            </div>

            {/* Status */}
            <div className={`w-full text-center py-2 rounded-xl text-sm font-medium ${
              signStatus?.signed
                ? 'bg-success-soft text-success'
                : 'bg-warn-soft text-warn'
            }`}>
              {signStatus?.signed
                ? `เซ็นแล้ว ✓ (${signStatus.signer_name})`
                : 'รอเซ็น...'}
            </div>

            {/* Copyable link */}
            <div className="w-full">
              <p className="text-xs text-ink-muted mb-1">ลิงก์สำหรับเจ้าของพื้นที่</p>
              <div className="flex items-center gap-2 border border-line rounded-xl px-3 py-2 bg-page">
                <span className="flex-1 text-xs text-ink-muted truncate">{signModal.link}</span>
                <button onClick={copyLink} className="shrink-0 text-primary hover:text-primary-dark">
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>

            <button onClick={closeSignModal} className="btn-secondary w-full">ปิด</button>
          </div>
        </Modal>
      )}
    </Layout>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-line last:border-0">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-xs text-ink font-medium text-right max-w-[60%] truncate">{value || '-'}</span>
    </div>
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
