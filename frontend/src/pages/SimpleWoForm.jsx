import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Camera, X, PenLine, Loader2 } from 'lucide-react'
import Layout from '../components/Layout'
import SignaturePad from '../components/SignaturePad'
import api, { uploadsBase } from '../api/client'
import { compressImage } from '../lib/image'
import { CONDITION_ISSUES, PRIORITIES } from '../lib/condition'
import { useAuthStore } from '../store/auth'


const WORK_TYPES = [
  { value: 'major', label: 'ล้างใหญ่' },
  { value: 'minor', label: 'ล้างย่อย' },
  { value: 'fan',   label: 'พัดลม' },
]

const REFRIGERANTS = ['R32', 'R410', 'R22']

// ประเภทเครื่องปรับอากาศ (ล้างใหญ่/ย่อย) — job-level, prints on the report.
const AC_TYPES = ['FCU', 'SPT', 'VRF', 'AHU', 'OAU']
// ประเภทพัดลม (พัดลม) — stored in the same ac_type field, job-level.
const FAN_TYPES = ['Exhaust Fan', 'Exhaust Fan Duct Type']

// Photo points (ก่อน + หลัง each). 1-5 required, 6-8 optional.
const PHOTO_POINTS = [
  { no: 1, label: 'Location',     required: true },
  { no: 2, label: 'วัดไฟ',        required: true },
  { no: 3, label: 'วัดลม',        required: true },
  { no: 4, label: 'คอยล์ FCU',    required: true },
  { no: 5, label: 'Strainer',     required: true },
  { no: 6, label: 'รูปเพิ่มเติม 1', required: false },
  { no: 7, label: 'รูปเพิ่มเติม 2', required: false },
  { no: 8, label: 'รูปเพิ่มเติม 3', required: false },
]

// Grid columns per grid work_type (ล้างย่อย / พัดลม) — multi-unit checkbox grid.
const GRID_COLS = {
  minor: ['ตรวจเช็คระบบการทำงาน', 'ล้างหัวจ่าย', 'ล้างช่องรีเทิร์น', 'ล้างฟิลเตอร์'],
  fan: ['ล้างหน้ากาก/มอเตอร์/ใบพัด', 'ใส่น้ำมันหล่อลื่นมอเตอร์', 'เช็คกระแสไฟฟ้า', 'เช็คความดังเสียง', 'ใช้งานได้ปกติ'],
}

const DRAFT_KEY = 'simple-wo-draft'

// Resolve a stored photo URL for thumbnail display (handles relative paths)
function photoSrc(url) {
  if (!url) return ''
  if (/^https?:|^data:/.test(url)) return url
  return `${uploadsBase || ''}${url.startsWith('/') ? '' : '/'}${url}`
}

