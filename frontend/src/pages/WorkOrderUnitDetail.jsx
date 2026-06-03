/**
 * WorkOrderUnitDetail — /work-orders/:id/units/:unitId
 * unitId = work_order_unit_id (the junction table row id)
 *
 * Loads inspection-template by equipment_type + wo.type,
 * renders grouped checklist + before/after inputs,
 * auto-saves (debounced 1.5 s) on any change.
 *
 * Photos uploaded per photo-point × phase (before/after) via
 * <input type="file" capture="environment">.
 *
 * New value_types: rst_amp | ln_vi | pressure_pair
 * Photo points: fetched from GET /master/photo-points
 * Team condition: PUT /work-orders/:id/condition (debounced online)
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
import { compressImage } from '../lib/image'
import { useOfflineStore } from '../store/offline'

export default function WorkOrderUnitDetail() {
  const { id: woId, unitId } = useParams()
  const navigate = useNavigate()

  const [wo, setWo]       = useState(null)
  const [item, setItem]   = useState(null)
  const [template, setTemplate] = useState([]) // [{id,category,item_label,value_type,unit_label,sort_order}]
  const [photoPoints, setPhotoPoints] = useState([]) // [{point_no,label,required}]
  const [photos, setPhotos]     = useState([]) // flat list for this unit
  const [loading, setLoading]   = useState(true)

  // Inspection values keyed by template_item_id
  const [values, setValues]         = useState({}) // { [template_item_id]: { ...all LMT fields } }
  const [hasRepair, setHasRepair]   = useState(false)
  const [repairNotes, setRepairNotes] = useState('')

  // Auto-save
  const saveTimer = useRef(null)
  const [saveStatus, setSaveStatus] = useState('') // '' | 'saving' | 'saved' | 'error'

  // Photo upload
  const fileInputRef    = useRef(null)
  const [uploadingPhase, setUploadingPhase] = useState(null)
  const [uploadingPointNo, setUploadingPointNo] = useState(null)
  const [uploadingLabel, setUploadingLabel] = useState(null)

  // Lightbox
  const [lightbox, setLightbox] = useState(null)

  // Tab
  const [tab, setTab] = useState('checklist')

  // "ขอเปิด" — explicit repair request (creates repair_logs status 'open')
  const [repairOpen, setRepairOpen]       = useState(false)
  const [repairProblem, setRepairProblem] = useState('')
  const [repairBusy, setRepairBusy]       = useState(false)
  const [repairDone, setRepairDone]       = useState(false)

  // Team condition (ความเห็นทีมช่าง)
  const [cond, setCond] = useState({
    cond_ac_degraded: false,
    cond_ac_old_5_7yr: false,
    cond_external_degraded: false,
    cond_external_detail: '',
    cond_internal_degraded: false,
    cond_internal_detail: '',
  })
  const condTimer = useRef(null)

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
          value_before:   i.value_before   ?? '',
          value_after:    i.value_after    ?? '',
          checked:        !!i.checked,
          note:           i.note           ?? '',
          val_r_before:   i.val_r_before   ?? '',
          val_s_before:   i.val_s_before   ?? '',
          val_t_before:   i.val_t_before   ?? '',
          val_r_after:    i.val_r_after    ?? '',
          val_s_after:    i.val_s_after    ?? '',
          val_t_after:    i.val_t_after    ?? '',
          val_ln_before:  i.val_ln_before  ?? '',
          val_l_before:   i.val_l_before   ?? '',
          val_ln_after:   i.val_ln_after   ?? '',
          val_l_after:    i.val_l_after    ?? '',
          val_suction:    i.val_suction    ?? '',
          val_discharge:  i.val_discharge  ?? '',
          refrigerant_type: i.refrigerant_type ?? '',
          power_system:   i.power_system   ?? '',
        }
      })
      setValues(seedVals)

      if (itemData) {
        setHasRepair(!!itemData.has_repair)
        setRepairNotes(itemData.repair_notes || '')
      }

      // Seed condition fields from WO
      setCond({
        cond_ac_degraded:      !!woData.cond_ac_degraded,
        cond_ac_old_5_7yr:     !!woData.cond_ac_old_5_7yr,
        cond_external_degraded: !!woData.cond_external_degraded,
        cond_external_detail:   woData.cond_external_detail || '',
        cond_internal_degraded: !!woData.cond_internal_degraded,
        cond_internal_detail:   woData.cond_internal_detail || '',
      })

      // Load template + photo points
      if (itemData) {
        const eqType = itemData.equipment_type || 'ac'
        const [tRes, ppRes] = await Promise.all([
          api.get(`/master/inspection-template?equipment_type=${eqType}&type=${woData.type}`)
            .catch(() => ({ data: [] })),
          api.get(`/master/photo-points?equipment_type=${eqType}&work_type=${woData.type}`)
            .catch(() => ({ data: [] })),
        ])
        setTemplate(tRes.data || [])
        setPhotoPoints(ppRes.data || [])
      }
    } finally {
      setLoading(false)
    }
  }, [woId, unitId])

  useEffect(() => { load() }, [load])

  // When the offline outbox drains (pending photos finished syncing), reload so
  // the optimistic "รอ sync" photos are replaced by the real server records —
  // this is what makes the submit photo-gate pass after capture.
  const pendingCount = useOfflineStore((s) => s.pending)
  const prevPending = useRef(0)
  useEffect(() => {
    if (prevPending.current > 0 && pendingCount === 0) load()
    prevPending.current = pendingCount
  }, [pendingCount, load])

  // Debounced auto-save inspection
  const scheduleAutoSave = useCallback((nextValues) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')
    saveTimer.current = setTimeout(async () => {
      try {
        const payload = {
          work_order_unit_id: Number(unitId),
          values: Object.entries(nextValues).map(([tid, v]) => ({
            template_item_id: Number(tid),
            value_before:     v.value_before   || null,
            value_after:      v.value_after    || null,
            checked:          !!v.checked,
            note:             v.note           || null,
            val_r_before:     v.val_r_before   || null,
            val_s_before:     v.val_s_before   || null,
            val_t_before:     v.val_t_before   || null,
            val_r_after:      v.val_r_after    || null,
            val_s_after:      v.val_s_after    || null,
            val_t_after:      v.val_t_after    || null,
            val_ln_before:    v.val_ln_before  || null,
            val_l_before:     v.val_l_before   || null,
            val_ln_after:     v.val_ln_after   || null,
            val_l_after:      v.val_l_after    || null,
            val_suction:      v.val_suction    || null,
            val_discharge:    v.val_discharge  || null,
            refrigerant_type: v.refrigerant_type || null,
            power_system:     v.power_system   || null,
          })),
        }
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
    scheduleAutoSave(next)
  }

  // Condition debounced PUT (online only — no need to offline-queue)
  const scheduleSaveCond = useCallback((nextCond) => {
    if (condTimer.current) clearTimeout(condTimer.current)
    condTimer.current = setTimeout(async () => {
      try {
        await api.put(`/work-orders/${woId}/condition`, nextCond)
      } catch {
        // silently ignore — not critical for offline flow
      }
    }, 1200)
  }, [woId])

  const updateCond = (field, val) => {
    const next = { ...cond, [field]: val }
    setCond(next)
    scheduleSaveCond(next)
  }

  // Photo upload
  const triggerPhotoUpload = (phase, pointNo, label) => {
    setUploadingPhase(phase)
    setUploadingPointNo(pointNo)
    setUploadingLabel(label)
    fileInputRef.current.click()
  }

  const handleFileChange = async (e) => {
    const raw = e.target.files?.[0]
    if (!raw) return
    e.target.value = ''
    try {
      // shrink the mobile photo so the upload actually completes
      const file = await compressImage(raw, { maxDim: 1600, quality: 0.7 })
      const fields = {
        work_order_unit_id: String(unitId),
        phase: uploadingPhase,
        point_no: String(uploadingPointNo),
        label: uploadingLabel || `${uploadingPhase} ${uploadingPointNo}`,
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
      setUploadingLabel(null)
    }
  }

  const deletePhoto = async (photo) => {
    if (photo.pending) return
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

  const canEdit = ['draft', 'in_progress', 'rejected'].includes(wo?.status)

  // Group template by category
  const categories = []
  const catMap = {}
  template.forEach((ti) => {
    const cat = ti.category || 'ทั่วไป'
    if (!catMap[cat]) { catMap[cat] = []; categories.push(cat) }
    catMap[cat].push(ti)
  })

  const photoUrl = (url) => (url ? `${uploadsBase}${url}` : null)

  // Photo progress helpers
  const photosForPhasePoint = (phase, pointNo) =>
    photos.filter((p) => p.phase === phase && String(p.point_no) === String(pointNo))

  const isUploading = (phase, pointNo) =>
    uploadingPhase === phase && String(uploadingPointNo) === String(pointNo)

  // Count photos per phase across required points
  const requiredPoints = photoPoints.filter((pp) => pp.required)
  const countDone = (phase) =>
    requiredPoints.filter((pp) => photosForPhasePoint(phase, pp.point_no).length > 0).length

  // Shared number input style
  const numCls = (disabled) =>
    `w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500 ${disabled ? 'bg-gray-50' : ''}`

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
          { key: 'condition', label: 'ความเห็นทีมช่าง' },
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

                        {/* ── check ── */}
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

                        {/* ── number ── */}
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

                        {/* ── before_after ── */}
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

                        {/* ── text ── */}
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

                        {/* ── rst_amp — มอเตอร์ Blower แรงดัน/กระแส ── */}
                        {ti.value_type === 'rst_amp' && (() => {
                          const power = v.power_system || '380'
                          return (
                          <div className="flex flex-col gap-3">
                            {/* ระบบไฟ 380/220 segmented */}
                            <div>
                              <p className="text-xs font-semibold text-gray-600 mb-1">ระบบไฟ</p>
                              <div className="inline-flex rounded-lg border border-line overflow-hidden">
                                {[
                                  { v: '380', label: '380V (3 เฟส · R/S/T)' },
                                  { v: '220', label: '220V (1 เฟส · L/LN)' },
                                ].map((opt) => (
                                  <button
                                    key={opt.v}
                                    type="button"
                                    disabled={!canEdit}
                                    onClick={() => updateValue(ti.id, 'power_system', opt.v)}
                                    className={`px-3 py-1.5 text-xs font-medium ${power === opt.v ? 'bg-primary text-white' : 'bg-white text-ink-muted'}`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {power === '220' && (
                              <p className="text-xs text-success bg-success-soft rounded-lg px-3 py-2">
                                แอร์ 1 เฟส วัดเฉพาะ L (A) และ LN (V) ไม่ต้องกรอก R/S/T
                              </p>
                            )}
                            {power !== '220' && (<>
                            {/* R/S/T ก่อน */}
                            <div>
                              <p className="text-xs font-semibold text-gray-600 mb-1">R / S / T (A) — ก่อน</p>
                              <div className="grid grid-cols-3 gap-2">
                                {[
                                  { field: 'val_r_before', label: 'R' },
                                  { field: 'val_s_before', label: 'S' },
                                  { field: 'val_t_before', label: 'T' },
                                ].map(({ field, label }) => (
                                  <div key={field}>
                                    <label className="text-xs text-gray-400 mb-0.5 block">{label}</label>
                                    <input
                                      type="number"
                                      step="any"
                                      placeholder="0.0"
                                      disabled={!canEdit}
                                      value={v[field] || ''}
                                      onChange={(e) => updateValue(ti.id, field, e.target.value)}
                                      className={numCls(!canEdit)}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                            {/* R/S/T หลัง */}
                            <div>
                              <p className="text-xs font-semibold text-gray-600 mb-1">R / S / T (A) — หลัง</p>
                              <div className="grid grid-cols-3 gap-2">
                                {[
                                  { field: 'val_r_after', label: 'R' },
                                  { field: 'val_s_after', label: 'S' },
                                  { field: 'val_t_after', label: 'T' },
                                ].map(({ field, label }) => (
                                  <div key={field}>
                                    <label className="text-xs text-gray-400 mb-0.5 block">{label}</label>
                                    <input
                                      type="number"
                                      step="any"
                                      placeholder="0.0"
                                      disabled={!canEdit}
                                      value={v[field] || ''}
                                      onChange={(e) => updateValue(ti.id, field, e.target.value)}
                                      className={numCls(!canEdit)}
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                            </>)}
                            {/* LN/L ก่อน */}
                            <div>
                              <p className="text-xs font-semibold text-gray-600 mb-1">LN (V) / L (A) — ก่อน</p>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-xs text-gray-400 mb-0.5 block">LN (V)</label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="0.0"
                                    disabled={!canEdit}
                                    value={v.val_ln_before || ''}
                                    onChange={(e) => updateValue(ti.id, 'val_ln_before', e.target.value)}
                                    className={numCls(!canEdit)}
                                  />
                                </div>
                                <div>
                                  <label className="text-xs text-gray-400 mb-0.5 block">L (A)</label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="0.0"
                                    disabled={!canEdit}
                                    value={v.val_l_before || ''}
                                    onChange={(e) => updateValue(ti.id, 'val_l_before', e.target.value)}
                                    className={numCls(!canEdit)}
                                  />
                                </div>
                              </div>
                            </div>
                            {/* LN/L หลัง */}
                            <div>
                              <p className="text-xs font-semibold text-gray-600 mb-1">LN (V) / L (A) — หลัง</p>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-xs text-gray-400 mb-0.5 block">LN (V)</label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="0.0"
                                    disabled={!canEdit}
                                    value={v.val_ln_after || ''}
                                    onChange={(e) => updateValue(ti.id, 'val_ln_after', e.target.value)}
                                    className={numCls(!canEdit)}
                                  />
                                </div>
                                <div>
                                  <label className="text-xs text-gray-400 mb-0.5 block">L (A)</label>
                                  <input
                                    type="number"
                                    step="any"
                                    placeholder="0.0"
                                    disabled={!canEdit}
                                    value={v.val_l_after || ''}
                                    onChange={(e) => updateValue(ti.id, 'val_l_after', e.target.value)}
                                    className={numCls(!canEdit)}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                          )
                        })()}

                        {/* ── ln_vi — ขณะ Compressor ทำงาน ── */}
                        {ti.value_type === 'ln_vi' && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-gray-500 mb-0.5 block">LN (V)</label>
                              <input
                                type="number"
                                step="any"
                                placeholder="0.0"
                                disabled={!canEdit}
                                value={v.val_ln_after || ''}
                                onChange={(e) => updateValue(ti.id, 'val_ln_after', e.target.value)}
                                className={numCls(!canEdit)}
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 mb-0.5 block">L (A)</label>
                              <input
                                type="number"
                                step="any"
                                placeholder="0.0"
                                disabled={!canEdit}
                                value={v.val_l_after || ''}
                                onChange={(e) => updateValue(ti.id, 'val_l_after', e.target.value)}
                                className={numCls(!canEdit)}
                              />
                            </div>
                          </div>
                        )}

                        {/* ── pressure_pair — น้ำยาแอร์ ── */}
                        {ti.value_type === 'pressure_pair' && (
                          <div className="flex flex-col gap-3">
                            {/* Refrigerant selector */}
                            <div>
                              <p className="text-xs text-gray-500 mb-1">ชนิดน้ำยา</p>
                              <div className="flex gap-2">
                                {['R32', 'R410', 'R22'].map((r) => (
                                  <button
                                    key={r}
                                    type="button"
                                    disabled={!canEdit}
                                    onClick={() => updateValue(ti.id, 'refrigerant_type', r)}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                                      v.refrigerant_type === r
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                                    } disabled:opacity-50`}
                                  >
                                    {r}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {/* Suction */}
                            <div>
                              <label className="text-xs text-gray-500 mb-0.5 block">
                                Suction (PSI) <span className="text-gray-400">ค่าอ้างอิง 135–140</span>
                              </label>
                              <input
                                type="number"
                                step="any"
                                placeholder="135"
                                disabled={!canEdit}
                                value={v.val_suction || ''}
                                onChange={(e) => updateValue(ti.id, 'val_suction', e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                              />
                            </div>
                            {/* Discharge */}
                            <div>
                              <label className="text-xs text-gray-500 mb-0.5 block">
                                Discharge (PSI) <span className="text-gray-400">ค่าอ้างอิง &lt;450–500</span>
                              </label>
                              <input
                                type="number"
                                step="any"
                                placeholder="450"
                                disabled={!canEdit}
                                value={v.val_discharge || ''}
                                onChange={(e) => updateValue(ti.id, 'val_discharge', e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                              />
                            </div>
                          </div>
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
            {/* Photo-point progress summary */}
            {requiredPoints.length > 0 && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm text-blue-800">
                ถ่ายแล้ว {countDone('before')}/{requiredPoints.length} จุด (ก่อน)
                &nbsp;·&nbsp;
                {countDone('after')}/{requiredPoints.length} จุด (หลัง)
              </div>
            )}

            {/* Point-based slots */}
            {photoPoints.length > 0 ? (
              ['before', 'after'].map((phase) => (
                <div key={phase}>
                  <h3 className="font-semibold text-gray-800 text-sm mb-2">
                    {phase === 'before' ? 'ก่อนล้าง' : 'หลังล้าง'}
                  </h3>
                  <div className="flex flex-col gap-3">
                    {photoPoints.map((pp) => {
                      const slotPhotos = photosForPhasePoint(phase, pp.point_no)
                      const uploading = isUploading(phase, pp.point_no)
                      const hasCover = slotPhotos.length > 0
                      return (
                        <div key={pp.point_no} className="bg-white border border-gray-100 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-gray-700">
                              {pp.point_no}. {pp.label}
                              {pp.required && <span className="ml-1 text-red-500">*</span>}
                            </span>
                            <span className={`text-xs font-semibold ${hasCover ? 'text-green-600' : 'text-gray-400'}`}>
                              {hasCover ? `✓ ${slotPhotos.length} รูป` : 'ยังไม่มีรูป'}
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {slotPhotos.map((p) => {
                              const src = p.pending ? p.objectUrl : photoUrl(p.url)
                              return (
                                <div key={p.id} className="rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                                  <div className="relative">
                                    <img
                                      src={src}
                                      alt={p.label}
                                      className="w-full aspect-square object-cover cursor-zoom-in"
                                      onClick={() => setLightbox({ url: src, label: p.label })}
                                    />
                                    {p.pending && (
                                      <span className="absolute top-1 left-1 bg-amber-500 text-white text-[9px] font-bold px-1 py-0.5 rounded-full">
                                        รอ sync
                                      </span>
                                    )}
                                    {canEdit && !p.pending && (
                                      <button
                                        onClick={() => deletePhoto(p)}
                                        className="absolute top-1 right-1 bg-black/50 text-white rounded-full w-5 h-5 flex items-center justify-center"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                            {/* Add photo */}
                            {canEdit && (
                              <button
                                onClick={() => triggerPhotoUpload(phase, pp.point_no, `${pp.label} (${phase === 'before' ? 'ก่อน' : 'หลัง'})`)}
                                disabled={uploading}
                                className="rounded-lg border-2 border-dashed border-gray-300 aspect-square flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50"
                              >
                                {uploading ? (
                                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-600" />
                                ) : (
                                  <>
                                    <Camera className="h-5 w-5" />
                                    <span className="text-[10px]">ถ่าย</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))
            ) : (
              /* Fallback: free phase tabs when no photo-point template */
              [
                { key: 'before',      label: 'ก่อนล้าง' },
                { key: 'after',       label: 'หลังล้าง' },
                { key: 'measurement', label: 'การวัดค่า' },
              ].map(({ key: phase, label }) => {
                const phasePhotos = photos.filter((p) => p.phase === phase)
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
                      {canEdit && (
                        <button
                          onClick={() => triggerPhotoUpload(phase, phasePhotos.length + 1, `${label} ${phasePhotos.length + 1}`)}
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
              })
            )}
          </div>
        )}

        {/* ── Condition tab — ความเห็นทีมช่าง ── */}
        {tab === 'condition' && (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-gray-400">
              บันทึกอัตโนมัติ — ใช้ประกอบใบงานเมื่อส่งตรวจ
            </p>

            {/* ac_degraded */}
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-blue-600"
                  disabled={!canEdit}
                  checked={cond.cond_ac_degraded}
                  onChange={(e) => updateCond('cond_ac_degraded', e.target.checked)}
                />
                <span className="text-sm text-gray-800">แอร์มีสภาพเสื่อมสภาพ</span>
              </label>
            </div>

            {/* ac_old_5_7yr */}
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-blue-600"
                  disabled={!canEdit}
                  checked={cond.cond_ac_old_5_7yr}
                  onChange={(e) => updateCond('cond_ac_old_5_7yr', e.target.checked)}
                />
                <span className="text-sm text-gray-800">อายุการใช้งาน 5–7 ปีขึ้นไป</span>
              </label>
            </div>

            {/* external_degraded + detail */}
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <label className="flex items-center gap-3 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-blue-600"
                  disabled={!canEdit}
                  checked={cond.cond_external_degraded}
                  onChange={(e) => updateCond('cond_external_degraded', e.target.checked)}
                />
                <span className="text-sm text-gray-800">ชุดนอก (Outdoor) เสื่อมสภาพ</span>
              </label>
              {cond.cond_external_degraded && (
                <textarea
                  rows={2}
                  disabled={!canEdit}
                  placeholder="รายละเอียดสภาพชุดนอก..."
                  value={cond.cond_external_detail}
                  onChange={(e) => updateCond('cond_external_detail', e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
              )}
            </div>

            {/* internal_degraded + detail */}
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <label className="flex items-center gap-3 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-blue-600"
                  disabled={!canEdit}
                  checked={cond.cond_internal_degraded}
                  onChange={(e) => updateCond('cond_internal_degraded', e.target.checked)}
                />
                <span className="text-sm text-gray-800">ชุดใน (Indoor) เสื่อมสภาพ</span>
              </label>
              {cond.cond_internal_degraded && (
                <textarea
                  rows={2}
                  disabled={!canEdit}
                  placeholder="รายละเอียดสภาพชุดใน..."
                  value={cond.cond_internal_detail}
                  onChange={(e) => updateCond('cond_internal_detail', e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
              )}
            </div>

            {!canEdit && (
              <p className="text-xs text-gray-400 text-center">ใบงานปิดแล้ว — ดูข้อมูลได้อย่างเดียว</p>
            )}
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
