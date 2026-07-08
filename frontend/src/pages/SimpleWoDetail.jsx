import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { FileText, Trash2, Pencil, Undo2, RotateCcw, PenLine, Send } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import SignaturePad from '../components/SignaturePad'
import { PageSpinner } from '../components/Spinner'
import api, { uploadsBase } from '../api/client'
import { CONDITION_ISSUE_LABEL, PRIORITY_LABEL, PRIORITY_COLOR } from '../lib/condition'
import { useAuthStore } from '../store/auth'

// Each role signs ONE slot on a ใบงาน (backend enforces it too); admin/super any.
const SLOT_FOR_ROLE = { technician: 'team', checker: 'supervisor', approve_building: 'building', approve_engineer: 'engineer' }
const SIG_DEFS = [
  { slot: 'team',       label: 'ช่างแอร์' },
  { slot: 'supervisor', label: 'หัวหน้าช่างแอร์' },
  { slot: 'building',   label: 'เจ้าหน้าที่ช่างอาคาร' },
  { slot: 'engineer',   label: 'เจ้าหน้าวิศวกรรม' },
]

// Status. "พร้อมวางบิล" is DERIVED (all 4 signed) not stored. approved = วางบิลแล้ว (ล็อก).
const STATUS_LABEL = {
  submitted: { label: 'รอเซ็น',  color: 'badge-warn' },
  checked:   { label: 'รอเซ็น',  color: 'badge-warn' },
  approved:  { label: 'วางบิลแล้ว (ล็อก)', color: 'badge-success' },
  rejected:  { label: 'ส่งกลับให้แก้',  color: 'badge-danger' },
}

const WORK_TYPE_LABEL = {
  major: 'ล้างใหญ่',
  minor: 'ล้างย่อย',
  fan:   'ล้างพัดลม',
}

const RESULT_LABEL = {
  ok:     { label: 'เรียบร้อย',     color: 'badge-success' },
  not_ok: { label: 'ไม่เรียบร้อย', color: 'badge-danger' },
}

// Grid columns for ล้างย่อย / พัดลม (must match SimpleWoForm GRID_COLS).
const GRID_COLS = {
  minor: ['ตรวจเช็คระบบการทำงาน', 'ล้างหัวจ่าย', 'ล้างช่องรีเทิร์น', 'ล้างฟิลเตอร์'],
  fan: ['ล้างหน้ากาก/มอเตอร์/ใบพัด', 'ใช้งานได้ปกติ'],
}

function photoSrc(url) {
  if (!url) return ''
  if (/^https?:|^data:/.test(url)) return url
  return `${uploadsBase || ''}${url.startsWith('/') ? '' : '/'}${url}`
}

