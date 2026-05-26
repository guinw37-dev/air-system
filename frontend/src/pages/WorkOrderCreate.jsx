import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import api from '../api/client'
import { useAuthStore } from '../store/auth'

const TYPES = [
  { value: 'major', label: 'ล้างใหญ่', desc: 'ล้างคอยล์เย็น/ร้อน + วัดค่า' },
  { value: 'minor', label: 'ล้างเล็ก', desc: 'เปลี่ยนกรอง + ตรวจสอบ' },
  { value: 'fan',   label: 'ล้างพัดลม', desc: 'ทำความสะอาดพัดลม' },
]

export default function WorkOrderCreate() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const [hospitals, setHospitals] = useState([])
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({
    hospital_id: '',
    type: 'major',
    tech1_id: user?.id || '',
    tech2_id: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api.get('/master/hospitals'),
      api.get('/master/users'),
    ]).then(([h, u]) => {
      setHospitals(h.data)
      setUsers(u.data)
      if (h.data.length === 1) setForm((f) => ({ ...f, hospital_id: h.data[0].id }))
    })
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.hospital_id) { setError('กรุณาเลือกโรงพยาบาล'); return }
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/work-orders', {
        hospital_id: form.hospital_id,
        type: form.type,
        tech1_id: form.tech1_id || undefined,
        tech2_id: form.tech2_id || undefined,
      })
      navigate(`/work-orders/${data.id}`)
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด')
      setLoading(false)
    }
  }

  return (
    <Layout title="เปิดใบงานใหม่" back="/work-orders">
      <form onSubmit={submit} className="px-4 pt-4 flex flex-col gap-5">

        {/* Hospital */}
        <div>
          <label className="label">โรงพยาบาล / สถานที่ *</label>
          <select
            className="input"
            value={form.hospital_id}
            onChange={(e) => setForm({ ...form, hospital_id: e.target.value })}
            required
          >
            <option value="">-- เลือก --</option>
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </div>

        {/* Type */}
        <div>
          <label className="label">ประเภทงาน *</label>
          <div className="flex flex-col gap-2">
            {TYPES.map((t) => (
              <label
                key={t.value}
                className={`flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition-colors ${
                  form.type === t.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value={t.value}
                  checked={form.type === t.value}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="accent-blue-600"
                />
                <div>
                  <p className="font-medium text-sm text-gray-900">{t.label}</p>
                  <p className="text-xs text-gray-500">{t.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Tech1 */}
        <div>
          <label className="label">ช่างคนที่ 1 *</label>
          <select
            className="input"
            value={form.tech1_id}
            onChange={(e) => setForm({ ...form, tech1_id: e.target.value })}
          >
            <option value="">-- เลือกช่าง --</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
            ))}
          </select>
        </div>

        {/* Tech2 */}
        <div>
          <label className="label">ช่างคนที่ 2 (ถ้ามี)</label>
          <select
            className="input"
            value={form.tech2_id}
            onChange={(e) => setForm({ ...form, tech2_id: e.target.value })}
          >
            <option value="">-- ไม่มี --</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
        )}

        <button type="submit" disabled={loading} className="btn-primary text-center">
          {loading ? 'กำลังสร้าง...' : 'สร้างใบงาน'}
        </button>
      </form>
    </Layout>
  )
}
