import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';

const WT = [{ key: 'major', label: 'ล้างใหญ่' }, { key: 'minor', label: 'ล้างย่อย' }, { key: 'fan', label: 'พัดลม' }];
const WTL = Object.fromEntries(WT.map((w) => [w.key, w.label]));
const ZONES = ['PTS1', 'PTS2'];
const monthLabel = (m) => `${m.slice(5)}/${Number(m.slice(0, 4)) + 543}`;

export default function WashAdjust() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ month: '', zone: 'PTS1', work_type: 'major', delta: '', note: '' });

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setRows((await api.get('/wash-adjust')).data); }
    catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    if (!form.month) { setErr('ระบุเดือน'); return; }
    setSaving(true); setErr('');
    try {
      await api.post('/wash-adjust', {
        month: form.month, zone: form.zone || null, work_type: form.work_type,
        delta: parseInt(form.delta, 10), note: form.note,
      });
      setForm((f) => ({ ...f, delta: '', note: '' }));
      load();
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  }
  async function del(id) {
    if (!confirm('ลบรายการปรับยอดนี้?')) return;
    try { await api.delete(`/wash-adjust/${id}`); load(); }
    catch (e) { setErr(e.response?.data?.error || e.message); }
  }

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">ปรับยอดล้าง (ย้อนหลัง / โยกเดือน)</h1>
          <p className="text-sm text-gray-500 mt-0.5">ใส่ยอดที่ล้างไปแล้ว (+) หรือลด (−) ต่อเดือน × โซน × ประเภท · โยกเดือน = +เดือนปลายทาง −เดือนต้นทาง</p>
        </div>

        <form onSubmit={save} className="bg-white border rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">เดือน</label>
              <input type="month" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.month} onChange={set('month')} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">โซน</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.zone} onChange={set('zone')}>
                <option value="">ทุกโซน</option>{ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">ประเภท</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.work_type} onChange={set('work_type')}>
                {WT.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">จำนวน (+เพิ่ม / −ลด)</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="numeric" value={form.delta} onChange={set('delta')} placeholder="เช่น 10 หรือ -5" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm text-gray-600 mb-1">หมายเหตุ</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.note} onChange={set('note')} placeholder="เช่น โยกจาก มิ.ย." />
            </div>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end">
            <button disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">{saving ? 'กำลังบันทึก…' : 'บันทึก'}</button>
          </div>
        </form>

        {loading ? <p className="text-center text-gray-400 py-8">กำลังโหลด…</p>
          : rows.length === 0 ? <p className="text-center text-gray-400 py-8">ยังไม่มีรายการปรับยอด</p>
          : (
            <div className="bg-white border rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500 border-b bg-gray-50">
                  <th className="py-2.5 px-3">เดือน</th><th className="py-2.5 px-2">โซน</th><th className="py-2.5 px-2">ประเภท</th>
                  <th className="py-2.5 px-2 text-right">จำนวน</th><th className="py-2.5 px-2">หมายเหตุ</th><th></th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-medium">{monthLabel(r.month)}</td>
                      <td className="py-2.5 px-2 text-gray-600">{r.zone || 'ทุกโซน'}</td>
                      <td className="py-2.5 px-2 text-gray-600">{WTL[r.work_type] || r.work_type || 'รวม'}</td>
                      <td className={`py-2.5 px-2 text-right font-semibold ${r.delta < 0 ? 'text-red-500' : 'text-emerald-600'}`}>{r.delta > 0 ? '+' : ''}{r.delta}</td>
                      <td className="py-2.5 px-2 text-gray-400">{r.note || ''}</td>
                      <td className="py-2.5 px-2 text-right"><button onClick={() => del(r.id)} className="text-red-500 hover:underline text-xs">ลบ</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </Layout>
  );
}
