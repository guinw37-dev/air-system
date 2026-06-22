import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { CalendarDays, Sparkles, ClipboardCheck, Target, FileSpreadsheet, AlertTriangle, ChevronRight } from 'lucide-react';
import api from '../api/client';
import Layout from '../components/Layout';
import { CONDITION_ISSUE_LABEL, PRIORITY_LABEL, PRIORITY_COLOR } from '../lib/condition';

const TH_MONTHS = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const WT = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลม' };
const WT_LONG = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลมระบายอากาศ' };

function thaiDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${TH_MONTHS[m]} ${y + 543}`;
}

function Card({ title, icon: Icon, children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden ${className}`}>
      <div className="flex items-center gap-2 px-4 py-3 bg-sky-50 border-b border-sky-100">
        {Icon && <Icon size={18} className="text-blue-800" />}
        <h2 className="font-bold text-blue-900 text-sm">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function WashReport() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [openIssue, setOpenIssue] = useState(null);   // อาการที่กดดู → popup
  const [selPr, setSelPr] = useState(null);           // filter ตามความเร่งด่วน

  const [cond, setCond] = useState(null);

  useEffect(() => {
    api.get('/dashboard/wash-report')
      .then((r) => setData(r.data))
      .catch((e) => setErr(e.response?.status === 400 ? 'เลือกสาขาก่อนเพื่อดูรายงาน' : (e.response?.data?.error || e.message)))
      .finally(() => setLoading(false));
    api.get('/simple-wo/condition-summary').then((r) => setCond(r.data)).catch(() => {});
  }, []);

  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    setExporting(true);
    try {
      const res = await api.get('/dashboard/wash-report/excel', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `รายงานล้างแอร์-${data?.date || ''}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ } finally { setExporting(false); }
  };

  const barData = data?.monthly?.types?.map((t) => ({
    name: WT[t.work_type] || t.work_type, เป้าหมาย: t.target, ยอดล้าง: t.done,
  })) || [];

  // แอร์เสื่อมสภาพ — นับต่ออาการ (เคารพ filter ความเร่งด่วน) + รายการสำหรับ popup
  const condItems = cond?.items || [];
  const issuePr = (it, k) => it.condition?.issue_priority?.[k] || it.condition?.priority || 'normal';
  const issueCounts = {};
  for (const it of condItems) for (const k of (it.condition?.issues || [])) {
    if (selPr && issuePr(it, k) !== selPr) continue;
    issueCounts[k] = (issueCounts[k] || 0) + 1;
  }
  const modalItems = openIssue
    ? condItems.filter((it) => (it.condition?.issues || []).includes(openIssue) && (!selPr || issuePr(it, openIssue) === selPr))
    : [];

  const weeks = data?.weekly?.weeks || [];
  const sum = (k) => weeks.reduce((s, w) => s + (w[k] || 0), 0);
  const sumTarget = sum('target'), sumDone = sum('done'), sumRem = sum('remaining');
  const sumPct = sumTarget > 0 ? Math.round((sumDone / sumTarget) * 100) : 0;

  return (
    <Layout>
      <div className="space-y-4">
        {/* Banner */}
        <div className="bg-blue-900 rounded-2xl py-4 px-6 text-center">
          <h1 className="text-white font-bold text-lg md:text-xl">AIR Conditioner Cleaning Dashboard – งานล้างแอร์</h1>
        </div>

        {loading ? (
          <p className="text-center text-slate-400 py-12">กำลังโหลด…</p>
        ) : err ? (
          <p className="text-center text-amber-600 py-12">{err}</p>
        ) : !data ? null : (
          <>
            <div className="flex items-center gap-2 text-blue-900 font-semibold">
              <CalendarDays size={18} />
              <span>รายงานประจำวันที่ : {thaiDate(data.date)}</span>
              <button onClick={exportExcel} disabled={exporting}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                <FileSpreadsheet size={16} /> {exporting ? 'กำลังออก…' : 'Export Excel'}
              </button>
            </div>

            {/* Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* daily wash — ยอดวันนี้ เทียบเป้า/วัน */}
              <Card title="สรุปงานล้างประจำวัน" icon={Sparkles}>
                <div className="flex items-baseline justify-between mb-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-slate-500">รวม</span>
                    <span className="text-4xl font-bold text-blue-900">{data.daily.total}</span>
                    <span className="text-slate-500">ตัว</span>
                  </div>
                  <span className="text-xs text-slate-400">เป้า/วัน {data.daily.target}</span>
                </div>
                <div className="space-y-2.5 text-sm">
                  {[['major', data.daily.major, data.daily.target_major],
                    ['minor', data.daily.minor, data.daily.target_minor],
                    ['fan', data.daily.fan, data.daily.target_fan]].map(([k, v, tg]) => {
                    const pct = tg > 0 ? Math.min(100, Math.round((v / tg) * 100)) : 0;
                    const tone = tg > 0 && v >= tg ? '#059669' : '#2563eb';
                    return (
                      <div key={k}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-slate-600">{WT[k]}</span>
                          <span><b className="text-blue-900">{v}</b><span className="text-slate-400"> / {tg} ตัว</span></span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* monthly repair */}
              <Card title="สรุปงานซ่อมประจำเดือน" icon={ClipboardCheck}>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-emerald-50 rounded-xl p-3">
                    <div className="text-2xl font-bold text-emerald-600">{data.repair.done}</div>
                    <div className="text-xs text-slate-500 mt-1">สำเร็จ ✓</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3">
                    <div className="text-2xl font-bold text-slate-700">{data.repair.total}</div>
                    <div className="text-xs text-slate-500 mt-1">ทั้งหมด</div>
                  </div>
                  <div className="bg-red-50 rounded-xl p-3">
                    <div className="text-2xl font-bold text-red-500">{data.repair.pending}</div>
                    <div className="text-xs text-slate-500 mt-1">คงค้าง ✗</div>
                  </div>
                </div>
                {data.repair.total > 0 && (
                  <div className="mt-3">
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((data.repair.done / data.repair.total) * 100)}%` }} />
                    </div>
                    <p className="text-xs text-slate-400 mt-1 text-center">สำเร็จ {Math.round((data.repair.done / data.repair.total) * 100)}%</p>
                  </div>
                )}
              </Card>

              {/* monthly target bar */}
              <Card title="เป้าหมายการล้าง (เดือนนี้)" icon={Target}>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={barData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="เป้าหมาย" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="ยอดล้าง" fill="#1e3a8a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>

            {/* Row 2 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* yearly */}
              <Card title={`ยอดล้างสะสม (ประจำปี ${(data.yearly.year || 0) + 543})`} icon={Sparkles}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 text-xs border-b">
                      <th className="py-2">ประเภท</th>
                      <th className="py-2 text-right">เป้าหมาย</th>
                      <th className="py-2 text-right">ยอดล้าง</th>
                      <th className="py-2 text-right">เหลือ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.yearly.types.map((t) => {
                      const rem = Math.max(0, t.target - t.done);
                      return (
                        <tr key={t.work_type} className="border-b last:border-0">
                          <td className="py-2.5 text-slate-700">{WT_LONG[t.work_type] || t.work_type}</td>
                          <td className="py-2.5 text-right tabular-nums text-slate-600">{t.target}</td>
                          <td className="py-2.5 text-right tabular-nums font-bold text-blue-900">{t.done}</td>
                          <td className="py-2.5 text-right tabular-nums text-amber-600">{rem}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>

              {/* weekly */}
              <Card title="รวมยอดล้างแอร์รายสัปดาห์ (Weekly)" icon={Target}>
                {(() => {
                  const cur = weeks.find((w) => w.no === data.weekly.current_no);
                  if (!cur) return null;
                  const tone = cur.pct >= 100 ? '#059669' : cur.pct >= 60 ? '#0ea5e9' : '#f59e0b';
                  return (
                    <div className="mb-3 rounded-xl bg-sky-50 border border-sky-100 p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-blue-900">สัปดาห์นี้ (Week {cur.no})</span>
                        <span className="text-xs text-slate-500">{cur.label}</span>
                      </div>
                      <div className="flex items-center gap-4 mt-1.5 text-sm">
                        <span>ยอด <b className="text-blue-900">{cur.done}</b>/{cur.target}</span>
                        <span className="text-amber-600">คงค้าง {cur.remaining}</span>
                        <span className="ml-auto font-bold" style={{ color: tone }}>{cur.pct}%</span>
                      </div>
                    </div>
                  );
                })()}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-500 text-xs border-b">
                        <th className="py-2 text-left">รายการ</th>
                        {weeks.map((w) => (
                          <th key={w.no} className={`py-2 text-center ${w.no === data.weekly.current_no ? 'text-blue-900 bg-sky-50 rounded' : ''}`}>
                            Week {w.no}
                          </th>
                        ))}
                        <th className="py-2 text-center">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b">
                        <td className="py-2 text-slate-600">เป้าหมาย (เครื่อง)</td>
                        {weeks.map((w) => <td key={w.no} className="py-2 text-center tabular-nums">{w.target}</td>)}
                        <td className="py-2 text-center tabular-nums font-semibold">{sumTarget}</td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2 text-slate-600">ยอดล้าง</td>
                        {weeks.map((w) => <td key={w.no} className="py-2 text-center tabular-nums font-bold text-blue-900">{w.done}</td>)}
                        <td className="py-2 text-center tabular-nums font-bold text-blue-900">{sumDone}</td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2 text-slate-600">ยอดคงค้าง</td>
                        {weeks.map((w) => <td key={w.no} className="py-2 text-center tabular-nums text-amber-600">{w.remaining}</td>)}
                        <td className="py-2 text-center tabular-nums text-amber-600">{sumRem}</td>
                      </tr>
                      <tr>
                        <td className="py-2 text-slate-600">% สำเร็จ</td>
                        {weeks.map((w) => <td key={w.no} className="py-2 text-center tabular-nums font-semibold" style={{ color: w.pct >= 100 ? '#059669' : w.pct >= 60 ? '#0ea5e9' : '#f59e0b' }}>{w.pct}%</td>)}
                        <td className="py-2 text-center tabular-nums font-semibold">{sumPct}%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-xs text-slate-400 space-y-0.5">
                  {weeks.map((w) => <div key={w.no}>Week {w.no} : {w.label}</div>)}
                </div>
              </Card>
            </div>

            {/* แอร์เสื่อมสภาพ แยกตามอาการ */}
            {cond && cond.total > 0 && (
              <Card title={`แอร์เสื่อมสภาพ / ต้องแก้ (${cond.total})`} icon={AlertTriangle}>
                {/* priority chips — คลิกเพื่อกรองดูแต่ละสถานะ */}
                <div className="flex gap-2 mb-3">
                  {['urgent', 'normal', 'low'].filter((p) => cond.byPriority?.[p]).map((p) => {
                    const on = selPr === p;
                    return (
                      <button key={p} onClick={() => setSelPr(on ? null : p)}
                        className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-all ${on ? 'text-white ring-2 ring-offset-1' : 'text-white opacity-80 hover:opacity-100'}`}
                        style={{ background: PRIORITY_COLOR[p], borderColor: PRIORITY_COLOR[p] }}>
                        {PRIORITY_LABEL[p]} {cond.byPriority[p]}
                      </button>
                    );
                  })}
                  {selPr && <button onClick={() => setSelPr(null)} className="text-xs text-slate-500 underline">ล้างตัวกรอง</button>}
                </div>
                {/* จำนวนต่อแต่ละอาการ — คลิกได้ทั้งช่อง (ข้อความหรือเลข) → popup ใบงาน */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                  {Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                    <button key={k} onClick={() => setOpenIssue(k)} title="คลิกดูใบงาน"
                      className="group flex items-center gap-1 text-sm border-b border-slate-50 py-1.5 px-1.5 rounded cursor-pointer hover:bg-sky-50 transition-colors">
                      <span className="text-slate-600 group-hover:text-blue-700 group-hover:underline truncate text-left">{CONDITION_ISSUE_LABEL[k] || k}</span>
                      <span className="flex-1" />
                      <b className="text-blue-900 group-hover:text-blue-700">{n}</b>
                      <ChevronRight size={14} className="text-slate-300 group-hover:text-blue-500 shrink-0" />
                    </button>
                  ))}
                  {!Object.keys(issueCounts).length && <p className="text-sm text-slate-400 col-span-full py-2">ไม่มีอาการในสถานะนี้</p>}
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Popup — ใบงานที่มีอาการที่เลือก → คลิกเข้าดูรายละเอียดงาน */}
      {openIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpenIssue(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-3 border-b bg-sky-50 sticky top-0">
              <div>
                <h3 className="font-bold text-blue-900">{CONDITION_ISSUE_LABEL[openIssue] || openIssue}</h3>
                <p className="text-xs text-slate-500">แอร์ที่มีอาการนี้ {modalItems.length} เครื่อง{selPr ? ` · ${PRIORITY_LABEL[selPr]}` : ''} — คลิกเพื่อดูใบงาน</p>
              </div>
              <button onClick={() => setOpenIssue(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
            </div>
            <div className="p-3 space-y-1">
              {modalItems.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">ไม่มีงาน</p>
              ) : modalItems.map((it) => {
                const pr = it.condition?.issue_priority?.[openIssue] || it.condition?.priority;
                return (
                  <button key={it.id} onClick={() => navigate(`/simple-wo/${it.id}`)}
                    className="w-full flex items-center gap-2 text-sm hover:bg-blue-50 rounded-lg px-3 py-2 text-left border border-slate-100">
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-800 truncate font-medium">{it.asset_code || it.wo_number}</div>
                      <div className="text-xs text-slate-500 truncate">{[it.location, it.building, it.room].filter(Boolean).join(' › ') || '—'}</div>
                    </div>
                    {pr && (
                      <span className="text-[11px] font-medium text-white px-1.5 py-0.5 rounded shrink-0" style={{ background: PRIORITY_COLOR[pr] || '#94a3b8' }}>
                        {PRIORITY_LABEL[pr] || pr}
                      </span>
                    )}
                    <span className="text-blue-600 text-xs shrink-0">ดู →</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
