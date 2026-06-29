import { useState, useEffect, useCallback, useRef } from 'react'
import { ClipboardList, Plus, Pencil, Trash2, Upload, X, AlertCircle, QrCode, Printer, FileSpreadsheet } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api/client'
import { useAuthStore } from '../store/auth'
import QRCode from 'qrcode'

const AC_TYPES = ['FCU', 'SPT', 'VRF', 'AHU', 'OAU']
const FAN_TYPES = ['Exhaust Fan', 'Exhaust Fan Duct Type']
const PTS_ZONES = ['PTS1', 'PTS2']

const EMPTY_FORM = {
  asset_code: '',
  pts_zone: '',
  location: '',
  is_clinic: false,
  building: '',
  floor: '',
  room: '',
  equipment: 'ac',
  ac_type: 'FCU',
  brand: '',
  model: '',
  cooling_size: '',
  freq_major: '',
  freq_minor: '',
  freq_fan: '',
  active: true,
  note: '',
}

function unitQrUrl(asset_code) {
  return `${window.location.origin}/simple-wo/new?unit=${encodeURIComponent(asset_code)}`
}

/* ── QR Modal (single unit) ───────────────────────────────────────────── */
function QrModal({ unit, onClose }) {
  const [dataUrl, setDataUrl] = useState(null)

  useEffect(() => {
    QRCode.toDataURL(unitQrUrl(unit.asset_code), { width: 220, margin: 2 })
      .then(setDataUrl)
      .catch(() => {})
  }, [unit.asset_code])

  const handlePrint = () => {
    const popup = window.open('', '_blank', 'width=400,height=520')
    if (!popup) return
    popup.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>QR – ${unit.asset_code}</title>
<style>
  body { margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; display: flex;
         flex-direction: column; align-items: center; justify-content: center;
         height: 100vh; background: #fff; }
  img  { width: 220px; height: 220px; display: block; }
  .code { font-family: monospace; font-size: 22px; font-weight: 700;
          letter-spacing: .04em; margin-top: 10px; color: #1A2B38; }
  .loc  { font-size: 13px; color: #7A93A8; margin-top: 4px; text-align: center; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <img src="${dataUrl}" alt="QR" />
  <div class="code">${unit.asset_code}</div>
  <div class="loc">${[unit.location, unit.ac_type].filter(Boolean).join(' · ')}</div>
  <script>window.onload = function(){ window.print(); window.close(); };<\/script>
</body>
</html>`)
    popup.document.close()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-72 flex flex-col items-center p-6 gap-4">
        {/* close */}
        <button onClick={onClose} className="absolute top-3 right-3 text-ink-muted hover:text-ink">
          <X className="h-5 w-5" />
        </button>

        <h3 className="font-semibold text-ink text-base self-start">QR Code</h3>

        {dataUrl ? (
          <img src={dataUrl} alt={`QR ${unit.asset_code}`} className="w-[220px] h-[220px] rounded-lg border border-line" />
        ) : (
          <div className="w-[220px] h-[220px] flex items-center justify-center text-ink-muted text-sm">กำลังสร้าง…</div>
        )}

        <div className="text-center">
          <p className="font-mono font-bold text-xl text-ink tracking-wide">{unit.asset_code}</p>
          <p className="text-xs text-ink-muted mt-1">
            {[unit.location, unit.ac_type].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>

        <div className="flex gap-2 w-full pt-1">
          <button onClick={onClose} className="btn-secondary flex-1 text-sm py-2">ปิด</button>
          <button
            onClick={handlePrint}
            disabled={!dataUrl}
            className="btn-primary flex-1 text-sm py-2 flex items-center justify-center gap-1.5"
          >
            <Printer className="h-4 w-4" />พิมพ์
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Print all QRs (filtered list) ───────────────────────────────────── */
async function printAllQr(rows) {
  if (rows.length === 0) {
    alert('ไม่มีเครื่องให้พิมพ์')
    return
  }

  // Generate all data-URLs first
  const items = await Promise.all(
    rows.map(async (u) => ({
      asset_code: u.asset_code,
      location: u.location || '',
      ac_type: u.ac_type || '',
      dataUrl: await QRCode.toDataURL(unitQrUrl(u.asset_code), { width: 160, margin: 2 }),
    }))
  )

  const labelsHtml = items.map((it) => `
    <div class="label">
      <img src="${it.dataUrl}" alt="${it.asset_code}" />
      <div class="code">${it.asset_code}</div>
      <div class="loc">${[it.location, it.ac_type].filter(Boolean).join(' · ') || '—'}</div>
    </div>`).join('')

  const popup = window.open('', '_blank', 'width=860,height=720')
  if (!popup) {
    alert('ป้องกันป๊อปอัพ — กรุณาอนุญาตป๊อปอัพสำหรับหน้านี้แล้วลองอีกครั้ง')
    return
  }

  popup.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>QR ทะเบียนแอร์ (${items.length} เครื่อง)</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #fff;
         padding: 12px; color: #1A2B38; }
  h1 { font-size: 13px; color: #7A93A8; margin-bottom: 10px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .label { border: 1px solid #E3EDF5; border-radius: 8px; padding: 10px 8px;
           display: flex; flex-direction: column; align-items: center;
           break-inside: avoid; page-break-inside: avoid; }
  .label img { width: 140px; height: 140px; display: block; }
  .code { font-family: monospace; font-size: 13px; font-weight: 700;
          letter-spacing: .03em; margin-top: 6px; text-align: center; }
  .loc  { font-size: 10px; color: #7A93A8; margin-top: 2px; text-align: center;
          word-break: break-word; }
  @media print {
    body { padding: 6px; }
    h1   { display: none; }
    .grid { gap: 6px; }
    @page { margin: 10mm; }
  }
</style>
</head>
<body>
  <h1>QR ทะเบียนแอร์ — ${items.length} เครื่อง</h1>
  <div class="grid">${labelsHtml}</div>
  <script>window.onload = function(){ window.print(); };<\/script>
</body>
</html>`)
  popup.document.close()
}

/* ── UnitModal (add / edit) ───────────────────────────────────────────── */
function UnitModal({ unit, onClose, onSaved }) {
  const [form, setForm] = useState(unit ? {
    asset_code: unit.asset_code || '',
    pts_zone: unit.pts_zone || '',
    location: unit.location || '',
    is_clinic: unit.is_clinic || false,
    building: unit.building || '',
    floor: unit.floor || '',
    room: unit.room || '',
    equipment: unit.equipment || 'ac',
    ac_type: unit.ac_type || 'FCU',
    brand: unit.brand || '',
    model: unit.model || '',
    cooling_size: unit.cooling_size || '',
    freq_major: unit.freq_major != null ? String(unit.freq_major) : '',
    freq_minor: unit.freq_minor != null ? String(unit.freq_minor) : '',
    freq_fan: unit.freq_fan != null ? String(unit.freq_fan) : '',
    active: unit.active !== false,
    note: unit.note || '',
  } : { ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const typeOptions = form.equipment === 'ac' ? AC_TYPES : FAN_TYPES

  // Reset ac_type to first option when equipment changes
  const handleEquipmentChange = (val) => {
    const defaultType = val === 'ac' ? AC_TYPES[0] : FAN_TYPES[0]
    setForm((f) => ({ ...f, equipment: val, ac_type: defaultType }))
  }

  const save = async (e) => {
    e.preventDefault()
    if (!form.asset_code.trim()) { setErr('ระบุรหัสแอร์'); return }
    setSaving(true); setErr('')
    try {
      const body = {
        ...form,
        freq_major: form.freq_major !== '' ? parseInt(form.freq_major) : null,
        freq_minor: form.freq_minor !== '' ? parseInt(form.freq_minor) : null,
        freq_fan: form.freq_fan !== '' ? parseInt(form.freq_fan) : null,
      }
      if (unit?.id) {
        await api.put(`/wash-units/${unit.id}`, body)
      } else {
        await api.post('/wash-units', body)
      }
      onSaved()
    } catch (e) {
      setErr(e.response?.data?.error || e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-2xl shadow-xl max-h-[94vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line sticky top-0 bg-white z-10">
          <h3 className="font-semibold text-ink text-base">
            {unit?.id ? 'แก้ไขเครื่อง' : 'เพิ่มเครื่องใหม่'}
          </h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={save} className="p-5 space-y-4">
          {/* Row 1: รหัส + โซน */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">รหัสแอร์ *</label>
              <input className="input" value={form.asset_code}
                onChange={(e) => set('asset_code', e.target.value)}
                placeholder="เช่น AC-001" />
            </div>
            <div>
              <label className="label">โซน (PTS)</label>
              <input className="input" list="pts-zone-list" value={form.pts_zone}
                onChange={(e) => set('pts_zone', e.target.value)}
                placeholder="PTS1 / PTS2" />
              <datalist id="pts-zone-list">
                {PTS_ZONES.map((z) => <option key={z} value={z} />)}
              </datalist>
            </div>
          </div>

          {/* Row 2: สถานที่ + is_clinic */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">สถานที่</label>
              <input className="input" value={form.location}
                onChange={(e) => set('location', e.target.value)}
                placeholder="เช่น อาคารผู้ป่วยนอก" />
            </div>
            <div className="flex flex-col justify-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-primary" checked={form.is_clinic}
                  onChange={(e) => set('is_clinic', e.target.checked)} />
                <span className="text-sm text-ink">เป็นคลินิก / หอพัก</span>
              </label>
              <p className="text-xs text-ink-muted mt-0.5">นับแยกตามสถานที่</p>
            </div>
          </div>

          {/* Row 3: อาคาร ชั้น ห้อง */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">อาคาร</label>
              <input className="input" value={form.building}
                onChange={(e) => set('building', e.target.value)} placeholder="A / B / C" />
            </div>
            <div>
              <label className="label">ชั้น</label>
              <input className="input" value={form.floor}
                onChange={(e) => set('floor', e.target.value)} placeholder="1 / 2 / B1" />
            </div>
            <div>
              <label className="label">ห้อง</label>
              <input className="input" value={form.room}
                onChange={(e) => set('room', e.target.value)} placeholder="101 / ICU" />
            </div>
          </div>

          {/* Row 4: ประเภทอุปกรณ์ (segmented) + ประเภทแอร์ */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">ประเภทอุปกรณ์</label>
              <div className="flex rounded-lg border border-line overflow-hidden text-sm">
                {[{ v: 'ac', l: 'แอร์' }, { v: 'fan', l: 'พัดลม' }].map(({ v, l }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => handleEquipmentChange(v)}
                    className={`flex-1 py-2 font-medium transition-colors ${
                      form.equipment === v
                        ? 'bg-primary text-white'
                        : 'bg-white text-ink-muted hover:bg-primary-soft'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">ประเภท{form.equipment === 'ac' ? 'แอร์' : 'พัดลม'}</label>
              <select className="input" value={form.ac_type}
                onChange={(e) => set('ac_type', e.target.value)}>
                {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Row 5: ยี่ห้อ รุ่น ขนาด */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">ยี่ห้อ</label>
              <input className="input" value={form.brand}
                onChange={(e) => set('brand', e.target.value)} placeholder="Daikin / Mitsubishi" />
            </div>
            <div>
              <label className="label">รุ่น</label>
              <input className="input" value={form.model}
                onChange={(e) => set('model', e.target.value)} placeholder="FTK25TV" />
            </div>
            <div>
              <label className="label">ขนาด (BTU/TR)</label>
              <input className="input" value={form.cooling_size}
                onChange={(e) => set('cooling_size', e.target.value)} placeholder="12000 / 1.5TR" />
            </div>
          </div>

          {/* Row 6: ความถี่ตามสัญญา */}
          <div>
            <p className="text-xs font-medium text-ink-muted mb-2">ความถี่ตามสัญญา (ครั้ง/ปี)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">ล้างใหญ่/ปี</label>
                <input className="input" inputMode="numeric" value={form.freq_major}
                  onChange={(e) => set('freq_major', e.target.value)} placeholder="1" />
              </div>
              <div>
                <label className="label">ล้างย่อย/ปี</label>
                <input className="input" inputMode="numeric" value={form.freq_minor}
                  onChange={(e) => set('freq_minor', e.target.value)} placeholder="3" />
              </div>
              <div>
                <label className="label">พัดลม/ปี</label>
                <input className="input" inputMode="numeric" value={form.freq_fan}
                  onChange={(e) => set('freq_fan', e.target.value)} placeholder="0" />
              </div>
            </div>
          </div>

          {/* Row 7: หมายเหตุ + active */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">หมายเหตุ</label>
              <input className="input" value={form.note}
                onChange={(e) => set('note', e.target.value)} placeholder="(ไม่บังคับ)" />
            </div>
            <div className="flex flex-col justify-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-primary" checked={form.active}
                  onChange={(e) => set('active', e.target.checked)} />
                <span className="text-sm text-ink">ใช้งานอยู่</span>
              </label>
            </div>
          </div>

          {err && (
            <p className="text-sm text-danger bg-danger-soft rounded-lg px-3 py-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />{err}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
            <button disabled={saving} className="btn-primary flex-1">
              {saving ? 'กำลังบันทึก…' : unit?.id ? 'บันทึกการแก้ไข' : 'เพิ่มเครื่อง'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ── Main page ────────────────────────────────────────────────────────── */
export default function WashUnits() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // Filters
  const [filterZone, setFilterZone] = useState('')
  const [filterEquip, setFilterEquip] = useState('')
  const [filterLoc, setFilterLoc] = useState('')
  const [filterAc, setFilterAc] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const searchDebounce = useRef(null)

  // Modal (add/edit)
  const [modalUnit, setModalUnit] = useState(null) // null = closed, {} = new, {id,...} = edit
  const [modalOpen, setModalOpen] = useState(false)

  // QR modal
  const [qrUnit, setQrUnit] = useState(null) // null = closed

  // Import
  const importRef = useRef(null)
  const [importMsg, setImportMsg] = useState(null) // { ok, text, errors }
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)

  // ดาวน์โหลด Excel สรุปทั้งระบบ (backup/ตรวจสอบ/ประวัติ)
  const exportAll = async () => {
    setExporting(true); setErr('')
    try {
      const res = await api.get('/wash-units/export-all', { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url; a.download = `air-system-backup-${new Date().toISOString().slice(0, 10)}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setErr(e.response?.data?.error || e.message) } finally { setExporting(false) }
  }

  const load = useCallback(async (q) => {
    setLoading(true); setErr('')
    try {
      const params = {}
      if (filterZone) params.zone = filterZone
      if (filterEquip) params.equipment = filterEquip
      if (q !== undefined ? q : searchQ) params.q = q !== undefined ? q : searchQ
      setRows((await api.get('/wash-units', { params })).data)
    } catch (e) {
      setErr(e.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }, [filterZone, filterEquip, searchQ])

  useEffect(() => { load() }, [load])

  const handleSearch = (val) => {
    setSearchQ(val)
    clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => load(val), 400)
  }

  // filter ฝั่ง client: สถานที่ + ตระกูลแอร์ (โซน/ประเภท/ค้นหา = ฝั่ง server)
  const view = rows.filter((u) => (!filterLoc || u.location === filterLoc) && (!filterAc || u.ac_type === filterAc))

  const openNew = () => { setModalUnit({}); setModalOpen(true) }
  const openEdit = (u) => { setModalUnit(u); setModalOpen(true) }
  const closeModal = () => { setModalOpen(false); setModalUnit(null) }
  const handleSaved = () => { closeModal(); load() }

  const del = async (u) => {
    if (!confirm(`ลบ "${u.asset_code}" ?`)) return
    try {
      await api.delete(`/wash-units/${u.id}`)
      load()
    } catch (e) {
      setErr(e.response?.data?.error || e.message)
    }
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true); setImportMsg(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const { data } = await api.post('/wash-units/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setImportMsg({
        ok: true,
        text: `สร้าง ${data.created} · อัปเดต ${data.updated} · ข้าม ${data.skipped}`,
        errors: data.errors || [],
      })
      load()
    } catch (e) {
      setImportMsg({ ok: false, text: e.response?.data?.error || e.message, errors: [] })
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  // Compact contract display: "ญ1·ย3·พ0"
  const contractStr = (u) => {
    const parts = []
    if (u.freq_major != null) parts.push(`ญ${u.freq_major}`)
    if (u.freq_minor != null) parts.push(`ย${u.freq_minor}`)
    if (u.freq_fan != null) parts.push(`พ${u.freq_fan}`)
    return parts.join('·') || '—'
  }

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-ink flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" /> ทะเบียนแอร์
            </h1>
            <p className="text-sm text-ink-muted mt-0.5">รายการเครื่องปรับอากาศและพัดลมทั้งหมดในสาขา</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {/* Print-all QR — available to everyone */}
            <button
              onClick={() => printAllQr(view)}
              disabled={loading || rows.length === 0}
              className="btn-secondary flex items-center gap-2 text-sm"
              title="พิมพ์ QR ทั้งหมดของรายการที่กรองอยู่"
            >
              <QrCode className="h-4 w-4" />
              พิมพ์ QR ทั้งหมด
            </button>

            <button
              onClick={exportAll}
              disabled={exporting}
              className="btn-secondary flex items-center gap-2 text-sm"
              title="ดาวน์โหลด Excel สรุปทั้งระบบ (ทะเบียน·ล้าง·ซ่อม·ปฏิทิน) สำหรับตรวจสอบ/backup"
            >
              <FileSpreadsheet className="h-4 w-4" />
              {exporting ? 'กำลังออก…' : 'ดาวน์โหลด Excel (สรุป)'}
            </button>

            {isAdmin && (
              <>
                <button
                  onClick={() => importRef.current?.click()}
                  disabled={importing}
                  className="btn-secondary flex items-center gap-2 text-sm"
                >
                  <Upload className="h-4 w-4" />
                  {importing ? 'กำลังนำเข้า…' : 'นำเข้า Excel'}
                </button>
                <input ref={importRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
                <button onClick={openNew} className="btn-primary flex items-center gap-2 text-sm">
                  <Plus className="h-4 w-4" /> เพิ่มเครื่อง
                </button>
              </>
            )}
          </div>
        </div>

        {/* Import hint */}
        {isAdmin && (
          <p className="text-xs text-ink-muted">
            คอลัมน์ Excel: รหัสแอร์, โซน, สถานที่, คลินิก, อาคาร, ชั้น, ห้อง, ประเภทอุปกรณ์, ประเภทแอร์, ยี่ห้อ, รุ่น, ขนาด, ล้างใหญ่/ปี, ล้างย่อย/ปี, พัดลม/ปี
          </p>
        )}

        {/* Import result */}
        {importMsg && (
          <div className={`flex items-start gap-2 text-sm px-4 py-3 rounded-xl ${importMsg.ok ? 'bg-green-50 text-green-800' : 'bg-danger-soft text-danger'}`}>
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">{importMsg.text}</p>
              {importMsg.errors?.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs space-y-0.5">
                  {importMsg.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                  {importMsg.errors.length > 5 && <li>…และอีก {importMsg.errors.length - 5} รายการ</li>}
                </ul>
              )}
            </div>
            <button onClick={() => setImportMsg(null)} className="ml-auto text-current opacity-60 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <select
            className="input !w-auto min-w-[120px]"
            value={filterZone}
            onChange={(e) => setFilterZone(e.target.value)}
          >
            <option value="">ทุกโซน</option>
            {PTS_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          <select
            className="input !w-auto min-w-[140px]"
            value={filterEquip}
            onChange={(e) => setFilterEquip(e.target.value)}
          >
            <option value="">ทุกประเภท</option>
            <option value="ac">แอร์</option>
            <option value="fan">พัดลม</option>
          </select>
          <select className="input !w-auto min-w-[150px]" value={filterLoc} onChange={(e) => setFilterLoc(e.target.value)}>
            <option value="">ทุกสถานที่</option>
            {[...new Set(rows.map((u) => u.location).filter(Boolean))].sort().map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select className="input !w-auto min-w-[130px]" value={filterAc} onChange={(e) => setFilterAc(e.target.value)}>
            <option value="">ทุกตระกูล</option>
            {[...new Set(rows.map((u) => u.ac_type).filter(Boolean))].sort().map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            className="input !w-auto flex-1 min-w-[180px]"
            placeholder="ค้นหา รหัส / สถานที่ / ยี่ห้อ…"
            value={searchQ}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>

        {/* Error */}
        {err && (
          <p className="text-sm text-danger bg-danger-soft px-3 py-2 rounded-lg flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />{err}
          </p>
        )}

        {/* Table */}
        {loading ? (
          <p className="text-center text-ink-muted py-12">กำลังโหลด…</p>
        ) : rows.length === 0 ? (
          <div className="text-center py-14 text-ink-muted">
            <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">ยังไม่มีรายการเครื่อง</p>
            {isAdmin && <p className="text-sm mt-1">กด "+ เพิ่มเครื่อง" หรือนำเข้า Excel เพื่อเริ่มต้น</p>}
          </div>
        ) : (
          <div className="bg-white border border-line rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="text-left text-ink-muted text-xs uppercase tracking-wide bg-gray-50 border-b border-line">
                    <th className="py-2.5 px-4">รหัสแอร์</th>
                    <th className="py-2.5 px-3">โซน</th>
                    <th className="py-2.5 px-3">สถานที่</th>
                    <th className="py-2.5 px-3">อาคาร/ชั้น/ห้อง</th>
                    <th className="py-2.5 px-3">ประเภท</th>
                    <th className="py-2.5 px-3">สัญญา</th>
                    <th className="py-2.5 px-3 w-10"></th>
                    {isAdmin && <th className="py-2.5 px-3 w-20"></th>}
                  </tr>
                </thead>
                <tbody>
                  {view.map((u) => (
                    <tr key={u.id} className="border-b border-line last:border-0 hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 px-4">
                        <span className="font-mono font-medium text-ink">{u.asset_code}</span>
                        {!u.active && (
                          <span className="ml-2 badge badge-gray text-[10px]">ปิด</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-ink-muted">{u.pts_zone || '—'}</td>
                      <td className="py-2.5 px-3">
                        <span className="text-ink">{u.location || '—'}</span>
                        {u.is_clinic && (
                          <span className="ml-1.5 badge badge-warn text-[10px]">คลินิก</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-ink-muted text-xs">
                        {[u.building, u.floor && `ชั้น${u.floor}`, u.room].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`badge text-[11px] ${u.equipment === 'fan' ? 'badge-primary' : 'badge-success'}`}>
                          {u.ac_type || (u.equipment === 'fan' ? 'พัดลม' : 'แอร์')}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs text-ink-muted">
                        {contractStr(u)}
                      </td>
                      {/* QR button — all roles */}
                      <td className="py-2.5 px-3 text-center">
                        <button
                          onClick={() => setQrUnit(u)}
                          className="text-ink-muted hover:text-primary p-1 rounded transition-colors"
                          title="ดู / พิมพ์ QR Code"
                        >
                          <QrCode className="h-3.5 w-3.5" />
                        </button>
                      </td>
                      {isAdmin && (
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => openEdit(u)}
                            className="text-primary hover:text-primary-dark p-1 rounded"
                            title="แก้ไข"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => del(u)}
                            className="text-danger hover:text-red-700 p-1 rounded ml-1"
                            title="ลบ"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-line bg-gray-50">
              <p className="text-xs text-ink-muted">{view.length} รายการ</p>
            </div>
          </div>
        )}
      </div>

      {/* Edit/add modal */}
      {modalOpen && (
        <UnitModal
          unit={modalUnit}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}

      {/* QR modal */}
      {qrUnit && (
        <QrModal
          unit={qrUnit}
          onClose={() => setQrUnit(null)}
        />
      )}
    </Layout>
  )
}
