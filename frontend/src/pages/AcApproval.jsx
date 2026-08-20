import { useState, useEffect } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';

// ซ่อมรออนุมัติ — ใบงานซ่อมแอร์ที่ออก Memo ขออะไหล่แล้ว: ติดตามสถานะ + ปริ้น
// Memo (แนบใบงาน) และออกใบ Report ส่งมอบเมื่อปิดงานแล้ว
const STATUS_LABEL = {
  Register: 'แจ้งซ่อม', Assign: 'รับงาน', 'Work On': 'กำลังซ่อม',
  'Wait Parts': 'รออะไหล่', Clear: 'ซ่อมเสร็จ', Close: 'ปิดงาน', Cancel: 'ยกเลิก',
};
const STATUS_COLOR = {
  Register: 'bg-gray-100 text-gray-700', 'Work On': 'bg-yellow-100 text-yellow-800',
  'Wait Parts': 'bg-orange-100 text-orange-800', Clear: 'bg-green-100 text-green-800',
  Close: 'bg-green-100 text-green-800', Cancel: 'bg-red-100 text-red-700',
  Assign: 'bg-blue-100 text-blue-800',
};
const DONE = ['Clear', 'Close'];

function fmt(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear() + 543}`;
}
const totalOf = (parts) => (Array.isArray(parts) ? parts : [])
  .reduce((s, p) => s + (parseFloat(p.qty) || 0) * (parseFloat(p.unit_price) || 0), 0);

export default function AcApproval() {
  const [memos, setMemos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('pending');   // pending = งานยังไม่เสร็จ | done | all
  const [opening, setOpening] = useState(null);

  useEffect(() => {
    api.get('/ac-memos')
      .then((r) => setMemos(Array.isArray(r.data) ? r.data : []))
      .catch((e) => setErr(e.response?.status === 400 ? 'เลือกสาขาก่อน' : (e.response?.data?.error || e.message)))
      .finally(() => setLoading(false));
  }, []);

  const shown = memos.filter((m) => (
    tab === 'pending' ? !DONE.includes(m.job_status) && m.job_status !== 'Cancel'
    : tab === 'done' ? DONE.includes(m.job_status)
    : true
  ));
  const counts = {
    pending: memos.filter((m) => !DONE.includes(m.job_status) && m.job_status !== 'Cancel').length,
    done: memos.filter((m) => DONE.includes(m.job_status)).length,
    all: memos.length,
  };

  async function openPdf(kind, m) {
    setOpening(`${kind}-${m.id}`);
    try {
      const url = kind === 'memo' ? `/ac-memos/${m.id}/pdf` : `/ac-repair-jobs/${m.job_id}/pdf`;
      const res = await api.get(url, { responseType: 'blob' });
      window.open(URL.createObjectURL(res.data), '_blank');
    } catch { alert('เปิด PDF ไม่สำเร็จ'); }
    finally { setOpening(null); }
  }

  return (
    <Layout>
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div className="bg-gradient-to-r from-sky-600 to-blue-700 rounded-2xl px-5 py-4">
        <h1 className="text-xl font-bold text-white">📄 ซ่อมรออนุมัติ (Memo อะไหล่)</h1>
        <p className="text-sm text-sky-100 mt-0.5">ใบงานที่ออก Memo ขออะไหล่แล้ว · ปริ้น Memo แนบใบงาน และออก Report เมื่อปิดงาน</p>
      </div>

      <div className="flex gap-1">
        {[['pending', 'รออนุมัติ / กำลังซ่อม'], ['done', 'ปิดงานแล้ว'], ['all', 'ทั้งหมด']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-all ${tab === k ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {label} ({counts[k]})
          </button>
        ))}
      </div>

      {loading ? <p className="text-center text-gray-400 py-12">กำลังโหลด…</p>
        : err ? <p className="text-center text-amber-600 py-12">{err}</p>
        : shown.length === 0 ? <p className="text-center text-gray-400 py-12">ไม่มีรายการ</p>
        : (
        <div className="space-y-2">
          {shown.map((m) => {
            const total = totalOf(m.parts);
            const isDone = DONE.includes(m.job_status);
            return (
              <div key={m.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold text-sky-700">{m.memo_number}</span>
                    {m.job_number && <span className="text-xs text-gray-400 border rounded px-1.5 py-0.5 font-mono">{m.job_number}</span>}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[m.job_status] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[m.job_status] || m.job_status || '—'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mt-1">{m.subject}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {[m.building && `อาคาร ${m.building}`, m.floor && `ชั้น ${m.floor}`, m.department].filter(Boolean).join(' › ') || '—'}
                    {' · '}ออกเมื่อ {fmt(m.created_at)}
                    {total > 0 && <> · <b className="text-sky-700">฿{total.toLocaleString('th-TH')}</b></>}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => openPdf('memo', m)} disabled={!!opening}
                    className="px-3 py-1.5 border border-sky-300 text-sky-700 bg-sky-50 rounded-lg text-sm hover:bg-sky-100 disabled:opacity-50">
                    {opening === `memo-${m.id}` ? '…' : '🖨️ Memo'}
                  </button>
                  {isDone ? (
                    <button onClick={() => openPdf('report', m)} disabled={!!opening}
                      className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">
                      {opening === `report-${m.id}` ? '…' : '📑 Report ส่งมอบ'}
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 text-xs text-gray-400 self-center">Report ออกได้เมื่อปิดงาน</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </Layout>
  );
}
