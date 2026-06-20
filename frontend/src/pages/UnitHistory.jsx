import { useState, useEffect } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';

const WT_LABEL = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลม' };
const fmt = (d) => (d ? new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

export default function UnitHistory() {
  const [codes, setCodes] = useState([]);
  const [code, setCode] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/simple-wo/unit-codes').then((r) => setCodes(r.data || [])).catch(() => {});
  }, []);

  async function lookup(c) {
    const q = (c ?? code).trim();
    if (!q) return;
    setLoading(true); setErr(''); setData(null);
    try { setData((await api.get('/simple-wo/unit-history', { params: { code: q } })).data); }
    catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">ประวัติการล้างรายเครื่อง</h1>
          <p className="text-sm text-gray-500 mt-0.5">เลือก/พิมพ์รหัสเครื่อง → ดูประวัติล้างทั้งหมด + จำนวนครั้งปีนี้</p>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); lookup(); }} className="flex gap-2">
          <input list="unit-codes" value={code} onChange={(e) => setCode(e.target.value)}
            className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="เลือกหรือพิมพ์รหัสเครื่อง" />
          <datalist id="unit-codes">{codes.map((c) => <option key={c} value={c} />)}</datalist>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">ดูประวัติ</button>
        </form>

        {err && <p className="text-sm text-red-600">{err}</p>}
        {loading && <p className="text-center text-gray-400 py-8">กำลังโหลด…</p>}

        {data && (
          <>
            <div className="bg-white border rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono font-bold text-gray-800">{data.code}</span>
                <span className="text-sm text-gray-500">ล้างทั้งหมด <b className="text-gray-800">{data.total}</b> ครั้ง</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="text-xs bg-blue-50 text-blue-700 border border-blue-100 rounded-lg px-2.5 py-1">
                  ปีนี้ {data.thisYearCount} ครั้ง
                </span>
                {Object.entries(data.byType || {}).map(([t, n]) => (
                  <span key={t} className="text-xs bg-slate-50 text-slate-600 border border-slate-200 rounded-lg px-2.5 py-1">
                    {WT_LABEL[t] || t} {n}
                  </span>
                ))}
              </div>
            </div>

            {data.items.length === 0 ? (
              <p className="text-center text-gray-400 py-8">ยังไม่มีประวัติ</p>
            ) : (
              <div className="bg-white border rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500 border-b bg-gray-50">
                    <th className="py-2.5 px-4">วันที่</th><th className="py-2.5 px-2">ประเภท</th>
                    <th className="py-2.5 px-2">สถานที่</th><th className="py-2.5 px-2">ช่าง</th><th className="py-2.5 px-2">ใบงาน</th>
                  </tr></thead>
                  <tbody>
                    {data.items.map((it) => (
                      <tr key={it.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="py-2.5 px-4">{fmt(it.work_date)}</td>
                        <td className="py-2.5 px-2 text-gray-600">{WT_LABEL[it.work_type] || it.work_type || '—'}</td>
                        <td className="py-2.5 px-2 text-gray-500">{[it.building, it.room].filter(Boolean).join(' › ') || '—'}</td>
                        <td className="py-2.5 px-2 text-gray-500">{it.tech_name || '—'}</td>
                        <td className="py-2.5 px-2">
                          <a href={`/simple-wo/${it.id}`} className="text-blue-600 hover:underline font-mono text-xs">{it.wo_number}</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
