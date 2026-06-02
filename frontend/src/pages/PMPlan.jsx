import { useEffect, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import api from '../api/client'

// ── constants ─────────────────────────────────────────────────────────────────

const DAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

// Calendar day cell color segments: major→warn, minor→primary, fan→success
const TYPE_DOT = {
  major: 'bg-warn',
  minor: 'bg-primary',
  fan:   'bg-success',
}
const TYPE_BADGE = {
  major: 'badge badge-warn',
  minor: 'badge badge-primary',
  fan:   'badge badge-success',
}
const TYPE_LABEL = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'ล้างพัดลม' }

const STATUS_BADGE = {
  pending: 'badge badge-warn',
  done:    'badge badge-success',
  overdue: 'badge badge-danger',
  skipped: 'badge badge-gray',
}
const STATUS_LABEL_MAP = { pending: 'รอดำเนินการ', done: 'เสร็จแล้ว', overdue: 'เลยกำหนด', skipped: 'ข้าม' }

function effectiveStatus(item) {
  if (item.status === 'done' || item.status === 'skipped') return item.status
  if (item.status === 'pending' && item.scheduled_date &&
      dayjs(item.scheduled_date).isBefore(dayjs(), 'day')) return 'overdue'
  return item.status
}

// ── Day popup ─────────────────────────────────────────────────────────────────

