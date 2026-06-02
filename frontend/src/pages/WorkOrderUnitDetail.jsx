/**
 * WorkOrderUnitDetail — /work-orders/:id/units/:unitId
 * unitId = work_order_unit_id (the junction table row id)
 *
 * Loads inspection-template by equipment_type + wo.type,
 * renders grouped checklist + before/after inputs,
 * auto-saves (debounced 1.5 s) on any change.
 *
 * Photos uploaded per phase (before/after/measurement) via
 * <input type="file" capture="environment">.
 *
 * TODO: area_owner no-login token flow is a later phase.
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Camera, AlertTriangle, Trash2 } from 'lucide-react'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api, { uploadsBase } from '../api/client'
import { enqueueInspection, enqueuePhoto, getPendingPhotos } from '../lib/offline/sync'

const PHASES = [
  { key: 'before',      label: 'ก่อนล้าง' },
  { key: 'after',       label: 'หลังล้าง' },
  { key: 'measurement', label: 'การวัดค่า' },
]

export default function WorkOrderUnitDetail() {
  const { id: woId, unitId } = useParams()
  const navigate = useNavigate()

  const [wo, setWo]       = useState(null)
  const [item, setItem]   = useState(null)
  const [template, setTemplate] = useState([]) // [{id,category,item_label,value_type,unit_label,sort_order}]
  const [photos, setPhotos]     = useState([]) // flat list for this unit
  const [loading, setLoading]   = useState(true)

  // Inspection values keyed by template_item_id
  const [values, setValues]         = useState({}) // { [template_item_id]: {value_before, value_after, checked, note} }
  const [hasRepair, setHasRepair]   = useState(false)
  const [repairNotes, setRepairNotes] = useState('')

  // Auto-save
  const saveTimer = useRef(null)
  const [saveStatus, setSaveStatus] = useState('') // '' | 'saving' | 'saved' | 'error'

  // Photo upload
  const fileInputRef    = useRef(null)
  const [uploadingPhase, setUploadingPhase] = useState(null)
  const [uploadingPointNo, setUploadingPointNo] = useState(null)

  // Lightbox
  const [lightbox, setLightbox] = useState(null)

  // Tab
  const [tab, setTab] = useState('checklist')

  // "ขอเปิด" — explicit repair request (creates repair_logs status 'open')
  const [repairOpen, setRepairOpen]       = useState(false)
  const [repairProblem, setRepairProblem] = useState('')
  const [repairBusy, setRepairBusy]       = useState(false)
  const [repairDone, setRepairDone]       = useState(false)

  const submitRepairRequest = async () => {
    if (!repairProblem.trim()) return
    setRepairBusy(true)
    try {
      await api.post(`/work-orders/${woId}/repair-request`, {
        work_order_unit_id: Number(unitId),
        problem: repairProblem.trim(),
      })
      setRepairDone(true)
      setRepairOpen(false)
      setRepairProblem('')
    } catch (err) {
      alert(err.response?.data?.error || 'ขอเปิดไม่สำเร็จ')
    } finally {
      setRepairBusy(false)
    }
  }

  const load = useCallback(async () => {
    try {
      const [woRes, photosRes] = await Promise.all([
        api.get(`/work-orders/${woId}`),
        api.get(`/work-orders/${woId}/photos`).catch(() => ({ data: {} })),
      ])
      const woData   = woRes.data
      const itemData = (woData.items || []).find((i) => String(i.id) === String(unitId))
      setWo(woData)
      setItem(itemData || null)

      // Flatten photos for this unit — server photos + locally-queued (offline) ones
      const photosMap = photosRes.data || {}
      const serverPhotos = photosMap[unitId] || []
      const pending = (await getPendingPhotos(woId).catch(() => []))
        .filter((p) => String(p.work_order_unit_id) === String(unitId))
      setPhotos([...serverPhotos, ...pending])

      // Seed values from existing inspections
      const existing = (woData.inspections || []).filter(
        (i) => String(i.work_order_unit_id) === String(unitId)
      )
      const seedVals = {}
      existing.forEach((i) => {
        seedVals[i.template_item_id] = {
          value_before: i.value_before ?? '',
          value_after:  i.value_after  ?? '',
          checked:      !!i.checked,
          note:         i.note ?? '',
        }
      })
      setValues(seedVals)

      if (itemData) {
        setHasRepair(!!itemData.has_repair)
        setRepairNotes(itemData.repair_notes || '')
      }

      // Load template
      if (itemData) {
        const eqType = itemData.equipment_type || (itemData.family ? 'ac' : 'ac')
        const tRes = await api.get(
          `/master/inspection-template?equipment_type=${eqType}&type=${woData.type}`
        ).catch(() => ({ data: [] }))
        setTemplate(tRes.data || [])
      }
    } finally {
      setLoading(false)
    }
  }, [woId, unitId])

  useEffect(() => { load() }, [load])

  // Debounced auto-save
  const scheduleAutoSave = useCallback((nextValues, nextHasRepair, nextRepairNotes) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    saveTimer.current = setTimeout(async () => {
      try {
        const payload = {
          work_order_unit_id: Number(unitId),
          values: Object.entries(nextValues).map(([tid, v]) => ({
            template_item_id: Number(tid),
            value_before: v.value_before || null,
            value_after:  v.value_after  || null,
            checked:      !!v.checked,
            note:         v.note || null,
          })),
          // has_repair/repair_notes intentionally omitted — repairs are raised
          // via the explicit "ขอเปิด" action, not the inspection auto-save.
        }
        // Persist to the offline outbox (IndexedDB) and let the sync engine push
        // it to the server. Works the same online or offline; the global
        // SyncIndicator shows whether it has reached the server yet.
        await enqueueInspection(woId, payload)
        setSaveStatus('saved')
      } catch {
        setSaveStatus('error')
      }
    }, 1500)
  }, [woId, unitId])

  const updateValue = (tid, field, val) => {
    const next = {
      ...values,
      [tid]: { ...(values[tid] || {}), [field]: val },
    }
    setValues(next)
    scheduleAutoSave(next, hasRepair, repairNotes)
  }

  const updateRepair = (newHasRepair, newRepairNotes) => {
    setHasRepair(newHasRepair)
    setRepairNotes(newRepairNotes)
    scheduleAutoSave(values, newHasRepair, newRepairNotes)
  }

  // Photo upload
  const triggerPhotoUpload = (phase, pointNo) => {
    setUploadingPhase(phase)
    setUploadingPointNo(pointNo)
    fileInputRef.current.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      // Queue the photo (with its blob) in the outbox. Optimistically show it
      // right away with a "รอ sync" badge; the engine uploads it when online.
      const fields = {
        work_order_unit_id: String(unitId),
        phase: uploadingPhase,
        point_no: String(uploadingPointNo),
        label: `${uploadingPhase} ${uploadingPointNo}`,
      }
      const token = await enqueuePhoto(woId, fields, file)
      setPhotos((prev) => [
        ...prev,
        {
          id: `photo:${token}`,
          token,
          work_order_unit_id: Number(unitId),
          phase: uploadingPhase,
          point_no: uploadingPointNo,
          label: fields.label,
          objectUrl: URL.createObjectURL(file),
          pending: true,
        },
      ])
    } catch (err) {
      alert(err.response?.data?.error || 'บันทึกรูปไม่สำเร็จ')
    } finally {
      setUploadingPhase(null)
      setUploadingPointNo(null)
    }
  }

  const deletePhoto = async (photo) => {
    if (photo.pending) return // queued photos: leave to sync (kept simple for v1)
    if (!confirm('ลบรูปนี้?')) return
    try {
      await api.delete(`/work-orders/${woId}/photos/${photo.id}`)
      setPhotos((p) => p.filter((x) => x.id !== photo.id))
    } catch (err) {
      alert(err.response?.data?.error || 'ลบไม่สำเร็จ')
    }
  }

  if (loading) return <PageSpinner />
  if (!item)   return <div className="p-4 text-red-600">ไม่พบข้อมูลอุปกรณ์ (unitId={unitId})</div>

  const canEdit = ['in_progress', 'rejected'].includes(wo?.status)

  // Group template by category
  const categories = []
  const catMap = {}
  template.forEach((ti) => {
    const cat = ti.category || 'ทั่วไป'
    if (!catMap[cat]) { catMap[cat] = []; categories.push(cat) }
    catMap[cat].push(ti)
  })

  const photosByPhase = (phase) => photos.filter((p) => p.phase === phase)

  const photoUrl = (url) => (url ? `${uploadsBase}${url}` : null)

  return (
    <Layout
      title={`${item.asset_code} — ${item.unit_name || ''}`}
      back={`/work-orders/${woId}`}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Meta */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-xs text-gray-500">
          {item.room_name} {item.building_name ? `· ${item.building_name}` : ''} · {item.family || item.equipment_type}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 bg-white sticky top-14 z-20">
        {[
          { key: 'checklist', label: 'รายการตรวจ' },
          { key: 'photos',    label: 'รูปภาพ' },
        ].map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`flex-1 py-3 text-sm font-medium ${
              tab === tb.key ? 'tab-active' : 'tab-inactive'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Auto-save indicator */}
      {saveStatus && (
        <div className={`text-xs text-center py-1 ${
          saveStatus === 'saving' ? 'text-gray-400' :
          saveStatus === 'saved'  ? 'text-green-600' : 'text-red-500'
        }`}>
          {saveStatus === 'saving' ? 'กำลังบันทึก...' : saveStatus === 'saved' ? 'บันทึกแล้ว' : 'บันทึกไม่สำเร็จ'}
        </div>
      )}

      <div className="px-4 pt-4 pb-10">

        {/* ── Checklist tab ── */}
        {tab === 'checklist' && (
          <div className="flex flex-col gap-5">
            {categories.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">ไม่มี template สำหรับประเภทนี้</p>
            )}
            {categories.map((cat) => (
              <div key={cat}>
                <h3 className="font-semibold text-gray-700 text-sm mb-2 border-b border-gray-100 pb-1">{cat}</h3>
                <div className="flex flex-col gap-3">
                  {catMap[cat].map((ti) => {
                    const v = values[ti.id] || {}
                    return (
                      <div key={ti.id} className="bg-white border border-gray-100 rounded-xl p-3">
                        <p className="text-sm font-medium text-gray-800 mb-2">{ti.item_label}</p>

                        {ti.value_type === 'check' && (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              className="h-5 w-5 accent-blue-600"
                              checked={!!v.checked}
                              disabled={!canEdit}
                              onChange={(e) => updateValue(ti.id, 'checked', e.target.checked)}
                            />
                            <span className="text-sm text-gray-600">ผ่าน / ดำเนินการแล้ว</span>
                          </label>
                        )}

                        {ti.value_type === 'number' && (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="any"
                              placeholder="ค่า"
                              disabled={!canEdit}
                              value={v.value_after || ''}
                              onChange={(e) => updateValue(ti.id, 'value_after', e.target.value)}
                              className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                            />
                            {ti.unit_label && <span className="text-xs text-gray-500">{ti.unit_label}</span>}
                          </div>
                        )}

                        {ti.value_type === 'before_after' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-gray-500 mb-0.5 block">ก่อน</label>
                              <input
                                type="number"
                                step="any"
                                placeholder="0"
                                disabled={!canEdit}
                                value={v.value_before || ''}
                                onChange={(e) => updateValue(ti.id, 'value_before', e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 mb-0.5 block">หลัง {ti.unit_label ? `(${ti.unit_label})` : ''}</label>
                              <input
                                type="number"
                                step="any"
                                placeholder="0"
                                disabled={!canEdit}
                                value={v.value_after || ''}
                                onChange={(e) => updateValue(ti.id, 'value_after', e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                              />
                            </div>
                          </div>
                        )}

                        {ti.value_type === 'text' && (
                          <textarea
                            rows={2}
                            disabled={!canEdit}
                            placeholder="บันทึก..."
                            value={v.note || ''}
                            onChange={(e) => updateValue(ti.id, 'note', e.target.value)}
                            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* ขอเปิด — แจ้งแอร์ผิดปกติ (สร้างคำขอเปิดงานซ่อม) */}
            <div className="card">
              {repairDone ? (
                <p className="flex items-center gap-2 text-sm font-medium text-green-700">
                  <AlertTriangle className="h-4 w-4" /> ส่งคำขอเปิดแล้ว
                </p>
              ) : !repairOpen ? (
                <button
                  type="button"
                  onClick={() => setRepairOpen(true)}
                  className="flex items-center gap-2 text-sm font-medium text-red-700"
                >
                  <AlertTriangle className="h-4 w-4" /> ขอเปิด (พบแอร์ผิดปกติ)
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-red-700">
                    <AlertTriangle className="h-4 w-4" /> ขอเปิด — ระบุอาการผิดปกติ
                  </span>
                  <textarea
                    className="input"
                    rows={3}
                    placeholder="อาการ / ปัญหาที่พบ..."
                    value={repairProblem}
                    onChange={(e) => setRepairProblem(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={submitRepairRequest}
                      disabled={repairBusy || !repairProblem.trim()}
                      className="btn-primary text-sm py-2 disabled:opacity-50"
                    >
                      {repairBusy ? 'กำลังส่ง...' : 'ส่งคำขอเปิด'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRepairOpen(false); setRepairProblem('') }}
                      className="text-sm text-gray-500 px-3"
                    >
                      ยกเลิก
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Photos tab ── */}
        {tab === 'photos' && (
          <div className="flex flex-col gap-6">
            {PHASES.map(({ key: phase, label }) => {
              const phasePhotos = photosByPhase(phase)
              return (
                <div key={phase}>
                  <h3 className="font-semibold text-gray-800 text-sm mb-2">
                    {label}
                    <span className="ml-2 text-gray-400 font-normal text-xs">({phasePhotos.length} รูป)</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {phasePhotos.map((p) => {
                      const src = p.pending ? p.objectUrl : photoUrl(p.url)
                      return (
                      <div key={p.id} className="rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                        <div className="relative">
                          <img
                            src={src}
                            alt={p.label}
                            className="w-full aspect-square object-cover cursor-zoom-in"
                            onClick={() => setLightbox({ url: src, label: p.label })}
                          />
                          {p.pending && (
                            <span className="absolute top-1.5 left-1.5 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                              รอ sync
                            </span>
                          )}
                          {canEdit && !p.pending && (
                            <button
                              onClick={() => deletePhoto(p)}
                              className="absolute top-1.5 right-1.5 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="px-2 py-1">
                          <p className="text-xs text-gray-500 truncate">{p.label || `${phase}`}</p>
                        </div>
                      </div>
                      )
                    })}

                    {/* Add photo button */}
                    {canEdit && (
                      <button
                        onClick={() => triggerPhotoUpload(phase, phasePhotos.length + 1)}
                        disabled={uploadingPhase === phase}
                        className="rounded-xl border-2 border-dashed border-gray-300 aspect-square flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50"
                      >
                        {uploadingPhase === phase ? (
                          <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-600" />
                        ) : (
                          <>
                            <Camera className="h-7 w-7" />
                            <span className="text-xs">ถ่ายรูป</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black flex flex-col"
          onClick={() => setLightbox(null)}
        >
          <div className="flex items-center justify-between px-4 py-3 shrink-0">
            <p className="text-white text-sm font-medium truncate pr-4">{lightbox.label}</p>
            <button onClick={() => setLightbox(null)} className="text-white text-3xl leading-none shrink-0">&times;</button>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden px-2 pb-4">
            <img
              src={lightbox.url}
              alt={lightbox.label}
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </Layout>
  )
}
