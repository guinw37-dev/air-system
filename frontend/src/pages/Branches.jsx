import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Plus, LogIn, Pencil, QrCode, X, Download } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api/client'
import { useTenantStore } from '../store/tenant'

// Super-admin back-office: provision + edit branches (สาขา). Each branch is a
// separate Postgres schema with its own users. "เข้าจัดการ" switches the SPA into
// that branch. Edit covers name / subdomain / card image; QR opens direct entry.
const slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// The public URL someone lands on for a branch.
function branchUrl(b) {
  const host = window.location.hostname
  const sub = b.subdomain || b.slug
  const isRealApex = !/^\d+\.\d+\.\d+\.\d+$/.test(host) && host !== 'localhost' && host.split('.').length === 2
  if (isRealApex) return `${window.location.protocol}//${sub}.${host}`
  return `${window.location.origin}/login?branch=${b.slug}`
}

function EditModal({ branch, onClose, onSaved }) {
  const [form, setForm] = useState({ name: branch.name || '', subdomain: branch.subdomain || branch.slug || '', card_image: branch.card_image || '' })
  const [saving, setSaving] = useState(false)
  const [qr, setQr] = useState(null)
  const [err, setErr] = useState('')

  const pickImage = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 1.5 * 1024 * 1024) { setErr('รูปใหญ่เกิน 1.5MB'); return }
    const reader = new FileReader()
    reader.onload = () => setForm((f) => ({ ...f, card_image: reader.result }))
    reader.readAsDataURL(file)
  }

  const save = async () => {
    setSaving(true); setErr('')
    try {
      await api.patch(`/branches/${branch.id}`, {
        name: form.name.trim(),
        subdomain: form.subdomain ? slugify(form.subdomain) : undefined,
        card_image: form.card_image,
      })
      onSaved()
    } catch (e) { setErr(e.response?.data?.error || 'บันทึกไม่สำเร็จ') } finally { setSaving(false) }
  }

  const makeQr = async () => {
    setErr('')
    try {
      const { data } = await api.get(`/branches/${branch.id}/qr`, { params: { url: branchUrl(branch) } })
      setQr(data.qr)
    } catch (e) { setErr(e.response?.data?.error || 'สร้าง QR ไม่สำเร็จ') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md p-6 shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-ink text-lg">แก้ไขสาขา</h3>
          <button onClick={onClose} className="text-ink-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div><label className="label">ชื่อสาขา</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div>
            <label className="label">Subdomain</label>
            <input className="input" value={form.subdomain} onChange={(e) => setForm({ ...form, subdomain: e.target.value })} />
            <p className="text-xs text-ink-muted mt-1">{(form.subdomain ? slugify(form.subdomain) : branch.slug)}.&lt;domain&gt; · schema {branch.schema_name} (แก้ schema ไม่ได้)</p>
          </div>
          <div>
            <label className="label">รูปหน้า Card</label>
            <div className="flex items-center gap-3">
              {form.card_image
                ? <img src={form.card_image} alt="" className="w-14 h-14 rounded-xl object-cover border border-line" />
                : <div className="w-14 h-14 rounded-xl bg-primary-soft flex items-center justify-center"><Building2 className="h-6 w-6 text-primary" /></div>}
              <input type="file" accept="image/*" onChange={pickImage} className="text-sm" />
              {form.card_image && <button onClick={() => setForm({ ...form, card_image: '' })} className="text-xs text-danger">ลบรูป</button>}
            </div>
          </div>

          {/* QR */}
          <div className="border-t border-line pt-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink flex items-center gap-1"><QrCode className="h-4 w-4" /> QR เข้าตรง</span>
              <button onClick={makeQr} className="text-sm text-primary">สร้าง QR</button>
            </div>
            <p className="text-xs text-ink-muted mt-1 break-all">{branchUrl(branch)}</p>
            {qr && (
              <div className="mt-2 flex flex-col items-center gap-2">
                <img src={qr} alt="QR" className="w-44 h-44" />
                <a href={qr} download={`qr-${branch.slug}.png`} className="text-sm text-primary flex items-center gap-1"><Download className="h-4 w-4" /> ดาวน์โหลด QR</a>
              </div>
            )}
          </div>

          {err && <p className="text-sm text-danger bg-danger-soft rounded-input px-3 py-2">{err}</p>}
          <div className="flex gap-2 mt-2">
            <button onClick={onClose} className="btn-secondary flex-1">ปิด</button>
            <button onClick={save} disabled={saving} className="btn-primary flex-1">{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Branches() {
  const navigate = useNavigate()
  const tenant = useTenantStore()
  const [list, setList] = useState([])
  const [form, setForm] = useState({ code: '', name: '', slug: '', admin_username: '', admin_password: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(null)

  const load = () => api.get('/branches').then((r) => setList(r.data || [])).catch(() => {})
  useEffect(() => { load() }, [])

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

  const toggle = async (b) => { await api.patch(`/branches/${b.id}`, { active: !b.active }).catch(() => {}); load() }
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
                <div className="flex items-center gap-3">
                  {b.card_image
                    ? <img src={b.card_image} alt="" className="w-10 h-10 rounded-lg object-cover border border-line shrink-0" />
                    : <div className="w-10 h-10 rounded-lg bg-primary-soft flex items-center justify-center shrink-0"><Building2 className="h-5 w-5 text-primary" /></div>}
                  <div>
                    <div className="font-medium text-ink">{b.name} <span className="text-xs text-ink-muted">({b.code})</span></div>
                    <div className="text-xs text-ink-muted">{b.subdomain || b.slug ? `${b.subdomain || b.slug}.<domain>` : '— ไม่มี subdomain'} · schema {b.schema_name || '—'} {b.active ? '' : '· ปิดใช้งาน'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {b.slug && b.schema_name && (
                    <button onClick={() => manage(b)} className="text-sm text-primary flex items-center gap-1"><LogIn className="h-4 w-4" /> เข้าจัดการ</button>
                  )}
                  <button onClick={() => setEditing(b)} className="text-xs text-ink-muted hover:text-primary flex items-center gap-1"><Pencil className="h-3.5 w-3.5" /> แก้ไข</button>
                  <button onClick={() => toggle(b)} className="text-xs text-ink-muted">{b.active ? 'ปิด' : 'เปิด'}</button>
                </div>
              </div>
            ))}
            {!list.length && <p className="text-sm text-ink-muted py-3">ยังไม่มีสาขา</p>}
          </div>
        </div>
      </div>

      {editing && <EditModal branch={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </Layout>
  )
}
