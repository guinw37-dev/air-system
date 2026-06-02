import { useEffect, useState, useCallback } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import api from '../api/client'

const MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
  'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
  'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

// ── Inline editor cell ────────────────────────────────────────────────────────
function MonthCell({ record, month, year, clientId, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(record?.notes || '')
  const [saving, setSaving] = useState(false)

  // Reset local state when record changes externally
  useEffect(() => {
    if (!editing) setNotes(record?.notes || '')
  }, [record, editing])

  const save = async () => {
    if (!clientId) return
    setSaving(true)
    const monthStr = `${year}-${String(month).padStart(2, '0')}`
    try {
      if (record?.id) {
        await api.put(`/deductions/${record.id}`, { notes })
      } else {
        await api.post('/deductions', { client_id: clientId, month: monthStr, notes })
      }
      setEditing(false)
      onSaved()
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => {
    setEditing(false)
    setNotes(record?.notes || '')
  }

  if (editing) {
    return (
      <td className="px-3 py-2 align-top min-w-[180px]">
        <div className="flex flex-col gap-1.5">
          <textarea
            autoFocus
            className="input text-xs resize-none w-full"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="หมายเหตุการหักเงิน..."
          />
          <div className="flex gap-1">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 py-1 rounded-input bg-primary text-white text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-60 flex items-center justify-center gap-1"
            >
              <Check className="h-3 w-3" /> {saving ? '...' : 'บันทึก'}
            </button>
            <button
              onClick={cancel}
              className="px-2 py-1 rounded-input border border-line text-ink-muted text-xs hover:bg-page transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </td>
    )
  }

  return (
    <td
      className="px-3 py-2 align-top cursor-pointer group hover:bg-primary-soft/40 transition-colors min-w-[160px]"
      onClick={() => setEditing(true)}
    >
      {record?.notes ? (
        <div className="flex items-start gap-1.5">
          <p className="text-xs text-ink flex-1 leading-relaxed whitespace-pre-wrap">{record.notes}</p>
          <Pencil className="h-3 w-3 text-ink-muted/40 group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
        </div>
      ) : (
        <div className="flex items-center gap-1 text-ink-muted/40 group-hover:text-primary transition-colors">
          <span className="text-xs">+ เพิ่มหมายเหตุ</span>
        </div>
      )}
      {record?.notes && record.created_by_name && (
        <p className="text-[10px] text-ink-muted mt-1">{record.created_by_name}</p>
      )}
    </td>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Deductions() {
  const currentYear = dayjs().year()
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [year, setYear] = useState(currentYear)
  const [records, setRecords] = useState([]) // flat list from API
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.get('/master/clients').then((r) => {
      const list = r.data || []
      setClients(list)
      if (list.length > 0) setClientId(String(list[0].id))
    }).catch(() => {})
  }, [])

  const load = useCallback(() => {
    if (!clientId) { setRecords([]); return }
    setLoading(true)
    const p = new URLSearchParams({ client_id: clientId, year })
    api.get(`/deductions?${p}`)
      .then((r) => setRecords(r.data || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false))
  }, [clientId, year])

  useEffect(() => { load() }, [load])

  // Build lookup: month number → record
  const byMonth = {}
  records.forEach((r) => {
    const m = parseInt(r.month?.split('-')[1], 10)
    if (m) byMonth[m] = r
  })

  const yearOptions = []
  for (let y = currentYear + 1; y >= 2020; y--) yearOptions.push(y)

  return (
    <Layout title="หักเงิน / Deductions">
      <div className="p-4 lg:p-6 flex flex-col gap-5">
        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            className="input max-w-xs"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">-- เลือก Client --</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            className="input w-28"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* Grid table */}
        {!clientId ? (
          <div className="card text-center py-12 text-ink-muted text-sm">เลือก Client เพื่อดูข้อมูล</div>
        ) : loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-line border-t-primary" />
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-line bg-page">
              <p className="text-sm font-semibold text-ink">
                หักเงิน ปี {year} — {clients.find((c) => String(c.id) === clientId)?.name || ''}
              </p>
              <p className="text-xs text-ink-muted mt-0.5">คลิกที่ช่องเดือนเพื่อเพิ่ม / แก้ไขหมายเหตุ</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-page border-b border-line">
                  <tr>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold text-ink-muted uppercase w-28">เดือน</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold text-ink-muted uppercase">หมายเหตุ</th>
                    <th className="text-left py-2.5 px-3 text-xs font-semibold text-ink-muted uppercase w-28">อัปเดตล่าสุด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {MONTH_NAMES.map((name, idx) => {
                    const m = idx + 1
                    const record = byMonth[m]
                    const isCurrentMonth = year === currentYear && m === dayjs().month() + 1
                    return (
                      <tr
                        key={m}
                        className={`${isCurrentMonth ? 'bg-primary-soft/30' : ''} hover:bg-page`}
                      >
                        <td className="py-2.5 px-3 align-middle">
                          <div className="flex items-center gap-2">
                            {isCurrentMonth && (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                            )}
                            <span className={`text-sm font-medium ${isCurrentMonth ? 'text-primary' : 'text-ink'}`}>
                              {name}
                            </span>
                          </div>
                        </td>
                        <MonthCell
                          record={record}
                          month={m}
                          year={year}
                          clientId={clientId}
                          onSaved={load}
                        />
                        <td className="py-2.5 px-3 align-middle text-xs text-ink-muted whitespace-nowrap">
                          {record?.updated_at
                            ? dayjs(record.updated_at).format('DD/MM/YY')
                            : record
                            ? dayjs(record.created_at).format('DD/MM/YY')
                            : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
