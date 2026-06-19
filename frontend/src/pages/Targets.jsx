import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';

const WT = [
  { key: '',      label: 'รวมทุกประเภท' },
  { key: 'major', label: 'ล้างใหญ่' },
  { key: 'minor', label: 'ล้างย่อย' },
  { key: 'fan',   label: 'พัดลม' },
];
const WT_LABEL = Object.fromEntries(WT.map((w) => [w.key, w.label]));

export default function Targets() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ zone: '', work_type: '', monthly_target: '', note: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setRows((await api.get('/targets')).data); }
    catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(e) {
    e.preventDefault();
    if (!form.zone.trim()) { setErr('ระบุโซน'); return; }
    setSaving(true); setErr('');
    try {
      await api.post('/targets', {
        zone: form.zone.trim(),
        work_type: form.work_type || null,
        monthly_target: form.monthly_target,
        note: form.note,
      });
      setForm({ zone: '', work_type: '', monthly_target: '', note: '' });
      load();
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  }

  async function del(id) {
    if (!confirm('ลบเป้าหมายนี้?')) return;
    try { await api.delete(`/targets/${id}`); load(); }
    catch (e) { setErr(e.response?.data?.error || e.message); }
  }

  function edit(r) {
    setForm({ zone: r.zone, work_type: r.work_type || '', monthly_target: String(r.monthly_target), note: r.note || '' });
  }

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">เป้าหมายล้างต่อเดือน</h1>
          <p className="text-sm text-gray-500 mt-0.5">ตั้งจำนวนที่ต้องล้างให้ได้ต่อเดือน แยกตามโซน + ประเภท (ตามสัญญา)</p>
        </div>

        {/* form */}
        <form onSubmit={save} className="bg-white border rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">โซน / สถานที่</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.zone}
                onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))}
                placeholder="เช่น PTS1, PTS2, คลินิกบางพระ" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">ประเภท</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.work_type}
                onChange={(e) => setForm((f) => ({ ...f, work_type: e.target.value }))}>
                {WT.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">เป้า/เดือน (เครื่อง)</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="numeric" value={form.monthly_target}
                onChange={(e) => setForm((f) => ({ ...f, monthly_target: e.target.value }))} placeholder="เช่น 120" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">หมายเหตุ</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="(ไม่บังคับ)" />
            </div>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end">
            <button disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'บันทึกเป้าหมาย'}
            </button>
          </div>
          <p className="text-xs text-gray-400">บันทึกซ้ำโซน+ประเภทเดิม = แก้ค่าเดิม</p>
        </form>

        {/* list */}
        {loading ? <p className="text-center text-gray-400 py-8">กำลังโหลด…</p>
          : rows.length === 0 ? <p className="text-center text-gray-400 py-8">ยังไม่มีเป้าหมาย</p>
          : (
            <div className="bg-white border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500 border-b bg-gray-50">
                  <th className="py-2.5 px-4">โซน</th><th className="py-2.5 px-2">ประเภท</th>
                  <th className="py-2.5 px-2 text-right">เป้า/เดือน</th><th className="py-2.5 px-2">หมายเหตุ</th><th></th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2.5 px-4 font-medium">{r.zone}</td>
                      <td className="py-2.5 px-2 text-gray-600">{WT_LABEL[r.work_type || ''] || r.work_type}</td>
                      <td className="py-2.5 px-2 text-right font-semibold">{r.monthly_target}</td>
                      <td className="py-2.5 px-2 text-gray-400">{r.note || ''}</td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        <button onClick={() => edit(r)} className="text-blue-600 hover:underline text-xs mr-3">แก้</button>
                        <button onClick={() => del(r.id)} className="text-red-500 hover:underline text-xs">ลบ</button>
                      </td>
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
