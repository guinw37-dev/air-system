import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wrench, CheckCircle, Clock } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api from '../api/client'

const STATUSES = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'open', label: 'รอซ่อม' },
  { value: 'in_progress', label: 'กำลังซ่อม' },
  { value: 'done', label: 'เสร็จแล้ว' },
]

const STATUS_COLOR = {
  open: 'bg-red-100 text-red-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  done: 'bg-green-100 text-green-700',
}
const STATUS_TH = {
  open: 'รอซ่อม',
  in_progress: 'กำลังซ่อม',
  done: 'เสร็จแล้ว',
}

export default function RepairLogs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({ cause: '', solution: '', status: '', petty_cash: '' })
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    const params = status ? `?status=${status}` : ''
    api.get(`/repair-logs${params}`).then((r) => setLogs(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [status])

  const openDetail = (log) => {
    setSelected(log)
    setForm({
      cause: log.cause || '',
      solution: log.solution || '',
      status: log.status,
      petty_cash: log.petty_cash || '',
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.patch(`/repair-logs/${selected.id}`, {
        cause: form.cause || undefined,
        solution: form.solution || undefined,
        status: form.status || undefined,
        petty_cash: form.petty_cash ? Number(form.petty_cash) : undefined,
      })
      setSelected(null)
      load()
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Layout title="รายการแจ้งซ่อม">
      <div className="px-4 pt-4 flex flex-col gap-3">
        {/* Status filter */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border ${
                status === s.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-blue-600" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {logs.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-12">ไม่พบรายการ</p>
            )}
            {logs.map((log) => (
              <button key={log.id} onClick={() => openDetail(log)} className="card text-left w-full active:bg-gray-50">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Wrench className="h-4 w-4 text-gray-400 shrink-0" />
                      <span className="font-medium text-sm text-gray-900 truncate">{log.ac_code}</span>
                    </div>
                    <p className="text-xs text-gray-500 truncate">{log.ac_name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{log.dept_name} · {log.floor_name}</p>
                    {log.problem && (
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2">{log.problem}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[log.status] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_TH[log.status] || log.status}
                    </span>
                    <span className="text-xs text-gray-400">{dayjs(log.created_at).format('DD/MM/YY')}</span>
                  </div>
                </div>
                {log.order_no && (
                  <p className="text-xs text-blue-600 mt-1">ใบงาน: {log.order_no}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail / Edit Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelected(null)} />
          <div className="relative bg-white rounded-t-3xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">{selected.ac_code} — {selected.ac_name}</h3>
              <button onClick={() => setSelected(null)} className="text-gray-400 text-2xl leading-none">&times;</button>
            </div>

            <div className="flex flex-col gap-4">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500">ปัญหา</p>
                <p className="text-sm text-gray-900 mt-0.5">{selected.problem || '-'}</p>
              </div>

              <div>
                <label className="label">สาเหตุ</label>
                <textarea className="input" rows={2} value={form.cause}
                  onChange={(e) => setForm({ ...form, cause: e.target.value })} />
              </div>

              <div>
                <label className="label">วิธีแก้ไข</label>
                <textarea className="input" rows={2} value={form.solution}
                  onChange={(e) => setForm({ ...form, solution: e.target.value })} />
              </div>

              <div>
                <label className="label">ค่าใช้จ่าย (บาท)</label>
                <input type="number" className="input" value={form.petty_cash}
                  onChange={(e) => setForm({ ...form, petty_cash: e.target.value })} />
              </div>

              <div>
                <label className="label">สถานะ</label>
                <select className="input" value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="open">รอซ่อม</option>
                  <option value="in_progress">กำลังซ่อม</option>
                  <option value="done">เสร็จแล้ว</option>
                </select>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setSelected(null)} className="btn-secondary flex-1">ยกเลิก</button>
                <button onClick={save} disabled={saving} className="btn-primary flex-1">
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
