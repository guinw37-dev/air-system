// แท็บ "เป้าหมายวันถัดไป" ในหน้าเป้าหมายล้าง (PDF ปรับ dashboard 9 พ.ย. 69 ข้อ 8)
// เลือกวัน + ประเภทล้าง + กรองสถานที่/ตระกูล/รหัส → ติ๊กเครื่องที่ "ยังไม่ล้างในเดือนนั้น" →
// ตั้งเป็นเป้าของวันนั้น. เขียนลงตารางเดียวกับ "ปฏิทินล้างแอร์" (wash_schedule) — ช่างเห็นในปฏิทิน,
// แจ้ง LINE เดิมยังทำงาน และนัดปิดเองเมื่อสร้างใบงานของเครื่องนั้น.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../api/client'
import { useHasZones } from '../lib/zones'

const WT = [
  { key: 'major', label: 'ล้างใหญ่' },
  { key: 'minor', label: 'ล้างย่อย' },
  { key: 'fan',   label: 'พัดลม' },
]
const WT_LABEL = Object.fromEntries(WT.map((w) => [w.key, w.label]))
const ZONES = ['PTS1', 'PTS2']
const th = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${Number(d.slice(0, 4)) + 543}` : '—')
const thMonth = (m) => `${m.slice(5)}/${Number(m.slice(0, 4)) + 543}`
const BULK_MAX = 200   // = backend wash-schedule/bulk

export default function NextDayTargets() {
  const hasZones = useHasZones()
  const [date, setDate] = useState(() => dayjs().add(1, 'day').format('YYYY-MM-DD'))
  const [wt, setWt] = useState('major')
  const [zone, setZone] = useState('')
  const [location, setLocation] = useState('')
  const [acType, setAcType] = useState('')
  const [q, setQ] = useState('')
  const [units, setUnits] = useState([])          // ทะเบียน → ตัวเลือกสถานที่/ตระกูล
  const [data, setData] = useState(null)          // { total, washed, items }
  const [planned, setPlanned] = useState([])      // นัดของวันที่เลือก (ทุกประเภท)
  const [sel, setSel] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)            // { ok, text }
  const month = date.slice(0, 7)

  useEffect(() => { api.get('/wash-units').then((r) => setUnits(r.data || [])).catch(() => {}) }, [])

  const load = useCallback(async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    setLoading(true)
    try {
      const params = { month, work_type: wt }
      if (zone) params.zone = zone
      if (location) params.location = location
      if (acType) params.ac_type = acType
      const [nw, pl] = await Promise.all([
        api.get('/wash-units/not-washed', { params }),
        api.get('/wash-schedule', { params: { from: date, to: date } }),
      ])
      setData(nw.data)
      setPlanned(pl.data?.items || [])
    } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.error || 'โหลดรายการไม่สำเร็จ' })
    } finally { setLoading(false) }
  }, [date, month, wt, zone, location, acType])
  useEffect(() => { load(); setSel(new Set()) }, [load])

  const eq = wt === 'fan' ? 'fan' : 'ac'
  const inScope = units.filter((u) => u.active !== false && u.equipment === eq && (!zone || u.pts_zone === zone))
  const locOpts = [...new Set(inScope.map((u) => u.location).filter(Boolean))].sort()
  const acOpts = [...new Set(inScope.map((u) => u.ac_type).filter(Boolean))].sort()

  // เครื่องที่ตั้งเป้าวันนี้ไว้แล้ว (ประเภทเดียวกัน) — ติ๊กซ้ำไม่ได้
  const plannedToday = useMemo(() => new Set(planned.filter((p) => p.work_type === wt && p.status !== 'skipped')
    .map((p) => p.asset_code)), [planned, wt])
  const items = (data?.items || []).filter((i) => !q || String(i.asset_code).toLowerCase().includes(q.trim().toLowerCase()))
  const selectable = items.filter((i) => !plannedToday.has(i.asset_code))
  const allSel = selectable.length > 0 && selectable.every((i) => sel.has(i.asset_code))

  const toggle = (code) => setSel((s) => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n })
  const toggleAll = () => setSel(allSel ? new Set() : new Set(selectable.map((i) => i.asset_code)))

  async function save() {
    if (!sel.size) return
    if (sel.size > BULK_MAX) { setMsg({ ok: false, text: `ตั้งได้ครั้งละไม่เกิน ${BULK_MAX} เครื่อง` }); return }
    setSaving(true); setMsg(null)
    try {
      const r = await api.post('/wash-schedule/bulk', { planned_date: date, work_type: wt, asset_codes: [...sel] })
      const b = r.data || {}
      const extra = [b.skipped_existing?.length ? `ข้าม ${b.skipped_existing.length} เครื่องที่มีนัดอยู่แล้ว` : '',
        b.unknown?.length ? `ไม่พบในทะเบียน ${b.unknown.length} เครื่อง` : ''].filter(Boolean).join(' · ')
      setMsg({ ok: true, text: `ตั้งเป้า${WT_LABEL[wt]}วันที่ ${th(date)} แล้ว ${b.created || 0} เครื่อง${extra ? ` (${extra})` : ''}` })
      setSel(new Set())
      await load()
    } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.error || 'บันทึกไม่สำเร็จ' })
    } finally { setSaving(false) }
  }

  async function removePlan(p) {
    if (!confirm(`ลบเป้า ${p.asset_code} (${WT_LABEL[p.work_type] || p.work_type}) วันที่ ${th(p.planned_date)}?`)) return
    try { await api.delete(`/wash-schedule/${p.id}`); await load() }
    catch (e) { setMsg({ ok: false, text: e.response?.data?.error || 'ลบไม่สำเร็จ' }) }
  }

  const plannedByType = WT.map((w) => ({ ...w, n: planned.filter((p) => p.work_type === w.key && p.status === 'planned').length }))

  return (
    <div className="space-y-4">
      <div className="bg-white border rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">วันที่ตั้งเป้า</label>
            <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">ประเภทล้าง</label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={wt}
              onChange={(e) => { setWt(e.target.value); setAcType(''); setLocation('') }}>
              {WT.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
            </select>
          </div>
          {hasZones && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">ลูกค้า/โซน</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={zone}
                onChange={(e) => { setZone(e.target.value); setLocation('') }}>
                <option value="">ทุกโซน</option>
                {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-600 mb-1">สถานที่</label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">ทุกสถานที่</option>
              {locOpts.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">{wt === 'fan' ? 'ตระกูลพัดลม' : 'ตระกูลแอร์'}</label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={acType} onChange={(e) => setAcType(e.target.value)}>
              <option value="">ทุกตระกูล</option>
              {acOpts.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">รหัสแอร์</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นรหัส เช่น FCU-9-04" />
          </div>
        </div>
        <p className="text-xs text-gray-500">
          รายการด้านล่าง = เครื่องที่ <b>ยังไม่ได้{WT_LABEL[wt]}ในเดือน {thMonth(month)}</b>
          {data && <> · ยังไม่ล้าง {data.items.length} จาก {data.total} เครื่อง (ล้างแล้ว {data.washed})</>}
          {' '}· ไม่นับใบงานที่ส่งกลับ
        </p>
      </div>

      {msg && (
        <div className={`rounded-xl px-4 py-2.5 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* เลือกเครื่อง */}
      <div className="bg-white border rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b bg-gray-50">
          <span className="text-sm text-gray-600">เลือกแล้ว <b className="text-blue-700">{sel.size}</b> เครื่อง</span>
          <button onClick={save} disabled={!sel.size || saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-40">
            {saving ? 'กำลังบันทึก…' : `ตั้งเป็นเป้า${WT_LABEL[wt]}วันที่ ${th(date)}`}
          </button>
        </div>
        {loading ? <p className="text-center text-gray-400 py-8">กำลังโหลด…</p>
          : items.length === 0 ? <p className="text-center text-gray-400 py-8">{data?.total ? 'ล้างครบทุกเครื่องแล้ว / ไม่พบตามตัวกรอง' : 'ไม่มีเครื่องในทะเบียนตามตัวกรอง'}</p>
          : (
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 bg-white"><tr className="text-left text-gray-500 border-b whitespace-nowrap">
                  <th className="py-2 px-3 w-10"><input type="checkbox" className="h-4 w-4 accent-blue-600" checked={allSel} onChange={toggleAll} aria-label="เลือกทั้งหมด" /></th>
                  <th className="py-2 px-2">รหัสแอร์</th>
                  {hasZones && <th className="py-2 px-2">โซน</th>}
                  <th className="py-2 px-2">สถานที่ / อาคาร · ชั้น · ห้อง</th>
                  <th className="py-2 px-2">ตระกูล</th>
                  <th className="py-2 px-2">{WT_LABEL[wt]}ล่าสุด</th>
                  <th className="py-2 px-2">นัดถัดไป</th>
                </tr></thead>
                <tbody>
                  {items.map((i) => {
                    const done = plannedToday.has(i.asset_code)
                    return (
                      <tr key={i.asset_code} onClick={() => !done && toggle(i.asset_code)}
                        className={`border-b last:border-0 ${done ? 'text-gray-400' : 'cursor-pointer hover:bg-blue-50/50'} ${sel.has(i.asset_code) ? 'bg-blue-50' : ''}`}>
                        <td className="py-2 px-3">
                          <input type="checkbox" className="h-4 w-4 accent-blue-600" disabled={done}
                            checked={done || sel.has(i.asset_code)} onChange={() => toggle(i.asset_code)} onClick={(e) => e.stopPropagation()} />
                        </td>
                        <td className="py-2 px-2 font-mono font-medium">{i.asset_code}</td>
                        {hasZones && <td className="py-2 px-2">{i.pts_zone || '—'}</td>}
                        <td className="py-2 px-2 text-gray-600">{[i.location, [i.building, i.floor, i.room].filter(Boolean).join(' · ')].filter(Boolean).join(' / ') || '—'}</td>
                        <td className="py-2 px-2">{i.ac_type || '—'}</td>
                        <td className="py-2 px-2 text-gray-600">{th(i.last_washed)}</td>
                        <td className="py-2 px-2">{done ? <span className="text-emerald-600">ตั้งเป้าวันนี้แล้ว</span> : th(i.next_plan)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* เป้าที่ตั้งไว้ของวันนั้น */}
      <div className="bg-white border rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-gray-700">
            เป้าของวันที่ {th(date)} · {plannedByType.map((w) => `${w.label} ${w.n}`).join(' · ')}
          </h3>
          <Link to="/wash-calendar" className="text-xs text-blue-600 hover:underline">ดูในปฏิทินล้างแอร์ →</Link>
        </div>
        {planned.length === 0 ? <p className="text-sm text-gray-400">ยังไม่มีเป้าในวันนี้</p> : (
          <div className="flex flex-wrap gap-2">
            {planned.map((p) => (
              <span key={p.id} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${p.status === 'done' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : p.status === 'skipped' ? 'bg-gray-50 text-gray-400 line-through' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
                <b className="font-mono">{p.asset_code}</b> {WT_LABEL[p.work_type] || p.work_type}
                {p.status === 'done' && ' ✓'}
                {p.status === 'planned' && (
                  <button onClick={() => removePlan(p)} className="text-red-500 hover:text-red-700" title="ลบเป้านี้" aria-label={`ลบเป้า ${p.asset_code}`}>×</button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
