import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, ChevronRight } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api/client'
import { useAuthStore } from '../store/auth'

const AC_TYPES = ['Split', 'VRF', 'FCU', 'AHU', 'Cassette', 'Floor Standing', 'Chiller']

// ─── Reusable modal ────────────────────────────────────────────────────────
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

// ─── Hospitals Tab ─────────────────────────────────────────────────────────
function HospitalsTab() {
  const user = useAuthStore((s) => s.user)
  const [list, setList] = useState([])
  const [modal, setModal] = useState(null) // null | 'new' | item
  const [form, setForm] = useState({ name: '', slug: '', address: '', phone: '' })
  const [saving, setSaving] = useState(false)

  const load = () => api.get('/master/hospitals').then((r) => setList(r.data))
  useEffect(() => { load() }, [])

  const openNew = () => { setForm({ name: '', slug: '', address: '', phone: '' }); setModal('new') }
  const openEdit = (h) => { setForm({ name: h.name, slug: h.slug, address: h.address || '', phone: h.phone || '' }); setModal(h) }

  const save = async () => {
    setSaving(true)
    try {
      if (modal === 'new') {
        await api.post('/master/hospitals', form)
      } else {
        await api.put(`/master/hospitals/${modal.id}`, form)
      }
      setModal(null); load()
    } catch (err) { alert(err.response?.data?.error || 'เกิดข้อผิดพลาด') }
    finally { setSaving(false) }
  }

  const del = async (id) => {
    if (!confirm('ปิดการใช้งานโรงพยาบาลนี้?')) return
    await api.delete(`/master/hospitals/${id}`); load()
  }

  const canEdit = user?.role === 'admin'

  return (
    <div>
      {canEdit && (
        <div className="mb-4">
          <button onClick={openNew} className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> เพิ่มโรงพยาบาล
          </button>
        </div>
      )}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ชื่อ</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Slug</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ที่อยู่</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">สถานะ</th>
              {canEdit && <th className="py-3 px-4" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {list.map((h) => (
              <tr key={h.id} className="hover:bg-gray-50">
                <td className="py-3 px-4 font-medium text-gray-900">{h.name}</td>
                <td className="py-3 px-4 text-gray-500">{h.slug}</td>
                <td className="py-3 px-4 text-gray-500 max-w-xs truncate">{h.address || '-'}</td>
                <td className="py-3 px-4">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${h.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {h.active ? 'ใช้งาน' : 'ปิด'}
                  </span>
                </td>
                {canEdit && (
                  <td className="py-3 px-4">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => openEdit(h)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => del(h.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title={modal === 'new' ? 'เพิ่มโรงพยาบาล' : 'แก้ไขโรงพยาบาล'} onClose={() => setModal(null)}>
          <div className="flex flex-col gap-3">
            <div><label className="label">ชื่อ *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label">Slug *</label><input className="input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="pts1" /></div>
            <div><label className="label">ที่อยู่</label><textarea className="input" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><label className="label">โทรศัพท์</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
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

// ─── AC Units Tab ──────────────────────────────────────────────────────────
function AcUnitsTab() {
  const user = useAuthStore((s) => s.user)
  const [hospitals, setHospitals] = useState([])
  const [selectedHospital, setSelectedHospital] = useState('')
  const [acList, setAcList] = useState([])
  const [buildings, setBuildings] = useState([])
  const [floors, setFloors] = useState([])
  const [departments, setDepartments] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ department_id: '', ac_code: '', name: '', type: 'Split', capacity_btu: '', pm_interval_months: 2, notes: '' })
  const [saving, setSaving] = useState(false)

  // Cascade selectors for new AC
  const [selBuilding, setSelBuilding] = useState('')
  const [selFloor, setSelFloor] = useState('')

  useEffect(() => { api.get('/master/hospitals').then((r) => setHospitals(r.data)) }, [])

  useEffect(() => {
    if (!selectedHospital) { setAcList([]); return }
    api.get(`/master/ac-units?hospital_id=${selectedHospital}`).then((r) => setAcList(r.data))
    api.get(`/master/buildings?hospital_id=${selectedHospital}`).then((r) => setBuildings(r.data))
  }, [selectedHospital])

  useEffect(() => {
    if (!selBuilding) { setFloors([]); setDepartments([]); return }
    api.get(`/master/floors?building_id=${selBuilding}`).then((r) => setFloors(r.data))
  }, [selBuilding])

  useEffect(() => {
    if (!selFloor) { setDepartments([]); return }
    api.get(`/master/departments?floor_id=${selFloor}`).then((r) => setDepartments(r.data))
  }, [selFloor])

  const openNew = () => {
    setForm({ department_id: '', ac_code: '', name: '', type: 'Split', capacity_btu: '', pm_interval_months: 2, notes: '' })
    setSelBuilding(''); setSelFloor('')
    setModal('new')
  }

  const openEdit = (ac) => {
    setForm({
      department_id: ac.department_id,
      ac_code: ac.ac_code, name: ac.name || '',
      type: ac.type || 'Split', capacity_btu: ac.capacity_btu || '',
      pm_interval_months: ac.pm_interval_months || 2, notes: ac.notes || '',
    })
    setModal(ac)
  }

  const save = async () => {
    setSaving(true)
    try {
      if (modal === 'new') {
        await api.post('/master/ac-units', { ...form, capacity_btu: form.capacity_btu || undefined })
      } else {
        await api.put(`/master/ac-units/${modal.id}`, { ...form, capacity_btu: form.capacity_btu || undefined })
      }
      setModal(null)
      if (selectedHospital) api.get(`/master/ac-units?hospital_id=${selectedHospital}`).then((r) => setAcList(r.data))
    } catch (err) { alert(err.response?.data?.error || 'เกิดข้อผิดพลาด') }
    finally { setSaving(false) }
  }

  const del = async (id) => {
    if (!confirm('ลบเครื่องแอร์นี้?')) return
    await api.delete(`/master/ac-units/${id}`)
    setAcList((l) => l.filter((a) => a.id !== id))
  }

  const canEdit = ['admin', 'owner'].includes(user?.role)

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select className="input max-w-xs" value={selectedHospital} onChange={(e) => setSelectedHospital(e.target.value)}>
          <option value="">-- เลือกโรงพยาบาล --</option>
          {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        {canEdit && selectedHospital && (
          <button onClick={openNew} className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> เพิ่มเครื่องแอร์
          </button>
        )}
      </div>

      {selectedHospital && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">รหัส</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ชื่อ</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ประเภท</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">BTU</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">แผนก</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">ชั้น/อาคาร</th>
                  {canEdit && <th className="py-3 px-4" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {acList.map((ac) => (
                  <tr key={ac.id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-blue-700">{ac.ac_code}</td>
                    <td className="py-3 px-4 text-gray-700">{ac.name || '-'}</td>
                    <td className="py-3 px-4 text-gray-500">{ac.type || '-'}</td>
                    <td className="py-3 px-4 text-gray-500">{ac.capacity_btu ? ac.capacity_btu.toLocaleString() : '-'}</td>
                    <td className="py-3 px-4 text-gray-500">{ac.dept_name}</td>
                    <td className="py-3 px-4 text-gray-500">{ac.floor_name} / {ac.building_name}</td>
                    {canEdit && (
                      <td className="py-3 px-4">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => openEdit(ac)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50">
                            <Pencil className="h-4 w-4" />
                          </button>
                          {user?.role === 'admin' && (
                            <button onClick={() => del(ac.id)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {acList.length === 0 && (
                  <tr><td colSpan={7} className="py-12 text-center text-gray-400">ไม่พบเครื่องแอร์</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <Modal title={modal === 'new' ? 'เพิ่มเครื่องแอร์' : `แก้ไข ${modal.ac_code}`} onClose={() => setModal(null)}>
          <div className="flex flex-col gap-3">
            {modal === 'new' && (
              <>
                <div>
                  <label className="label">อาคาร</label>
                  <select className="input" value={selBuilding} onChange={(e) => { setSelBuilding(e.target.value); setSelFloor('') }}>
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
                  <label className="label">แผนก *</label>
                  <select className="input" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} disabled={!selFloor}>
                    <option value="">-- เลือกแผนก --</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </>
            )}
            <div><label className="label">รหัสแอร์ *</label><input className="input" value={form.ac_code} onChange={(e) => setForm({ ...form, ac_code: e.target.value })} placeholder="A-B01-001" /></div>
            <div><label className="label">ชื่อ/รุ่น</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div>
              <label className="label">ประเภท</label>
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {AC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className="label">BTU</label><input type="number" className="input" value={form.capacity_btu} onChange={(e) => setForm({ ...form, capacity_btu: e.target.value })} /></div>
            <div>
              <label className="label">รอบ PM (เดือน)</label>
              <input type="number" className="input" value={form.pm_interval_months} onChange={(e) => setForm({ ...form, pm_interval_months: Number(e.target.value) })} />
            </div>
            <div><label className="label">หมายเหตุ</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
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

// ─── Buildings/Floors/Depts Tab ────────────────────────────────────────────
function StructureTab() {
  const [hospitals, setHospitals] = useState([])
  const [selectedH, setSelectedH] = useState('')
  const [buildings, setBuildings] = useState([])
  const [selBuilding, setSelBuilding] = useState(null)
  const [floors, setFloors] = useState([])
  const [selFloor, setSelFloor] = useState(null)
  const [departments, setDepartments] = useState([])

  // modal state
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ name: '', code: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { api.get('/master/hospitals').then((r) => setHospitals(r.data)) }, [])

  useEffect(() => {
    if (!selectedH) return
    api.get(`/master/buildings?hospital_id=${selectedH}`).then((r) => { setBuildings(r.data); setSelBuilding(null); setFloors([]); setSelFloor(null); setDepartments([]) })
  }, [selectedH])

  const loadFloors = (b) => {
    setSelBuilding(b); setSelFloor(null); setDepartments([])
    api.get(`/master/floors?building_id=${b.id}`).then((r) => setFloors(r.data))
  }

  const loadDepts = (f) => {
    setSelFloor(f)
    api.get(`/master/departments?floor_id=${f.id}`).then((r) => setDepartments(r.data))
  }

  const openModal = (type, item = null) => {
    setForm({ name: item?.name || '', code: item?.code || '' })
    setModal({ type, item })
  }

  const save = async () => {
    setSaving(true)
    try {
      const { type, item } = modal
      if (type === 'building') {
        if (item) await api.put(`/master/buildings/${item.id}`, form)
        else await api.post('/master/buildings', { hospital_id: selectedH, ...form })
        api.get(`/master/buildings?hospital_id=${selectedH}`).then((r) => setBuildings(r.data))
      } else if (type === 'floor') {
        if (item) await api.put(`/master/floors/${item.id}`, form)
        else await api.post('/master/floors', { building_id: selBuilding.id, ...form })
        api.get(`/master/floors?building_id=${selBuilding.id}`).then((r) => setFloors(r.data))
      } else if (type === 'department') {
        if (item) await api.put(`/master/departments/${item.id}`, form)
        else await api.post('/master/departments', { floor_id: selFloor.id, ...form })
        api.get(`/master/departments?floor_id=${selFloor.id}`).then((r) => setDepartments(r.data))
      }
      setModal(null)
    } catch (err) { alert(err.response?.data?.error || 'เกิดข้อผิดพลาด') }
    finally { setSaving(false) }
  }

  const del = async (type, id) => {
    if (!confirm('ลบรายการนี้?')) return
    if (type === 'building') { await api.delete(`/master/buildings/${id}`); api.get(`/master/buildings?hospital_id=${selectedH}`).then((r) => setBuildings(r.data)) }
    else if (type === 'floor') { await api.delete(`/master/floors/${id}`); api.get(`/master/floors?building_id=${selBuilding.id}`).then((r) => setFloors(r.data)) }
    else if (type === 'department') { await api.delete(`/master/departments/${id}`); api.get(`/master/departments?floor_id=${selFloor.id}`).then((r) => setDepartments(r.data)) }
  }

  const ColHeader = ({ title, onAdd }) => (
    <div className="flex items-center justify-between mb-2">
      <h4 className="font-semibold text-gray-700 text-sm">{title}</h4>
      {onAdd && <button onClick={onAdd} className="text-blue-600 hover:bg-blue-50 rounded-lg p-1"><Plus className="h-4 w-4" /></button>}
    </div>
  )

  const Item = ({ item, active, onClick, onEdit, onDel, showArrow }) => (
    <div className={`flex items-center gap-1 px-3 py-2 rounded-lg cursor-pointer ${active ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100 text-gray-700'}`}>
      <span className="flex-1 text-sm truncate" onClick={onClick}>{item.name || item.code}</span>
      <button onClick={(e) => { e.stopPropagation(); onEdit() }} className="p-1 opacity-0 group-hover:opacity-100 hover:opacity-100 text-gray-400 hover:text-blue-600">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button onClick={(e) => { e.stopPropagation(); onDel() }} className="p-1 text-gray-400 hover:text-red-500">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      {showArrow && <ChevronRight className="h-4 w-4 text-gray-400" />}
    </div>
  )

  return (
    <div>
      <div className="mb-4">
        <select className="input max-w-xs" value={selectedH} onChange={(e) => setSelectedH(e.target.value)}>
          <option value="">-- เลือกโรงพยาบาล --</option>
          {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </div>

      {selectedH && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Buildings */}
          <div className="card">
            <ColHeader title="อาคาร" onAdd={() => openModal('building')} />
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
          </div>

          {/* Floors */}
          <div className="card">
            <ColHeader title={selBuilding ? `ชั้น — ${selBuilding.name}` : 'ชั้น'} onAdd={selBuilding ? () => openModal('floor') : null} />
            {!selBuilding ? (
              <p className="text-xs text-gray-400">เลือกอาคารก่อน</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {floors.map((f) => (
                  <div key={f.id} className="group flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100 cursor-pointer" onClick={() => loadDepts(f)}>
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

          {/* Departments */}
          <div className="card">
            <ColHeader title={selFloor ? `แผนก — ${selFloor.name}` : 'แผนก'} onAdd={selFloor ? () => openModal('department') : null} />
            {!selFloor ? (
              <p className="text-xs text-gray-400">เลือกชั้นก่อน</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {departments.map((d) => (
                  <div key={d.id} className="group flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100">
                    <span className="flex-1 text-sm text-gray-700">{d.name}</span>
                    <button onClick={() => openModal('department', d)} className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => del('department', d.id)} className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                {departments.length === 0 && <p className="text-xs text-gray-400 py-2">ยังไม่มีแผนก</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {modal && (
        <Modal
          title={{ building: 'อาคาร', floor: 'ชั้น', department: 'แผนก' }[modal.type] + (modal.item ? ' — แก้ไข' : ' — เพิ่ม')}
          onClose={() => setModal(null)}
        >
          <div className="flex flex-col gap-3">
            <div><label className="label">ชื่อ *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></div>
            {modal.type === 'building' && (
              <div><label className="label">รหัสอาคาร</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="A" /></div>
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

// ─── Main Page ─────────────────────────────────────────────────────────────
const TABS = [
  { key: 'hospitals', label: 'โรงพยาบาล' },
  { key: 'structure', label: 'อาคาร / ชั้น / แผนก' },
  { key: 'ac',        label: 'เครื่องแอร์' },
]

export default function MasterData() {
  const [tab, setTab] = useState('hospitals')

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

        {tab === 'hospitals' && <HospitalsTab />}
        {tab === 'structure' && <StructureTab />}
        {tab === 'ac'        && <AcUnitsTab />}
      </div>
    </Layout>
  )
}
