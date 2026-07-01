import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import Layout from '../components/Layout';

const ZONES = ['PTS1', 'PTS2'];
const monthLabel = (m) => (m ? `${m.slice(5)}/${Number(m.slice(0, 4)) + 543}` : '—');
const thisMonth = () => new Date().toISOString().slice(0, 7);
const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };

const EMPTY = {
  zone: '', month: thisMonth(), week_no: '', day_from: '', day_to: '',
  target_major: '', target_minor: '', target_fan: '', note: '',
};

export default function WeekConfig() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [filterZone, setFilterZone] = useState('');
  const [filterMonth, setFilterMonth] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setRows((await api.get('/week-config')).data); }
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
      await api.post('/week-config', {
        zone: form.zone || null,
        month: form.month,
        week_no: form.week_no,
        day_from: form.day_from,
        day_to: form.day_to,
        target_major: form.target_major,
        target_minor: form.target_minor,
        target_fan: form.target_fan,
        note: form.note,
      });
      setForm({ ...EMPTY, zone: form.zone, month: form.month });
      load();
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  }
  async function del(id) {
    if (!confirm('ลบสัปดาห์นี้?')) return;
    try { await api.delete(`/week-config/${id}`); load(); }
    catch (e) { setErr(e.response?.data?.error || e.message); }
  }
  function edit(r) {
    setForm({
      zone: r.zone || '', month: r.month, week_no: String(r.week_no),
      day_from: String(r.day_from), day_to: String(r.day_to),
      target_major: String(r.target_major), target_minor: String(r.target_minor),
      target_fan: String(r.target_fan), note: r.note || '',
    });
  }
  // เติม 4 สัปดาห์อัตโนมัติ (1-7/8-14/15-21/22-สิ้นเดือน) ให้เดือน+โซนที่ฟอร์มเลือก
  async function autofill() {
    if (!form.month) { setErr('ระบุเดือนก่อน'); return; }
    const dim = daysInMonth(form.month);
    const ranges = [[1, 7], [8, 14], [15, 21], [22, dim]];
    setSaving(true); setErr('');
    try {
      for (let i = 0; i < ranges.length; i++) {
        await api.post('/week-config', {
          zone: form.zone || null, month: form.month, week_no: i + 1,
          day_from: ranges[i][0], day_to: ranges[i][1],
          target_major: 0, target_minor: 0, target_fan: 0, note: '',
        });
      }
      load();
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  }

  const view = rows
    .filter((r) => (!filterZone || (r.zone || '') === filterZone) && (!filterMonth || r.month === filterMonth))
    .sort((a, b) => a.month.localeCompare(b.month)
      || String(a.zone || '').localeCompare(String(b.zone || ''))
      || a.week_no - b.week_no);
  const months = [...new Set(rows.map((r) => r.month))].sort();

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">ตั้งค่าสัปดาห์ (Weekly)</h1>
          <p className="text-sm text-gray-500 mt-0.5">กำหนดช่วงวันของแต่ละสัปดาห์ + เป้าต่อสัปดาห์ (ล้างใหญ่/ย่อย/พัดลม) ต่อเดือน — ใช้แทนสัปดาห์ตายตัวในการ์ด Weekly</p>
        </div>

        {/* form */}
        <form onSubmit={save} className="bg-white border rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">ลูกค้า/โซน <span className="text-gray-400">(ว่าง=ทุกโซน)</span></label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.zone} onChange={set('zone')}>
                <option value="">ทุกโซน</option>
                {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">เดือน</label>
              <input type="month" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.month} onChange={set('month')} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">สัปดาห์ที่</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="numeric" value={form.week_no} onChange={set('week_no')} placeholder="1" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm text-gray-600 mb-1">วันเริ่ม</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="numeric" value={form.day_from} onChange={set('day_from')} placeholder="1" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">วันจบ</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="numeric" value={form.day_to} onChange={set('day_to')} placeholder="7" />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">เป้าล้างใหญ่</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="numeric" value={form.target_major} onChange={set('target_major')} placeholder="0" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">เป้าล้างย่อย</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="numeric" value={form.target_minor} onChange={set('target_minor')} placeholder="0" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">เป้าพัดลม</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="numeric" value={form.target_fan} onChange={set('target_fan')} placeholder="0" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">หมายเหตุ</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.note} onChange={set('note')} placeholder="(ไม่บังคับ)" />
            </div>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={autofill} disabled={saving} className="px-3 py-2 border border-blue-200 text-blue-600 rounded-lg text-sm hover:bg-blue-50 disabled:opacity-50">
              เติม 4 สัปดาห์อัตโนมัติ
            </button>
            <button disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'บันทึกสัปดาห์'}
            </button>
          </div>
          <p className="text-xs text-gray-400">บันทึกซ้ำ โซน+เดือน+สัปดาห์เดิม = แก้ค่าเดิม</p>
        </form>

        {/* filter + list */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-500">ดูเฉพาะ:</span>
          <select className="border rounded-lg px-2 py-1 text-sm" value={filterZone} onChange={(e) => setFilterZone(e.target.value)}>
            <option value="">ทุกโซน</option>
            {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          <select className="border rounded-lg px-2 py-1 text-sm" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}>
            <option value="">ทุกเดือน</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>

        {loading ? <p className="text-center text-gray-400 py-8">กำลังโหลด…</p>
          : view.length === 0 ? <p className="text-center text-gray-400 py-8">ยังไม่มีการตั้งค่าสัปดาห์ (การ์ด Weekly ใช้สัปดาห์ตายตัว 1-7/8-14/15-21/22-สิ้นเดือน)</p>
          : (
            <div className="bg-white border rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500 border-b bg-gray-50">
                  <th className="py-2.5 px-3">โซน</th><th className="py-2.5 px-2">เดือน</th><th className="py-2.5 px-2">สัปดาห์</th>
                  <th className="py-2.5 px-2">ช่วงวัน</th>
                  <th className="py-2.5 px-2 text-right">ใหญ่</th><th className="py-2.5 px-2 text-right">ย่อย</th>
                  <th className="py-2.5 px-2 text-right">พัดลม</th><th className="py-2.5 px-2 text-right">รวม</th><th></th>
                </tr></thead>
                <tbody>
                  {view.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-medium">{r.zone || 'ทุกโซน'}</td>
                      <td className="py-2.5 px-2 text-gray-600">{monthLabel(r.month)}</td>
                      <td className="py-2.5 px-2 text-gray-600">W{r.week_no}</td>
                      <td className="py-2.5 px-2 text-gray-600">{r.day_from}–{r.day_to}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{r.target_major}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{r.target_minor}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums">{r.target_fan}</td>
                      <td className="py-2.5 px-2 text-right tabular-nums font-semibold text-blue-900">{r.target_major + r.target_minor + r.target_fan}</td>
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
