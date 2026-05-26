import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Camera, CheckSquare, Ruler, AlertTriangle } from 'lucide-react'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api, { uploadsBase } from '../api/client'
import { MEASUREMENT_FIELDS, CHECKLIST_ITEMS } from '../lib/config'

const TABS = [
  { key: 'photos',      label: 'รูปภาพ',   icon: Camera },
  { key: 'measure',     label: 'ค่าวัด',    icon: Ruler },
  { key: 'checklist',   label: 'รายการ',   icon: CheckSquare },
]

export default function AcItemDetail() {
  const { id: woId, itemId } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState('photos')

  // WO + item data
  const [wo, setWo] = useState(null)
  const [item, setItem] = useState(null)
  const [photos, setPhotos] = useState([])
  const [photoPoints, setPhotoPoints] = useState(null)
  const [loading, setLoading] = useState(true)

  // Measurements state
  const [measurements, setMeasurements] = useState({ before: {}, after: {} })
  const [savingM, setSavingM] = useState(false)

  // Checklist state
  const [checklist, setChecklist] = useState({})
  const [hasRepair, setHasRepair] = useState(false)
  const [repairNotes, setRepairNotes] = useState('')
  const [savingC, setSavingC] = useState(false)

  // Photo upload
  const [uploadingPoint, setUploadingPoint] = useState(null) // { phase, point_no, label }
  const fileInputRef = useRef(null)

  // Lightbox
  const [lightbox, setLightbox] = useState(null) // { url, label } | null

  const load = async () => {
    try {
      const [woRes, photosRes] = await Promise.all([
        api.get(`/work-orders/${woId}`),
        api.get(`/photos/items/${itemId}`),
      ])
      const woData = woRes.data
      const itemData = woData.items?.find((i) => String(i.id) === String(itemId))
      setWo(woData)
      setItem(itemData)
      setPhotos(photosRes.data)

      if (itemData?.measurements) {
        const m = typeof itemData.measurements === 'string'
          ? JSON.parse(itemData.measurements)
          : itemData.measurements
        setMeasurements(m || { before: {}, after: {} })
      }
      if (itemData?.checklist) {
        const c = typeof itemData.checklist === 'string'
          ? JSON.parse(itemData.checklist)
          : itemData.checklist
        setChecklist(c || {})
      }
      if (itemData?.has_repair) setHasRepair(itemData.has_repair)
      if (itemData?.repair_notes) setRepairNotes(itemData.repair_notes)

      // Load photo points config
      const ppRes = await api.get(`/photos/points/${woData.type}`)
      setPhotoPoints(ppRes.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [itemId])

  if (loading) return <PageSpinner />
  if (!item) return <div className="p-4 text-red-600">ไม่พบข้อมูล</div>

  const canEdit = wo.status === 'in_progress'
  const woType = wo.type
  const acType = item.ac_type || ''

  // ── Photos ─────────────────────────────────────────────────────────────────

  const triggerUpload = (phase, point_no, label) => {
    if (!canEdit) return
    setUploadingPoint({ phase, point_no, label })
    fileInputRef.current.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !uploadingPoint) return
    e.target.value = ''
    const { phase, point_no, label } = uploadingPoint
    setUploadingPoint({ ...uploadingPoint, loading: true })
    try {
      const fd = new FormData()
      fd.append('photo', file)
      fd.append('phase', phase)
      fd.append('point_no', String(point_no))
      fd.append('label', label)
      await api.post(`/photos/items/${itemId}`, fd)
      const r = await api.get(`/photos/items/${itemId}`)
      setPhotos(r.data)
    } finally {
      setUploadingPoint(null)
    }
  }

  const deletePhoto = async (photoId) => {
    if (!confirm('ลบรูปนี้?')) return
    await api.delete(`/photos/${photoId}`)
    setPhotos((p) => p.filter((x) => x.id !== photoId))
  }

  const photosByPhase = (phase) =>
    photos.filter((p) => p.phase === phase)

  const getPhoto = (phase, point_no) =>
    photos.find((p) => p.phase === phase && p.point_no === point_no)

  const photoUrl = (url) =>
    url ? `${uploadsBase}${url}` : null

  // ── Measurements ────────────────────────────────────────────────────────────

  const setMVal = (timing, key, val) => {
    setMeasurements((m) => ({
      ...m,
      [timing]: { ...m[timing], [key]: val },
    }))
  }

  const saveMeasurements = async () => {
    setSavingM(true)
    try {
      await api.put(`/work-orders/${woId}/items/${itemId}`, {
        measurements,
        checklist,
        has_repair: hasRepair,
        repair_notes: repairNotes,
      })
      alert('บันทึกสำเร็จ')
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally {
      setSavingM(false)
    }
  }

  // ── Checklist ───────────────────────────────────────────────────────────────

  const toggleCheck = (key) => {
    setChecklist((c) => ({ ...c, [key]: !c[key] }))
  }

  const saveChecklist = async () => {
    setSavingC(true)
    try {
      await api.put(`/work-orders/${woId}/items/${itemId}`, {
        measurements,
        checklist,
        has_repair: hasRepair,
        repair_notes: repairNotes,
      })
      alert('บันทึกสำเร็จ')
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally {
      setSavingC(false)
    }
  }

  const measureFields = MEASUREMENT_FIELDS.filter((f) => {
    if (woType !== 'major') return false
    if (f.acTypes && !f.acTypes.includes(acType)) return false
    return true
  })

  const checkItems = CHECKLIST_ITEMS[woType] || []

  const phases = woType === 'major'
    ? ['before', 'after']
    : ['before', 'during', 'after']

  const phaseLabel = { before: 'ก่อนล้าง', during: 'ระหว่างล้าง', after: 'หลังล้าง' }

  return (
    <Layout title={`${item.ac_code} — ${item.ac_name}`} back={`/work-orders/${woId}`}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* AC Info */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-xs text-gray-500">
          {item.dept_name} · {item.floor_name} · {item.building_name} · {item.ac_type} · {item.capacity_btu ? `${item.capacity_btu} BTU` : ''}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 bg-white sticky top-14 z-20">
        {TABS.filter((tb) => woType === 'major' || tb.key !== 'measure').map((tb) => {
          const Icon = tb.icon
          return (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`flex-1 flex flex-col items-center py-2.5 gap-0.5 text-xs ${
                tab === tb.key ? 'tab-active' : 'tab-inactive'
              }`}
            >
              <Icon className="h-5 w-5" />
              {tb.label}
            </button>
          )
        })}
      </div>

      <div className="px-4 pt-4">

        {/* ── Photos Tab ── */}
        {tab === 'photos' && (
          <div className="flex flex-col gap-5">
            {phases.map((phase) => {
              const points = photoPoints?.[phase] || []
              if (woType !== 'major' && points.length === 0) return null
              return (
                <div key={phase}>
                  <h3 className="font-semibold text-gray-800 mb-2 text-sm">
                    {phaseLabel[phase]}
                    <span className="ml-2 text-gray-400 font-normal">
                      ({photosByPhase(phase).length}/{woType === 'major' ? points.length : 1})
                    </span>
                  </h3>
                  {woType === 'major' ? (
                    <div className="grid grid-cols-2 gap-2">
                      {points.map((pt) => {
                        const existing = getPhoto(phase, pt.point_no)
                        const uploading = uploadingPoint?.phase === phase && uploadingPoint?.point_no === pt.point_no
                        if (pt.acTypes && !pt.acTypes.includes(acType)) return null
                        return (
                          <PhotoCell
                            key={pt.point_no}
                            label={`${pt.point_no}. ${pt.label}`}
                            required={pt.required}
                            photo={existing}
                            uploading={uploading}
                            canEdit={canEdit}
                            photoUrl={photoUrl}
                            onCapture={() => triggerUpload(phase, pt.point_no, pt.label)}
                            onDelete={() => deletePhoto(existing?.id)}
                            onView={() => setLightbox({ url: photoUrl(existing?.url), label: `${pt.point_no}. ${pt.label}` })}
                          />
                        )
                      })}
                    </div>
                  ) : (
                    /* minor/fan: single photo per phase */
                    <div className="grid grid-cols-2 gap-2">
                      {[1].map((pn) => {
                        const existing = getPhoto(phase, pn)
                        const uploading = uploadingPoint?.phase === phase && uploadingPoint?.point_no === pn
                        const label = phaseLabel[phase]
                        return (
                          <PhotoCell
                            key={pn}
                            label={label}
                            required
                            photo={existing}
                            uploading={uploading}
                            canEdit={canEdit}
                            photoUrl={photoUrl}
                            onCapture={() => triggerUpload(phase, pn, label)}
                            onDelete={() => deletePhoto(existing?.id)}
                            onView={() => setLightbox({ url: photoUrl(existing?.url), label })}
                          />
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Measurements Tab ── */}
        {tab === 'measure' && woType === 'major' && (
          <div className="flex flex-col gap-5 pb-4">
            {(['before', 'after']).map((timing) => (
              <div key={timing}>
                <h3 className="font-semibold text-gray-800 mb-3 text-sm">
                  {timing === 'before' ? 'ก่อนล้าง' : 'หลังล้าง'}
                </h3>
                <div className="flex flex-col gap-2">
                  {measureFields
                    .filter((f) => timing === 'after' || !f.afterOnly)
                    .map((f) => (
                      <div key={f.key} className="flex items-center gap-2">
                        <label className="flex-1 text-sm text-gray-700">
                          {f.label}
                          <span className="text-gray-400 text-xs ml-1">({f.unit})</span>
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          disabled={!canEdit}
                          value={measurements[timing]?.[f.key] ?? ''}
                          onChange={(e) => setMVal(timing, f.key, e.target.value)}
                          className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                          placeholder="0"
                        />
                      </div>
                    ))}
                </div>
              </div>
            ))}
            {canEdit && (
              <button onClick={saveMeasurements} disabled={savingM} className="btn-primary text-center">
                {savingM ? 'กำลังบันทึก...' : 'บันทึกค่าวัด'}
              </button>
            )}
          </div>
        )}

        {/* ── Checklist Tab ── */}
        {tab === 'checklist' && (
          <div className="flex flex-col gap-4 pb-4">
            <div className="flex flex-col gap-1">
              {checkItems.map((ci) => (
                <label key={ci.key} className="flex items-center gap-3 py-2.5 border-b border-gray-100">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-blue-600 rounded"
                    checked={!!checklist[ci.key]}
                    disabled={!canEdit}
                    onChange={() => toggleCheck(ci.key)}
                  />
                  <span className="text-sm text-gray-800">{ci.label}</span>
                </label>
              ))}
            </div>

            {/* Repair flag */}
            <div className="card">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-red-500"
                  checked={hasRepair}
                  disabled={!canEdit}
                  onChange={(e) => setHasRepair(e.target.checked)}
                />
                <span className="flex items-center gap-2 text-sm font-medium text-red-700">
                  <AlertTriangle className="h-4 w-4" /> พบปัญหา / แจ้งซ่อม
                </span>
              </label>
              {hasRepair && (
                <textarea
                  className="input mt-3"
                  rows={3}
                  placeholder="รายละเอียดปัญหา..."
                  value={repairNotes}
                  disabled={!canEdit}
                  onChange={(e) => setRepairNotes(e.target.value)}
                />
              )}
            </div>

            {canEdit && (
              <button onClick={saveChecklist} disabled={savingC} className="btn-primary text-center">
                {savingC ? 'กำลังบันทึก...' : 'บันทึกรายการ'}
              </button>
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
            <button
              onClick={() => setLightbox(null)}
              className="text-white text-3xl leading-none shrink-0"
            >
              &times;
            </button>
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

function PhotoCell({ label, required, photo, uploading, canEdit, photoUrl, onCapture, onDelete, onView }) {
  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
      {photo ? (
        <div className="relative">
          <img
            src={photoUrl(photo.url)}
            alt={label}
            className="w-full aspect-square object-cover cursor-zoom-in"
            onClick={onView}
          />
          {canEdit && (
            <button
              onClick={onDelete}
              className="absolute top-1.5 right-1.5 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm leading-none"
            >
              &times;
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={onCapture}
          disabled={!canEdit || uploading}
          className="w-full aspect-square flex flex-col items-center justify-center gap-2 text-gray-400 disabled:opacity-50"
        >
          {uploading ? (
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-600" />
          ) : (
            <Camera className="h-8 w-8" />
          )}
        </button>
      )}
      <div className="px-2 py-1.5">
        <p className="text-xs text-gray-600 leading-snug line-clamp-2">{label}</p>
        {required && !photo && (
          <p className="text-xs text-red-400 mt-0.5">จำเป็น</p>
        )}
      </div>
    </div>
  )
}
