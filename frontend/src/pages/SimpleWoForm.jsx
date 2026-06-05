import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Camera, X, PenLine, Loader2 } from 'lucide-react'
import Layout from '../components/Layout'
import SignaturePad from '../components/SignaturePad'
import api, { uploadsBase } from '../api/client'
import { compressImage } from '../lib/image'
import { useAuthStore } from '../store/auth'

// 12 โรงพยาบาล (ไม่รวม Demo) — ลูกค้าของ simple-wo
const HOSPITALS = [
  'โรงพยาบาลพญาไท 1',
  'โรงพยาบาลพญาไท 2',
  'โรงพยาบาลพญาไท 3',
  'โรงพยาบาลพญาไท นวมินทร์',
  'โรงพยาบาลพญาไท บ่อวิน',
  'โรงพยาบาลพญาไท พหลโยธิน',
  'โรงพยาบาลพญาไท ศรีราชา',
  'โรงพยาบาลเปาโล พระประแดง',
  'โรงพยาบาลเปาโล รังสิต',
  'โรงพยาบาลเปาโล สมุทรปราการ',
  'โรงพยาบาลเปาโล เกษตร',
  'โรงพยาบาลเปาโล โชคชัย 4',
]

const WORK_TYPES = [
  { value: 'major', label: 'ล้างใหญ่' },
  { value: 'minor', label: 'ล้างย่อย' },
  { value: 'fan',   label: 'พัดลม' },
]

