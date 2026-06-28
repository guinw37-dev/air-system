import { useState, useEffect, useCallback } from 'react'
import { MessageCircle, Save, Send, CheckCircle2, AlertCircle } from 'lucide-react'
import Layout from '../components/Layout'
import api from '../api/client'

export default function LineSettings() {
  const [cfg, setCfg] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [token, setToken] = useState('')
  const [savingToken, setSavingToken] = useState(false)
  const [gids, setGids] = useState({})        // id → group id (editable)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setErr('')
    try {
      const r = await api.get('/line-admin/config')
      setCfg(r.data)
      setGids(Object.fromEntries((r.data.branches || []).map((b) => [b.id, b.line_group_id || ''])))
    } catch (e) { setErr(e.response?.data?.error || e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500) }

  const saveToken = async () => {
    setSavingToken(true); setErr('')
    try { await api.put('/line-admin/token', { token }); setToken(''); flash('บันทึก token แล้ว'); await load() }
    catch (e) { setErr(e.response?.data?.error || e.message) } finally { setSavingToken(false) }
  }
  const saveGid = async (id) => {
    setBusyId(id); setErr('')
    try { await api.put(`/line-admin/branch/${id}`, { line_group_id: gids[id] }); flash('บันทึก group id แล้ว') }
    catch (e) { setErr(e.response?.data?.error || e.message) } finally { setBusyId(null) }
  }
  const test = async (id) => {
    setBusyId(id); setErr('')
    try { await api.post(`/line-admin/test/${id}`); flash('ส่งทดสอบเข้ากลุ่มแล้ว') }
    catch (e) { setErr(e.response?.data?.error || e.message) } finally { setBusyId(null) }
  }

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="text-green-600" size={22} />
          <h1 className="text-xl font-bold text-slate-900">ตั้งค่า LINE แจ้งเตือน</h1>
        </div>

        {err && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-sm text-red-700 flex items-center gap-2"><AlertCircle size={16} />{err}</div>}
        {msg && <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2 text-sm text-emerald-700 flex items-center gap-2"><CheckCircle2 size={16} />{msg}</div>}

        {!cfg ? <p className="text-center text-slate-400 py-12">กำลังโหลด…</p> : (
          <>
            {/* token */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h2 className="font-bold text-slate-800 mb-1">Channel Access Token</h2>
              <p className="text-xs text-slate-500 mb-3">
                สถานะ: {cfg.hasToken
                  ? <span className="text-emerald-600 font-medium">มีแล้ว ({cfg.tokenSource === 'db' ? 'จากเว็บ' : 'จาก env'}) {cfg.tokenPreview}</span>
                  : <span className="text-amber-600 font-medium">ยังไม่ได้ตั้ง</span>}
              </p>
              <div className="flex gap-2">
                <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="วาง Channel Access Token ใหม่"
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                <button onClick={saveToken} disabled={savingToken || !token.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  <Save size={15} /> บันทึก
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">บันทึกแล้วใช้ได้ทันที ไม่ต้อง redeploy · เว้นว่างแล้วบันทึก = ล้าง (กลับไปใช้ env)</p>
            </div>

            {/* per-branch group id */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h2 className="font-bold text-slate-800 mb-1">Group ID ต่อสาขา</h2>
              <p className="text-xs text-slate-500 mb-3">เชิญบอทเข้ากลุ่ม → พิมพ์ในกลุ่ม → บอทตอบ group id → วางที่นี่</p>
              <div className="space-y-2">
                {cfg.branches.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center gap-2 border-b border-slate-50 py-2">
                    <span className="w-40 text-sm text-slate-700 truncate">{b.name}</span>
                    <input value={gids[b.id] || ''} onChange={(e) => setGids({ ...gids, [b.id]: e.target.value })}
                      placeholder="Cxxxxxxxx (group id)" className="flex-1 min-w-[180px] border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
                    <button onClick={() => saveGid(b.id)} disabled={busyId === b.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50"><Save size={14} /> บันทึก</button>
                    <button onClick={() => test(b.id)} disabled={busyId === b.id || !gids[b.id]}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50"><Send size={14} /> ทดสอบ</button>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-slate-400">แจ้งเตือนอัตโนมัติทุกวัน 08:45 (เฉพาะสาขาที่ตั้ง group id)</p>
          </>
        )}
      </div>
    </Layout>
  )
}
