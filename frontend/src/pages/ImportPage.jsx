import { useState, useRef } from 'react'
import { Upload, Download, CheckCircle, AlertCircle, FileSpreadsheet, X } from 'lucide-react'
import Layout from '../components/Layout'
import api, { uploadsBase } from '../api/client'
import { useAuthStore } from '../store/auth'

const TABS = [
  { key: 'ac-units',     label: 'ข้อมูลเครื่องแอร์',   role: ['admin', 'owner'] },
  { key: 'work-history', label: 'ประวัติงานเก่า',        role: ['admin'] },
  { key: 'pts-excel',    label: 'ไฟล์ Excel แบบเดิม',   role: ['admin', 'owner'] },
]

const PTS_INFO = (
  <div className="bg-blue-50 rounded-xl px-4 py-3 text-xs text-blue-700 space-y-1">
    <p className="font-semibold mb-1">ไฟล์ Excel แบบเดิม (สถานที่ล้างแอร์ + พัดลม.xlsx)</p>
    <p>• รองรับ format เดิมโดยตรง — ไม่ต้องแก้ไข format</p>
    <p>• Sheet 1 = แอร์, Sheet 2 = พัดลม (ระบบจะ import ทั้งคู่)</p>
    <p>• วันที่ปีพ.ศ. (เช่น 2569-01-27) จะแปลงเป็น ค.ศ. อัตโนมัติ</p>
    <p>• "แอร์เสีย" จะตั้งสถานะ broken, "ไม่มีฟิลเตอร์" จะข้ามแถวนั้น</p>
    <p>• สร้าง Hospital / Building / Floor / Dept อัตโนมัติ</p>
    <p>• ใบงานแต่ละวัน + ประเภทเดียวกัน จะรวมเป็นใบงานเดียว</p>
  </div>
)

const COLUMNS = {
  'ac-units': [
    { col: 'hospital',            req: true,  desc: 'ชื่อโรงพยาบาล (จะสร้างใหม่ถ้าไม่มี)' },
    { col: 'building',            req: true,  desc: 'ชื่ออาคาร' },
    { col: 'floor',               req: true,  desc: 'ชั้น เช่น ชั้น 1, B2' },
    { col: 'department',          req: true,  desc: 'แผนก / ห้อง' },
    { col: 'ac_code',             req: true,  desc: 'รหัสเครื่องแอร์ (unique key)' },
    { col: 'ac_name',             req: false, desc: 'ชื่อ/รายละเอียด' },
    { col: 'ac_type',             req: false, desc: 'ประเภท เช่น FCU, AHU, แอร์น้ำยา' },
    { col: 'brand',               req: false, desc: 'ยี่ห้อ/Model' },
    { col: 'capacity_btu',        req: false, desc: 'ขนาด BTU (ตัวเลข)' },
    { col: 'pm_interval_months',  req: false, desc: 'รอบ PM (เดือน) default = 3' },
  ],
  'work-history': [
    { col: 'ac_code',    req: true,  desc: 'รหัสเครื่องแอร์ (ต้องมีในระบบแล้ว)' },
    { col: 'work_type',  req: true,  desc: 'major / minor / fan' },
    { col: 'work_date',  req: true,  desc: 'วันที่ทำงาน YYYY-MM-DD หรือ DD/MM/YYYY' },
    { col: 'tech1_name', req: false, desc: 'ชื่อช่าง (ต้องตรงกับชื่อในระบบ)' },
    { col: 'tech2_name', req: false, desc: 'ชื่อช่าง 2 (ถ้ามี)' },
  ],
}

const NOTES = {
  'ac-units': [
    'รหัสเครื่องแอร์ (ac_code) คือ unique key — ถ้ามีอยู่แล้วจะ update, ถ้าไม่มีจะ insert ใหม่',
    'Hospital / Building / Floor / Department จะถูกสร้างอัตโนมัติถ้าไม่มีในระบบ',
    'ชื่อต้องเขียนเหมือนกันทุกตัวอักษร (case-insensitive) เพื่อให้รวมเข้าในกลุ่มเดียวกัน',
    'แถวที่ไม่มี ac_code จะถูกข้ามโดยอัตโนมัติ',
  ],
  'work-history': [
    'แต่ละแถวคือ 1 เครื่องแอร์ที่ถูกล้าง — ถ้า ac_code + work_date + work_type + tech1 เหมือนกัน จะรวมเป็นใบงานเดียว',
    'ac_code ต้องมีอยู่ในระบบแล้ว (import เครื่องแอร์ก่อน)',
    'work_date รองรับ: YYYY-MM-DD หรือ DD/MM/YYYY',
    'งานที่ import จะมีสถานะ "อนุมัติ" ทันที และจะ update next_pm_date ของเครื่องแอร์อัตโนมัติ',
    'ใบงานจะใช้รหัส IMP-YYYYMMDD-XXXX',
  ],
}

