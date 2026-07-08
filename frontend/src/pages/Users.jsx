import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Building2, ShieldCheck } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api/client'
import { useTenantStore } from '../store/tenant'
import { useAuthStore } from '../store/auth'

// Role model (mirrors backend utils/roles.js). Each branch signing role owns one
// signature slot on a ใบงาน:
//  Super Dev        = super_admin      — apex/public, cross-branch, owner only.
//  Admin Dep.       = admin            — branch-local, full within the branch.
//  Approve Engineer = approve_engineer — signs เจ้าหน้าวิศวกรรม + approves.
//  Approve Building = approve_building — signs เจ้าหน้าที่ช่างอาคาร + approves.
//  Checker Dev.     = checker          — signs หัวหน้าช่างแอร์ + inspects.
//  Technician       = technician       — field tech, signs ช่างแอร์.
// On apex (super context) you may only create Super Devs; branch roles are
// created INSIDE that branch (เข้าจัดการ → ผู้ใช้งาน).
const BRANCH_ROLES = ['admin', 'approve_engineer', 'approve_building', 'checker', 'technician']
const SUPER_ROLES  = ['super_admin']
// Hierarchy rank (mirrors backend utils/roles.js). A user can only manage roles
// at or below their own rank, and can't assign a role above it.
const ROLE_RANK = { super_admin: 100, admin: 80, approve_engineer: 60, approve_building: 60, checker: 60, technician: 40, approver: 60 }
const rankOf = (r) => ROLE_RANK[r] || 0
const ROLE_COLOR = {
  super_admin:      'badge-danger',
  admin:            'badge-primary',
  approve_engineer: 'badge-warn',
  approve_building: 'badge-warn',
  checker:          'bg-primary-soft text-primary',
  technician:       'badge-gray',
  approver:         'badge-warn',
}
const ROLE_TH = {
  super_admin:      'Super Dev — ผู้ดูแลระบบ',
  admin:            'Admin Dep. — ผู้จัดการสาขา',
  approve_engineer: 'Approve Engineer — วิศวกรรม',
  approve_building: 'Approve Building — ช่างอาคาร',
  checker:          'Checker Dev. — หัวหน้าช่างแอร์',
  technician:       'Technician — ช่าง',
  approver:         'Approve Dev. (เดิม)',
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
  const tenant = useTenantStore()
  const me = useAuthStore((s) => s.user)
  const myRank = rankOf(me?.role)
  // Only roles at or below my rank can be assigned.
  const ROLES = (tenant.isBranch ? BRANCH_ROLES : SUPER_ROLES).filter((r) => rankOf(r) <= myRank)
  const defaultRole = ROLES[ROLES.length - 1] || (tenant.isBranch ? 'technician' : 'super_admin')
  const [users, setUsers] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ name: '', username: '', password: '', role: defaultRole, phone: '', position: '', active: true, confirm_password: '' })
  const [saving, setSaving] = useState(false)
  // Step-up: any action touching a Super Dev needs my own password re-entered.
  const needsStepUp = form.role === 'super_admin' || (modal && modal !== 'new' && modal.role === 'super_admin')

  const [branches, setBranches] = useState([])
  const load = () => api.get('/master/users').then((r) => setUsers(r.data))
  useEffect(() => {
    load()
    if (!tenant.isBranch) api.get('/branches/public').then((r) => setBranches(r.data || [])).catch(() => {})
  }, [tenant.isBranch])

  // Apex only: move a public super-admin account into a branch's own users.
  const moveToBranch = async (userId, slug) => {
    if (!slug) return
    const b = branches.find((x) => x.slug === slug)
    if (!window.confirm(`ย้ายผู้ใช้นี้ไปสาขา "${b?.name || slug}"? จะ login ได้เฉพาะสาขานั้น`)) return
    try {
      await api.post(`/branches/${slug}/adopt-user`, { userId })
      load()
    } catch (err) { alert(err.response?.data?.error || 'ย้ายไม่สำเร็จ') }
  }

  const openNew = () => {
    setForm({ name: '', username: '', password: '', role: defaultRole, phone: '', position: '', active: true, confirm_password: '' })
    setModal('new')
  }

  const openEdit = (u) => {
    setForm({ name: u.name, username: u.username, password: '', role: u.role, phone: u.phone || '', position: u.position || '', active: u.active, confirm_password: '' })
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

  // Delete — Super Dev target needs a password step-up (handled server-side too).
  const remove = async (u) => {
    if (!window.confirm(`ลบผู้ใช้ "${u.name}" ?`)) return
    let confirm_password
    if (u.role === 'super_admin') {
      confirm_password = window.prompt('ยืนยันรหัสผ่าน Super Dev ของคุณเพื่อลบ')
      if (!confirm_password) return
    }
    try {
      await api.delete(`/master/users/${u.id}`, { data: { confirm_password } })
      load()
    } catch (err) { alert(err.response?.data?.error || 'ลบไม่สำเร็จ') }
  }

  // Can I manage this row? Not higher rank, and not my own account.
  const canManage = (u) => rankOf(u.role) <= myRank && String(u.id) !== String(me?.id)

  return (
    <Layout title="จัดการผู้ใช้งาน">
      <div className="p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="inline-flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg bg-primary-soft text-primary">
            {tenant.isBranch
              ? <><Building2 className="h-4 w-4" /> ผู้ใช้งานของสาขา: {tenant.name}</>
              : <><ShieldCheck className="h-4 w-4" /> ผู้ดูแลกลาง (Super Admin)</>}
          </div>
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
                <th className="text-left py-3 px-4 text-xs font-semibold text-ink-muted uppercase">ตำแหน่ง</th>
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
                  <td className="py-3 px-4 text-ink-muted">{u.position || '-'}</td>
                  <td className="py-3 px-4 text-ink-muted">{u.phone || '-'}</td>
                  <td className="py-3 px-4">
                    <span className={`badge ${u.active ? 'badge-success' : 'badge-gray'}`}>
                      {u.active ? 'ใช้งาน' : 'ปิด'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2 justify-end">
                      {!tenant.isBranch && branches.length > 0 && u.role !== 'super_admin' && (
                        <select
                          defaultValue=""
                          onChange={(e) => { moveToBranch(u.id, e.target.value); e.target.value = '' }}
                          className="text-xs border border-line rounded-lg px-2 py-1 text-ink-muted"
                          title="ย้ายไปสาขา"
                        >
                          <option value="">→ ย้ายไปสาขา</option>
                          {branches.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
                        </select>
                      )}
                      {canManage(u) && (
                        <>
                          <button onClick={() => openEdit(u)} className="p-1.5 text-ink-muted hover:text-primary rounded-lg hover:bg-primary-soft" title="แก้ไข">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button onClick={() => remove(u)} className="p-1.5 text-ink-muted hover:text-danger rounded-lg hover:bg-danger-soft" title="ลบ">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
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
                {/* include the row's current role even if it's outside my assignable set, so editing keeps it */}
                {(ROLES.includes(form.role) ? ROLES : [form.role, ...ROLES]).map((r) => <option key={r} value={r}>{ROLE_TH[r] || r}</option>)}
              </select>
            </div>
            <div><label className="label">โทรศัพท์</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label className="label">ตำแหน่ง</label><input className="input" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="เช่น หัวหน้าช่างแอร์ / วิศวกรอาคาร" /></div>
            {needsStepUp && (
              <div className="rounded-input bg-danger-soft p-3">
                <label className="label text-danger flex items-center gap-1"><ShieldCheck className="h-4 w-4" /> ยืนยันรหัสผ่าน Super Dev ของคุณ *</label>
                <input type="password" className="input" placeholder="รหัสผ่านของคุณ" value={form.confirm_password} onChange={(e) => setForm({ ...form, confirm_password: e.target.value })} />
                <p className="text-xs text-danger mt-1">การสร้าง/แก้ไข Super Dev ต้องยืนยันตัวตนอีกครั้ง</p>
              </div>
            )}
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
