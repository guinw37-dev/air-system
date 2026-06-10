import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Snowflake, Building2, ArrowRight, ShieldCheck, LogOut } from 'lucide-react'
import api from '../api/client'
import { useTenantStore } from '../store/tenant'
import { useAuthStore } from '../store/auth'

// Post-login branch picker for a super-admin (apex). Picking a หน่วยงาน/สาขา
// switches the session into that branch (X-Branch) — no re-login — and the
// normal app then operates on that branch's schema. A super-admin token (isSuper)
// passes enforceBranch on any branch.
export default function SelectBranch() {
  const navigate = useNavigate()
  const tenant = useTenantStore()
  const { user, logout } = useAuthStore()
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/branches/public')
      .then((r) => setBranches(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const enter = (b) => { tenant.switchBranch(b.slug, b.name); navigate('/simple-wo') }
  const stayCentral = () => { tenant.switchBranch(null); navigate('/') }
  const doLogout = () => { logout(); navigate('/login') }

  return (
    <div className="min-h-screen bg-page flex flex-col items-center px-4 py-10">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-3 shadow-lg">
          <Snowflake className="h-9 w-9 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-ink">เลือกหน่วยงาน</h1>
        <p className="text-sm text-ink-muted mt-1">สวัสดี {user?.name} — เลือกสาขาที่จะเข้าใช้งาน</p>
      </div>

      <div className="w-full max-w-4xl">
        {loading ? (
          <p className="text-center text-ink-muted py-16">กำลังโหลดสาขา…</p>
        ) : branches.length === 0 ? (
          <p className="text-center text-ink-muted py-16">ยังไม่มีสาขา — ไปที่ “จัดการสาขา” เพื่อเพิ่ม</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {branches.map((b) => (
              <button
                key={b.slug}
                onClick={() => enter(b)}
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

      <div className="mt-10 flex items-center gap-6">
        <button onClick={stayCentral} className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-primary">
          <ShieldCheck className="h-4 w-4" /> จัดการระดับกลาง (ไม่เลือกสาขา)
        </button>
        <button onClick={doLogout} className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-danger">
          <LogOut className="h-4 w-4" /> ออกจากระบบ
        </button>
      </div>
    </div>
  )
}
