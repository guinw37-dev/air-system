import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Plus, LogIn } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api/client'
import { useTenantStore } from '../store/tenant'

// Super-admin back-office: provision/manage branches (สาขา). Each branch is a
// separate Postgres schema with its own users — fully isolated. "เข้าจัดการ"
// switches the SPA into that branch (X-Branch) so the normal pages operate on it.
export default function Branches() {
  const navigate = useNavigate()
  const tenant = useTenantStore()
  const [list, setList] = useState([])
  const [form, setForm] = useState({ code: '', name: '', slug: '', admin_username: '', admin_password: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/branches').then((r) => setList(r.data || [])).catch(() => {})
  useEffect(() => { load() }, [])

  const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  const create = async (e) => {
    e.preventDefault()
    setMsg(null); setBusy(true)
    try {
      const body = { ...form, slug: form.slug || slugify(form.name) }
      const { data } = await api.post('/branches', body)
      setMsg({ ok: true, text: `สร้างสาขา ${data.branch.name} [${data.branch.schema_name}] แล้ว` })
      setForm({ code: '', name: '', slug: '', admin_username: '', admin_password: '' })
      load()
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || 'สร้างไม่สำเร็จ' })
    } finally { setBusy(false) }
  }

  const toggle = async (b) => {
    await api.patch(`/branches/${b.id}`, { active: !b.active }).catch(() => {})
    load()
  }

  const manage = (b) => { tenant.switchBranch(b.slug, b.name); navigate('/') }
  const exitBranch = () => { tenant.switchBranch(null) }

  return (
    <Layout>
      <div className="p-4 flex flex-col gap-4 max-w-3xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2"><Building2 className="h-5 w-5" /> จัดการสาขา</h2>
          {tenant.isBranch && (
            <button onClick={exitBranch} className="text-sm text-ink-muted">← ออกจากสาขา ({tenant.name})</button>
          )}
        </div>

        {/* create */}
        <form onSubmit={create} className="card flex flex-col gap-3">
          <p className="font-semibold text-ink">เพิ่มสาขาใหม่</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">รหัส (code)</label><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required /></div>
            <div><label className="label">slug (subdomain)</label><input className="input" placeholder="เว้นว่าง = สร้างจากชื่อ" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></div>
          </div>
          <div><label className="label">ชื่อสาขา</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">admin user (ของสาขา)</label><input className="input" value={form.admin_username} onChange={(e) => setForm({ ...form, admin_username: e.target.value })} /></div>
            <div><label className="label">admin password</label><input className="input" type="password" value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} /></div>
          </div>
          {msg && <p className={`text-sm rounded-input px-3 py-2 ${msg.ok ? 'bg-green-50 text-green-700' : 'bg-danger-soft text-danger'}`}>{msg.text}</p>}
          <button disabled={busy} className="btn-primary self-start flex items-center gap-2"><Plus className="h-4 w-4" /> {busy ? 'กำลังสร้าง...' : 'สร้างสาขา + schema'}</button>
        </form>

        {/* list */}
        <div className="card">
          <p className="font-semibold text-ink mb-2">สาขาทั้งหมด ({list.length})</p>
          <div className="flex flex-col divide-y divide-line">
            {list.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="font-medium text-ink">{b.name} <span className="text-xs text-ink-muted">({b.code})</span></div>
                  <div className="text-xs text-ink-muted">{b.slug ? `${b.slug}.<domain>` : '— ไม่มี subdomain'} · schema {b.schema_name || '—'} {b.active ? '' : '· ปิดใช้งาน'}</div>
                </div>
                <div className="flex items-center gap-2">
                  {b.slug && b.schema_name && (
                    <button onClick={() => manage(b)} className="text-sm text-primary flex items-center gap-1"><LogIn className="h-4 w-4" /> เข้าจัดการ</button>
                  )}
                  <button onClick={() => toggle(b)} className="text-xs text-ink-muted">{b.active ? 'ปิด' : 'เปิด'}</button>
                </div>
              </div>
            ))}
            {!list.length && <p className="text-sm text-ink-muted py-3">ยังไม่มีสาขา</p>}
          </div>
        </div>
      </div>
    </Layout>
  )
}
