import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Snowflake } from 'lucide-react'
import api from '../api/client'
import { useAuthStore } from '../store/auth'
import { useTenantStore } from '../store/tenant'

export default function Login() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const tenant = useTenantStore()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', form)
      setAuth(data.token, data.user)
      // Super-admin (apex login) picks a branch first; branch users go straight in.
      navigate(data.user?.isSuper && !tenant.isBranch ? '/select-branch' : '/')
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center px-4">
      {/* Branding strip */}
      <div className="mb-6 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-3 shadow-lg">
          <Snowflake className="h-9 w-9 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-ink">Air System</h1>
        <p className="text-sm text-ink-muted mt-1">Technical Water Co.,Ltd</p>
        {tenant.isBranch && (
          <p className="text-sm font-medium text-primary mt-1">{tenant.name}</p>
        )}
      </div>

      <div className="card w-full max-w-sm shadow-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="label">ชื่อผู้ใช้</label>
            <input
              className="input"
              type="text"
              autoComplete="username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">รหัสผ่าน</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </div>
          {error && (
            <p className="text-sm text-danger bg-danger-soft rounded-input px-3 py-2">{error}</p>
          )}
          <button type="submit" disabled={loading} className="btn-primary mt-2 w-full text-center py-3">
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  )
}
