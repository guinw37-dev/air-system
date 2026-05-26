import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Plus, FileText, CheckCircle, XCircle, ChevronRight,
  Camera, ClipboardCheck, Ruler, PenLine
} from 'lucide-react'
import dayjs from 'dayjs'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // AC unit selector modal
  const [showAddAc, setShowAddAc] = useState(false)
  const [acList, setAcList] = useState([])
  const [acSearch, setAcSearch] = useState('')
  const [addingAc, setAddingAc] = useState(null) // ac_unit_id being added

  // Signature modal
  const [sigRole, setSigRole] = useState(null) // 'tech' | 'area_owner' | 'engineering'

  // Action states
  const [actionLoading, setActionLoading] = useState(false)
  const [approveNotes, setApproveNotes] = useState('')
  const [showReject, setShowReject] = useState(false)

  const load = useCallback(() => {
    api.get(`/work-orders/${id}`).then((r) => setWo(r.data)).finally(() => setLoading(false))
  }, [id])

  useEffect(() => { load() }, [load])

  // Load AC units for this hospital when add modal opens
  useEffect(() => {
    if (!showAddAc || !wo) return
    api.get(`/master/ac-units?hospital_id=${wo.hospital_id}`).then((r) => setAcList(r.data))
  }, [showAddAc, wo])

  if (loading) return <PageSpinner />
  if (!wo) return <div className="p-4 text-red-600">{error || 'ไม่พบใบงาน'}</div>

  const s = STATUS_LABEL[wo.status] || { label: wo.status, color: 'bg-gray-100 text-gray-700' }
  const t = TYPE_LABEL[wo.type]    || { label: wo.type,   color: 'bg-gray-100 text-gray-700' }

  const isOwnerAdmin = ['owner', 'admin'].includes(user?.role)
  const canEdit = wo.status === 'in_progress'

  const existingItemAcIds = new Set((wo.items || []).map((i) => i.ac_unit_id))

  const addAcUnit = async (acUnitId) => {
    setAddingAc(acUnitId)
    try {
      await api.post(`/work-orders/${id}/items`, { ac_unit_id: acUnitId })
      load()
    } finally {
      setAddingAc(null)
    }
  }

  const removeItem = async (itemId) => {
    if (!confirm('ลบเครื่องนี้ออกจากใบงาน?')) return
    await api.delete(`/work-orders/${id}/items/${itemId}`)
    load()
  }

  const submit = async () => {
    if (!confirm('ส่งงานเพื่อรออนุมัติ?')) return
    setActionLoading(true)
    try {
      await api.patch(`/work-orders/${id}/submit`)
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally {
      setActionLoading(false)
    }
  }

  const approve = async () => {
    setActionLoading(true)
    try {
      await api.patch(`/work-orders/${id}/approve`, { notes: approveNotes })
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally {
      setActionLoading(false)
    }
  }

  const reject = async () => {
    if (!approveNotes.trim()) { alert('กรุณาระบุเหตุผล'); return }
    setActionLoading(true)
    try {
      await api.patch(`/work-orders/${id}/reject`, { notes: approveNotes })
      setShowReject(false)
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally {
      setActionLoading(false)
    }
  }

  const saveSig = async (dataUrl) => {
    const res = await api.post(`/work-orders/${id}/signatures`, {
      role: sigRole,
      signature_data: dataUrl,
    })
    setSigRole(null)
    load()
    if (res.data?.auto_submitted) {
      alert('เซ็นครบทั้ง 3 ฝ่าย — ส่งงานอัตโนมัติแล้ว')
    }
  }

  const downloadPdf = () => {
    const base = uploadsBase || ''
    const token = useAuthStore.getState().token
    window.open(`${base}/api/pdf/work-orders/${id}?token=${token}`, '_blank')
  }

  const filteredAc = acList.filter((a) =>
    !acSearch ||
    a.ac_code?.toLowerCase().includes(acSearch.toLowerCase()) ||
    a.ac_name?.toLowerCase().includes(acSearch.toLowerCase()) ||
    a.dept_name?.toLowerCase().includes(acSearch.toLowerCase()) ||
    a.floor_name?.toLowerCase().includes(acSearch.toLowerCase())
  )

  const hasSig = (role) => wo.signatures?.some((s) => s.role === role)

  return (
    <Layout
      title={wo.order_no}
      back="/work-orders"
      actions={
        <button onClick={downloadPdf} className="p-1 rounded-lg active:bg-blue-600">
          <FileText className="h-5 w-5" />
        </button>
      }
    >
      <div className="px-4 pt-4 flex flex-col gap-4">

        {/* WO Info Card */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${s.color}`}>{s.label}</span>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${t.color}`}>{t.label}</span>
          </div>
          <InfoRow label="โรงพยาบาล" value={wo.hospital_name} />
          <InfoRow label="ช่าง 1" value={wo.tech1_name} />
          {wo.tech2_name && <InfoRow label="ช่าง 2" value={wo.tech2_name} />}
          <InfoRow label="เริ่มงาน" value={dayjs(wo.started_at).format('DD/MM/YYYY HH:mm')} />
          {wo.completed_at && <InfoRow label="เสร็จสิ้น" value={dayjs(wo.completed_at).format('DD/MM/YYYY HH:mm')} />}
          {wo.owner_notes && (
            <div className="mt-2 bg-orange-50 rounded-lg px-3 py-2">
              <p className="text-xs text-orange-700">{wo.owner_notes}</p>
            </div>
          )}
        </div>

        {/* AC Items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-gray-800">เครื่องแอร์ ({wo.items?.length || 0})</h2>
            {canEdit && (
              <button onClick={() => setShowAddAc(true)} className="flex items-center gap-1 text-blue-600 text-sm font-medium">
                <Plus className="h-4 w-4" /> เพิ่ม
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {(wo.items || []).map((item) => {
              const photos = (wo.photos || []).filter((p) => p.work_order_item_id === item.id)
              const hasMeasure = item.measurements && Object.keys(item.measurements).length > 0
              const hasChecklist = item.checklist && Object.keys(item.checklist).length > 0
              return (
                <div key={item.id} className="card">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => navigate(`/work-orders/${id}/items/${item.id}`)}
                        className="text-left w-full"
                      >
                        <p className="font-medium text-gray-900 text-sm">{item.ac_code}</p>
                        <p className="text-xs text-gray-500 truncate">{item.ac_name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{item.dept_name} · {item.floor_name} · {item.building_name}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className={`flex items-center gap-1 text-xs ${photos.length > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                            <Camera className="h-3.5 w-3.5" /> {photos.length} รูป
                          </span>
                          <span className={`flex items-center gap-1 text-xs ${hasMeasure ? 'text-green-600' : 'text-gray-400'}`}>
                            <Ruler className="h-3.5 w-3.5" /> {hasMeasure ? 'บันทึกแล้ว' : '-'}
                          </span>
                          <span className={`flex items-center gap-1 text-xs ${hasChecklist ? 'text-green-600' : 'text-gray-400'}`}>
                            <ClipboardCheck className="h-3.5 w-3.5" /> {hasChecklist ? 'บันทึกแล้ว' : '-'}
                          </span>
                        </div>
                        {item.has_repair && (
                          <span className="mt-1 inline-block text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                            แจ้งซ่อม
                          </span>
                        )}
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => navigate(`/work-orders/${id}/items/${item.id}`)}
                        className="p-2 text-gray-400"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                      {canEdit && (
                        <button onClick={() => removeItem(item.id)} className="p-2 text-red-400">
                          <XCircle className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {(wo.items || []).length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีเครื่องแอร์ กด + เพื่อเพิ่ม</p>
            )}
          </div>
        </div>

        {/* Signatures */}
        <div>
          <h2 className="font-semibold text-gray-800 mb-2">ลายเซ็นปิดงาน</h2>
          <div className="flex flex-col gap-2">
            {[
              {
                role: 'tech',
                label: `ช่างผู้ปฏิบัติงาน (${wo.tech1_name || '-'}${wo.tech2_name ? ` / ${wo.tech2_name}` : ''})`,
                canSign: canEdit && (user?.id === wo.tech1_id || user?.id === wo.tech2_id || isOwnerAdmin),
              },
              {
                role: 'area_owner',
                label: 'เจ้าของพื้นที่',
                canSign: canEdit,
              },
              {
                role: 'engineering',
                label: 'แผนกวิศวกรรม',
                canSign: canEdit,
              },
            ].map(({ role, label, canSign }) => {
              const sig = wo.signatures?.find((s) => s.role === role)
              return (
                <div key={role} className="card flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700">{label}</p>
                    {sig && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {dayjs(sig.signed_at).format('DD/MM/YY HH:mm')}
                      </p>
                    )}
                  </div>
                  {sig ? (
                    <img src={sig.signature_data} alt="sig" className="h-12 w-24 object-contain border rounded-lg" />
                  ) : canSign ? (
                    <button onClick={() => setSigRole(role)} className="flex items-center gap-1 text-blue-600 text-sm">
                      <PenLine className="h-4 w-4" /> เซ็น
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">ยังไม่ได้เซ็น</span>
                  )}
                </div>
              )
            })}
          </div>
          {wo.status === 'in_progress' && (
            <p className="text-xs text-gray-400 mt-2 text-center">
              * เซ็นครบทั้ง 3 ฝ่าย → ระบบส่งงานอัตโนมัติ
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 pb-4">
          {/* Tech: submit */}
          {canEdit && !isOwnerAdmin && wo.items?.length > 0 && (
            <button onClick={submit} disabled={actionLoading} className="btn-primary text-center flex items-center justify-center gap-2">
              <CheckCircle className="h-5 w-5" />
              {actionLoading ? 'กำลังส่ง...' : 'ส่งงาน'}
            </button>
          )}

          {/* Owner: approve/reject */}
          {wo.status === 'pending_approval' && isOwnerAdmin && (
            <>
              <textarea
                className="input"
                placeholder="หมายเหตุ (ถ้ามี)"
                rows={2}
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={approve} disabled={actionLoading} className="btn-green flex-1 text-center">
                  อนุมัติ
                </button>
                <button onClick={() => setShowReject(true)} className="btn-danger flex-1 text-center">
                  ไม่อนุมัติ
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add AC Modal */}
      {showAddAc && (
        <Modal title="เพิ่มเครื่องแอร์" onClose={() => setShowAddAc(false)}>
          <input
            className="input mb-3"
            placeholder="ค้นหา รหัส / ชื่อ / แผนก..."
            value={acSearch}
            onChange={(e) => setAcSearch(e.target.value)}
            autoFocus
          />
          <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
            {filteredAc.map((ac) => {
              const added = existingItemAcIds.has(ac.id)
              return (
                <div key={ac.id} className="flex items-center gap-3 border border-gray-100 rounded-xl px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{ac.ac_code}</p>
                    <p className="text-xs text-gray-500 truncate">{ac.ac_name}</p>
                    <p className="text-xs text-gray-400">{ac.dept_name} · {ac.floor_name}</p>
                  </div>
                  <button
                    disabled={added || addingAc === ac.id}
                    onClick={() => addAcUnit(ac.id)}
                    className={`shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium ${
                      added ? 'bg-gray-100 text-gray-400' : 'bg-blue-600 text-white active:bg-blue-700'
                    }`}
                  >
                    {added ? 'เพิ่มแล้ว' : addingAc === ac.id ? '...' : 'เพิ่ม'}
                  </button>
                </div>
              )
            })}
            {filteredAc.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">ไม่พบเครื่องแอร์</p>
            )}
          </div>
        </Modal>
      )}

      {/* Signature Modal */}
      {sigRole && (
        <Modal title="ลายเซ็น" onClose={() => setSigRole(null)}>
          <SignaturePad onSave={saveSig} onCancel={() => setSigRole(null)} />
        </Modal>
      )}

      {/* Reject confirm modal */}
      {showReject && (
        <Modal title="ไม่อนุมัติ" onClose={() => setShowReject(false)}>
          <textarea
            className="input mb-3"
            placeholder="เหตุผล *"
            rows={3}
            value={approveNotes}
            onChange={(e) => setApproveNotes(e.target.value)}
          />
          <div className="flex gap-2">
            <button onClick={() => setShowReject(false)} className="btn-secondary flex-1">ยกเลิก</button>
            <button onClick={reject} disabled={actionLoading} className="btn-danger flex-1">ยืนยัน</button>
          </div>
        </Modal>
      )}
    </Layout>
  )
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between py-1 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-xs text-gray-900 font-medium">{value || '-'}</span>
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  )
}
