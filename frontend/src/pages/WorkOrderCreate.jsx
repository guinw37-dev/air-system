import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Check } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api/client'
import { useAuthStore } from '../store/auth'

const TYPES = [
  { value: 'major', label: 'ล้างใหญ่',  desc: 'ล้างคอยล์เย็น/ร้อน + วัดค่า',    eqType: 'ac' },
  { value: 'minor', label: 'ล้างย่อย',  desc: 'เปลี่ยนกรอง + ตรวจสอบ',          eqType: 'ac' },
  { value: 'fan',   label: 'ล้างพัดลม', desc: 'ทำความสะอาดพัดลม',               eqType: 'fan' },
]

export default function WorkOrderCreate() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  // Step 1: form basics
  const [clients, setClients]   = useState([])
  const [sites, setSites]       = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [form, setForm] = useState({
    client_id: '',
    site_id: '',
    type: 'major',
    assignee_ids: [],
    unit_ids: [],
  })

  // Step 2: unit picker
  const [units, setUnits]           = useState([])
  const [loadingUnits, setLoadingUnits] = useState(false)
  const [unitSearch, setUnitSearch] = useState('')
  const [buildingFilter, setBuildingFilter] = useState('')
  const [buildings, setBuildings]   = useState([])

  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    Promise.all([
      api.get('/master/clients'),
      api.get('/master/users'),
    ]).then(([c, u]) => {
      setClients(c.data)
      setAllUsers(u.data)
      if (c.data.length === 1) {
        const id = String(c.data[0].id)
        setForm((f) => ({ ...f, client_id: id }))
      }
    }).catch(() => {})
  }, [])

  // When client changes, load sites
  useEffect(() => {
    if (!form.client_id) { setSites([]); return }
    api.get(`/master/sites?client_id=${form.client_id}`)
      .then((r) => setSites(r.data))
      .catch(() => setSites([]))
  }, [form.client_id])

  // When client or type changes, load units
  useEffect(() => {
    if (!form.client_id) { setUnits([]); return }
    const eqType = TYPES.find((t) => t.value === form.type)?.eqType || 'ac'
    setLoadingUnits(true)
    api.get(`/master/units?client_id=${form.client_id}&equipment_type=${eqType}`)
      .then((r) => {
        setUnits(r.data)
        // Collect unique buildings from units
        const bmap = {}
        r.data.forEach((u) => { if (u.building_name) bmap[u.building_name] = true })
        setBuildings(Object.keys(bmap))
        setBuildingFilter('')
      })
      .catch(() => setUnits([]))
      .finally(() => setLoadingUnits(false))
  }, [form.client_id, form.type])

  // Default current user as assignee
  useEffect(() => {
    if (user?.id) {
      setForm((f) => ({
        ...f,
        assignee_ids: f.assignee_ids.includes(user.id) ? f.assignee_ids : [user.id],
      }))
    }
  }, [user])

  const toggleAssignee = (uid) => {
    setForm((f) => ({
      ...f,
      assignee_ids: f.assignee_ids.includes(uid)
        ? f.assignee_ids.filter((id) => id !== uid)
        : [...f.assignee_ids, uid],
    }))
  }

  const toggleUnit = (uid) => {
    setForm((f) => ({
      ...f,
      unit_ids: f.unit_ids.includes(uid)
        ? f.unit_ids.filter((id) => id !== uid)
        : [...f.unit_ids, uid],
    }))
  }

  const filteredUnits = units.filter((u) => {
    const matchSearch = !unitSearch ||
      u.asset_code?.toLowerCase().includes(unitSearch.toLowerCase()) ||
      u.name?.toLowerCase().includes(unitSearch.toLowerCase()) ||
      u.room_name?.toLowerCase().includes(unitSearch.toLowerCase())
    const matchBuilding = !buildingFilter || u.building_name === buildingFilter
    return matchSearch && matchBuilding
  })

  const submit = async (e) => {
    e.preventDefault()
    if (!form.client_id) { setError('กรุณาเลือก Client'); return }
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/work-orders', {
        client_id: form.client_id ? Number(form.client_id) : undefined,
        site_id:   form.site_id   ? Number(form.site_id)   : undefined,
        type:      form.type,
        assignee_ids: form.assignee_ids,
        unit_ids:     form.unit_ids,
      })
      navigate(`/work-orders/${data.id}`)
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด')
      setLoading(false)
    }
  }

  const techUsers = allUsers.filter((u) => ['technician', 'central_admin'].includes(u.role))

  return (
    <Layout title="เปิดใบงานใหม่" back="/work-orders">
      <form onSubmit={submit} className="px-4 pt-4 pb-8 flex flex-col gap-5">

        {/* Client */}
        <div>
          <label className="label">Client *</label>
          <select
            className="input"
            value={form.client_id}
            onChange={(e) => setForm({ ...form, client_id: e.target.value, site_id: '', unit_ids: [] })}
            required
          >
            <option value="">-- เลือก Client --</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Site */}
        {form.client_id && (
          <div>
            <label className="label">Site / สถานที่</label>
            <select
              className="input"
              value={form.site_id}
              onChange={(e) => setForm({ ...form, site_id: e.target.value })}
            >
              <option value="">-- เลือก Site (ถ้ามี) --</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Type */}
        <div>
          <label className="label">ประเภทงาน *</label>
          <div className="flex flex-col gap-2">
            {TYPES.map((t) => (
              <label
                key={t.value}
                className={`flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition-colors ${
                  form.type === t.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value={t.value}
                  checked={form.type === t.value}
                  onChange={(e) => setForm({ ...form, type: e.target.value, unit_ids: [] })}
                  className="accent-blue-600"
                />
                <div>
                  <p className="font-medium text-sm text-gray-900">{t.label}</p>
                  <p className="text-xs text-gray-500">{t.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Assignees */}
        <div>
          <label className="label">ผู้รับผิดชอบ (เลือกได้หลายคน)</label>
          <div className="flex flex-col gap-1.5 mt-1">
            {techUsers.map((u) => {
              const checked = form.assignee_ids.includes(u.id)
              return (
                <label
                  key={u.id}
                  className={`flex items-center gap-3 border rounded-xl px-4 py-2.5 cursor-pointer transition-colors ${
                    checked ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAssignee(u.id)}
                    className="accent-blue-600"
                  />
                  <span className="text-sm text-gray-900">{u.name}</span>
                  <span className="text-xs text-gray-400 ml-auto">{u.role}</span>
                </label>
              )
            })}
            {techUsers.length === 0 && (
              <p className="text-xs text-gray-400">ไม่พบผู้ใช้งาน</p>
            )}
          </div>
        </div>

        {/* Unit picker */}
        {form.client_id && (
          <div>
            <label className="label">
              เลือกอุปกรณ์ ({form.unit_ids.length} รายการที่เลือก)
            </label>

            {/* Search + building filter */}
            <div className="flex gap-2 mb-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  className="input pl-9 text-sm"
                  placeholder="ค้นหา asset code / ชื่อ / ห้อง..."
                  value={unitSearch}
                  onChange={(e) => setUnitSearch(e.target.value)}
                />
              </div>
            </div>

            {buildings.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mb-2">
                <button
                  type="button"
                  onClick={() => setBuildingFilter('')}
                  className={`px-2.5 py-1 rounded-lg text-xs border ${!buildingFilter ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}
                >
                  ทุกอาคาร
                </button>
                {buildings.map((b) => (
                  <button
                    type="button"
                    key={b}
                    onClick={() => setBuildingFilter(b)}
                    className={`px-2.5 py-1 rounded-lg text-xs border ${buildingFilter === b ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto border border-gray-200 rounded-xl p-2">
              {loadingUnits && (
                <p className="text-sm text-gray-400 text-center py-4">กำลังโหลด...</p>
              )}
              {!loadingUnits && filteredUnits.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">ไม่พบอุปกรณ์</p>
              )}
              {filteredUnits.map((u) => {
                const checked = form.unit_ids.includes(u.id)
                return (
                  <label
                    key={u.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                      checked ? 'bg-blue-50 border border-blue-300' : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                      checked ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                    }`}>
                      {checked && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                    </div>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => toggleUnit(u.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{u.asset_code}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {u.name || '-'} · {u.room_name || '-'} · {u.floor_name || ''} · {u.building_name || ''}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{u.family || ''}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
        )}

        <button type="submit" disabled={loading || !form.client_id} className="btn-primary text-center">
          {loading ? 'กำลังสร้าง...' : 'สร้างใบงาน'}
        </button>
      </form>
    </Layout>
  )
}
