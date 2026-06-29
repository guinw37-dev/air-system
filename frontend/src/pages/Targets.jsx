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
const ZONES = ['PTS1', 'PTS2'];
const monthLabel = (m) => (m ? `${m.slice(5)}/${Number(m.slice(0, 4)) + 543}` : 'ทุกเดือน');

const EMPTY = { zone: 'PTS1', month: '', location: '', ac_type: '', work_type: '', monthly_target: '', note: '' };

export default function Targets() {
  const [rows, setRows] = useState([]);
  const [units, setUnits] = useState([]);     // ทะเบียน → distinct location/ac_type
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [filterZone, setFilterZone] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setRows((await api.get('/targets')).data); }
    catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/wash-units').then((r) => setUnits(r.data || [])).catch(() => {}); }, []);

  // dropdown options จากทะเบียน (กรองตามโซนที่ฟอร์มเลือก)
  const inZone = units.filter((u) => !form.zone || u.pts_zone === form.zone);
  const locOpts = [...new Set(inZone.map((u) => u.location).filter(Boolean))].sort();
  const acOpts = [...new Set(units.map((u) => u.ac_type).filter(Boolean))].sort();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    if (!form.zone.trim()) { setErr('ระบุโซน'); return; }
    setSaving(true); setErr('');
    try {
      await api.post('/targets', {
        zone: form.zone.trim(),
        month: form.month || null,
        location: form.location || null,
        ac_type: form.ac_type || null,
        work_type: form.work_type || null,
        monthly_target: form.monthly_target,
        note: form.note,
      });
      setForm({ ...EMPTY, zone: form.zone, month: form.month });
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
    setForm({ zone: r.zone, month: r.month || '', location: r.location || '', ac_type: r.ac_type || '',
      work_type: r.work_type || '', monthly_target: String(r.monthly_target), note: r.note || '' });
  }

  const view = rows.filter((r) => !filterZone || r.zone === filterZone);

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">เป้าหมายล้างต่อเดือน</h1>
          <p className="text-sm text-gray-500 mt-0.5">ตั้งเป้าแยก ลูกค้า + เดือน + สถานที่ + ตระกูลแอร์ + ประเภทล้าง</p>
        </div>

        {/* form */}
        <form onSubmit={save} className="bg-white border rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">ลูกค้า/โซน</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.zone} onChange={set('zone')}>
                {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">เดือน <span className="text-gray-400">(ว่าง=ทุกเดือน)</span></label>
              <input type="month" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.month} onChange={set('month')} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">สถานที่ <span className="text-gray-400">(ว่าง=ทุกที่)</span></label>
              <input list="tg-locs" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.location} onChange={set('location')} placeholder="ทุกสถานที่" />
              <datalist id="tg-locs">{locOpts.map((l) => <option key={l} value={l} />)}</datalist>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">ตระกูลแอร์/พัดลม <span className="text-gray-400">(ว่าง=ทุก)</span></label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.ac_type} onChange={set('ac_type')}>
                <option value="">ทุกตระกูล</option>
                {acOpts.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">ประเภทล้าง</label>
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.work_type} onChange={set('work_type')}>
                {WT.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">เป้า/เดือน (เครื่อง)</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" inputMode="numeric" value={form.monthly_target} onChange={set('monthly_target')} placeholder="เช่น 120" />
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className="block text-sm text-gray-600 mb-1">หมายเหตุ</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm" value={form.note} onChange={set('note')} placeholder="(ไม่บังคับ)" />
            </div>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end">
            <button disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'บันทึกเป้าหมาย'}
            </button>
          </div>
          <p className="text-xs text-gray-400">บันทึกซ้ำ ลูกค้า+เดือน+สถานที่+ตระกูล+ประเภทเดิม = แก้ค่าเดิม</p>
        </form>

        {/* filter + list */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">ดูเฉพาะ:</span>
          <select className="border rounded-lg px-2 py-1 text-sm" value={filterZone} onChange={(e) => setFilterZone(e.target.value)}>
            <option value="">ทุกลูกค้า</option>
            {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>

        {loading ? <p className="text-center text-gray-400 py-8">กำลังโหลด…</p>
          : view.length === 0 ? <p className="text-center text-gray-400 py-8">ยังไม่มีเป้าหมาย</p>
          : (
            <div className="bg-white border rounded-2xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500 border-b bg-gray-50">
                  <th className="py-2.5 px-3">ลูกค้า</th><th className="py-2.5 px-2">เดือน</th><th className="py-2.5 px-2">สถานที่</th>
                  <th className="py-2.5 px-2">ตระกูล</th><th className="py-2.5 px-2">ประเภท</th>
                  <th className="py-2.5 px-2 text-right">เป้า/เดือน</th><th className="py-2.5 px-2">หมายเหตุ</th><th></th>
                </tr></thead>
                <tbody>
                  {view.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2.5 px-3 font-medium">{r.zone}</td>
                      <td className="py-2.5 px-2 text-gray-600">{monthLabel(r.month)}</td>
                      <td className="py-2.5 px-2 text-gray-600">{r.location || 'ทุกที่'}</td>
                      <td className="py-2.5 px-2 text-gray-600">{r.ac_type || 'ทุกตระกูล'}</td>
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
