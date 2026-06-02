import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../api/client'
import SignaturePad from '../components/SignaturePad'
import Spinner from '../components/Spinner'
import { CheckCircle, AlertTriangle } from 'lucide-react'

export default function SignPage() {
  const { token } = useParams()

  const [info, setInfo]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)  // null | 'expired' | 'used' | 'notfound' | string
  const [done, setDone]       = useState(false)

  // Form state
  const [signerName, setSignerName]       = useState('')
  const [position, setPosition]           = useState('')
  const [showPad, setShowPad]             = useState(false)
  const [submitting, setSubmitting]       = useState(false)
  const [submitError, setSubmitError]     = useState('')

  useEffect(() => {
    api.get(`/sign/${token}`)
      .then((r) => setInfo(r.data))
      .catch((err) => {
        const status = err.response?.status
        const msg    = err.response?.data?.error || ''
        if (status === 410) {
          if (msg.includes('หมดอายุ')) setError('expired')
          else if (msg.includes('ถูกใช้')) setError('used')
          else setError('expired')
        } else if (status === 404) {
          setError('notfound')
        } else {
          setError(msg || 'เกิดข้อผิดพลาด')
        }
      })
      .finally(() => setLoading(false))
  }, [token])

  const handleSave = async (signatureData) => {
    if (!signerName.trim()) {
      setSubmitError('กรุณาระบุชื่อ-นามสกุล')
      return
    }
    const fullName = position.trim()
      ? `${signerName.trim()} (${position.trim()})`
      : signerName.trim()

    setSubmitting(true)
    setSubmitError('')
    try {
      await api.post(`/sign/${token}`, {
        signer_name: fullName,
        signature_data: signatureData,
      })
      setDone(true)
    } catch (err) {
      const status = err.response?.status
      const msg    = err.response?.data?.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่'
      if (status === 410) {
        setError('expired')
      } else {
        setSubmitError(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ── Loading ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <Spinner className="h-10 w-10" />
      </div>
    )
  }

  // ── Error states ─────────────────────────────────────────────────────────
  if (error) {
    const isExpiredOrUsed = error === 'expired' || error === 'used'
    return (
      <div className="min-h-screen bg-page flex items-center justify-center px-4">
        <div className="card max-w-sm w-full text-center py-8 px-6">
          <AlertTriangle className="h-12 w-12 text-warn mx-auto mb-3" />
          {isExpiredOrUsed ? (
            <>
              <h2 className="text-lg font-semibold text-ink mb-2">
                {error === 'expired' ? 'ลิงก์หมดอายุ' : 'ลิงก์ถูกใช้ไปแล้ว'}
              </h2>
              <p className="text-sm text-ink-muted">กรุณาขอลิงก์ใหม่จากช่างผู้รับผิดชอบ</p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-ink mb-2">ไม่พบลิงก์นี้</h2>
              <p className="text-sm text-ink-muted">{error === 'notfound' ? 'ลิงก์ไม่ถูกต้อง' : error}</p>
            </>
          )}
        </div>
      </div>
    )
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center px-4">
        <div className="card max-w-sm w-full text-center py-8 px-6">
          <CheckCircle className="h-14 w-14 text-success mx-auto mb-3" />
          <h2 className="text-xl font-bold text-ink mb-1">ขอบคุณ</h2>
          <p className="text-base text-ink-muted">ลงนามเรียบร้อยแล้ว</p>
        </div>
      </div>
    )
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-page px-4 py-8">
      <div className="max-w-sm mx-auto flex flex-col gap-4">

        {/* Header */}
        <div className="text-center mb-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-soft mb-3">
            <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-ink">ลงนามรับทราบการซ่อมบำรุง</h1>
          <p className="text-xs text-ink-muted mt-1">Air System — Technical Water</p>
        </div>

        {/* Work order info */}
        <div className="card flex flex-col gap-2">
          <Row label="เลขที่ใบงาน" value={info.order_no || `#${info.id}`} />
          <Row label="ประเภทงาน"   value={info.type} />
          {info.client_name && <Row label="รพ. / ลูกค้า" value={info.client_name} />}
          {info.site_name   && <Row label="Site"         value={info.site_name} />}
          <Row label="วันที่สร้าง" value={dayjs(info.created_at).format('DD/MM/YYYY HH:mm')} />
        </div>

        {/* Units list */}
        {(info.units || []).length > 0 && (
          <div className="card">
            <p className="text-sm font-semibold text-ink mb-2">
              รายการอุปกรณ์ ({info.units.length})
            </p>
            <div className="flex flex-col gap-2">
              {info.units.map((u, i) => (
                <div key={i} className="border border-line rounded-xl px-3 py-2 bg-page">
                  <p className="text-sm font-medium text-ink">{u.asset_code}</p>
                  <p className="text-xs text-ink-muted">{u.unit_name}</p>
                  <p className="text-xs text-ink-muted/70">
                    {[u.room_name, u.floor_name, u.building_name].filter(Boolean).join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Signer form */}
        <div className="card flex flex-col gap-4">
          <div>
            <label className="label">ชื่อ-นามสกุล *</label>
            <input
              className="input"
              placeholder="ชื่อ-นามสกุลผู้ลงนาม"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">ตำแหน่ง (ถ้ามี)</label>
            <input
              className="input"
              placeholder="เช่น หัวหน้าพยาบาล"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
          </div>

          {submitError && (
            <p className="text-xs text-danger bg-danger-soft rounded-input px-3 py-2">{submitError}</p>
          )}

          {!showPad ? (
            <button
              onClick={() => {
                if (!signerName.trim()) { setSubmitError('กรุณาระบุชื่อ-นามสกุล'); return }
                setSubmitError('')
                setShowPad(true)
              }}
              className="btn-primary w-full py-3 text-base"
            >
              ลงลายเซ็น
            </button>
          ) : (
            <>
              <p className="label">ลายเซ็น *</p>
              <SignaturePad
                onSave={handleSave}
                onCancel={() => setShowPad(false)}
              />
              {submitting && (
                <p className="text-xs text-ink-muted text-center mt-1">กำลังบันทึก...</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-ink-muted">{label}</span>
      <span className="text-ink font-medium text-right max-w-[60%]">{value || '-'}</span>
    </div>
  )
}