function DayPopup({ date, items, onClose, onUnitClick }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl w-full max-w-sm shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
          <h3 className="font-semibold text-ink text-sm">
            PM วันที่ {dayjs(date).format('D MMMM YYYY')}
          </h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-2">
          {items.length === 0 && (
            <p className="text-ink-muted text-sm text-center py-6">ไม่มีรายการ</p>
          )}
          {items.map((item, i) => {
            const eff = effectiveStatus(item)
            return (
              <button
                key={i}
                onClick={() => onUnitClick(item)}
                className="w-full text-left px-3 py-2.5 rounded-xl border border-line hover:bg-primary-soft hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-primary text-sm">{item.asset_code || '-'}</p>
                  <div className="flex gap-1 shrink-0">
                    <span className={TYPE_BADGE[item.planned_type] || 'badge badge-gray'}>
                      {TYPE_LABEL[item.planned_type] || item.planned_type}
                    </span>
                    <span className={STATUS_BADGE[eff] || 'badge badge-gray'}>
                      {STATUS_LABEL_MAP[eff] || eff}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-ink-muted mt-0.5">{item.room_name || '-'}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Calendar grid ─────────────────────────────────────────────────────────────

function CalendarGrid({ year, month, calData, onDayClick }) {
  // Build grid: first day of month, 6 rows × 7 cols
  const firstDay = dayjs(`${year}-${String(month).padStart(2, '0')}-01`)
  const daysInMonth = firstDay.daysInMonth()
  const startDow = firstDay.day() // 0=Sun

  const today = dayjs().format('YYYY-MM-DD')

  // cells: null = empty, number = day
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  // pad to complete weeks
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="card p-0 overflow-hidden">
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 bg-primary-dark text-white text-xs font-medium">
        {DAYS_TH.map((d) => (
          <div key={d} className="py-2 text-center">{d}</div>
        ))}
      </div>

      {/* Weeks */}
      <div className="grid grid-cols-7 divide-x divide-y divide-line">
        {cells.map((day, idx) => {
          if (!day) {
            return <div key={idx} className="min-h-[80px] bg-page/50" />
          }
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const items = calData[dateStr] || []
          const isToday = dateStr === today

          // Count by type
          const counts = {}
          items.forEach((it) => { counts[it.planned_type] = (counts[it.planned_type] || 0) + 1 })
          const typeKeys = Object.keys(counts).filter((k) => counts[k] > 0)

          return (
            <button
              key={idx}
              onClick={() => items.length > 0 && onDayClick(dateStr, items)}
              className={`min-h-[80px] p-1.5 text-left flex flex-col gap-1 transition-colors ${
                items.length > 0
                  ? 'hover:bg-primary-soft cursor-pointer'
                  : 'cursor-default'
              } ${isToday ? 'bg-primary-soft' : ''}`}
            >
              {/* Day number */}
              <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                isToday ? 'bg-primary text-white' : 'text-ink'
              }`}>
                {day}
              </span>

              {/* Count bubbles by type */}
              {typeKeys.length > 0 && (
                <div className="flex flex-col gap-0.5 w-full">
                  {typeKeys.map((type) => (
                    <div
                      key={type}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-white ${TYPE_DOT[type] || 'bg-ink-muted'}`}
                    >
                      <span className="flex-1 text-center leading-none">{counts[type]}</span>
                    </div>
                  ))}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PMPlan() {
  const navigate  = useNavigate()
  const now       = dayjs()

  const [clients, setClients] = useState([])
  const [sites,   setSites]   = useState([])

  const [clientId, setClientId] = useState('')
  const [siteId,   setSiteId]   = useState('')
  const [year,     setYear]     = useState(now.year())
  const [month,    setMonth]    = useState(now.month() + 1)

  const [calData,  setCalData]  = useState({})  // { "YYYY-MM-DD": [...] }
  const [loading,  setLoading]  = useState(false)

  // Day popup
  const [popup, setPopup] = useState(null) // { date, items }

  // Load clients
  useEffect(() => {
    api.get('/master/clients').then((r) => setClients(r.data || [])).catch(() => {})
  }, [])

  // Load sites when client changes
  useEffect(() => {
    setSiteId('')
    setSites([])
    if (!clientId) return
    api.get(`/master/sites?client_id=${clientId}`).then((r) => setSites(r.data || [])).catch(() => {})
  }, [clientId])

  // Load calendar data
  const loadCalendar = useCallback(() => {
    if (!clientId) { setCalData({}); return }
    setLoading(true)
    const p = new URLSearchParams({ client_id: clientId, year, month })
    if (siteId) p.set('site_id', siteId)
    api.get(`/pm/calendar?${p}`)
      .then((r) => setCalData(r.data || {}))
      .catch(() => setCalData({}))
      .finally(() => setLoading(false))
  }, [clientId, siteId, year, month])

  useEffect(() => { loadCalendar() }, [loadCalendar])

  const prevMonth = () => {
    const d = dayjs(`${year}-${String(month).padStart(2, '0')}-01`).subtract(1, 'month')
    setYear(d.year())
    setMonth(d.month() + 1)
  }
  const nextMonth = () => {
    const d = dayjs(`${year}-${String(month).padStart(2, '0')}-01`).add(1, 'month')
    setYear(d.year())
    setMonth(d.month() + 1)
  }

  // Total PM this month
  const totalThisMonth = useMemo(() => {
    return Object.values(calData).reduce((sum, arr) => sum + (arr || []).length, 0)
  }, [calData])

  const monthLabel = dayjs(`${year}-${String(month).padStart(2, '0')}-01`).format('MMMM YYYY')

  const years = Array.from({ length: 4 }, (_, i) => now.year() - 1 + i)

  return (
    <Layout title="PM Plan — ปฏิทิน">
      <div className="p-4 lg:p-6 flex flex-col gap-5">

        {/* ── Selectors ── */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Client <span className="text-danger">*</span></label>
            <select
              className="input min-w-[180px]"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">— เลือก Client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {clientId && (
            <div>
              <label className="label">Site</label>
              <select
                className="input min-w-[160px]"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
              >
                <option value="">ทุก Site</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="label">ปี</label>
            <select
              className="input w-28"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {years.map((y) => <option key={y} value={y}>{y + 543} ({y})</option>)}
            </select>
          </div>
        </div>

        {!clientId && (
          <div className="text-center text-ink-muted py-20 text-sm">เลือก Client เพื่อดูปฏิทิน PM</div>
        )}

        {clientId && (
          <>
            {/* ── Month navigation ── */}
            <div className="flex items-center justify-between">
              <button
                onClick={prevMonth}
                className="p-2 rounded-xl border border-line hover:bg-page transition-colors"
              >
                <ChevronLeft className="h-4 w-4 text-ink-muted" />
              </button>

              <div className="text-center">
                <h2 className="font-bold text-ink text-lg capitalize">{monthLabel}</h2>
                <p className="text-xs text-ink-muted">{totalThisMonth} รายการ PM เดือนนี้</p>
              </div>

              <button
                onClick={nextMonth}
                className="p-2 rounded-xl border border-line hover:bg-page transition-colors"
              >
                <ChevronRight className="h-4 w-4 text-ink-muted" />
              </button>
            </div>

            {/* ── Legend ── */}
            <div className="flex gap-4 flex-wrap text-xs text-ink-muted">
              {[
                { label: 'ล้างใหญ่',   cls: 'bg-warn' },
                { label: 'ล้างย่อย',   cls: 'bg-primary' },
                { label: 'ล้างพัดลม', cls: 'bg-success' },
              ].map(({ label, cls }) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className={`w-3 h-3 rounded ${cls} inline-block`} />
                  {label}
                </span>
              ))}
              <span className="text-ink-muted/70">ตัวเลขในแต่ละสีคือจำนวนเครื่อง · คลิกวันเพื่อดูรายละเอียด</span>
            </div>

            {/* ── Calendar ── */}
            {loading ? (
              <div className="flex justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-4 border-line border-t-primary" />
              </div>
            ) : (
              <CalendarGrid
                year={year}
                month={month}
                calData={calData}
                onDayClick={(date, items) => setPopup({ date, items })}
              />
            )}
          </>
        )}
      </div>

      {/* Day popup */}
      {popup && (
        <DayPopup
          date={popup.date}
          items={popup.items}
          onClose={() => setPopup(null)}
          onUnitClick={() => {
            setPopup(null)
            navigate('/work-orders/new')
          }}
        />
      )}
    </Layout>
  )
}
