import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Snowflake, Building2, ArrowRight, ShieldCheck } from 'lucide-react'
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
    // Universal (works without per-branch DNS): re-enter the SPA scoped to slug.
    const url = new URL(window.location.href)
    url.searchParams.set('branch', slug)
    url.pathname = '/login'
    window.location.href = url.toString()
  }

  return (
    <div className="min-h-screen bg-page flex flex-col items-center px-4 py-10">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-3 shadow-lg">
          <Snowflake className="h-9 w-9 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-ink">Air System</h1>
        <p className="text-sm text-ink-muted mt-1">Technical Water Co.,Ltd — เลือกสาขา</p>
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
                  <div className="w-11 h-11 rounded-xl bg-primary-soft flex items-center justify-center">
                    <Building2 className="h-6 w-6 text-primary" />
                  </div>
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