export default function ImportPage() {
  const user = useAuthStore((s) => s.user)
  const [tab, setTab] = useState('ac-units')
  const [file, setFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const fileInputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const visibleTabs = TABS.filter((t) => t.role.includes(user?.role))

  const pickFile = (f) => {
    if (!f) return
    if (!f.name.match(/\.(xlsx|xls|csv)$/i)) {
      alert('รองรับเฉพาะ .xlsx, .xls, .csv')
      return
    }
    setFile(f)
    setResult(null)
  }

  const downloadTemplate = () => {
    const token = useAuthStore.getState().token
    const base = uploadsBase || ''
    window.open(`${base}/api/import/template/${tab}?token=${token}`, '_blank')
  }

  const doImport = async () => {
    if (!file) return
    setImporting(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await api.post(`/import/${tab}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setResult(r.data)
    } catch (err) {
      setResult({ error: err.response?.data?.error || 'เกิดข้อผิดพลาด' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <Layout title="Import ข้อมูล">
      <div className="p-6 flex flex-col gap-5 max-w-3xl mx-auto">

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setFile(null); setResult(null) }}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Column guide / info */}
        <div className="card">
          {tab === 'pts-excel' ? (
            PTS_INFO
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800 text-sm">คอลัมน์ที่ต้องการ (Row 1 = header)</h3>
                <button
                  onClick={downloadTemplate}
                  className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                >
                  <Download className="h-4 w-4" /> ดาวน์โหลด Template
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left py-2 px-3 font-medium text-gray-500">Column name</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-500">จำเป็น</th>
                      <th className="text-left py-2 px-3 font-medium text-gray-500">คำอธิบาย</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {COLUMNS[tab].map((c) => (
                      <tr key={c.col}>
                        <td className="py-2 px-3 font-mono text-blue-700">{c.col}</td>
                        <td className="py-2 px-3">
                          {c.req
                            ? <span className="text-red-500 font-medium">ต้องมี</span>
                            : <span className="text-gray-400">ไม่บังคับ</span>
                          }
                        </td>
                        <td className="py-2 px-3 text-gray-600">{c.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 bg-blue-50 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-blue-700 mb-1.5">หมายเหตุ</p>
                {NOTES[tab].map((n, i) => (
                  <p key={i} className="text-xs text-blue-700 leading-relaxed">• {n}</p>
                ))}
              </div>
            </>
          )}
        </div>

        {/* File upload */}
        <div
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors ${
            dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-300'
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
              <FileSpreadsheet className="h-8 w-8 text-green-600 shrink-0" />
              <div className="text-left">
                <p className="font-medium text-gray-800 text-sm">{file.name}</p>
                <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setFile(null); setResult(null) }}
                className="text-gray-400 hover:text-red-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div>
              <Upload className="h-10 w-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">ลาก file มาวาง หรือ คลิกเพื่อเลือก</p>
              <p className="text-xs text-gray-400 mt-1">.xlsx, .xls, .csv</p>
            </div>
          )}
        </div>

        {/* Import button */}
        <button
          onClick={doImport}
          disabled={!file || importing}
          className="btn-primary text-center flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {importing ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
              กำลัง Import...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              {tab === 'ac-units' ? 'Import เครื่องแอร์' : tab === 'pts-excel' ? 'Import ไฟล์ Excel แบบเดิม' : 'Import ประวัติงาน'}
            </>
          )}
        </button>

        {/* Result */}
        {result && (
          <div className={`card ${result.error ? 'border border-red-200 bg-red-50' : 'border border-green-200 bg-green-50'}`}>
            {result.error ? (
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-red-700 text-sm">เกิดข้อผิดพลาด</p>
                  <p className="text-xs text-red-600 mt-1">{result.error}</p>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <p className="font-semibold text-green-800 text-sm">Import สำเร็จ</p>
                </div>
                <div className="flex gap-5 flex-wrap text-sm mb-3">
                  {result.created !== undefined && (
                    <span className="text-green-700">✅ สร้างใหม่ <strong>{result.created}</strong> รายการ</span>
                  )}
                  {result.updated !== undefined && (
                    <span className="text-blue-700">🔄 อัปเดต <strong>{result.updated}</strong> รายการ</span>
                  )}
                  {result.skipped !== undefined && result.skipped > 0 && (
                    <span className="text-gray-500">⏭ ข้าม <strong>{result.skipped}</strong> แถว</span>
                  )}
                  {result.ac_created !== undefined && (
                    <span className="text-green-700">✅ แอร์ใหม่ <strong>{result.ac_created}</strong> ตัว</span>
                  )}
                  {result.ac_updated !== undefined && (
                    <span className="text-blue-700">🔄 แอร์อัปเดต <strong>{result.ac_updated}</strong> ตัว</span>
                  )}
                  {result.wos_created !== undefined && (
                    <span className="text-purple-700">📋 ใบงาน <strong>{result.wos_created}</strong> ใบ</span>
                  )}
                </div>
                {result.errors?.length > 0 && (
                  <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
                    <p className="text-xs font-semibold text-orange-700 mb-1.5">
                      ⚠ มีข้อผิดพลาด {result.errors.length} รายการ (แถวที่ไม่ผ่านถูกข้ามไป)
                    </p>
                    <div className="max-h-40 overflow-y-auto">
                      {result.errors.map((e, i) => (
                        <p key={i} className="text-xs text-orange-700 leading-relaxed">• {e}</p>
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
