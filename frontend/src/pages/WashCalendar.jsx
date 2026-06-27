import { useState, useEffect, useCallback } from 'react'
import dayjs from 'dayjs'
import { CalendarRange, ChevronLeft, ChevronRight, Wand2, Check, SkipForward, Trash2, RotateCcw } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api/client'
import { useAuthStore } from '../store/auth'

const WT = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลม' }
const WT_COLOR = { major: 'bg-blue-100 text-blue-700', minor: 'bg-teal-100 text-teal-700', fan: 'bg-violet-100 text-violet-700' }
const TH_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const monthTitle = (m) => `${TH_MONTHS[m.month()]} ${m.year() + 543}`
const thDay = (d) => `${d.date()} ${TH_MONTHS[d.month()]} ${d.year() + 543}`

export default function WashCalendar() {
  const { user } = useAuthStore()
  const canEdit = user?.role === 'admin' || user?.role === 'super_admin'

  const [month, setMonth] = useState(dayjs().startOf('month'))
  const [sel, setSel] = useState(dayjs().format('YYYY-MM-DD'))
  const [summary, setSummary] = useState({})       // 'YYYY-MM-DD' → {planned,done,skipped,total}
  const [dayItems, setDayItems] = useState([])
  const [loadingDay, setLoadingDay] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

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

  const generate = async () => {
    if (!window.confirm('สร้างแผนอัตโนมัติจากทะเบียนแอร์? (ลบเฉพาะแผนที่ยังไม่เสร็จตั้งแต่วันนี้ไป แล้วกระจายใหม่)')) return
    setBusy(true); setErr('')
    try {
      const r = await api.post('/wash-schedule/generate', { from: today })
      alert(`สร้างแผนสำเร็จ ${r.data.created} นัด`)
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

  // คลิกนัด → เปิดใบงาน: ถ้าเสร็จแล้วเปิดใบงานนั้น, ถ้ายัง → สร้างใบงานใหม่ prefill เครื่อง+ประเภท
  const openWo = (it) => {
    if (it.status === 'done' && it.done_wo_id) navigate(`/simple-wo/${it.done_wo_id}`)
    else navigate(`/simple-wo/new?unit=${encodeURIComponent(it.asset_code)}&wt=${it.work_type}`)
  }

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
            <button onClick={generate} disabled={busy}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              <Wand2 size={16} /> สร้างแผนอัตโนมัติ
            </button>
          )}
        </div>

        {err && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-sm text-red-700">{err}</div>}

        {/* ── ปฏิทินเต็มกว้าง ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setMonth(month.subtract(1, 'month'))} className="p-2 rounded-lg hover:bg-slate-100"><ChevronLeft size={20} /></button>
            <div className="font-bold text-slate-800 text-lg">{monthTitle(month)}</div>
            <div className="flex items-center gap-1">
              <button onClick={() => { setMonth(dayjs().startOf('month')); setSel(today) }} className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">วันนี้</button>
              <button onClick={() => setMonth(month.add(1, 'month'))} className="p-2 rounded-lg hover:bg-slate-100"><ChevronRight size={20} /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center text-sm text-slate-400 mb-1.5">
            {TH_DOW.map((d, i) => <div key={i} className={i === 0 ? 'text-red-400' : ''}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {gridDays.map((d) => {
              const key = d.format('YYYY-MM-DD')
              const s = summary[key]
              const inMonth = d.month() === month.month()
              const isToday = key === today
              const isSel = key === sel
              return (
                <button key={key} onClick={() => setSel(key)}
                  className={`min-h-[96px] rounded-xl border p-2 text-left transition-colors flex flex-col ${
                    isSel ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50/40'
                      : 'border-slate-100 hover:border-blue-200'} ${inMonth ? '' : 'opacity-40'}`}>
                  <div className={`text-sm font-semibold ${isToday ? 'text-white bg-blue-600 rounded-full w-7 h-7 flex items-center justify-center' : 'text-slate-700'}`}>{d.date()}</div>
                  {s && s.total > 0 && (
                    <div className="mt-auto flex flex-wrap gap-1">
                      {s.planned > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">{s.planned}</span>}
                      {s.done > 0 && <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">✓{s.done}</span>}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
          <div className="flex gap-4 mt-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-200" /> ค้าง (planned)</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-200" /> เสร็จ (done)</span>
          </div>
        </div>

        {/* ── รายละเอียดวันที่เลือก (ล่าง) แยกตามประเภทงาน ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 md:p-6">
          <div className="flex items-baseline gap-3 mb-4 flex-wrap">
            <h2 className="font-bold text-slate-800 text-lg">{thDay(selM)}</h2>
            <span className="text-sm text-slate-400">{dayItems.length} นัด · ค้าง {dayItems.filter((i) => i.status === 'planned').length} · เสร็จ {dayItems.filter((i) => i.status === 'done').length}</span>
            <span className="ml-auto text-xs text-slate-400">คลิกที่รายการเพื่อเปิด/สร้างใบงาน</span>
          </div>
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
                          <span className="text-sm font-semibold text-slate-800 truncate">{it.asset_code}</span>
                          {it.status === 'done' && <Check size={15} className="text-emerald-600 ml-auto shrink-0" />}
                          {it.status === 'skipped' && <span className="text-[11px] text-slate-400 ml-auto">ข้าม</span>}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">
                          {[it.pts_zone, it.building, it.floor, it.room].filter(Boolean).join(' › ') || '—'}{it.ac_type ? ` · ${it.ac_type}` : ''}
                        </div>
                        {canEdit && it.status !== 'done' && (
                          <div className="flex items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                            <input type="date" defaultValue={it.planned_date} onChange={(e) => e.target.value !== it.planned_date && patch(it.id, { planned_date: e.target.value })}
                              className="text-xs border border-slate-200 rounded px-1.5 py-0.5 text-slate-600" title="ย้ายวัน" />
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
    </Layout>
  )
}