export default function SimpleWoForm() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEdit = !!id
  const { user } = useAuthStore()

  // Each role may sign ONLY its own signature slot (backend enforces this too);
  // other slots are read-only. admin/super do NOT sign at all (they manage + bill).
  // Step chain: a slot is signable only after every earlier slot is signed.
  const SLOT_FOR_ROLE = { technician: 'team', checker: 'supervisor', approve_building: 'building', approve_engineer: 'engineer' }
  // ช่างอาคาร + วิศวกรรม เซ็นพร้อมกันได้ (ขนาน) — ต้องการแค่ ช่างแอร์ + หัวหน้า
  const SIG_PREREQ = { team: [], supervisor: ['team'], building: ['team', 'supervisor'], engineer: ['team', 'supervisor'] }
  const canSignSlot = (slot) => SLOT_FOR_ROLE[user?.role] === slot

  const [header, setHeader] = useState({
    tech_name: '',
    work_date: '',
    client_name: '',
    pts_zone: '',
    location: '',
    building: '',
    floor: '',
    room: '',
    asset_code: '',
    work_type: 'major',
    ac_type: 'FCU',
    power_system: '380',
    start_time: '',
    end_time: '',
    result: 'ok',
  })

  const [acInfo, setAcInfo] = useState({ detail: '', location: '', kind: '', brand: '', model: '', cooling_size: '' })

  const [schema, setSchema] = useState({ sections: [] })
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [checklistValues, setChecklistValues] = useState({})

  // ล้างย่อย / พัดลม use a multi-unit checkbox grid instead of the major checklist.
  const [gridRows, setGridRows] = useState([]) // [{ name, checks:[bool], broken }]
  const [recommendation, setRecommendation] = useState('')
  const isGrid = header.work_type === 'minor' || header.work_type === 'fan'

  const [photoUrls, setPhotoUrls] = useState([]) // { url, phase, point_no, label }
  const [galleryUrls, setGalleryUrls] = useState([]) // { url }
  const [uploading, setUploading] = useState(false)

  const [teamComment, setTeamComment] = useState({
    ac_degraded: false,
    ac_old_5_7yr: false,
    external_degraded: false,
    external_detail: '',
    internal_degraded: false,
    internal_detail: '',
  })

  // สภาพแอร์ / แจ้งเปลี่ยนอะไหล่ (ไม่ใช่งานซ่อม — ประเมินตอนล้าง)
  const CONDITION_DEFAULT = { issues: [], issues_other: '', health_pct: '', health_reason: '', priority: '' }
  const [condition, setCondition] = useState(CONDITION_DEFAULT)
  const toggleIssue = (key) => setCondition((c) => ({
    ...c, issues: c.issues.includes(key) ? c.issues.filter((k) => k !== key) : [...c.issues, key],
  }))

  // รหัสเครื่องที่เคยล้าง → datalist กันกรอกรหัสผิด (พี่ยิม)
  const [unitCodes, setUnitCodes] = useState([])
  useEffect(() => {
    let alive = true
    api.get('/simple-wo/unit-codes').then((r) => { if (alive) setUnitCodes(r.data || []) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const [signatures, setSignatures] = useState({
    engineer:   { name: '', data: '' },
    department: { name: '', data: '' },
    team:       { name: '', data: '' },
    supervisor: { name: '', data: '' },
    building:   { name: '', data: '' },
  })
  const [sigPad, setSigPad] = useState(null) // 'engineer' | 'department' | 'team' | 'supervisor' | 'building' | null

  const [submitting, setSubmitting] = useState(false)
  const [loadingWo, setLoadingWo] = useState(false)
  const [error, setError] = useState('')

  const beforeInputRef = useRef(null)
  const afterInputRef  = useRef(null)
  const galleryInputRef = useRef(null)

  const draftLoaded = useRef(false)

  // Edit: load the existing WO. Create: restore autosaved draft.
  useEffect(() => {
    if (isEdit) {
      setLoadingWo(true)
      api.get(`/simple-wo/${id}`)
        .then((r) => {
          const w = r.data
          setHeader({
            tech_name: w.tech_name || '',
            work_date: w.work_date ? String(w.work_date).slice(0, 10) : '',
            client_name: w.client_name || '',
            pts_zone: w.pts_zone || '',
            location: w.location || '',
            building: w.building || '',
            floor: w.floor || '',
            room: w.room || '',
            asset_code: w.asset_code || '',
            work_type: w.work_type || 'major',
            ac_type: w.ac_type || 'FCU',
            power_system: w.power_system || '380',
            start_time: w.start_time ? String(w.start_time).slice(0, 5) : '',
            end_time: w.end_time ? String(w.end_time).slice(0, 5) : '',
            result: w.result || 'ok',
          })
          setAcInfo({ detail: '', location: '', kind: '', brand: '', model: '', cooling_size: '', serial: '', ...(w.ac_info || {}) })
          setChecklistValues(w.checklist_values || {})
          setGridRows(Array.isArray(w.grid_rows) ? w.grid_rows : [])
          setRecommendation(w.recommendation || '')
          setPhotoUrls(Array.isArray(w.photo_urls) ? w.photo_urls : [])
          setGalleryUrls(Array.isArray(w.gallery_urls) ? w.gallery_urls : [])
          setTeamComment({
            ac_degraded: !!w.team_comment?.ac_degraded,
            ac_old_5_7yr: !!w.team_comment?.ac_old_5_7yr,
            external_degraded: !!w.team_comment?.external_degraded,
            external_detail: w.team_comment?.external_detail || '',
            internal_degraded: !!w.team_comment?.internal_degraded,
            internal_detail: w.team_comment?.internal_detail || '',
          })
          setCondition({ ...CONDITION_DEFAULT, ...(w.condition || {}), issues: Array.isArray(w.condition?.issues) ? w.condition.issues : [] })
          setSignatures({
            engineer:   { name: w.sig_engineer_name || '',   data: w.sig_engineer || '' },
            department: { name: w.sig_department_name || '',  data: w.sig_department || '' },
            team:       { name: w.sig_team_name || '',        data: w.sig_team || '' },
            supervisor: { name: w.sig_supervisor_name || '',   data: w.sig_supervisor || '' },
            building:   { name: w.sig_building_name || '',     data: w.sig_building || '' },
          })
        })
        .catch((e) => setError(e.response?.data?.error || 'โหลดใบงานไม่สำเร็จ'))
        .finally(() => { setLoadingWo(false); draftLoaded.current = true })
      return
    }
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      const d = raw ? JSON.parse(raw) : null
      // ชื่อช่าง = ชื่อคนล็อกอิน (default), draft ทับได้ถ้าเคยแก้
      const techName = d?.header?.tech_name || user?.name || ''
      if (d?.header) setHeader((h) => ({ ...h, ...d.header, tech_name: techName }))
      else setHeader((h) => ({ ...h, tech_name: techName }))
      if (d?.acInfo) setAcInfo(d.acInfo)
      if (d?.checklistValues) setChecklistValues(d.checklistValues)
      if (Array.isArray(d?.gridRows)) setGridRows(d.gridRows)
      if (d?.recommendation) setRecommendation(d.recommendation)
      if (Array.isArray(d?.photoUrls)) setPhotoUrls(d.photoUrls)
      if (Array.isArray(d?.galleryUrls)) setGalleryUrls(d.galleryUrls)
      if (d?.teamComment) setTeamComment(d.teamComment)
      if (d?.signatures) setSignatures(d.signatures)
    } catch {
      // malformed draft — ignore
    } finally {
      draftLoaded.current = true
    }
  }, [isEdit, id])

  // Autosave whole form state to localStorage on any change (create mode only)
  useEffect(() => {
    if (isEdit) return // edit mode pulls from the server, never the draft
    if (!draftLoaded.current) return // don't overwrite before restore runs
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ header, acInfo, checklistValues, gridRows, recommendation, photoUrls, galleryUrls, teamComment, signatures })
      )
    } catch {
      // storage full / unavailable — ignore
    }
  }, [header, acInfo, checklistValues, gridRows, recommendation, photoUrls, galleryUrls, teamComment, signatures])

  // ONE checklist for all work types (full AC set) — load once on mount.
  // ประเภทงาน is stored/printed but does NOT change the checklist.
  useEffect(() => {
    setSchemaLoading(true)
    api.get('/simple-wo/form-schema?work_type=major')
      .then((r) => setSchema(r.data && Array.isArray(r.data.sections) ? r.data : { sections: [] }))
      .catch(() => setSchema({ sections: [] }))
      .finally(() => setSchemaLoading(false))
  }, [])

  const setField = (id, patch) => {
    setChecklistValues((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }))
  }

  const setAc = (patch) => setAcInfo((p) => ({ ...p, ...patch }))

  // The single photo stored for a given point + phase (or undefined).
  const getPointPhoto = (point_no, phase) =>
    photoUrls.find((p) => p.point_no === point_no && p.phase === phase)

  // Compress + upload one file → returns the stored url. Holds NO component
  // state, so each PhotoSlot owns its own busy/preview/error locally and an
  // upload re-renders only that slot, not the whole (large) form.
  const uploadOne = async (file) => {
    const compressed = await compressImage(file, { stamp: true })   // burn วัน/เวลา in
    const fd = new FormData()
    fd.append('photo', compressed)
    // Do NOT set Content-Type manually — the browser adds the multipart boundary.
    const res = await api.post('/simple-wo/upload', fd)
    return res.data.url
  }

  // Store/replace the photo for a point + phase (only mutates on success).
  const setPointPhoto = (point, phase, url) =>
    setPhotoUrls((prev) => [
      ...prev.filter((p) => !(p.point_no === point.no && p.phase === phase)),
      { url, phase, point_no: point.no, label: point.label },
    ])

  const removePointPhoto = (point_no, phase) =>
    setPhotoUrls((prev) => prev.filter((p) => !(p.point_no === point_no && p.phase === phase)))

  // Required points missing either ก่อน or หลัง → blocks submit.
  const missingRequiredPhotos = PHOTO_POINTS.filter(
    (pt) => pt.required && (!getPointPhoto(pt.no, 'before') || !getPointPhoto(pt.no, 'after'))
  )

  // Gallery (คลังรูป): unlimited extra album photos, not in the PDF.
  const handleGallery = async (files) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const compressed = await compressImage(file)
        const fd = new FormData()
        fd.append('photo', compressed)
        // Do NOT set Content-Type manually — the browser must add the multipart boundary.
        const res = await api.post('/simple-wo/upload', fd)
        setGalleryUrls((prev) => [...prev, { url: res.data.url }])
      }
    } catch {
      alert('อัปโหลดรูปไม่สำเร็จ')
    } finally {
      setUploading(false)
      if (galleryInputRef.current) galleryInputRef.current.value = ''
    }
  }

  const removeGallery = (i) => setGalleryUrls((prev) => prev.filter((_, idx) => idx !== i))

  const saveSig = (role, dataUrl) => {
    setSignatures((prev) => ({ ...prev, [role]: { ...prev[role], data: dataUrl } }))
    setSigPad(null)
  }

  const clearDraft = () => {
    if (!window.confirm('ล้างฟอร์มทั้งหมด? ข้อมูลที่กรอกไว้จะหายไป')) return
    setHeader({
      tech_name: '',
      work_date: '',
      client_name: '',
      location: '',
      building: '',
      floor: '',
      room: '',
      asset_code: '',
      work_type: 'major',
      ac_type: 'FCU',
      power_system: '380',
      start_time: '',
      end_time: '',
      result: 'ok',
    })
    setAcInfo({ detail: '', location: '', kind: '', brand: '', model: '', cooling_size: '', serial: '' })
    setChecklistValues({})
    setGridRows([])
    setRecommendation('')
    setPhotoUrls([])
    setGalleryUrls([])
    setTeamComment({
      ac_degraded: false,
      ac_old_5_7yr: false,
      external_degraded: false,
      external_detail: '',
      internal_degraded: false,
      internal_detail: '',
    })
    setCondition(CONDITION_DEFAULT)
    setSignatures({
      engineer:   { name: '', data: '' },
      department: { name: '', data: '' },
      team:       { name: '', data: '' },
      supervisor: { name: '', data: '' },
      building:   { name: '', data: '' },
    })
    setError('')
    localStorage.removeItem(DRAFT_KEY)
  }

  const submit = async () => {
    if (submitting) return
    if (!isGrid && missingRequiredPhotos.length > 0) {
      setError(`กรุณาอัปรูปบังคับให้ครบ (ก่อน+หลัง): ${missingRequiredPhotos.map((pt) => pt.label).join(', ')}`)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const body = {
        tech_name: header.tech_name,
        work_date: header.work_date,
        client_name: header.client_name,
        pts_zone: header.pts_zone,
        location: header.location,
        building: header.building,
        floor: header.floor,
        room: header.room,
        asset_code: header.asset_code,
        work_type: header.work_type,
        ac_type: header.ac_type,
        power_system: header.power_system,
        ac_info: acInfo,
        checklist_values: checklistValues,
        grid_rows: gridRows,
        recommendation,
        result: header.result,
        start_time: header.start_time,
        end_time: header.end_time,
        team_comment: teamComment,
        condition,
        photo_urls: photoUrls,
        gallery_urls: galleryUrls,
        sig_engineer: signatures.engineer.data,
        sig_engineer_name: signatures.engineer.name,
        sig_department: signatures.department.data,
        sig_department_name: signatures.department.name,
        sig_team: signatures.team.data,
        sig_team_name: signatures.team.name,
        sig_supervisor: signatures.supervisor.data,
        sig_supervisor_name: signatures.supervisor.name,
        sig_building: signatures.building.data,
        sig_building_name: signatures.building.name,
      }
      const res = isEdit
        ? await api.put(`/simple-wo/${id}`, body)
        : await api.post('/simple-wo', body)
      if (!isEdit) localStorage.removeItem(DRAFT_KEY) // clear draft so next new form starts blank
      navigate(`/simple-wo/${isEdit ? id : res.data.id}`)
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกใบงานไม่สำเร็จ')
      setSubmitting(false)
    }
  }

  return (
    <Layout title={isEdit ? 'แก้ไขใบงาน' : 'เปิดใบงานใหม่'} back={isEdit ? `/simple-wo/${id}` : '/simple-wo'}>
      <div className="px-4 pt-4 pb-8 flex flex-col gap-5 max-w-2xl mx-auto w-full">

        {/* ── Header fields ── */}
        <div className="card flex flex-col gap-3">
          <h2 className="section-header">ข้อมูลทั่วไป</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Text label="ชื่อช่าง" value={header.tech_name} onChange={(v) => setHeader({ ...header, tech_name: v })} />
            <div>
              <label className="label">วันที่</label>
              <input type="date" className="input" value={header.work_date} onChange={(e) => setHeader({ ...header, work_date: e.target.value })} />
            </div>
            <div>
              <label className="label">ลูกค้า (โรงพยาบาล)</label>
              <ClientCombobox value={header.client_name} onChange={(v) => setHeader({ ...header, client_name: v })} />
            </div>
            <div>
              <label className="label">สัญญา/โซน (PTS)</label>
              <input className="input" list="pts-zone-options" placeholder="เช่น PTS1, PTS2"
                value={header.pts_zone} onChange={(e) => setHeader({ ...header, pts_zone: e.target.value })} />
              <datalist id="pts-zone-options">
                <option value="PTS1" />
                <option value="PTS2" />
              </datalist>
            </div>
            <Text label="สถานที่ (เว้นว่าง = ใช้ชื่อลูกค้า)" value={header.location} onChange={(v) => setHeader({ ...header, location: v })} />
            <Text label="อาคาร" value={header.building} onChange={(v) => setHeader({ ...header, building: v })} />
            <Text label="ชั้น" value={header.floor} onChange={(v) => setHeader({ ...header, floor: v })} />
            {/* ห้อง + เลขเครื่อง: major = header; ล้างย่อย/พัดลม = ต่อเครื่องใน "รายการเครื่อง" */}
            {!isGrid && <Text label="ห้อง" value={header.room} onChange={(v) => setHeader({ ...header, room: v })} />}
            {!isGrid && (
              <div>
                <label className="label">เลขเครื่อง</label>
                <input list="swo-unit-codes" className="input" value={header.asset_code}
                  onChange={(e) => setHeader({ ...header, asset_code: e.target.value })}
                  placeholder="เลือกหรือพิมพ์รหัสเครื่อง" />
                <datalist id="swo-unit-codes">{unitCodes.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
            )}
            <div>
              <label className="label">เวลาเริ่ม</label>
              <input type="time" className="input" value={header.start_time} onChange={(e) => setHeader({ ...header, start_time: e.target.value })} />
            </div>
          </div>

          {/* work_type segmented */}
          <div>
            <label className="label">ประเภทงาน</label>
            <div className="flex gap-2">
              {WORK_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setHeader({ ...header, work_type: t.value })}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    header.work_type === t.value
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-ink-muted border-line'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* ประเภทเครื่องปรับอากาศ — ล้างใหญ่ + ล้างย่อย (พัดลมไม่มี) */}
          {header.work_type !== 'fan' && (
            <div>
              <label className="label">ประเภทเครื่องปรับอากาศ</label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {AC_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setHeader({ ...header, ac_type: t })}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      header.ac_type === t ? 'bg-primary text-white border-primary' : 'bg-white text-ink-muted border-line'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* ระบบไฟ — major only (ใช้ใน checklist) */}
          {header.work_type === 'major' && (
            <div>
              <label className="label">ระบบไฟ</label>
              <PowerToggle value={header.power_system} onChange={(v) => setHeader({ ...header, power_system: v })} />
            </div>
          )}
          {/* ประเภทพัดลม — fan only (เก็บใน ac_type) */}
          {header.work_type === 'fan' && (
            <div>
              <label className="label">ประเภทพัดลม</label>
              <div className="grid grid-cols-2 gap-2">
                {FAN_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setHeader({ ...header, ac_type: t })}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      header.ac_type === t ? 'bg-primary text-white border-primary' : 'bg-white text-ink-muted border-line'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Grid form (ล้างย่อย / พัดลม) ── */}
        {isGrid && (
          <>
            <GridEditor workType={header.work_type} rows={gridRows} onChange={setGridRows} uploadOne={uploadOne} />
            <div className="card flex flex-col gap-3">
              <h2 className="section-header">ข้อแนะนำ</h2>
              <textarea className="input" rows={2} value={recommendation} onChange={(e) => setRecommendation(e.target.value)} placeholder="ข้อแนะนำ / หมายเหตุ" />
            </div>
          </>
        )}

        {/* ── AC info (รายละเอียดเครื่องปรับอากาศ) — major only ── */}
        {!isGrid && (
        <div className="card flex flex-col gap-3">
          <h2 className="section-header">รายละเอียดเครื่องปรับอากาศ</h2>
          {/* รายละเอียดเครื่อง (=เลขเครื่อง) + ตำแหน่งที่ติดตั้ง (=ห้อง/แผนก) ตัดออก — กรอกใน ข้อมูลทั่วไป แล้ว */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Text label="ยี่ห้อ" value={acInfo.brand} onChange={(v) => setAc({ brand: v })} />
            <Text label="รุ่น" value={acInfo.model} onChange={(v) => setAc({ model: v })} />
            <div>
              <label className="label">ขนาดทำความเย็น (BTU)</label>
              <input className="input" inputMode="decimal" value={acInfo.cooling_size} onChange={(e) => setAc({ cooling_size: e.target.value })} />
            </div>
            <Text label="หมายเลขเครื่อง (Nameplate)" value={acInfo.serial} onChange={(v) => setAc({ serial: v })} />
          </div>

          {/* kind segmented */}
          <div>
            <label className="label">ชนิดเครื่อง</label>
            <div className="flex gap-2">
              {[
                { value: 'water', label: 'แอร์น้ำ' },
                { value: 'refrigerant', label: 'แอร์น้ำยา' },
                { value: 'other', label: 'อื่นๆ' },
              ].map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setAc({ kind: k.value })}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    acInfo.kind === k.value
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-ink-muted border-line'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        )}

        {/* ── Checklist sections — major only ── */}
        {!isGrid && (
        <div className="flex flex-col gap-4">
          {schemaLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
          {!schemaLoading && schema.sections.map((section) => (
            <div key={section.key} className="card flex flex-col gap-3">
              <h2 className="section-header">{section.label}</h2>
              <div className="flex flex-col gap-3">
                {(section.fields || []).map((field) => (
                  <ChecklistField
                    key={field.id}
                    field={field}
                    value={checklistValues[field.id] || {}}
                    onChange={(patch) => setField(field.id, patch)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        )}

        {/* ── Photos (8 จุด, ก่อน/หลัง) — major only ── */}
        {!isGrid && (
        <div className="card flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="section-header">รูปภาพ (ก่อน / หลัง)</h2>
            <span className="text-xs text-ink-muted">จุด 1-5 บังคับ · <span className="text-danger">*</span></span>
          </div>
          <p className="text-xs text-ink-muted">แตะช่องเพื่อถ่ายรูป หรือเลือกจากอัลบั้มในเครื่อง</p>
          <div className="flex flex-col gap-3">
            {PHOTO_POINTS.map((pt) => (
              <div key={pt.no} className="rounded-xl border border-line p-3">
                <div className="text-sm font-medium text-ink mb-2">
                  {pt.no}. {pt.label}
                  {pt.required && <span className="text-danger ml-1">*</span>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <PhotoSlot
                    label="ก่อน"
                    photo={getPointPhoto(pt.no, 'before')}
                    onUpload={async (file) => setPointPhoto(pt, 'before', await uploadOne(file))}
                    onRemove={() => removePointPhoto(pt.no, 'before')}
                  />
                  <PhotoSlot
                    label="หลัง"
                    photo={getPointPhoto(pt.no, 'after')}
                    onUpload={async (file) => setPointPhoto(pt, 'after', await uploadOne(file))}
                    onRemove={() => removePointPhoto(pt.no, 'after')}
                  />
                </div>
              </div>
            ))}
          </div>
          {missingRequiredPhotos.length > 0 && (
            <p className="text-xs text-danger">
              ยังขาดรูปบังคับ: {missingRequiredPhotos.map((pt) => pt.label).join(', ')}
            </p>
          )}
        </div>
        )}

        {/* ── Gallery (คลังรูป) — extra album photos, not in PDF ── */}
        <div className="card flex flex-col gap-3">
          <h2 className="section-header">เพิ่มเติม (คลังรูป)</h2>
          <p className="text-xs text-ink-muted">อัปโหลดจากอัลบั้มได้ไม่จำกัด · บีบอัดรูปอัตโนมัติ · ไม่เข้า PDF</p>
          <label className={`flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-line rounded-xl py-6 cursor-pointer text-ink-muted hover:border-primary transition-colors ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
            <Camera className="h-6 w-6" />
            <span className="text-xs font-medium">เลือกจากอัลบั้ม</span>
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => handleGallery(e.target.files)}
            />
          </label>
          {uploading && <p className="text-xs text-ink-muted">กำลังอัปโหลด...</p>}
          {galleryUrls.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {galleryUrls.map((p, i) => (
                <div key={i} className="relative">
                  <a href={photoSrc(p.url)} target="_blank" rel="noreferrer" className="block">
                    <img src={photoSrc(p.url)} alt="" loading="lazy" decoding="async" className="w-full aspect-square object-cover rounded-lg border border-line" />
                  </a>
                  <button
                    type="button"
                    onClick={() => removeGallery(i)}
                    className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Team comment — major only ── */}
        {!isGrid && (
        <div className="card flex flex-col gap-3">
          <h2 className="section-header">ความเห็นทีมช่าง</h2>
          <CheckRow
            label="แอร์เสื่อมสภาพ"
            checked={teamComment.ac_degraded}
            onChange={(v) => setTeamComment({ ...teamComment, ac_degraded: v })}
          />
          <CheckRow
            label="แอร์อายุ 5-7 ปี"
            checked={teamComment.ac_old_5_7yr}
            onChange={(v) => setTeamComment({ ...teamComment, ac_old_5_7yr: v })}
          />
          <div>
            <CheckRow
              label="คอยล์ร้อน (ภายนอก) เสื่อม"
              checked={teamComment.external_degraded}
              onChange={(v) => setTeamComment({ ...teamComment, external_degraded: v })}
            />
            {teamComment.external_degraded && (
              <input
                className="input mt-2"
                placeholder="รายละเอียด (ภายนอก)"
                value={teamComment.external_detail}
                onChange={(e) => setTeamComment({ ...teamComment, external_detail: e.target.value })}
              />
            )}
          </div>
          <div>
            <CheckRow
              label="คอยล์เย็น (ภายใน) เสื่อม"
              checked={teamComment.internal_degraded}
              onChange={(v) => setTeamComment({ ...teamComment, internal_degraded: v })}
            />
            {teamComment.internal_degraded && (
              <input
                className="input mt-2"
                placeholder="รายละเอียด (ภายใน)"
                value={teamComment.internal_detail}
                onChange={(e) => setTeamComment({ ...teamComment, internal_detail: e.target.value })}
              />
            )}
          </div>
        </div>
        )}

        {/* ── สภาพแอร์ / แจ้งเปลี่ยนอะไหล่ (major only) ── */}
        {!isGrid && (
        <div className="card flex flex-col gap-3">
          <h2 className="section-header">สภาพแอร์ / แจ้งเปลี่ยนอะไหล่</h2>
          <p className="text-xs text-ink-muted -mt-1">แอร์ใช้งานได้ แต่อะไหล่เสื่อม — แจ้งให้พิจารณาเปลี่ยน (ไม่ใช่งานซ่อม)</p>
          <div>
            <label className="label">รายการที่เสื่อมสภาพ</label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {CONDITION_ISSUES.map((it) => (
                <CheckRow key={it.key} label={it.label}
                  checked={condition.issues.includes(it.key)} onChange={() => toggleIssue(it.key)} />
              ))}
            </div>
          </div>
          <Text label="อื่นๆ (ระบุ)" value={condition.issues_other} onChange={(v) => setCondition((c) => ({ ...c, issues_other: v }))} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">สภาพแอร์โดยรวม (%)</label>
              <input className="input" inputMode="numeric" placeholder="เช่น 70"
                value={condition.health_pct} onChange={(e) => setCondition((c) => ({ ...c, health_pct: e.target.value }))} />
            </div>
            <div>
              <label className="label">ความเร่งด่วน</label>
              <div className="flex gap-2">
                {PRIORITIES.map((p) => (
                  <button key={p.key} type="button"
                    onClick={() => setCondition((c) => ({ ...c, priority: c.priority === p.key ? '' : p.key }))}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      condition.priority === p.key ? 'text-white' : 'bg-white text-ink-muted border-line'}`}
                    style={condition.priority === p.key ? { background: p.color, borderColor: p.color } : undefined}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="label">เหตุผล / รายละเอียด (ทำไมควรเปลี่ยน)</label>
            <textarea className="input" rows={2} placeholder="เช่น คอยล์เริ่มผุ น้ำหยด ใช้ต่อเสี่ยงเสียหาย"
              value={condition.health_reason} onChange={(e) => setCondition((c) => ({ ...c, health_reason: e.target.value }))} />
          </div>
        </div>
        )}

        {/* ── Result + end time ── */}
        <div className="card flex flex-col gap-3">
          <h2 className="section-header">สรุปผลงาน</h2>
          <div>
            <label className="label">ผลงาน</label>
            <div className="flex gap-2">
              {[
                { value: 'ok', label: 'เรียบร้อย' },
                { value: 'not_ok', label: 'ไม่เรียบร้อย' },
              ].map((r) => (
                <label
                  key={r.value}
                  className={`flex-1 flex items-center justify-center gap-2 border rounded-xl px-3 py-2.5 cursor-pointer text-sm font-medium transition-colors ${
                    header.result === r.value ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-white text-ink-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name="result"
                    className="accent-primary"
                    checked={header.result === r.value}
                    onChange={() => setHeader({ ...header, result: r.value })}
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label">เวลาเสร็จ</label>
            <input type="time" className="input" value={header.end_time} onChange={(e) => setHeader({ ...header, end_time: e.target.value })} />
          </div>
        </div>

        {/* ── Signatures ── */}
        <div className="card flex flex-col gap-4">
          <h2 className="section-header">ลายเซ็น</h2>
          {[
            { role: 'team',       label: 'ช่างแอร์' },
            { role: 'supervisor', label: 'หัวหน้าช่างแอร์' },
            { role: 'building',   label: 'เจ้าหน้าที่ช่างอาคาร' },
            { role: 'engineer',   label: 'เจ้าหน้าวิศวกรรม' },
          ].map(({ role, label }) => {
            const mine = canSignSlot(role)
            // ช่างอาคาร + วิศวกรรม เซ็นพร้อมกันได้ — ต้องการแค่ ช่างแอร์ + หัวหน้า
            const ready = (SIG_PREREQ[role] || []).every((p) => !!signatures[p]?.data)
            const canSign = mine && ready
            const blockSlot = (SIG_PREREQ[role] || []).find((p) => !signatures[p]?.data)
            const prevLabel = { team: 'ช่างแอร์', supervisor: 'หัวหน้าช่างแอร์', building: 'เจ้าหน้าที่ช่างอาคาร', engineer: 'เจ้าหน้าวิศวกรรม' }[blockSlot]
            return (
            <div key={role} className="flex flex-col gap-2 border-b border-line last:border-0 pb-4 last:pb-0">
              <label className="label flex items-center gap-2">{label}
                {!mine && <span className="text-[11px] font-normal text-ink-muted">(เซ็นได้เฉพาะช่องของคุณ)</span>}</label>
              <input
                className="input"
                placeholder="ชื่อผู้ลงนาม"
                disabled={!canSign}
                value={signatures[role].name}
                onChange={(e) => setSignatures((prev) => ({ ...prev, [role]: { ...prev[role], name: e.target.value } }))}
              />
              {signatures[role].data ? (
                <div className="flex items-center gap-3">
                  <img src={signatures[role].data} alt="sig" className="h-16 w-32 object-contain border border-line rounded-lg bg-white" />
                  {canSign && <button type="button" onClick={() => setSigPad(role)} className="btn-secondary text-sm">เซ็นใหม่</button>}
                </div>
              ) : canSign ? (
                <button type="button" onClick={() => setSigPad(role)} className="btn-secondary flex items-center justify-center gap-1.5 self-start">
                  <PenLine className="h-4 w-4" /> เซ็น
                </button>
              ) : mine && !ready ? (
                <span className="text-sm text-ink-muted">รอ “{prevLabel}” เซ็นก่อน</span>
              ) : (
                <span className="text-sm text-ink-muted">— ยังไม่ได้เซ็น —</span>
              )}
            </div>
            )
          })}
        </div>

        {error && (
          <p className="text-sm text-danger bg-danger-soft rounded-xl px-3 py-2">{error}</p>
        )}

        <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-page/90 backdrop-blur border-t border-line flex flex-col gap-2">
          {!isEdit && <p className="text-[11px] text-ink-muted text-center">บันทึกร่างอัตโนมัติ</p>}
          <div className="flex gap-2">
            {!isEdit && (
              <button
                type="button"
                onClick={clearDraft}
                disabled={submitting || uploading}
                className="btn-secondary text-center"
              >
                ล้างฟอร์ม
              </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={submitting || uploading || loadingWo}
              className="btn-primary text-center flex-1"
            >
              {submitting ? 'กำลังบันทึก...' : (isEdit ? 'บันทึกการแก้ไข' : 'ส่งใบงาน')}
            </button>
          </div>
        </div>
      </div>

      {/* Signature pad modal */}
      {sigPad && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSigPad(null)} />
          <div className="relative bg-white rounded-t-3xl w-full max-w-lg p-5">
            <h3 className="font-semibold text-ink mb-4">ลายเซ็น</h3>
            <SignaturePad onSave={(d) => saveSig(sigPad, d)} onCancel={() => setSigPad(null)} />
          </div>
        </div>
      )}
    </Layout>
  )
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function Text({ label, value, onChange }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function PowerToggle({ value, onChange, labels }) {
  return (
    <div className="flex gap-2">
      {['380', '220'].map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
            value === p ? 'bg-primary text-white border-primary' : 'bg-white text-ink-muted border-line'
          }`}
        >
          {labels ? labels[p] : `${p}V`}
        </button>
      ))}
    </div>
  )
}

function CheckRow({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input type="checkbox" className="accent-primary h-4 w-4" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm text-ink">{label}</span>
    </label>
  )
}

function NumPair({ value, onChange, unit, unitOptions }) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="input flex-1 min-w-0"
        inputMode="decimal"
        placeholder="ก่อน"
        value={value.value_before || ''}
        onChange={(e) => onChange({ value_before: e.target.value })}
      />
      <input
        className="input flex-1 min-w-0"
        inputMode="decimal"
        placeholder="หลัง"
        value={value.value_after || ''}
        onChange={(e) => onChange({ value_after: e.target.value })}
      />
      {unitOptions ? (
        <select
          className="input shrink-0"
          style={{ width: '6rem' }}
          value={value.unit || unitOptions[0]}
          onChange={(e) => onChange({ unit: e.target.value })}
        >
          {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      ) : (
        unit && <span className="text-xs text-ink-muted shrink-0">{unit}</span>
      )}
    </div>
  )
}

function ChecklistField({ field, value, onChange }) {
  const { value_type, item_label, unit_label } = field

  const labelEl = item_label && value_type !== 'check' ? (
    <label className="label flex items-center justify-between">
      <span>{item_label}</span>
      {unit_label && <span className="text-ink-muted font-normal">{unit_label}</span>}
    </label>
  ) : null

  switch (value_type) {
    case 'check':
      return (
        <div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="accent-primary h-4 w-4"
              checked={!!value.checked}
              onChange={(e) => onChange({ checked: e.target.checked })}
            />
            <span className="text-sm text-ink">{item_label}{unit_label ? ` (${unit_label})` : ''}</span>
          </label>
          <input
            className="input mt-2"
            placeholder="หมายเหตุ"
            value={value.note || ''}
            onChange={(e) => onChange({ note: e.target.value })}
          />
        </div>
      )

    case 'number':
    case 'before_after': {
      // ความเร็วลม (Ft/m) → ให้เลือกหน่วย ft/m, CFM หรือ m/s
      const airflow = (unit_label || '').toLowerCase() === 'ft/m'
      return (
        <div>
          {/* airflow already shows its unit in the select + item_label, skip the duplicate */}
          {airflow ? <label className="label">{item_label}</label> : labelEl}
          <NumPair
            value={value}
            onChange={onChange}
            unit={unit_label}
            unitOptions={airflow ? ['ft/m', 'CFM', 'm/s'] : undefined}
          />
        </div>
      )
    }

    case 'text':
      return (
        <div>
          {labelEl}
          <input
            className="input"
            value={value.val_text || ''}
            onChange={(e) => onChange({ val_text: e.target.value })}
          />
        </div>
      )

    case 'rst_amp': {
      const ps = value.power_system || '380'
      return (
        <div className="flex flex-col gap-2">
          {labelEl}
          <PowerToggle value={ps} onChange={(v) => onChange({ power_system: v })} />
          {ps === '380' && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-ink-muted">R / S / T (ก่อน)</p>
              <div className="grid grid-cols-3 gap-2">
                <input className="input" inputMode="decimal" placeholder="R" value={value.val_r_before || ''} onChange={(e) => onChange({ val_r_before: e.target.value })} />
                <input className="input" inputMode="decimal" placeholder="S" value={value.val_s_before || ''} onChange={(e) => onChange({ val_s_before: e.target.value })} />
                <input className="input" inputMode="decimal" placeholder="T" value={value.val_t_before || ''} onChange={(e) => onChange({ val_t_before: e.target.value })} />
              </div>
              <p className="text-xs text-ink-muted">R / S / T (หลัง)</p>
              <div className="grid grid-cols-3 gap-2">
                <input className="input" inputMode="decimal" placeholder="R" value={value.val_r_after || ''} onChange={(e) => onChange({ val_r_after: e.target.value })} />
                <input className="input" inputMode="decimal" placeholder="S" value={value.val_s_after || ''} onChange={(e) => onChange({ val_s_after: e.target.value })} />
                <input className="input" inputMode="decimal" placeholder="T" value={value.val_t_after || ''} onChange={(e) => onChange({ val_t_after: e.target.value })} />
              </div>
            </div>
          )}
          {/* 220V (1φ) → LN/L only; 380V already shows R/S/T above */}
          {ps === '220' && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-ink-muted">LN / L (ก่อน)</p>
              <div className="grid grid-cols-2 gap-2">
                <input className="input" inputMode="decimal" placeholder="LN" value={value.val_ln_before || ''} onChange={(e) => onChange({ val_ln_before: e.target.value })} />
                <input className="input" inputMode="decimal" placeholder="L" value={value.val_l_before || ''} onChange={(e) => onChange({ val_l_before: e.target.value })} />
              </div>
              <p className="text-xs text-ink-muted">LN / L (หลัง)</p>
              <div className="grid grid-cols-2 gap-2">
                <input className="input" inputMode="decimal" placeholder="LN" value={value.val_ln_after || ''} onChange={(e) => onChange({ val_ln_after: e.target.value })} />
                <input className="input" inputMode="decimal" placeholder="L" value={value.val_l_after || ''} onChange={(e) => onChange({ val_l_after: e.target.value })} />
              </div>
            </div>
          )}
        </div>
      )
    }

    case 'ln_vi': {
      // เฟส: 3 เฟส (380) → R/S/T + LN ; 1 เฟส (220) → LN/L
      const lnPs = value.power_system || (value.val_l_after ? '220' : '380')
      return (
        <div className="flex flex-col gap-2">
          {labelEl}
          <PowerToggle value={lnPs} onChange={(v) => onChange({ power_system: v })} labels={{ '380': '3 เฟส', '220': '1 เฟส' }} />
          {lnPs === '380' ? (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-[20px_1fr_1fr] items-center gap-2 text-xs text-ink-muted">
                <span></span><span className="text-center">แรงดัน (V)</span><span className="text-center">กระแส (A)</span>
              </div>
              {['r', 's', 't'].map((ph) => (
                <div key={ph} className="grid grid-cols-[20px_1fr_1fr] items-center gap-2">
                  <span className="text-sm font-semibold text-ink-muted uppercase">{ph}</span>
                  <input className="input" inputMode="decimal" placeholder="V" value={value[`val_${ph}_v_after`] || ''} onChange={(e) => onChange({ [`val_${ph}_v_after`]: e.target.value })} />
                  <input className="input" inputMode="decimal" placeholder="A" value={value[`val_${ph}_after`] || ''} onChange={(e) => onChange({ [`val_${ph}_after`]: e.target.value })} />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <input className="input" inputMode="decimal" placeholder="LN (V)" value={value.val_ln_after || ''} onChange={(e) => onChange({ val_ln_after: e.target.value })} />
              <input className="input" inputMode="decimal" placeholder="L (A)" value={value.val_l_after || ''} onChange={(e) => onChange({ val_l_after: e.target.value })} />
            </div>
          )}
        </div>
      )
    }

    case 'pressure_pair':
      return (
        <div className="flex flex-col gap-2">
          {labelEl}
          <select
            className="input"
            value={value.refrigerant_type || ''}
            onChange={(e) => onChange({ refrigerant_type: e.target.value })}
          >
            <option value="">-- น้ำยา --</option>
            {REFRIGERANTS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input className="input" inputMode="decimal" placeholder="Suction" value={value.val_suction || ''} onChange={(e) => onChange({ val_suction: e.target.value })} />
            <input className="input" inputMode="decimal" placeholder="Discharge" value={value.val_discharge || ''} onChange={(e) => onChange({ val_discharge: e.target.value })} />
          </div>
        </div>
      )

    default:
      // Unknown type — render a plain text fallback so nothing is hidden
      return (
        <div>
          {labelEl || <label className="label">{item_label}</label>}
          <input
            className="input"
            value={value.val_text || ''}
            onChange={(e) => onChange({ val_text: e.target.value })}
          />
        </div>
      )
  }
}

// Searchable + addable customer (hospital) picker, backed by /simple-wo/clients.
// Type to filter; pick an option, or add a new name that persists server-side.
function ClientCombobox({ value, onChange }) {
  const [clients, setClients] = useState([])
  const [q, setQ] = useState(value || '')
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    api.get('/simple-wo/clients').then((r) => setClients((r.data || []).map((c) => c.name))).catch(() => {})
  }, [])
  useEffect(() => { setQ(value || '') }, [value])
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const query = q.trim()
  const filtered = clients.filter((c) => c.toLowerCase().includes(query.toLowerCase()))
  const exact = clients.some((c) => c === query)
  const pick = (name) => { onChange(name); setQ(name); setOpen(false) }
  const add = async () => {
    if (!query || adding) return
    setAdding(true)
    try {
      await api.post('/simple-wo/clients', { name: query })
      setClients((prev) => (prev.includes(query) ? prev : [...prev, query].sort()))
      pick(query)
    } catch { alert('เพิ่มลูกค้าไม่สำเร็จ') } finally { setAdding(false) }
  }

  return (
    <div className="relative" ref={ref}>
      <input
        className="input"
        placeholder="พิมพ์เพื่อค้นหา หรือเพิ่มโรงพยาบาล"
        value={q}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {filtered.map((c) => (
            <button type="button" key={c} onClick={() => pick(c)} className="block w-full text-left px-3 py-2 text-sm text-ink hover:bg-primary-soft">{c}</button>
          ))}
          {!filtered.length && !query && <p className="px-3 py-2 text-xs text-ink-muted">พิมพ์เพื่อค้นหา</p>}
          {query && !exact && (
            <button type="button" onClick={add} disabled={adding} className="block w-full text-left px-3 py-2 text-sm font-medium text-primary border-t border-line hover:bg-primary-soft">
              {adding ? 'กำลังเพิ่ม...' : `+ เพิ่ม “${query}”`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Multi-unit checkbox grid for ล้างย่อย / พัดลม.
//   ล้างย่อย: ห้อง/แผนก + เลขเครื่อง + checks + 3 รูป (ก่อน/หลัง/ขณะ) ต่อเครื่อง.
//   พัดลม:   ชื่อ/เลขเครื่อง + checks + ชำรุด.
const ROW_PHASES = [['before', 'ก่อนล้าง'], ['after', 'หลังล้าง'], ['during', 'ขณะปฏิบัติงาน']]
function GridEditor({ workType, rows, onChange, uploadOne }) {
  const cols = GRID_COLS[workType] || []
  const fan = workType === 'fan'
  // both ล้างย่อย & พัดลม carry ห้อง/แผนก + เลขเครื่อง + 3 photos per machine.
  const roomGrid = workType === 'minor' || fan
  const addRow = () => onChange([...rows, roomGrid
    ? { room: '', machine_no: '', checks: cols.map(() => false), photos: {}, ...(fan ? { broken: '' } : {}) }
    : { name: '', checks: cols.map(() => false), broken: '' }])
  const setRow = (i, patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const toggle = (i, c) => setRow(i, { checks: cols.map((_, idx) => (idx === c ? !(rows[i].checks || [])[c] : !!(rows[i].checks || [])[idx])) })
  const setPhoto = (i, phase, url) => setRow(i, { photos: { ...(rows[i].photos || {}), [phase]: url } })
  const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i))
  return (
    <div className="card flex flex-col gap-3">
      <h2 className="section-header">รายการเครื่อง ({rows.length})</h2>
      {rows.length === 0 && <p className="text-xs text-ink-muted">ยังไม่มีเครื่อง · กด “เพิ่มเครื่อง” ด้านล่าง</p>}
      {rows.map((r, i) => (
        <div key={i} className="rounded-xl border border-line p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink-muted w-6 shrink-0">{i + 1}.</span>
            {roomGrid ? (
              <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
                <input className="input min-w-0" placeholder="ห้อง/แผนก (ไม่รู้ใส่ –)" value={r.room || ''} onChange={(e) => setRow(i, { room: e.target.value })} />
                <input className="input min-w-0" placeholder="เลขเครื่อง (ไม่รู้ใส่ –)" value={r.machine_no || ''} onChange={(e) => setRow(i, { machine_no: e.target.value })} />
              </div>
            ) : (
              <input className="input flex-1 min-w-0" placeholder="ชื่อ / เลขเครื่อง" value={r.name || ''} onChange={(e) => setRow(i, { name: e.target.value })} />
            )}
            <button type="button" onClick={() => removeRow(i)} className="text-danger px-1 shrink-0" aria-label="ลบแถว"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {cols.map((c, ci) => (
              <label key={ci} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" className="accent-primary h-4 w-4" checked={!!(r.checks || [])[ci]} onChange={() => toggle(i, ci)} />
                <span>{c}</span>
              </label>
            ))}
          </div>
          {workType === 'fan' && (
            <input className="input" placeholder="ชำรุดเนื่องจาก (ถ้ามี)" value={r.broken || ''} onChange={(e) => setRow(i, { broken: e.target.value })} />
          )}
          {roomGrid && (
            <div>
              <div className="text-xs text-ink-muted mb-1">รูปถ่าย (3 รูป/เครื่อง)</div>
              <div className="grid grid-cols-3 gap-2">
                {ROW_PHASES.map(([k, label]) => (
                  <PhotoSlot
                    key={k}
                    label={label}
                    photo={(r.photos || {})[k] ? { url: (r.photos || {})[k] } : null}
                    onUpload={async (file) => setPhoto(i, k, await uploadOne(file))}
                    onRemove={() => setPhoto(i, k, '')}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
      <button type="button" onClick={addRow} className="btn-secondary self-start">+ เพิ่มเครื่อง</button>
    </div>
  )
}

// One photo slot (ก่อน or หลัง) for a point. Owns its OWN busy/preview/error
// state so an in-flight upload re-renders only this slot — not the whole form —
// and shows an instant local preview while the file uploads in the background.
// Empty tile = camera OR gallery (no `capture`, so the OS picker offers both).
function PhotoSlot({ label, photo, onUpload, onRemove }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState('')

  const pick = async (file) => {
    if (!file || busy) return
    setErr('')
    const localUrl = URL.createObjectURL(file)
    setPreview(localUrl)
    setBusy(true)
    try {
      await onUpload(file) // compress + POST + lift result into parent state
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || 'อัปไม่สำเร็จ')
    } finally {
      setBusy(false)
      setPreview('')
      URL.revokeObjectURL(localUrl)
    }
  }

  // Saved server photo (and not mid-replace) → thumbnail + remove.
  if (photo && !busy && !preview) {
    return (
      <div className="relative">
        <img src={photoSrc(photo.url)} alt="" loading="lazy" decoding="async" className="w-full aspect-square object-cover rounded-lg border border-line" />
        <span className="absolute top-1 left-1 badge badge-primary text-[10px] px-1.5 py-0">{label}</span>
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5"
          aria-label={`ลบรูป${label}`}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    )
  }

  // Empty / uploading / error → tappable tile (taps re-trigger after an error).
  return (
    <label className={`relative flex flex-col items-center justify-center gap-1 aspect-square border-2 border-dashed rounded-lg cursor-pointer overflow-hidden transition-colors ${err ? 'border-danger text-danger' : 'border-line text-ink-muted hover:border-primary'} ${busy ? 'pointer-events-none' : ''}`}>
      {preview && <img src={preview} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" />}
      <span className="relative z-10 flex flex-col items-center gap-1 text-center px-1">
        {busy ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-xs">กำลังอัป...</span>
          </>
        ) : err ? (
          <>
            <Camera className="h-5 w-5" />
            <span className="text-[11px] font-medium">อัปไม่สำเร็จ · แตะลองใหม่</span>
          </>
        ) : (
          <>
            <Camera className="h-5 w-5" />
            <span className="text-xs font-medium">{label}</span>
          </>
        )}
      </span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={busy}
        onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }}
      />
    </label>
  )
}