const REFRIGERANTS = ['R32', 'R410', 'R22']

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

  const [header, setHeader] = useState({
    tech_name: '',
    work_date: '',
    client_name: '',
    building: '',
    floor: '',
    room: '',
    asset_code: '',
    work_type: 'major',
    power_system: '380',
    start_time: '',
    end_time: '',
    result: 'ok',
  })

  const [acInfo, setAcInfo] = useState({ detail: '', location: '', kind: '', brand: '', model: '', cooling_size: '' })

  const [schema, setSchema] = useState({ sections: [] })
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [checklistValues, setChecklistValues] = useState({})

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
            building: w.building || '',
            floor: w.floor || '',
            room: w.room || '',
            asset_code: w.asset_code || '',
            work_type: w.work_type || 'major',
            power_system: w.power_system || '380',
            start_time: w.start_time ? String(w.start_time).slice(0, 5) : '',
            end_time: w.end_time ? String(w.end_time).slice(0, 5) : '',
            result: w.result || 'ok',
          })
          setAcInfo({ detail: '', location: '', kind: '', brand: '', model: '', cooling_size: '', ...(w.ac_info || {}) })
          setChecklistValues(w.checklist_values || {})
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
        JSON.stringify({ header, acInfo, checklistValues, photoUrls, galleryUrls, teamComment, signatures })
      )
    } catch {
      // storage full / unavailable — ignore
    }
  }, [header, acInfo, checklistValues, photoUrls, galleryUrls, teamComment, signatures])

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

  const handlePhotos = async (files, phase) => {
    if (!files || files.length === 0) return
    const existing = photoUrls.filter((p) => p.phase === phase).length
    const room = 6 - existing
    if (room <= 0) {
      alert(`รูป${phase === 'before' ? 'ก่อน' : 'หลัง'} เก็บได้สูงสุด 6 รูป (สำหรับ PDF)`)
      if (beforeInputRef.current) beforeInputRef.current.value = ''
      if (afterInputRef.current)  afterInputRef.current.value = ''
      return
    }
    // Cap at 6 per phase: only upload the first N that fit.
    const picked = Array.from(files)
    const toUpload = picked.slice(0, room)
    if (picked.length > room) {
      alert(`รูป${phase === 'before' ? 'ก่อน' : 'หลัง'} เก็บได้สูงสุด 6 รูป (สำหรับ PDF)`)
    }
    setUploading(true)
    try {
      let idx = existing
      for (const file of toUpload) {
        const compressed = await compressImage(file)
        const fd = new FormData()
        fd.append('photo', compressed)
        // Do NOT set Content-Type manually — the browser must add the multipart
        // boundary. Setting 'multipart/form-data' without a boundary makes multer
        // fail to parse → 500 on every upload.
        const res = await api.post('/simple-wo/upload', fd)
        idx += 1
        setPhotoUrls((prev) => [
          ...prev,
          { url: res.data.url, phase, point_no: idx, label: phase === 'before' ? 'ก่อน' : 'หลัง' },
        ])
      }
    } catch {
      alert('อัปโหลดรูปไม่สำเร็จ')
    } finally {
      setUploading(false)
      if (beforeInputRef.current) beforeInputRef.current.value = ''
      if (afterInputRef.current)  afterInputRef.current.value = ''
    }
  }

  const removePhoto = (i) => setPhotoUrls((prev) => prev.filter((_, idx) => idx !== i))

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
      building: '',
      floor: '',
      room: '',
      asset_code: '',
      work_type: 'major',
      power_system: '380',
      start_time: '',
      end_time: '',
      result: 'ok',
    })
    setAcInfo({ detail: '', location: '', kind: '', brand: '', model: '', cooling_size: '' })
    setChecklistValues({})
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
    setError('')
    setSubmitting(true)
    try {
      const body = {
        tech_name: header.tech_name,
        work_date: header.work_date,
        client_name: header.client_name,
        building: header.building,
        floor: header.floor,
        room: header.room,
        asset_code: header.asset_code,
        work_type: header.work_type,
        power_system: header.power_system,
        ac_info: acInfo,
        checklist_values: checklistValues,
        result: header.result,
        start_time: header.start_time,
        end_time: header.end_time,
        team_comment: teamComment,
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
              <select className="input" value={header.client_name} onChange={(e) => setHeader({ ...header, client_name: e.target.value })}>
                <option value="">-- เลือกโรงพยาบาล --</option>
                {HOSPITALS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <Text label="อาคาร" value={header.building} onChange={(v) => setHeader({ ...header, building: v })} />
            <Text label="ชั้น" value={header.floor} onChange={(v) => setHeader({ ...header, floor: v })} />
            <Text label="ห้อง" value={header.room} onChange={(v) => setHeader({ ...header, room: v })} />
            <Text label="เลขเครื่อง" value={header.asset_code} onChange={(v) => setHeader({ ...header, asset_code: v })} />
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

          {/* power_system toggle */}
          <div>
            <label className="label">ระบบไฟ</label>
            <PowerToggle value={header.power_system} onChange={(v) => setHeader({ ...header, power_system: v })} />
          </div>
        </div>

        {/* ── AC info (รายละเอียดเครื่องปรับอากาศ) ── */}
        <div className="card flex flex-col gap-3">
          <h2 className="section-header">รายละเอียดเครื่องปรับอากาศ</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Text label="รายละเอียดเครื่อง" value={acInfo.detail} onChange={(v) => setAc({ detail: v })} />
            <Text label="ตำแหน่งที่ติดตั้ง" value={acInfo.location} onChange={(v) => setAc({ location: v })} />
            <Text label="ยี่ห้อ" value={acInfo.brand} onChange={(v) => setAc({ brand: v })} />
            <Text label="รุ่น" value={acInfo.model} onChange={(v) => setAc({ model: v })} />
            <div>
              <label className="label">ขนาดทำความเย็น (BTU)</label>
              <input className="input" inputMode="decimal" value={acInfo.cooling_size} onChange={(e) => setAc({ cooling_size: e.target.value })} />
            </div>
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

        {/* ── Checklist sections ── */}
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

        {/* ── Photos ── */}
        <div className="card flex flex-col gap-3">
          <h2 className="section-header">รูปภาพ</h2>
          <div className="grid grid-cols-2 gap-3">
            <PhotoPicker
              label={`รูปก่อน (${photoUrls.filter((p) => p.phase === 'before').length}/6)`}
              phase="before"
              inputRef={beforeInputRef}
              onPick={(files) => handlePhotos(files, 'before')}
              disabled={uploading || photoUrls.filter((p) => p.phase === 'before').length >= 6}
            />
            <PhotoPicker
              label={`รูปหลัง (${photoUrls.filter((p) => p.phase === 'after').length}/6)`}
              phase="after"
              inputRef={afterInputRef}
              onPick={(files) => handlePhotos(files, 'after')}
              disabled={uploading || photoUrls.filter((p) => p.phase === 'after').length >= 6}
            />
          </div>
          {uploading && <p className="text-xs text-ink-muted">กำลังอัปโหลด...</p>}
          {photoUrls.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {photoUrls.map((p, i) => (
                <div key={i} className="relative">
                  <img src={photoSrc(p.url)} alt="" loading="lazy" decoding="async" className="w-full aspect-square object-cover rounded-lg border border-line" />
                  <span className="absolute top-1 left-1 badge badge-primary text-[10px] px-1.5 py-0">{p.label}</span>
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

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

        {/* ── Team comment ── */}
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
          ].map(({ role, label }) => (
            <div key={role} className="flex flex-col gap-2 border-b border-line last:border-0 pb-4 last:pb-0">
              <label className="label">{label}</label>
              <input
                className="input"
                placeholder="ชื่อผู้ลงนาม"
                value={signatures[role].name}
                onChange={(e) => setSignatures((prev) => ({ ...prev, [role]: { ...prev[role], name: e.target.value } }))}
              />
              {signatures[role].data ? (
                <div className="flex items-center gap-3">
                  <img src={signatures[role].data} alt="sig" className="h-16 w-32 object-contain border border-line rounded-lg bg-white" />
                  <button type="button" onClick={() => setSigPad(role)} className="btn-secondary text-sm">เซ็นใหม่</button>
                </div>
              ) : (
                <button type="button" onClick={() => setSigPad(role)} className="btn-secondary flex items-center justify-center gap-1.5 self-start">
                  <PenLine className="h-4 w-4" /> เซ็น
                </button>
              )}
            </div>
          ))}
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

function PowerToggle({ value, onChange }) {
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
          {p}V
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
      // ความเร็วลม (Ft/m) → ให้เลือกหน่วย ft/m หรือ CFM
      const airflow = (unit_label || '').toLowerCase() === 'ft/m'
      return (
        <div>
          {/* airflow already shows its unit in the select + item_label, skip the duplicate */}
          {airflow ? <label className="label">{item_label}</label> : labelEl}
          <NumPair
            value={value}
            onChange={onChange}
            unit={unit_label}
            unitOptions={airflow ? ['ft/m', 'CFM'] : undefined}
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
          {/* LN / L always shown */}
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
      )
    }

    case 'ln_vi':
      return (
        <div>
          {labelEl}
          <div className="grid grid-cols-2 gap-2">
            <input className="input" inputMode="decimal" placeholder="LN (V)" value={value.val_ln_after || ''} onChange={(e) => onChange({ val_ln_after: e.target.value })} />
            <input className="input" inputMode="decimal" placeholder="L (A)" value={value.val_l_after || ''} onChange={(e) => onChange({ val_l_after: e.target.value })} />
          </div>
        </div>
      )

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

function PhotoPicker({ label, phase, inputRef, onPick, disabled }) {
  return (
    <label className={`flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-line rounded-xl py-6 cursor-pointer text-ink-muted hover:border-primary transition-colors ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
      <Camera className="h-6 w-6" />
      <span className="text-xs font-medium">{label}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => onPick(e.target.files)}
      />
    </label>
  )
}
