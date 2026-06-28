import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { CalendarRange, ChevronLeft, ChevronRight, Wand2, Check, SkipForward, Trash2, RotateCcw, AlertTriangle, Plus } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api/client'
import { useAuthStore } from '../store/auth'

const WT = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลม' }
const WT_COLOR = { major: 'bg-blue-100 text-blue-700', minor: 'bg-teal-100 text-teal-700', fan: 'bg-violet-100 text-violet-700' }
const TH_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const monthTitle = (m) => `${TH_MONTHS[m.month()]} ${m.year() + 543}`
const thDay = (d) => `${d.date()} ${TH_MONTHS[d.month()]} ${d.year() + 543}`

// สีประจำโซน (วนซ้ำตามจำนวนโซน)
const ZONE_PALETTE = [
  { dot: 'bg-blue-600', chip: 'bg-blue-50 text-blue-700 border-blue-200', text: 'text-blue-600' },
  { dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 border-rose-200', text: 'text-rose-600' },
  { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', text: 'text-amber-600' },
  { dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700 border-violet-200', text: 'text-violet-600' },
  { dot: 'bg-cyan-500', chip: 'bg-cyan-50 text-cyan-700 border-cyan-200', text: 'text-cyan-600' },
  { dot: 'bg-fuchsia-500', chip: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200', text: 'text-fuchsia-600' },
]

export default function WashCalendar() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const canEdit = user?.role === 'admin' || user?.role === 'super_admin'

  const [month, setMonth] = useState(dayjs().startOf('month'))
  const [sel, setSel] = useState(dayjs().format('YYYY-MM-DD'))
  const [summary, setSummary] = useState({})       // 'YYYY-MM-DD' → {planned,done,skipped,total}
  const [dayItems, setDayItems] = useState([])
  const [loadingDay, setLoadingDay] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showGen, setShowGen] = useState(false)
  const [cfg, setCfg] = useState({ cap: { major: 10, minor: 10, fan: 5 }, workdays: [1, 2, 3, 4, 5, 6], byZone: true })
  const [onlyOutstanding, setOnlyOutstanding] = useState(false)
  const [codes, setCodes] = useState([])
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({ asset_code: '', work_type: 'major' })

  const gridStart = month.startOf('month').startOf('week')   // อาทิตย์
  const gridDays = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'))
  const today = dayjs().format('YYYY-MM-DD')

  const loadSummary = useCallback(async () => {
    setErr('')
    try {
      const from = gridStart.format('YYYY-MM-DD')
      const to = gridStart.add(41, 'day').format('YYYY-MM-DD')
      const r = await api.get('/wash-schedule/summary', { params: { from, to } })
      const map = {}
      for (const d of r.data.days || []) map[d.date] = d
      setSummary(map)
    } catch (e) { setErr(e.response?.data?.error || e.message) }
  }, [month])

  const loadDay = useCallback(async () => {
    setLoadingDay(true)
    try {
      const r = await api.get('/wash-schedule', { params: { from: sel, to: sel } })
      setDayItems(r.data.items || [])
    } catch { setDayItems([]) } finally { setLoadingDay(false) }
  }, [sel])

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadDay() }, [loadDay])

  // โหลด config ที่จำไว้ (ล้างได้/วัน, วันทำงาน, แยกโซน)
  useEffect(() => {
    api.get('/auth/prefs/wash_plan_cfg').then((r) => {
      if (!r.data?.value) return
      const v = { ...r.data.value }
      if (typeof v.workdays === 'string') v.workdays = v.workdays === 'mon_fri' ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6]
      if (!Array.isArray(v.workdays)) v.workdays = [1, 2, 3, 4, 5, 6]
      // เก่า: capacity เดี่ยว → แตกเป็น cap ต่อประเภท
      if (typeof v.capacity === 'number' && !v.cap) v.cap = { major: v.capacity, minor: v.capacity, fan: v.capacity }
      delete v.capacity
      if (!v.cap) v.cap = { major: 10, minor: 10, fan: 5 }
      setCfg((c) => ({ ...c, ...v }))
    }).catch(() => {})
  }, [])

  const generate = async () => {
    setBusy(true); setErr('')
    try {
      const r = await api.post('/wash-schedule/generate', {
        from: today, workdays: cfg.workdays, byZone: cfg.byZone, onlyOutstanding,
        cap_major: cfg.cap.major, cap_minor: cfg.cap.minor, cap_fan: cfg.cap.fan,
      })
      api.put('/auth/prefs/wash_plan_cfg', { value: cfg }).catch(() => {})   // จำ default
      setShowGen(false)
      const c = r.data.cap || cfg.cap
      alert(`สร้างแผนสำเร็จ ${r.data.created} นัด (ใหญ่ ${c.major} · ย่อย ${c.minor} · พัดลม ${c.fan} ต่อวัน)`)
      await loadSummary(); await loadDay()
    } catch (e) { setErr(e.response?.data?.error || e.message) } finally { setBusy(false) }
  }

  const patch = async (id, body) => {
    setBusy(true)
    try { await api.patch(`/wash-schedule/${id}`, body); await loadSummary(); await loadDay() }
    catch (e) { setErr(e.response?.data?.error || e.message) } finally { setBusy(false) }
  }
  const remove = async (id) => {
    if (!window.confirm('ลบนัดนี้?')) return
    setBusy(true)
    try { await api.delete(`/wash-schedule/${id}`); await loadSummary(); await loadDay() }
    catch (e) { setErr(e.response?.data?.error || e.message) } finally { setBusy(false) }
  }

  // ทีมจัดแผนเอง — เพิ่มนัดเครื่องลงวันที่เลือก
  useEffect(() => { api.get('/wash-units/codes').then((r) => setCodes(r.data || [])).catch(() => {}) }, [])
  const addEntry = async () => {
    if (!addForm.asset_code.trim()) return
    setBusy(true); setErr('')
    try {
      await api.post('/wash-schedule', { asset_code: addForm.asset_code.trim(), work_type: addForm.work_type, planned_date: sel })
      setAddForm({ asset_code: '', work_type: 'major' }); setAddOpen(false)
      await loadSummary(); await loadDay()
    } catch (e) { setErr(e.response?.data?.error || e.message) } finally { setBusy(false) }
  }

  // คลิกนัด → เปิดใบงาน: ถ้าเสร็จแล้วเปิดใบงานนั้น, ถ้ายัง → สร้างใบงานใหม่ prefill เครื่อง+ประเภท
  const openWo = (it) => {
    if (it.status === 'done' && it.done_wo_id) navigate(`/simple-wo/${it.done_wo_id}`)
    else navigate(`/simple-wo/new?unit=${encodeURIComponent(it.asset_code)}&wt=${it.work_type}`)
  }

  // โซนทั้งหมดที่เห็นในเดือน → กำหนดสีคงที่
  const zoneList = useMemo(() => {
    const set = new Set()
    Object.values(summary).forEach((d) => Object.keys(d.zones || {}).forEach((z) => set.add(z)))
    return [...set].sort()
  }, [summary])
  const zoneColor = (z) => ZONE_PALETTE[Math.max(0, zoneList.indexOf(z)) % ZONE_PALETTE.length]

  const selM = dayjs(sel)
  // จัดกลุ่มนัดของวันที่เลือก ตามประเภทงาน (ใหญ่/ย่อย/พัดลม)
  const WT_ORDER = ['major', 'minor', 'fan']
  const dayGroups = WT_ORDER
    .map((wt) => ({ wt, items: dayItems.filter((i) => i.work_type === wt) }))
    .filter((g) => g.items.length)

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
        {/* header */}
        <div className="flex items-center gap-2">
          <CalendarRange className="text-blue-700" size={22} />
          <h1 className="text-xl font-bold text-slate-900">ปฏิทินล้างแอร์</h1>
          {canEdit && (
            <button onClick={() => setShowGen(true)} disabled={busy}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              <Wand2 size={16} /> สร้างแผนอัตโนมัติ
            </button>
          )}
        </div>

        {err && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-sm text-red-700">{err}</div>}

        {/* ── ปฏิทินเต็มกว้าง ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {/* header แถบไล่สี */}
          <div className="flex items-center justify-between px-4 md:px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            <button onClick={() => setMonth(month.subtract(1, 'month'))} className="p-2 rounded-lg hover:bg-white/15"><ChevronLeft size={20} /></button>
            <div className="font-bold text-lg tracking-wide">{monthTitle(month)}</div>
            <div className="flex items-center gap-1">
              <button onClick={() => { setMonth(dayjs().startOf('month')); setSel(today) }} className="text-sm px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25">วันนี้</button>
              <button onClick={() => setMonth(month.add(1, 'month'))} className="p-2 rounded-lg hover:bg-white/15"><ChevronRight size={20} /></button>
            </div>
          </div>

          <div className="p-3 md:p-5">
            <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-slate-400 mb-2">
              {TH_DOW.map((d, i) => <div key={i} className={i === 0 || i === 6 ? 'text-rose-400' : ''}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {gridDays.map((d) => {
                const key = d.format('YYYY-MM-DD')
                const s = summary[key]
                const inMonth = d.month() === month.month()
                const isToday = key === today
                const isSel = key === sel
                const wknd = d.day() === 0 || d.day() === 6
                const zoneEntries = s ? Object.entries(s.zones || {}).filter(([, v]) => (v.planned + v.done) > 0) : []
                return (
                  <button key={key} onClick={() => setSel(key)}
                    className={`group min-h-[100px] rounded-xl border p-1.5 text-left transition-all flex flex-col ${
                      isSel ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50/50 shadow-sm'
                        : 'border-slate-100 hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5'} ${
                      inMonth ? (wknd ? 'bg-slate-50/60' : 'bg-white') : 'opacity-35'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-bold ${isToday ? 'text-white bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full w-7 h-7 flex items-center justify-center shadow' : wknd ? 'text-rose-400' : 'text-slate-700'}`}>{d.date()}</span>
                      {s && s.done > 0 && <span className="text-[10px] font-semibold text-emerald-600 flex items-center gap-0.5"><Check size={11} />{s.done}</span>}
                    </div>
                    {zoneEntries.length > 0 && (
                      <div className="mt-auto flex flex-col gap-0.5">
                        {zoneEntries.map(([z, v]) => {
                          const c = zoneColor(z)
                          return (
                            <span key={z} className={`flex items-center gap-1 text-[10px] font-medium px-1 py-0.5 rounded border ${c.chip}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${c.dot} shrink-0`} />
                              <span className="truncate">{z}</span>
                              <span className="ml-auto font-bold">{v.planned + v.done}</span>
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
            {/* legend โซน + สถานะ */}
            <div className="flex flex-wrap gap-3 mt-4 text-xs text-slate-500">
              {zoneList.map((z) => (
                <span key={z} className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded-full ${zoneColor(z).dot}`} /> {z}</span>
              ))}
              <span className="flex items-center gap-1.5 ml-auto text-emerald-600"><Check size={13} /> เสร็จแล้ว</span>
            </div>
          </div>
        </div>

        {/* ── รายละเอียดวันที่เลือก (ล่าง) แยกตามประเภทงาน ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
          <div className="flex items-baseline gap-3 mb-4 flex-wrap">
            <h2 className="font-bold text-slate-800 text-lg">{thDay(selM)}</h2>
            <span className="text-sm text-slate-400">{dayItems.length} นัด · ค้าง {dayItems.filter((i) => i.status === 'planned').length} · เสร็จ {dayItems.filter((i) => i.status === 'done').length}</span>
            <span className="ml-auto text-xs text-slate-400">คลิกที่รายการเพื่อเปิด/สร้างใบงาน</span>
            {canEdit && (
              <button onClick={() => setAddOpen((v) => !v)}
                className="flex items-center gap-1 text-sm px-2.5 py-1 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50">
                <Plus size={15} /> เพิ่มนัด
              </button>
            )}
          </div>
          {addOpen && canEdit && (
            <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
              <label className="flex-1 min-w-[180px]">
                <span className="block text-xs text-slate-500 mb-0.5">เลขเครื่อง (asset)</span>
                <input list="ws-codes" value={addForm.asset_code} onChange={(e) => setAddForm({ ...addForm, asset_code: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm" placeholder="พิมพ์/เลือกเครื่อง" />
                <datalist id="ws-codes">{codes.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
              <label>
                <span className="block text-xs text-slate-500 mb-0.5">ประเภท</span>
                <select value={addForm.work_type} onChange={(e) => setAddForm({ ...addForm, work_type: e.target.value })}
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm">
                  <option value="major">ล้างใหญ่</option><option value="minor">ล้างย่อย</option><option value="fan">พัดลม</option>
                </select>
              </label>
              <button onClick={addEntry} disabled={busy || !addForm.asset_code.trim()}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">เพิ่มลง {selM.date()}/{selM.month() + 1}</button>
              <button onClick={() => setAddOpen(false)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600">ยกเลิก</button>
            </div>
          )}
          {(() => {
            const dups = dayItems.filter((i) => i.status === 'planned' && i.washed_at)
            if (!dups.length) return null
            return (
              <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle size={16} className="shrink-0" />
                <span>พบ <b>{dups.length}</b> นัดที่อาจล้างไปแล้ว (มีใบงานล้างภายใน 90 วัน) — กด “ทำแล้ว” เพื่อเคลียร์ หรือ “ข้าม”</span>
                {canEdit && <button onClick={() => dups.forEach((d) => patch(d.id, { status: 'done', done_wo_id: d.washed_wo_id }))} disabled={busy}
                  className="ml-auto shrink-0 text-xs font-medium px-2 py-1 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">เคลียร์ทั้งหมด</button>}
              </div>
            )
          })()}
          {loadingDay ? (
            <p className="text-center text-slate-400 py-8 text-sm">กำลังโหลด…</p>
          ) : dayItems.length === 0 ? (
            <p className="text-center text-slate-400 py-8 text-sm">ไม่มีนัดวันนี้</p>
          ) : (
            <div className="space-y-5">
              {dayGroups.map((g) => (
                <div key={g.wt}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-sm font-bold px-2 py-0.5 rounded ${WT_COLOR[g.wt] || 'bg-slate-100'}`}>{WT[g.wt] || g.wt}</span>
                    <span className="text-xs text-slate-400">{g.items.length} เครื่อง</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {g.items.map((it) => (
                      <div key={it.id} onClick={() => openWo(it)}
                        className={`rounded-xl border p-3 cursor-pointer transition-colors hover:border-blue-300 hover:bg-blue-50/30 ${
                          it.status === 'done' ? 'border-emerald-100 bg-emerald-50/40'
                            : it.status === 'skipped' ? 'border-slate-100 bg-slate-50 opacity-70' : 'border-slate-100'}`}>
                        <div className="flex items-center gap-2">
                          {it.pts_zone && <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${zoneColor(it.pts_zone).dot}`} title={it.pts_zone} />}
                          <span className="text-sm font-semibold text-slate-800 truncate">{it.asset_code}</span>
                          {it.status === 'done' && <Check size={15} className="text-emerald-600 ml-auto shrink-0" />}
                          {it.status === 'skipped' && <span className="text-[11px] text-slate-400 ml-auto">ข้าม</span>}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">
                          {[it.pts_zone, it.building, it.floor, it.room].filter(Boolean).join(' › ') || '—'}{it.ac_type ? ` · ${it.ac_type}` : ''}
                        </div>
                        {it.status === 'planned' && it.washed_at && (
                          <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 rounded px-1.5 py-0.5">
                            <AlertTriangle size={12} className="shrink-0" /> ล้างไปแล้ว {it.washed_at}
                          </div>
                        )}
                        {canEdit && it.status !== 'done' && (
                          <div className="flex items-center gap-2 mt-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                            <input type="date" defaultValue={it.planned_date} onChange={(e) => e.target.value !== it.planned_date && patch(it.id, { planned_date: e.target.value })}
                              className="text-xs border border-slate-200 rounded px-1.5 py-0.5 text-slate-600" title="ย้ายวัน" />
                            {it.washed_at && it.status === 'planned' && (
                              <button onClick={() => patch(it.id, { status: 'done', done_wo_id: it.washed_wo_id })} disabled={busy} className="text-xs flex items-center gap-0.5 text-emerald-600 hover:text-emerald-700"><Check size={13} /> ทำแล้ว</button>
                            )}
                            {it.status === 'planned'
                              ? <button onClick={() => patch(it.id, { status: 'skipped' })} disabled={busy} className="text-xs flex items-center gap-0.5 text-slate-500 hover:text-amber-600"><SkipForward size={13} /> ข้าม</button>
                              : <button onClick={() => patch(it.id, { status: 'planned' })} disabled={busy} className="text-xs flex items-center gap-0.5 text-slate-500 hover:text-blue-600"><RotateCcw size={13} /> คืน</button>}
                            <button onClick={() => remove(it.id)} disabled={busy} className="text-xs flex items-center gap-0.5 text-slate-400 hover:text-red-600 ml-auto"><Trash2 size={13} /> ลบ</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-400 mt-4">เสร็จอัตโนมัติเมื่อสร้างใบงานล้างของเครื่องนั้น</p>
        </div>
      </div>

      {/* ── modal: สร้างแผนอัตโนมัติ (กรอก capacity/วัน) ── */}
      {showGen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !busy && setShowGen(false)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-xl p-5">
            <h3 className="font-bold text-slate-800 text-lg mb-1">สร้างแผนอัตโนมัติ</h3>
            <p className="text-xs text-slate-400 mb-4">กระจายเครื่องลงปฏิทินตามกำลังต่อวัน · ลบเฉพาะแผนที่ยังไม่เสร็จตั้งแต่วันนี้ไป</p>
            <div className="mb-3">
              <span className="text-sm text-slate-600">ล้างได้ / วัน (เครื่อง) แยกประเภท</span>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {[['major', 'ล้างใหญ่'], ['minor', 'ล้างย่อย'], ['fan', 'พัดลม']].map(([k, lb]) => (
                  <label key={k} className="text-center">
                    <span className="block text-xs text-slate-500 mb-0.5">{lb}</span>
                    <input type="number" min="0" value={cfg.cap[k]}
                      onChange={(e) => setCfg({ ...cfg, cap: { ...cfg.cap, [k]: e.target.value } })}
                      className="w-full border border-slate-200 rounded-lg px-2 py-2 text-slate-800 text-center" />
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">ใส่ 0 = ไม่จัดประเภทนั้นลงปฏิทิน</p>
            </div>
            <div className="mb-3">
              <span className="text-sm text-slate-600">วันทำงาน (เลือกได้หลายวัน)</span>
              <div className="flex gap-1 mt-1">
                {[[1, 'จ'], [2, 'อ'], [3, 'พ'], [4, 'พฤ'], [5, 'ศ'], [6, 'ส'], [0, 'อา']].map(([d, lb]) => {
                  const on = (cfg.workdays || []).includes(d)
                  return (
                    <button key={d} type="button"
                      onClick={() => setCfg({ ...cfg, workdays: on ? cfg.workdays.filter((x) => x !== d) : [...(cfg.workdays || []), d] })}
                      className={`flex-1 py-2 rounded-lg text-sm border ${on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200'}`}>{lb}</button>
                  )
                })}
              </div>
            </div>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input type="checkbox" className="accent-blue-600 h-4 w-4" checked={cfg.byZone} onChange={(e) => setCfg({ ...cfg, byZone: e.target.checked })} />
              <span className="text-sm text-slate-600">แยกโควต้าต่อโซน (PTS1/PTS2)</span>
            </label>
            <label className="flex items-center gap-2 mb-4 cursor-pointer">
              <input type="checkbox" className="accent-amber-600 h-4 w-4" checked={onlyOutstanding} onChange={(e) => setOnlyOutstanding(e.target.checked)} />
              <span className="text-sm text-slate-600">เฉพาะที่คงค้าง (เกินกำหนด/ยังไม่ล้าง)</span>
            </label>
            <div className="flex gap-2">
              <button onClick={() => setShowGen(false)} disabled={busy} className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">ยกเลิก</button>
              <button onClick={generate} disabled={busy} className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{busy ? 'กำลังสร้าง…' : 'สร้างแผน'}</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
