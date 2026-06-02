import { useEffect, useState, useCallback } from 'react'
import { Package, Plus, Search, X } from 'lucide-react'
import dayjs from 'dayjs'
import Layout from '../components/Layout'
import { PageSpinner } from '../components/Spinner'
import api from '../api/client'

// ─── Modal ────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface rounded-2xl w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-ink text-lg">{title}</h3>
          <button onClick={onClose} className="text-ink-muted text-2xl leading-none hover:text-ink">&times;</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Requisition Modal ────────────────────────────────────────────────────────
function RequisitionModal({ clientId, onClose, onSaved }) {
  const [units, setUnits] = useState([])
  const [unitSearch, setUnitSearch] = useState('')
  const [selectedUnit, setSelectedUnit] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [form, setForm] = useState({ work_order_id: '', part_name: '', qty: 1, note: '' })
  const [saving, setSaving] = useState(false)

  // Search units
  useEffect(() => {
    if (!clientId) return
    setSearchLoading(true)
    const params = new URLSearchParams({ client_id: clientId })
    if (unitSearch) params.append('q', unitSearch)
    api.get(`/master/units?${params}`)
      .then((r) => setUnits(r.data || []))
      .catch(() => {})
      .finally(() => setSearchLoading(false))
  }, [clientId, unitSearch])

  const save = async () => {
    if (!selectedUnit) return alert('กรุณาเลือกเครื่อง')
    if (!form.part_name.trim()) return alert('กรุณาระบุชื่ออะไหล่')
    if (!form.qty || form.qty < 1) return alert('จำนวนต้องมากกว่า 0')
    setSaving(true)
    try {
      await api.post('/parts', {
        unit_id: selectedUnit.id,
        work_order_id: form.work_order_id || undefined,
        part_name: form.part_name.trim(),
        qty: Number(form.qty),
        note: form.note.trim() || undefined,
      })
      onSaved()
      onClose()
    } catch (err) {
      alert(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally {
      setSaving(false)
    }
  }

  const filteredUnits = units.filter((u) => {
    if (!unitSearch) return true
    const q = unitSearch.toLowerCase()
    return (
      u.asset_code?.toLowerCase().includes(q) ||
      u.name?.toLowerCase().includes(q) ||
      u.room_name?.toLowerCase().includes(q)
    )
  })

  return (
    <Modal title="เบิกอะไหล่" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Unit search */}
        <div>
          <label className="label">เครื่อง *</label>
          {selectedUnit ? (
            <div className="flex items-center gap-2 p-2.5 bg-primary-soft border border-primary/20 rounded-xl">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-primary text-sm">{selectedUnit.asset_code}</p>
                <p className="text-xs text-primary/70 truncate">{selectedUnit.name} · {selectedUnit.room_name || '-'}</p>
              </div>
              <button onClick={() => setSelectedUnit(null)} className="text-primary/50 hover:text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
                <input
                  className="input pl-9"
                  placeholder="ค้นหา asset code, ชื่อ, ห้อง..."
                  value={unitSearch}
                  onChange={(e) => setUnitSearch(e.target.value)}
                />
              </div>
              <div className="border border-line rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                {searchLoading ? (
                  <p className="py-3 text-center text-sm text-ink-muted">กำลังโหลด...</p>
                ) : filteredUnits.length === 0 ? (
                  <p className="py-3 text-center text-sm text-ink-muted">ไม่พบเครื่อง</p>
                ) : filteredUnits.slice(0, 30).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setSelectedUnit(u)}
                    className="w-full text-left px-3 py-2 hover:bg-primary-soft border-b border-line last:border-0 transition-colors"
                  >
                    <p className="text-sm font-medium text-ink">{u.asset_code}</p>
                    <p className="text-xs text-ink-muted">{u.name} · {u.room_name || '-'}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="label">เลขที่ใบงาน (ถ้ามี)</label>
          <input
            className="input"
            placeholder="WO-2024-001"
            value={form.work_order_id}
            onChange={(e) => setForm({ ...form, work_order_id: e.target.value })}
          />
        </div>

        <div>
          <label className="label">ชื่ออะไหล่ *</label>
          <input
            className="input"
            placeholder="เช่น แผ่นกรอง HEPA, คอมเพรสเซอร์ R32..."
            value={form.part_name}
            onChange={(e) => setForm({ ...form, part_name: e.target.value })}
          />
        </div>

        <div>
          <label className="label">จำนวน *</label>
          <input
            type="number"
            min="1"
            className="input"
            value={form.qty}
            onChange={(e) => setForm({ ...form, qty: e.target.value })}
          />
        </div>

        <div>
          <label className="label">หมายเหตุ</label>
          <textarea
            className="input resize-none"
            rows={2}
            placeholder="รายละเอียดเพิ่มเติม..."
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
          <button onClick={save} disabled={saving} className="btn-primary flex-1">
            {saving ? 'กำลังบันทึก...' : 'เบิกอะไหล่'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Parts() {
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [filters, setFilters] = useState({ unit_id: '', work_order_id: '', from: '', to: '' })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    api.get('/master/clients').then((r) => {
      const list = r.data || []
      setClients(list)
      if (list.length > 0) setClientId(String(list[0].id))
    }).catch(() => {})
  }, [])

  const load = useCallback(() => {
    if (!clientId) { setRows([]); return }
    setLoading(true)
    const p = new URLSearchParams({ client_id: clientId })
    if (filters.unit_id) p.append('unit_id', filters.unit_id)
    if (filters.work_order_id) p.append('work_order_id', filters.work_order_id)
    if (filters.from) p.append('from', filters.from)
    if (filters.to) p.append('to', filters.to)
    api.get(`/parts?${p}`)
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [clientId, filters])

  useEffect(() => { load() }, [load])

  const setFilter = (key, val) => setFilters((f) => ({ ...f, [key]: val }))

  return (
    <Layout title="อะไหล่">
      <div className="p-4 lg:p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
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
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary flex items-center gap-2"
            disabled={!clientId}
          >
            <Plus className="h-4 w-4" /> เบิกอะไหล่
          </button>
        </div>

        {/* Filters */}
        <div className="card py-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="label">Asset Code / เครื่อง</label>
              <input
                className="input text-sm"
                placeholder="unit id..."
                value={filters.unit_id}
                onChange={(e) => setFilter('unit_id', e.target.value)}
              />
            </div>
            <div>
              <label className="label">เลขที่ใบงาน</label>
              <input
                className="input text-sm"
                placeholder="WO..."
                value={filters.work_order_id}
                onChange={(e) => setFilter('work_order_id', e.target.value)}
              />
            </div>
            <div>
              <label className="label">จากวันที่</label>
              <input
                type="date"
                className="input text-sm"
                value={filters.from}
                onChange={(e) => setFilter('from', e.target.value)}
              />
            </div>
            <div>
              <label className="label">ถึงวันที่</label>
              <input
                type="date"
                className="input text-sm"
                value={filters.to}
                onChange={(e) => setFilter('to', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="card p-0 overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-line border-t-primary" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-page border-b border-line">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">วันที่</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">เลขเครื่อง</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">ชื่อเครื่อง / ห้อง</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">อะไหล่</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-ink-muted uppercase">จำนวน</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">ผู้เบิก</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">ใบงาน</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-primary-soft/40">
                      <td className="py-3 px-4 text-ink-muted text-xs whitespace-nowrap">
                        {r.requisitioned_at ? dayjs(r.requisitioned_at).format('DD/MM/YY HH:mm') : '-'}
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-primary text-xs">{r.asset_code || '-'}</td>
                      <td className="py-3 px-4 text-ink text-xs">{r.unit_name || '-'}</td>
                      <td className="py-3 px-4 font-medium text-ink">{r.part_name}</td>
                      <td className="py-3 px-4 text-right font-semibold text-ink">{r.qty}</td>
                      <td className="py-3 px-4 text-ink-muted text-xs">{r.requisitioned_by_name || '-'}</td>
                      <td className="py-3 px-4 text-ink-muted text-xs">{r.order_no || '-'}</td>
                      <td className="py-3 px-4 text-ink-muted text-xs">{r.note || '-'}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-12 text-center">
                        <Package className="h-8 w-8 text-ink-muted/30 mx-auto mb-2" />
                        <p className="text-ink-muted text-sm">ยังไม่มีรายการเบิกอะไหล่</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Total count */}
        {rows.length > 0 && (
          <p className="text-xs text-ink-muted text-right">{rows.length} รายการ</p>
        )}
      </div>

      {showModal && (
        <RequisitionModal
          clientId={clientId}
          onClose={() => setShowModal(false)}
          onSaved={load}
        />
      )}
    </Layout>
  )
}
