import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Snowflake } from 'lucide-react'
import api from '../api/client'
import { useAuthStore } from '../store/auth'

export default function Login() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
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
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-700 to-blue-500 flex flex-col items-center justify-center px-6">
      <div className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-xl">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-blue-100 rounded-2xl p-4 mb-3">
            <Snowflake className="h-10 w-10 text-blue-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Air System</h1>
          <p className="text-sm text-gray-500 mt-1">Technical Water Co.,Ltd</p>
        </div>

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
            <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
          )}
          <button type="submit" disabled={loading} className="btn-primary mt-2 text-center">
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  )
}
