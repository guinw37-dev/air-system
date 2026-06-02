import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pencil, Trash2, ChevronRight, ExternalLink } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api/client'
import { useAuthStore } from '../store/auth'

const FAMILIES = ['Split', 'VRF', 'FCU', 'AHU', 'Cassette', 'Floor Standing', 'Chiller', 'Other']
const EQUIPMENT_TYPES = [
  { value: 'ac',  label: 'แอร์' },
  { value: 'fan', label: 'พัดลม' },
]
const UNIT_STATUSES = [
  { value: 'active',   label: 'ปกติ' },
  { value: 'broken',   label: 'เสีย' },
  { value: 'inactive', label: 'ปิดใช้' },
]

// ─── Reusable modal ───────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none hover:text-gray-600">&times;</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Clients Tab ─────────────────────────────────────────────────────────────
function ClientsTab() {
  const user = useAuthStore((s) => s.user)
  const [list, setList] = useState([])
  const [modal, setModal] = useState(null) // null | 'new' | item
  const [form, setForm] = useState({ code: '', name: '' })
  const [saving, setSaving] = useState(false)

  const load = () => api.get('/master/clients').then((r) => setList(r.data))
  useEffect(() => { load() }, [])

  const openNew = () => { setForm({ code: '', name: '' }); setModal('new') }
  const openEdit = (c) => { setForm({ code: c.code || '', name: c.name, active: c.active }); setModal(c) }

  const save = async () => {
    setSaving(true)
    try {
      if (modal === 'new') {
        await api.post('/master/clients', form)
      } else {
        await api.put(`/master/clients/${modal.id}`, form)
      }
      setModal(null); load()
    } catch (err) { alert(err.response?.data?.error || 'เกิดข้อผิดพลาด') }
    finally { setSaving(false) }
  }

  const del = async (id) => {
    if (!confirm('ปิดการใช้งาน client นี้?')) return
    await api.delete(`/master/clients/${id}`); load()
  }

  const canEdit = ['admin', 'central_admin'].includes(user?.role)

  return (
    <div>
      {canEdit && (
        <div className="mb-4">
          <button onClick={openNew} className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> เพิ่ม Client
          </button>
        </div>
      )}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">รหัส</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ชื่อ</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">สถานะ</th>
              {canEdit && <th className="py-3 px-4" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {list.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="py-3 px-4 font-mono text-gray-500">{c.code || '-'}</td>
                <td className="py-3 px-4 font-medium text-gray-900">{c.name}</td>
                <td className="py-3 px-4">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.active ? 'ใช้งาน' : 'ปิด'}
                  </span>
                </td>
                {canEdit && (
                  <td className="py-3 px-4">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => openEdit(c)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => del(c.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={4} className="py-10 text-center text-gray-400">ไม่มี Client</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal === 'new' ? 'เพิ่ม Client' : 'แก้ไข Client'} onClose={() => setModal(null)}>
          <div className="flex flex-col gap-3">
            <div><label className="label">รหัส (code)</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="C001" /></div>
            <div><label className="label">ชื่อ *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            {modal !== 'new' && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                <span className="text-sm text-gray-700">เปิดใช้งาน</span>
              </label>
            )}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">ยกเลิก</button>
              <button onClick={save} disabled={saving} className="btn-primary flex-1">{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Structure Tab (Sites → Buildings → Floors → Rooms) ───────────────────────
function StructureTab() {
  const [clients, setClients] = useState([])
  const [selectedClient, setSelectedClient] = useState('')
  const [sites, setSites] = useState([])
  const [selSite, setSelSite] = useState(null)
  const [buildings, setBuildings] = useState([])
  const [selBuilding, setSelBuilding] = useState(null)
  const [floors, setFloors] = useState([])
  const [selFloor, setSelFloor] = useState(null)
  const [rooms, setRooms] = useState([])

  const [modal, setModal] = useState(null) // { type, item }
  const [form, setForm] = useState({ name: '', code: '', client_id: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { api.get('/master/clients').then((r) => setClients(r.data)) }, [])

  useEffect(() => {
    if (!selectedClient) { setSites([]); setSelSite(null); return }
    api.get(`/master/sites?client_id=${selectedClient}`).then((r) => {
      setSites(r.data); setSelSite(null); setBuildings([]); setSelBuilding(null); setFloors([]); setSelFloor(null); setRooms([])
    })
  }, [selectedClient])

  const loadBuildings = (s) => {
    setSelSite(s); setSelBuilding(null); setFloors([]); setSelFloor(null); setRooms([])
    api.get(`/master/buildings?site_id=${s.id}`).then((r) => setBuildings(r.data))
  }

  const loadFloors = (b) => {
    setSelBuilding(b); setSelFloor(null); setRooms([])
    api.get(`/master/floors?building_id=${b.id}`).then((r) => setFloors(r.data))
  }

  const loadRooms = (f) => {
    setSelFloor(f)
    api.get(`/master/rooms?floor_id=${f.id}`).then((r) => setRooms(r.data))
  }

  const openModal = (type, item = null) => {
    setForm({ name: item?.name || '', code: item?.code || '' })
    setModal({ type, item })
  }

  const save = async () => {
    setSaving(true)
    try {
      const { type, item } = modal
      if (type === 'site') {
        if (item) await api.put(`/master/sites/${item.id}`, form)
        else await api.post('/master/sites', { client_id: selectedClient, ...form })
        api.get(`/master/sites?client_id=${selectedClient}`).then((r) => setSites(r.data))
      } else if (type === 'building') {
        if (item) await api.put(`/master/buildings/${item.id}`, form)
        else await api.post('/master/buildings', { site_id: selSite.id, ...form })
        api.get(`/master/buildings?site_id=${selSite.id}`).then((r) => setBuildings(r.data))
      } else if (type === 'floor') {
        if (item) await api.put(`/master/floors/${item.id}`, form)
        else await api.post('/master/floors', { building_id: selBuilding.id, ...form })
        api.get(`/master/floors?building_id=${selBuilding.id}`).then((r) => setFloors(r.data))
      } else if (type === 'room') {
        if (item) await api.put(`/master/rooms/${item.id}`, form)
        else await api.post('/master/rooms', { floor_id: selFloor.id, ...form })
        api.get(`/master/rooms?floor_id=${selFloor.id}`).then((r) => setRooms(r.data))
      }
      setModal(null)
    } catch (err) { alert(err.response?.data?.error || 'เกิดข้อผิดพลาด') }
    finally { setSaving(false) }
  }

  const del = async (type, id) => {
    if (!confirm('ลบรายการนี้?')) return
    if (type === 'site') {
      await api.delete(`/master/sites/${id}`)
      api.get(`/master/sites?client_id=${selectedClient}`).then((r) => setSites(r.data))
    } else if (type === 'building') {
      await api.delete(`/master/buildings/${id}`)
      api.get(`/master/buildings?site_id=${selSite.id}`).then((r) => setBuildings(r.data))
    } else if (type === 'floor') {
      await api.delete(`/master/floors/${id}`)
      api.get(`/master/floors?building_id=${selBuilding.id}`).then((r) => setFloors(r.data))
    } else if (type === 'room') {
      await api.delete(`/master/rooms/${id}`)
      api.get(`/master/rooms?floor_id=${selFloor.id}`).then((r) => setRooms(r.data))
    }
  }

  return (
    <div>
      <div className="mb-4">
        <select className="input max-w-xs" value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
          <option value="">-- เลือก Client --</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {selectedClient && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Sites */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-gray-700 text-sm">สถานที่ (Site)</h4>
              <button onClick={() => openModal('site')} className="text-blue-600 hover:bg-blue-50 rounded-lg p-1"><Plus className="h-4 w-4" /></button>
            </div>
            <div className="flex flex-col gap-0.5">
              {sites.map((s) => (
                <div key={s.id} className="group flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100 cursor-pointer" onClick={() => loadBuildings(s)}>
                  <span className={`flex-1 text-sm ${selSite?.id === s.id ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>{s.name} {s.code && `(${s.code})`}</span>
                  <button onClick={(e) => { e.stopPropagation(); openModal('site', s) }} className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={(e) => { e.stopPropagation(); del('site', s.id) }} className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                </div>
              ))}
              {sites.length === 0 && <p className="text-xs text-gray-400 py-2">ยังไม่มีสถานที่</p>}
            </div>
          </div>

          {/* Buildings */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-gray-700 text-sm">{selSite ? `อาคาร — ${selSite.name}` : 'อาคาร'}</h4>
              {selSite && <button onClick={() => openModal('building')} className="text-blue-600 hover:bg-blue-50 rounded-lg p-1"><Plus className="h-4 w-4" /></button>}
            </div>
            {!selSite ? <p className="text-xs text-gray-400">เลือก Site ก่อน</p> : (
              <div className="flex flex-col gap-0.5">
                {buildings.map((b) => (
                  <div key={b.id} className="group flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100 cursor-pointer" onClick={() => loadFloors(b)}>
                    <span className={`flex-1 text-sm ${selBuilding?.id === b.id ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>{b.name} {b.code && `(${b.code})`}</span>
                    <button onClick={(e) => { e.stopPropagation(); openModal('building', b) }} className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={(e) => { e.stopPropagation(); del('building', b.id) }} className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                    <ChevronRight className="h-4 w-4 text-gray-300" />
                  </div>
                ))}
                {buildings.length === 0 && <p className="text-xs text-gray-400 py-2">ยังไม่มีอาคาร</p>}
              </div>
            )}
          </div>

          {/* Floors */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-gray-700 text-sm">{selBuilding ? `ชั้น — ${selBuilding.name}` : 'ชั้น'}</h4>
              {selBuilding && <button onClick={() => openModal('floor')} className="text-blue-600 hover:bg-blue-50 rounded-lg p-1"><Plus className="h-4 w-4" /></button>}
            </div>
            {!selBuilding ? <p className="text-xs text-gray-400">เลือกอาคารก่อน</p> : (
              <div className="flex flex-col gap-0.5">
                {floors.map((f) => (
                  <div key={f.id} className="group flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100 cursor-pointer" onClick={() => loadRooms(f)}>
                    <span className={`flex-1 text-sm ${selFloor?.id === f.id ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>{f.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); openModal('floor', f) }} className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={(e) => { e.stopPropagation(); del('floor', f.id) }} className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                    <ChevronRight className="h-4 w-4 text-gray-300" />
                  </div>
                ))}
                {floors.length === 0 && <p className="text-xs text-gray-400 py-2">ยังไม่มีชั้น</p>}
              </div>
            )}
          </div>

          {/* Rooms */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-gray-700 text-sm">{selFloor ? `ห้อง — ${selFloor.name}` : 'ห้อง / แผนก'}</h4>
              {selFloor && <button onClick={() => openModal('room')} className="text-blue-600 hover:bg-blue-50 rounded-lg p-1"><Plus className="h-4 w-4" /></button>}
            </div>
            {!selFloor ? <p className="text-xs text-gray-400">เลือกชั้นก่อน</p> : (
              <div className="flex flex-col gap-0.5">
                {rooms.map((r) => (
                  <div key={r.id} className="group flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100">
                    <span className="flex-1 text-sm text-gray-700">{r.name}</span>
                    <button onClick={() => openModal('room', r)} className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => del('room', r.id)} className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                {rooms.length === 0 && <p className="text-xs text-gray-400 py-2">ยังไม่มีห้อง</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {modal && (
        <Modal
          title={{ site: 'สถานที่', building: 'อาคาร', floor: 'ชั้น', room: 'ห้อง / แผนก' }[modal.type] + (modal.item ? ' — แก้ไข' : ' — เพิ่ม')}
          onClose={() => setModal(null)}
        >
          <div className="flex flex-col gap-3">
            <div><label className="label">ชื่อ *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></div>
            {(modal.type === 'site' || modal.type === 'building') && (
              <div><label className="label">รหัส (code)</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="A" /></div>
            )}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">ยกเลิก</button>
              <button onClick={save} disabled={saving} className="btn-primary flex-1">{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Units Tab ────────────────────────────────────────────────────────────────
function UnitsTab() {
  const user = useAuthStore((s) => s.user)
  const [clients, setClients] = useState([])
  const [selectedClient, setSelectedClient] = useState('')
  const [equipmentTypeFilter, setEquipmentTypeFilter] = useState('') // '' | 'ac' | 'fan'
  const [unitList, setUnitList] = useState([])
  const [loadingUnits, setLoadingUnits] = useState(false)

  // Cascade selectors for new unit
  const [sites, setSites] = useState([])
  const [buildings, setBuildings] = useState([])
  const [floors, setFloors] = useState([])
  const [rooms, setRooms] = useState([])
  const [selSite, setSelSite] = useState('')
  const [selBuilding, setSelBuilding] = useState('')
  const [selFloor, setSelFloor] = useState('')

  const [modal, setModal] = useState(null) // null | 'new' | unit
  const [form, setForm] = useState({
    room_id: '', asset_code: '', name: '', equipment_type: 'ac',
    family: 'Split', capacity_btu: '', refrigerant: '',
    status: 'active', last_major_clean_date: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => { api.get('/master/clients').then((r) => setClients(r.data)) }, [])

  const loadUnits = (clientId, eqType) => {
    if (!clientId) { setUnitList([]); return }
    setLoadingUnits(true)
    const params = new URLSearchParams({ client_id: clientId })
    if (eqType) params.append('equipment_type', eqType)
    api.get(`/master/units?${params}`).then((r) => setUnitList(r.data)).finally(() => setLoadingUnits(false))
  }

  useEffect(() => { loadUnits(selectedClient, equipmentTypeFilter) }, [selectedClient, equipmentTypeFilter])

  // Cascade for add form
  useEffect(() => {
    if (!selectedClient) { setSites([]); return }
    api.get(`/master/sites?client_id=${selectedClient}`).then((r) => setSites(r.data))
  }, [selectedClient])

  useEffect(() => {
    if (!selSite) { setBuildings([]); setSelBuilding(''); return }
    api.get(`/master/buildings?site_id=${selSite}`).then((r) => setBuildings(r.data))
  }, [selSite])

  useEffect(() => {
    if (!selBuilding) { setFloors([]); setSelFloor(''); return }
    api.get(`/master/floors?building_id=${selBuilding}`).then((r) => setFloors(r.data))
  }, [selBuilding])

  useEffect(() => {
    if (!selFloor) { setRooms([]); return }
    api.get(`/master/rooms?floor_id=${selFloor}`).then((r) => setRooms(r.data))
  }, [selFloor])

  const openNew = () => {
    setForm({ room_id: '', asset_code: '', name: '', equipment_type: 'ac', family: 'Split', capacity_btu: '', refrigerant: '', status: 'active', last_major_clean_date: '' })
    setSelSite(''); setSelBuilding(''); setSelFloor('')
    setModal('new')
  }

  const openEdit = (u) => {
    setForm({
      room_id: u.room_id || '',
      asset_code: u.asset_code || '',
      name: u.name || '',
      equipment_type: u.equipment_type || 'ac',
      family: u.family || 'Split',
      capacity_btu: u.capacity_btu || '',
      refrigerant: u.refrigerant || '',
      status: u.status || 'active',
      last_major_clean_date: u.last_major_clean_date ? u.last_major_clean_date.slice(0, 10) : '',
    })
    setModal(u)
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        ...form,
        capacity_btu: form.capacity_btu ? Number(form.capacity_btu) : undefined,
        last_major_clean_date: form.last_major_clean_date || undefined,
        client_id: selectedClient || undefined,
      }
      if (modal === 'new') {
        await api.post('/master/units', payload)
      } else {
        await api.put(`/master/units/${modal.id}`, payload)
      }
      setModal(null)
      loadUnits(selectedClient, equipmentTypeFilter)
    } catch (err) { alert(err.response?.data?.error || 'เกิดข้อผิดพลาด') }
    finally { setSaving(false) }
  }

  const del = async (id) => {
    if (!confirm('ลบอุปกรณ์นี้?')) return
    await api.delete(`/master/units/${id}`)
    loadUnits(selectedClient, equipmentTypeFilter)
  }

  const canEdit = ['admin', 'central_admin'].includes(user?.role)

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-wrap">
        <select className="input max-w-xs" value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
          <option value="">-- เลือก Client --</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="flex gap-2">
          {[{ value: '', label: 'ทั้งหมด' }, ...EQUIPMENT_TYPES].map((et) => (
            <button
              key={et.value}
              onClick={() => setEquipmentTypeFilter(et.value)}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                equipmentTypeFilter === et.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
              }`}
            >
              {et.label}
            </button>
          ))}
        </div>
        {canEdit && selectedClient && (
          <button onClick={openNew} className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> เพิ่มอุปกรณ์
          </button>
        )}
      </div>

      {selectedClient && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Asset Code</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ชื่อ</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ประเภท</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Family</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">BTU</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ห้อง</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">สถานะ</th>
                  {canEdit && <th className="py-3 px-4" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loadingUnits ? (
                  <tr><td colSpan={8} className="py-10 text-center text-gray-400">กำลังโหลด...</td></tr>
                ) : unitList.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-blue-700">
                      <Link
                        to={`/units/${u.id}`}
                        className="hover:underline flex items-center gap-1 group"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {u.asset_code}
                        <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-gray-700">{u.name || '-'}</td>
                    <td className="py-3 px-4 text-gray-500">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.equipment_type === 'fan' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {u.equipment_type === 'fan' ? 'พัดลม' : 'แอร์'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-500">{u.family || '-'}</td>
                    <td className="py-3 px-4 text-gray-500">{u.capacity_btu ? Number(u.capacity_btu).toLocaleString() : '-'}</td>
                    <td className="py-3 px-4 text-gray-500">{u.room_name || u.dept_name || '-'}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        u.status === 'active' ? 'bg-green-100 text-green-700'
                        : u.status === 'broken' ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 text-gray-500'
                      }`}>
                        {UNIT_STATUSES.find((s) => s.value === u.status)?.label || u.status}
                      </span>
                    </td>
                    {canEdit && (
                      <td className="py-3 px-4">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => openEdit(u)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50">
                            <Pencil className="h-4 w-4" />
                          </button>
                          {user?.role === 'admin' && (
                            <button onClick={() => del(u.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {!loadingUnits && unitList.length === 0 && (
                  <tr><td colSpan={8} className="py-12 text-center text-gray-400">ไม่พบอุปกรณ์</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <Modal title={modal === 'new' ? 'เพิ่มอุปกรณ์' : `แก้ไข ${modal.asset_code}`} onClose={() => setModal(null)}>
          <div className="flex flex-col gap-3">
            {modal === 'new' && (
              <>
                <div>
                  <label className="label">Site</label>
                  <select className="input" value={selSite} onChange={(e) => { setSelSite(e.target.value); setSelBuilding(''); setSelFloor('') }}>
                    <option value="">-- เลือก Site --</option>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">อาคาร</label>
                  <select className="input" value={selBuilding} onChange={(e) => { setSelBuilding(e.target.value); setSelFloor('') }} disabled={!selSite}>
                    <option value="">-- เลือกอาคาร --</option>
                    {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">ชั้น</label>
                  <select className="input" value={selFloor} onChange={(e) => setSelFloor(e.target.value)} disabled={!selBuilding}>
                    <option value="">-- เลือกชั้น --</option>
                    {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">ห้อง / แผนก *</label>
                  <select className="input" value={form.room_id} onChange={(e) => setForm({ ...form, room_id: e.target.value })} disabled={!selFloor}>
                    <option value="">-- เลือกห้อง --</option>
                    {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              </>
            )}
            <div>
              <label className="label">ประเภทอุปกรณ์</label>
              <div className="flex gap-2">
                {EQUIPMENT_TYPES.map((et) => (
                  <button key={et.value} type="button"
                    onClick={() => setForm({ ...form, equipment_type: et.value })}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${form.equipment_type === et.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}
                  >{et.label}</button>
                ))}
              </div>
            </div>
            <div><label className="label">Asset Code *</label><input className="input" value={form.asset_code} onChange={(e) => setForm({ ...form, asset_code: e.target.value })} placeholder="A-B01-001" /></div>
            <div><label className="label">ชื่อ / รุ่น</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div>
              <label className="label">Family</label>
              <select className="input" value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value })}>
                {FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div><label className="label">BTU</label><input type="number" className="input" value={form.capacity_btu} onChange={(e) => setForm({ ...form, capacity_btu: e.target.value })} /></div>
            <div><label className="label">สารทำความเย็น</label><input className="input" value={form.refrigerant} onChange={(e) => setForm({ ...form, refrigerant: e.target.value })} placeholder="R32, R410A" /></div>
            <div>
              <label className="label">สถานะ</label>
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {UNIT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div><label className="label">วันที่ล้างใหญ่ล่าสุด</label><input type="date" className="input" value={form.last_major_clean_date} onChange={(e) => setForm({ ...form, last_major_clean_date: e.target.value })} /></div>
            <div className="flex gap-2 mt-2">
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">ยกเลิก</button>
              <button onClick={save} disabled={saving} className="btn-primary flex-1">{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'clients',   label: 'Clients' },
  { key: 'structure', label: 'Site / อาคาร / ชั้น / ห้อง' },
  { key: 'units',     label: 'อุปกรณ์' },
]

export default function MasterData() {
  const [tab, setTab] = useState('clients')

  return (
    <Layout title="Master Data">
      <div className="p-6 flex flex-col gap-4">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'clients'   && <ClientsTab />}
        {tab === 'structure' && <StructureTab />}
        {tab === 'units'     && <UnitsTab />}
      </div>
    </Layout>
  )
}
