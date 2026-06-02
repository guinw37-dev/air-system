import { useEffect, useState } from 'react'
import { Plus, Pencil, Shield } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api/client'

const ROLES = ['admin', 'central_admin', 'approver', 'technician']
const ROLE_COLOR = {
  admin:         'badge-danger',
  central_admin: 'badge-primary',
  approver:      'badge-warn',
  technician:    'badge-gray',
}
const ROLE_TH = {
  admin:         'ผู้ดูแลระบบ',
  central_admin: 'แอดมินกลาง',
  approver:      'ผู้อนุมัติ',
  technician:    'ช่าง',
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-ink text-lg">{title}</h3>
          <button onClick={onClose} className="text-ink-muted text-2xl leading-none">&times;</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export default function Users() {
  const [users, setUsers] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'technician', phone: '', active: true })
  const [saving, setSaving] = useState(false)

  const load = () => api.get('/master/users').then((r) => setUsers(r.data))
  useEffect(() => { load() }, [])

  const openNew = () => {
    setForm({ name: '', username: '', password: '', role: 'technician', phone: '', active: true })
    setModal('new')
  }

  const openEdit = (u) => {
    setForm({ name: u.name, username: u.username, password: '', role: u.role, phone: u.phone || '', active: u.active })
    setModal(u)
  }

  const save = async () => {
    setSaving(true)
    try {
      if (modal === 'new') {
        if (!form.password) { alert('กรุณาตั้งรหัสผ่าน'); setSaving(false); return }
        await api.post('/master/users', form)
      } else {
        await api.put(`/master/users/${modal.id}`, form)
      }
      setModal(null); load()
    } catch (err) { alert(err.response?.data?.error || 'เกิดข้อผิดพลาด') }
    finally { setSaving(false) }
  }

  return (
    <Layout title="จัดการผู้ใช้งาน">
      <div className="p-6 flex flex-col gap-4">
        <div>
          <button onClick={openNew} className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> เพิ่มผู้ใช้งาน
          </button>
        </div>

        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-page border-b border-line">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">ชื่อ</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">Username</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">Role</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">โทรศัพท์</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">สถานะ</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-primary-soft/40">
                  <td className="py-3 px-4 font-medium text-ink flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary-soft flex items-center justify-center text-primary text-xs font-bold shrink-0">
                      {u.name?.[0]?.toUpperCase()}
                    </div>
                    {u.name}
                  </td>
                  <td className="py-3 px-4 text-ink-muted font-mono">{u.username}</td>
                  <td className="py-3 px-4">
                    <span className={`badge ${ROLE_COLOR[u.role] || 'badge-gray'}`}>
                      {ROLE_TH[u.role] || u.role}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-ink-muted">{u.phone || '-'}</td>
                  <td className="py-3 px-4">
                    <span className={`badge ${u.active ? 'badge-success' : 'badge-gray'}`}>
                      {u.active ? 'ใช้งาน' : 'ปิด'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <button onClick={() => openEdit(u)} className="p-1.5 text-ink-muted hover:text-primary rounded-lg hover:bg-primary-soft">
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal title={modal === 'new' ? 'เพิ่มผู้ใช้งาน' : `แก้ไข — ${modal.name}`} onClose={() => setModal(null)}>
          <div className="flex flex-col gap-3">
            <div><label className="label">ชื่อ-นามสกุล *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label">Username *</label><input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={modal !== 'new'} /></div>
            <div>
              <label className="label">{modal === 'new' ? 'รหัสผ่าน *' : 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)'}</label>
              <input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div>
              <label className="label">Role *</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_TH[r]}</option>)}
              </select>
            </div>
            <div><label className="label">โทรศัพท์</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            {modal !== 'new' && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="h-4 w-4 accent-primary" />
                <span className="text-sm text-ink">เปิดใช้งาน</span>
              </label>
            )}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">ยกเลิก</button>
              <button onClick={save} disabled={saving} className="btn-primary flex-1">{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  )
}
