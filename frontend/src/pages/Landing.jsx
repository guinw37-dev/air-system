import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, ArrowRight, ShieldCheck } from 'lucide-react'
import Logo from '../components/Logo'
import api from '../api/client'

// Apex landing page — one card per active branch (สาขา). Cards come from the
// live registry, so adding a branch (จัดการสาขา) makes a new card appear here
// automatically. Clicking a card enters that branch (sets ?branch=<slug> and
// reloads so the app resolves to it; swap for the real subdomain once DNS is set).
export default function Landing() {
  const navigate = useNavigate()
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/branches/public')
      .then((r) => setBranches(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const enter = (slug) => {
    const host = window.location.hostname
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(host)
    // On a real apex domain (e.g. tw-carework.online) go to the branch's own
    // subdomain (pts1.tw-carework.online). Otherwise (localhost / IP / the
    // multi-label *.sslip.io dev host) fall back to ?branch= which the SPA
    // resolves without per-branch DNS.
    const isRealApex = !isIp && host !== 'localhost' && host.split('.').length === 2
    if (isRealApex) {
      window.location.href = `${window.location.protocol}//${slug}.${host}/login`
    } else {
      const url = new URL(window.location.href)
      url.searchParams.set('branch', slug)
      url.pathname = '/login'
      window.location.href = url.toString()
    }
  }

  return (
    <div className="min-h-screen bg-page flex flex-col items-center px-4 py-10">
      <div className="text-center mb-8">
        <Logo size={64} className="mx-auto mb-3 drop-shadow-md" />
        <h1 className="text-2xl font-bold text-ink">Air System</h1>
        <p className="text-sm text-ink-muted mt-1">Technical Water Co.,Ltd — เลือกสาขา</p>
        <button
          onClick={() => navigate('/login')}
          className="btn-secondary mt-4 inline-flex items-center gap-2 text-sm"
        >
          <ShieldCheck className="h-4 w-4" /> เข้าระบบผู้ดูแล (Super Admin)
        </button>
      </div>

      <div className="w-full max-w-4xl">
        {loading ? (
          <p className="text-center text-ink-muted py-16">กำลังโหลดสาขา…</p>
        ) : branches.length === 0 ? (
          <p className="text-center text-ink-muted py-16">ยังไม่มีสาขา — เข้าระบบผู้ดูแลเพื่อเพิ่มสาขา</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {branches.map((b) => (
              <button
                key={b.slug}
                onClick={() => enter(b.slug)}
                className="card text-left hover:shadow-md hover:border-primary transition group flex flex-col gap-3"
              >
                <div className="flex items-center justify-between">
                  {b.card_image
                    ? <img src={b.card_image} alt="" className="w-11 h-11 rounded-xl object-cover border border-line" />
                    : <div className="w-11 h-11 rounded-xl bg-primary-soft flex items-center justify-center"><Building2 className="h-6 w-6 text-primary" /></div>}
                  <ArrowRight className="h-5 w-5 text-ink-muted group-hover:text-primary group-hover:translate-x-1 transition" />
                </div>
                <div>
                  <div className="font-semibold text-ink">{b.name}</div>
                  <div className="text-xs text-ink-muted mt-0.5">{b.slug}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* super-admin entry */}
      <button
        onClick={() => navigate('/login')}
        className="mt-10 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-primary"
      >
        <ShieldCheck className="h-4 w-4" /> เข้าระบบผู้ดูแล (Super Admin)
      </button>
    </div>
  )
}