export default function SimpleWoDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const { user } = useAuthStore()
  const role = user?.role
  const privileged = role === 'admin' || role === 'super_admin'
  const canSignSlot = (slot) => SLOT_FOR_ROLE[role] === slot   // admin/super do not sign

  const [wo, setWo] = useState(null)
  const [schema, setSchema] = useState({ sections: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [signSlot, setSignSlot] = useState(null)   // slot being signed (modal open)
  const [signName, setSignName] = useState('')

  // Sign one slot via the dedicated sign endpoint (no full edit needed). Then refresh.
  const submitSign = async (dataUrl) => {
    setBusy(true)
    try {
      await api.post(`/simple-wo/${id}/sign`, { slot: signSlot, signature_data: dataUrl, signer_name: signName || user?.name || '' })
      setSignSlot(null)
      const r = await api.get(`/simple-wo/${id}`)
      setWo(r.data)
    } catch (err) {
      alert(err.response?.data?.error || 'เซ็นไม่สำเร็จ')
    } finally { setBusy(false) }
  }
  const openSign = (slot) => { setSignName(user?.name || ''); setSignSlot(slot) }

  // Run an approval-workflow transition then refresh the WO.
  const transition = async (action) => {
    let reason
    if (action === 'reject') {
      reason = window.prompt('เหตุผลที่ส่งกลับ (ให้ช่างแก้)')
      if (reason === null) return
    }
    if (action === 'reopen' && !window.confirm('ปลดล็อกใบงานนี้กลับเป็น "รอตรวจ"?')) return
    setBusy(true)
    try {
      await api.post(`/simple-wo/${id}/transition`, { action, reason })
      const r = await api.get(`/simple-wo/${id}`)
      setWo(r.data)
    } catch (err) {
      alert(err.response?.data?.error || 'ทำรายการไม่สำเร็จ')
    } finally { setBusy(false) }
  }

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
  const cond = wo.condition || {}
  const ac = wo.ac_info || {}
  const AC_KIND_LABEL = { water: 'แอร์น้ำ', refrigerant: 'แอร์น้ำยา', other: 'อื่นๆ' }
  const photos = Array.isArray(wo.photo_urls) ? wo.photo_urls : []
  const gallery = Array.isArray(wo.gallery_urls) ? wo.gallery_urls : []
  const result = RESULT_LABEL[wo.result]
  const dateVal = wo.work_date || wo.created_at
  const isGrid = wo.work_type === 'minor' || wo.work_type === 'fan'
  const gridRows = Array.isArray(wo.grid_rows) ? wo.grid_rows : []
  const gridCols = GRID_COLS[wo.work_type] || []
  // พร้อมวางบิล = เซ็นครบ 4 ช่อง และยังไม่วางบิล (approved)
  const SIGN_ORDER = ['team', 'supervisor', 'building', 'engineer']
  // ช่างอาคาร + วิศวกรรม เซ็นพร้อมกันได้ (ขนาน) — ต้องการแค่ ช่างแอร์ + หัวหน้า
  const SIG_PREREQ = { team: [], supervisor: ['team'], building: ['team', 'supervisor'], engineer: ['team', 'supervisor'] }
  const signed = (s) => !!wo[`sig_${s}`]
  // เซ็นครบ = ช่างแอร์ + หัวหน้า + (อาคาร หรือ วิศวกรรม อย่างน้อย 1)
  const allSigned = signed('team') && signed('supervisor') && (signed('building') || signed('engineer'))
  const readyBill = allSigned && wo.status !== 'approved'
  // A slot is signable once its prerequisites are signed.
  const priorsSigned = (slot) => (SIG_PREREQ[slot] || []).every(signed)
  // Which signature the ใบงาน is waiting on (อาคาร/วิศวกรรม = เซ็น 1 ใน 2 พอ).
  const pendingStage =
    !signed('team') ? 'team'
      : !signed('supervisor') ? 'supervisor'
      : (!signed('building') && !signed('engineer')) ? 'building_engineer'
      : 'done'
  const STAGE_BADGE = {
    team:              { label: 'ยังไม่เสร็จ',          color: 'badge-warn' },
    supervisor:        { label: 'รอหัวหน้าตรวจงาน',      color: 'badge-warn' },
    building_engineer: { label: 'รออาคาร/วิศวกรรม (เซ็น 1)', color: 'bg-indigo-50 text-indigo-600' },
    done:              { label: 'รอวางบิล',              color: 'badge-success' },
  }

  // PDF มีให้ดาวน์โหลดเฉพาะใบที่วางบิลแล้ว (approved)
  const billed = wo.status === 'approved'

  return (
    <Layout
      title={wo.wo_number || `ใบงาน #${id}`}
      back="/simple-wo"
      actions={
        billed ? (
          <button onClick={downloadPdf} disabled={busy} className="p-1 rounded-lg text-ink-muted hover:bg-page">
            <FileText className="h-5 w-5" />
          </button>
        ) : null
      }
    >
      <div className="px-4 pt-4 pb-8 flex flex-col gap-4 max-w-2xl mx-auto w-full">

        {/* WO number + status badge */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="badge badge-primary text-sm px-3 py-1">{wo.wo_number || `#${id}`}</span>
          <div className="flex items-center gap-2">
            {(() => {
              const st = wo.status || 'submitted'
              const s = st === 'approved' ? STATUS_LABEL.approved
                : st === 'rejected' ? STATUS_LABEL.rejected
                : (STAGE_BADGE[pendingStage] || STATUS_LABEL[st])
              return s && <span className={`badge ${s.color}`}>{s.label}</span>
            })()}
            {result && <span className={`badge ${result.color}`}>{result.label}</span>}
          </div>
        </div>
        {wo.status === 'rejected' && wo.reject_reason && (
          <div className="rounded-input bg-danger-soft text-danger text-sm px-3 py-2">
            <span className="font-medium">ส่งกลับ:</span> {wo.reject_reason}
          </div>
        )}

        {/* Header info */}
        <div className="card">
          <h2 className="section-header mb-3">ข้อมูลทั่วไป</h2>
          <InfoRow label="ช่าง" value={wo.tech_name} />
          <InfoRow label="วันที่" value={dateVal ? dayjs(dateVal).format('DD/MM/YYYY') : '-'} />
          <InfoRow label="ลูกค้า" value={wo.client_name} />
          {wo.pts_zone && <InfoRow label="สัญญา/โซน" value={wo.pts_zone} />}
          <InfoRow label="สถานที่" value={wo.location || wo.client_name} />
          <InfoRow label="อาคาร" value={wo.building} />
          <InfoRow label="ชั้น" value={wo.floor} />
          {!isGrid && <InfoRow label="ห้อง/แผนก" value={wo.room} />}
          {!isGrid && <InfoRow label="เลขเครื่อง" value={wo.asset_code} />}
          <InfoRow label="ประเภทงาน" value={WORK_TYPE_LABEL[wo.work_type] || wo.work_type} />
          {wo.work_type !== 'fan' && <InfoRow label="ประเภทแอร์" value={wo.ac_type || '-'} />}
          {wo.work_type === 'fan' && <InfoRow label="ประเภทพัดลม" value={wo.ac_type || '-'} />}
          {wo.work_type === 'major' && <InfoRow label="ระบบไฟ" value={wo.power_system ? `${wo.power_system}V` : '-'} />}
          <InfoRow label="เวลาเริ่ม" value={wo.start_time} />
          <InfoRow label="เวลาเสร็จ" value={wo.end_time} />
        </div>

        {/* Grid form (ล้างย่อย / พัดลม) — list of units + checks */}
        {isGrid && (
          <div className="card flex flex-col gap-3">
            <h2 className="section-header">รายการเครื่อง ({gridRows.length})</h2>
            {gridRows.length === 0 && <p className="text-sm text-ink-muted">ไม่มีรายการ</p>}
            {gridRows.map((r, i) => (
              <div key={i} className="rounded-xl border border-line p-3">
                <p className="font-medium text-ink mb-1.5">
                  {i + 1}. {isGrid && (r.room || r.machine_no)
                    ? `${r.room || '–'} · เลขเครื่อง ${r.machine_no || r.name || '–'}`
                    : (r.name || '-')}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {gridCols.map((c, ci) => (
                    <span key={ci} className={(r.checks || [])[ci] ? 'text-primary' : 'text-ink-muted line-through'}>
                      {(r.checks || [])[ci] ? '✓' : '✗'} {c}
                    </span>
                  ))}
                </div>
                {wo.work_type === 'fan' && r.broken && <p className="text-sm text-danger mt-1.5">ชำรุด: {r.broken}</p>}
                {r.photos && Object.values(r.photos).some(Boolean) && (
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {[['before', 'ก่อนล้าง'], ['after', 'หลังล้าง'], ['during', 'ขณะปฏิบัติงาน']].map(([k, label]) => (
                      <div key={k} className="text-center">
                        <div className="text-[11px] text-ink-muted mb-0.5">{label}</div>
                        {r.photos[k]
                          ? <a href={photoSrc(r.photos[k])} target="_blank" rel="noreferrer"><img src={photoSrc(r.photos[k])} alt={label} loading="lazy" className="w-full aspect-square object-cover rounded-lg border border-line" /></a>
                          : <div className="w-full aspect-square rounded-lg border border-dashed border-line flex items-center justify-center text-ink-muted text-xs">—</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {isGrid && wo.recommendation && (
          <div className="card">
            <h2 className="section-header mb-2">ข้อแนะนำ</h2>
            <p className="text-sm text-ink whitespace-pre-wrap">{wo.recommendation}</p>
          </div>
        )}

        {/* AC info (รายละเอียดเครื่องปรับอากาศ) — major only */}
        {!isGrid && (
        <div className="card">
          <h2 className="section-header mb-3">รายละเอียดเครื่องปรับอากาศ</h2>
          {/* รายละเอียดเครื่อง/ตำแหน่งที่ติดตั้ง = เลขเครื่อง/ห้อง อยู่ใน ข้อมูลทั่วไป แล้ว */}
          <InfoRow label="ชนิดเครื่อง" value={AC_KIND_LABEL[ac.kind] || '-'} />
          <InfoRow label="ยี่ห้อ" value={ac.brand} />
          <InfoRow label="รุ่น" value={ac.model} />
          <InfoRow label="ขนาดทำความเย็น (BTU)" value={ac.cooling_size} />
          <InfoRow label="หมายเลขเครื่อง (Nameplate)" value={ac.serial} />
        </div>
        )}

        {/* Checklist values — grouped by section, with item labels — major only */}
        {!isGrid && schema.sections.map((section) => (
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
        {!isGrid && schema.sections.length === 0 && Object.keys(cv).length > 0 && (
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

        {/* Team comment — major only */}
        {!isGrid && (
        <div className="card">
          <h2 className="section-header mb-3">ความเห็นทีมช่าง</h2>
          <div className="flex flex-col gap-1.5 text-sm">
            <Flag on={tc.ac_degraded} label="แอร์เสื่อมสภาพ" />
            <Flag on={tc.ac_old_5_7yr} label="แอร์อายุ 5-7 ปี" />
            <Flag on={tc.external_degraded} label={`คอยล์ร้อนเสื่อม${tc.external_detail ? ` — ${tc.external_detail}` : ''}`} />
            <Flag on={tc.internal_degraded} label={`คอยล์เย็นเสื่อม${tc.internal_detail ? ` — ${tc.internal_detail}` : ''}`} />
          </div>
        </div>
        )}

        {/* สภาพแอร์ / แจ้งเปลี่ยนอะไหล่ */}
        {!isGrid && cond && (cond.issues?.length || cond.issues_other || cond.health_reason || cond.priority) ? (
        <div className="card">
          <h2 className="section-header mb-3">สภาพแอร์ / แจ้งเปลี่ยนอะไหล่</h2>
          {(cond.issues?.length || cond.issues_other) ? (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {(cond.issues || []).map((k) => {
                const pr = cond.issue_priority?.[k] || cond.priority;
                return (
                  <span key={k} className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-2 py-0.5">
                    {CONDITION_ISSUE_LABEL[k] || k}
                    {pr && (
                      <span className="text-[10px] font-medium px-1 rounded text-white" style={{ background: PRIORITY_COLOR[pr] || '#94a3b8' }}>
                        {PRIORITY_LABEL[pr] || pr}
                      </span>
                    )}
                  </span>
                );
              })}
              {cond.issues_other && (
                <span className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-full px-2 py-0.5">{cond.issues_other}</span>
              )}
            </div>
          ) : null}
          <div className="flex flex-col gap-1 text-sm">
            {cond.health_pct !== '' && cond.health_pct != null && (
              <InfoRow label="สภาพโดยรวม" value={`${cond.health_pct}%`} />
            )}
            {cond.health_reason && <InfoRow label="เหตุผล" value={cond.health_reason} />}
          </div>
        </div>
        ) : null}

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
                  <img src={photoSrc(p.url)} alt="" loading="lazy" decoding="async" className="w-full aspect-square object-cover rounded-lg border border-line" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Signatures — each role signs its own slot here (no need to open edit) */}
        <div className="card">
          <h2 className="section-header mb-3">ลายเซ็น</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {SIG_DEFS.map(({ slot, label }) => {
              const isSigned = !!wo[`sig_${slot}`]
              const mine = canSignSlot(slot) && wo.status !== 'approved'
              const ready = priorsSigned(slot)
              const canSign = mine && ready
              // the prerequisite still missing (e.g. engineer waits on หัวหน้าช่าง, not ช่างอาคาร)
              const blockSlot = (SIG_PREREQ[slot] || []).find((p) => !signed(p))
              const prevLabel = SIG_DEFS.find((d) => d.slot === blockSlot)?.label
              return (
                <div key={slot} className="flex flex-col gap-1.5">
                  <SigBox label={label} name={wo[`sig_${slot}_name`]} data={wo[`sig_${slot}`]} />
                  {canSign && (
                    <button onClick={() => openSign(slot)} disabled={busy}
                      className="btn-secondary text-xs flex items-center justify-center gap-1 py-1.5">
                      <PenLine className="h-3.5 w-3.5" /> {isSigned ? 'เซ็นใหม่' : 'เซ็น'}
                    </button>
                  )}
                  {mine && !ready && !isSigned && (
                    <span className="text-[11px] text-ink-muted text-center">รอ “{prevLabel}” เซ็นก่อน</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Approval workflow ── */}
        {(() => {
          const status = wo.status || 'submitted'
          const REVIEW = ['checker', 'approve_building', 'approve_engineer', 'approver', 'admin', 'super_admin']
          const canReject   = status === 'submitted' && REVIEW.includes(role)
          const canReopen   = ['approved', 'rejected'].includes(status) && privileged
          const canResubmit = status === 'rejected' && ['technician', 'checker', 'admin', 'super_admin'].includes(role)
          if (!(canReject || canReopen || canResubmit)) return null
          return (
            <div className="card flex flex-col gap-2">
              <h2 className="section-header">ขั้นตอนงาน</h2>
              <div className="flex flex-wrap gap-2">
                {canResubmit && (
                  <button onClick={() => transition('resubmit')} disabled={busy} className="btn-primary flex items-center gap-1.5">
                    <Send className="h-4 w-4" /> แก้แล้ว ส่งกลับมาตรวจ
                  </button>
                )}
                {canReject && (
                  <button onClick={() => transition('reject')} disabled={busy} className="btn-danger flex items-center gap-1.5">
                    <Undo2 className="h-4 w-4" /> ส่งกลับ
                  </button>
                )}
                {canReopen && (
                  <button onClick={() => transition('reopen')} disabled={busy} className="btn-secondary flex items-center gap-1.5">
                    <RotateCcw className="h-4 w-4" /> ปลดล็อก
                  </button>
                )}
              </div>
              {canResubmit && <p className="text-xs text-ink-muted">แก้ไขใบงานให้เรียบร้อยก่อน แล้วกด “ส่งกลับมาตรวจ”</p>}
            </div>
          )
        })()}

        {/* Actions — edit/delete locked once approved (except admin/super) */}
        {!(wo.status === 'approved' && !privileged) && (
          <button
            onClick={() => navigate(`/simple-wo/${id}/edit`)}
            disabled={busy}
            className="btn-secondary w-full flex items-center justify-center gap-2"
          >
            <Pencil className="h-4 w-4" /> แก้ไขใบงาน
          </button>
        )}
        {billed && (
          <button onClick={downloadPdf} disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2">
            <FileText className="h-5 w-5" /> ดาวน์โหลด PDF
          </button>
        )}

        {/* Delete */}
        {!(wo.status === 'approved' && !privileged) && (
          <button
            onClick={remove}
            disabled={busy}
            className="btn-danger w-full flex items-center justify-center gap-2"
          >
            <Trash2 className="h-4 w-4" /> ลบใบงาน
          </button>
        )}
      </div>

      {/* Sign one slot (decoupled from edit) */}
      {signSlot && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSignSlot(null)} />
          <div className="relative bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto">
            <h3 className="font-semibold text-ink mb-3">
              เซ็น — {SIG_DEFS.find((d) => d.slot === signSlot)?.label}
            </h3>
            <div className="mb-3">
              <label className="label">ชื่อผู้ลงนาม</label>
              <input className="input" placeholder="ชื่อผู้ลงนาม" value={signName} onChange={(e) => setSignName(e.target.value)} />
            </div>
            <SignaturePad onSave={submitSign} onCancel={() => setSignSlot(null)} />
            {busy && <p className="text-xs text-ink-muted mt-2 text-center">กำลังบันทึก...</p>}
          </div>
        </div>
      )}
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
      if (String(ps) === '220')
        return `220V 1φ · LN/L — ก่อน ${g(v.val_ln_before)}V/${g(v.val_l_before)}A · หลัง ${g(v.val_ln_after)}V/${g(v.val_l_after)}A`
      return `380V 3φ · R/S/T — ก่อน ${g(v.val_r_before)}/${g(v.val_s_before)}/${g(v.val_t_before)} · หลัง ${g(v.val_r_after)}/${g(v.val_s_after)}/${g(v.val_t_after)} A`
    }
    case 'ln_vi':
      if (String(v.power_system) === '380')
        return `3 เฟส · R ${g(v.val_r_v_after)}V/${g(v.val_r_after)}A · S ${g(v.val_s_v_after)}V/${g(v.val_s_after)}A · T ${g(v.val_t_v_after)}V/${g(v.val_t_after)}A`
      return `1 เฟส · LN ${g(v.val_ln_after)}V · L ${g(v.val_l_after)}A`
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
            <img src={photoSrc(p.url)} alt="" loading="lazy" decoding="async" className="w-full aspect-square object-cover rounded-xl border border-line" />
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
