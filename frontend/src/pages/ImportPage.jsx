import { useState, useRef } from 'react'
import { Upload, Download, CheckCircle, AlertCircle, FileSpreadsheet, X, Server } from 'lucide-react'
import Layout from '../components/Layout'
import api, { uploadsBase } from '../api/client'
import { useAuthStore } from '../store/auth'

export default function ImportPage() {
  const [file, setFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [serverImporting, setServerImporting] = useState(false)
  const [result, setResult] = useState(null)
  const fileInputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const pickFile = (f) => {
    if (!f) return
    if (!f.name.match(/\.(xlsx|xls|csv)$/i)) {
      alert('รองรับเฉพาะ .xlsx, .xls, .csv')
      return
    }
    setFile(f)
    setResult(null)
  }

  const downloadTemplate = async () => {
    try {
      // Via axios so X-Branch is sent (a raw window.open ?token= URL omits it →
      // requireBranch 400 for a branch user).
      const res = await api.get('/import/template/ac-data', { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url; a.download = 'template-ac-data.xlsx'
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch {
      alert('ดาวน์โหลด template ไม่สำเร็จ')
    }
  }

  const doImport = async () => {
    if (!file) return
    setImporting(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await api.post('/import/ac-data', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResult(r.data)
    } catch (err) {
      setResult({ error: err.response?.data?.error || 'เกิดข้อผิดพลาด' })
    } finally {
      setImporting(false)
    }
  }

  const doServerImport = async () => {
    if (!confirm('ใช้ไฟล์ EXCEL_PATH บน server?')) return
    setServerImporting(true)
    setResult(null)
    try {
      const r = await api.post('/import/ac-data/server')
      setResult(r.data)
    } catch (err) {
      setResult({ error: err.response?.data?.error || 'เกิดข้อผิดพลาด' })
    } finally {
      setServerImporting(false)
    }
  }

  return (
    <Layout title="Import ข้อมูล">
      <div className="p-6 flex flex-col gap-5 max-w-3xl mx-auto">

        {/* Info card */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-ink text-sm">Import ข้อมูลอุปกรณ์ (แอร์ + พัดลม)</h3>
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Download className="h-4 w-4" /> ดาวน์โหลด Template
            </button>
          </div>
          <div className="bg-primary-soft rounded-xl px-4 py-3 text-xs text-primary space-y-1">
            <p className="font-semibold mb-1">รายละเอียด</p>
            <p>• ระบบสร้าง Client / Site / Building / Floor / Room / Unit อัตโนมัติ</p>
            <p>• รองรับทั้งแอร์และพัดลมในไฟล์เดียวกัน</p>
            <p>• asset_code คือ unique key — ถ้ามีอยู่แล้วจะ update, ถ้าไม่มีจะ insert</p>
            <p>• แถวที่ไม่ผ่านจะถูกข้ามและรายงานใน errors[]</p>
          </div>
        </div>

        {/* File upload */}
        <div
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors cursor-pointer ${
            dragging ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary'
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files[0]) }}
          onClick={() => fileInputRef.current.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => pickFile(e.target.files[0])}
          />
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <FileSpreadsheet className="h-8 w-8 text-success shrink-0" />
              <div className="text-left">
                <p className="font-medium text-ink text-sm">{file.name}</p>
                <p className="text-xs text-ink-muted">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setFile(null); setResult(null) }}
                className="text-ink-muted hover:text-danger"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div>
              <Upload className="h-10 w-10 text-line mx-auto mb-2" />
              <p className="text-sm text-ink-muted">ลาก file มาวาง หรือ คลิกเพื่อเลือก</p>
              <p className="text-xs text-ink-muted/60 mt-1">.xlsx, .xls, .csv</p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={doImport}
            disabled={!file || importing}
            className="btn-primary flex-1 text-center flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {importing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                กำลัง Import...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Import ไฟล์
              </>
            )}
          </button>

          <button
            onClick={doServerImport}
            disabled={serverImporting}
            className="btn-secondary flex items-center gap-2 disabled:opacity-50 text-sm"
            title="ใช้ไฟล์ EXCEL_PATH บน server"
          >
            {serverImporting ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-gray-600" />
            ) : (
              <Server className="h-4 w-4" />
            )}
            Server Import
          </button>
        </div>

        {/* Result */}
        {result && (
          <div className={`card ${result.error ? 'border border-danger/30 bg-danger-soft' : 'border border-success/30 bg-success-soft'}`}>
            {result.error ? (
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-danger shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-danger text-sm">เกิดข้อผิดพลาด</p>
                  <p className="text-xs text-danger/80 mt-1">{result.error}</p>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle className="h-5 w-5 text-success" />
                  <p className="font-semibold text-success text-sm">Import สำเร็จ</p>
                </div>

                {/* Counts */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                  {[
                    { key: 'clients',   label: 'Clients' },
                    { key: 'sites',     label: 'Sites' },
                    { key: 'buildings', label: 'อาคาร' },
                    { key: 'floors',    label: 'ชั้น' },
                    { key: 'rooms',     label: 'ห้อง' },
                    { key: 'units_ac',  label: 'แอร์' },
                    { key: 'units_fan', label: 'พัดลม' },
                    { key: 'skipped',   label: 'ข้าม' },
                  ].filter((item) => result[item.key] !== undefined).map(({ key, label }) => (
                    <div key={key} className="bg-surface/60 rounded-xl p-3 text-center">
                      <p className="text-xl font-bold text-ink">{result[key]}</p>
                      <p className="text-xs text-ink-muted mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                {/* needs_recode */}
                {result.needs_recode?.length > 0 && (
                  <div className="bg-warn-soft border border-warn/30 rounded-xl p-3 mb-3">
                    <p className="text-xs font-semibold text-warn mb-1.5">
                      ⚠ Asset codes ที่ต้องแก้รหัส ({result.needs_recode.length} รายการ)
                    </p>
                    <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                      {result.needs_recode.map((code) => (
                        <span key={code} className="text-xs font-mono bg-warn/10 text-warn px-2 py-0.5 rounded">{code}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* fans_unassigned */}
                {result.fans_unassigned > 0 && (
                  <div className="bg-warn-soft border border-warn/30 rounded-xl p-3 mb-3">
                    <p className="text-xs text-warn">
                      ⚠ พัดลม {result.fans_unassigned} ตัว ไม่ได้ assign ห้อง
                    </p>
                  </div>
                )}

                {/* errors */}
                {result.errors?.length > 0 && (
                  <div className="bg-warn-soft border border-warn/30 rounded-xl p-3">
                    <p className="text-xs font-semibold text-warn mb-1.5">
                      ⚠ มีข้อผิดพลาด {result.errors.length} รายการ (แถวที่ไม่ผ่านถูกข้ามไป)
                    </p>
                    <div className="max-h-40 overflow-y-auto">
                      {result.errors.map((e, i) => (
                        <p key={i} className="text-xs text-warn leading-relaxed">• {typeof e === 'string' ? e : JSON.stringify(e)}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}
