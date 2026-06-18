import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  AreaChart, Area, XAxis, Tooltip, CartesianGrid,
} from 'recharts';
import {
  Wrench, Sparkles, ReceiptText, Clock, ArrowUpRight, ChevronRight, Building2,
} from 'lucide-react';
import dayjs from 'dayjs';
import api from '../api/client';
import { useTenantStore } from '../store/tenant';
import { useAuthStore } from '../store/auth';
import Layout from '../components/Layout';

// ── blue-family palette ───────────────────────────────────────────────────────
const C = {
  primary: '#2563eb', sky: '#0ea5e9', cyan: '#06b6d4', teal: '#14b8a6',
  indigo: '#4f46e5', slate: '#94a3b8', light: '#dbeafe',
};
const AC_STATUS = [
  { key: 'ac_register', label: 'แจ้งซ่อม', color: C.slate },
  { key: 'ac_assign',   label: 'รับงาน',   color: C.primary },
  { key: 'ac_work',     label: 'กำลังซ่อม', color: C.sky },
  { key: 'ac_clear',    label: 'ซ่อมเสร็จ', color: C.teal },
  { key: 'ac_close',    label: 'ปิดงาน',   color: C.indigo },
];
const WO_LABEL = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลม' };
const REPAIR_STATUS_TH = {
  Register: 'แจ้งซ่อม', Assign: 'รับงาน', 'Work On': 'กำลังซ่อม',
  Clear: 'ซ่อมเสร็จ', Close: 'ปิดงาน', Cancel: 'ยกเลิก',
};

function fmtDate(d) { return d ? dayjs(d).format('DD/MM') : ''; }

// ── reusable card shell ───────────────────────────────────────────────────────
function Card({ title, action, children, className = '' }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-5 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-slate-800">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// big highlight tile (top row)
function Highlight({ icon: Icon, value, label, tone }) {
  const tones = {
    blue: 'from-blue-500 to-blue-600',
    sky:  'from-sky-500 to-cyan-500',
    teal: 'from-teal-500 to-emerald-500',
    indigo: 'from-indigo-500 to-blue-600',
  };
  return (
    <div className={`rounded-2xl p-5 text-white bg-gradient-to-br ${tones[tone]} shadow-sm`}>
      <div className="flex items-center justify-between">
        <Icon size={22} className="opacity-90" />
        <ArrowUpRight size={18} className="opacity-60" />
      </div>
      <div className="text-3xl font-bold mt-3 leading-none">{value}</div>
      <div className="text-sm mt-1 opacity-90">{label}</div>
    </div>
  );
}

// horizontal progress row (Invoice Overview style)
function ProgressRow({ label, value, total, color }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold text-slate-800">{value} <span className="text-slate-400 font-normal text-xs">งาน</span></span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

// ── branch-mode rich dashboard ───────────────────────────────────────────────
function BranchDashboard({ b, navigate }) {
  const donut = AC_STATUS.map((s) => ({ name: s.label, value: b[s.key] || 0, color: s.color }))
    .filter((d) => d.value > 0);
  const donutTotal = donut.reduce((s, d) => s + d.value, 0);
  const billTotal = (b.wo_pending || 0) + (b.wo_ready || 0) + (b.wo_billed || 0);
  const openTickets = (b.recentRepair || []).filter((j) => j.status === 'Register');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* top highlights span all cols */}
      <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Highlight icon={Wrench}      value={b.ac_active}  label="งานซ่อมค้าง"  tone="blue" />
        <Highlight icon={Clock}       value={b.ac_clear}   label="รอปิดงานซ่อม" tone="sky" />
        <Highlight icon={ReceiptText} value={b.wo_ready}   label="รอวางบิล"     tone="teal" />
        <Highlight icon={Sparkles}    value={b.wo_billed}  label="วางบิลแล้ว"   tone="indigo" />
      </div>

      {/* left: my tasks */}
      <Card title="งานค้างล่าสุด" className="lg:row-span-2"
        action={<button onClick={() => navigate('/simple-wo')} className="text-blue-600 text-xs hover:underline flex items-center gap-0.5">ทั้งหมด <ChevronRight size={13} /></button>}>
        <div className="space-y-2">
          {(b.recentRepair || []).slice(0, 3).map((j) => (
            <button key={`r${j.id}`} onClick={() => navigate('/ac-repair')}
              className="w-full text-left rounded-xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/40 p-3 transition-colors">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
                <span className="text-xs font-mono text-slate-400">{j.job_number}</span>
                <span className="ml-auto text-xs text-blue-600">{REPAIR_STATUS_TH[j.status] || j.status}</span>
              </div>
              <p className="text-sm text-slate-700 line-clamp-1 pl-4">{j.description}</p>
              {j.department && <p className="text-xs text-slate-400 pl-4 mt-0.5">{j.department}</p>}
            </button>
          ))}
          {(b.recentWo || []).slice(0, 3).map((w) => (
            <button key={`w${w.wo_number}`} onClick={() => navigate('/simple-wo')}
              className="w-full text-left rounded-xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/40 p-3 transition-colors">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="w-2 h-2 rounded-full bg-teal-500 shrink-0" />
                <span className="text-xs font-mono text-slate-400">{w.wo_number}</span>
                <span className="ml-auto text-xs text-teal-600">{w.all_signed ? 'รอวางบิล' : 'กำลังทำ'}</span>
              </div>
              <p className="text-sm text-slate-700 line-clamp-1 pl-4">{w.client_name || '—'}</p>
              <p className="text-xs text-slate-400 pl-4 mt-0.5">{WO_LABEL[w.work_type] || w.work_type}</p>
            </button>
          ))}
          {!(b.recentRepair || []).length && !(b.recentWo || []).length && (
            <p className="text-center text-slate-400 text-sm py-8">ไม่มีงานค้าง</p>
          )}
        </div>
      </Card>

      {/* center: donut งานซ่อม */}
      <Card title="ภาพรวมงานซ่อมแอร์"
        action={<button onClick={() => navigate('/ac-repair')} className="text-blue-600"><ArrowUpRight size={16} /></button>}>
        <div className="relative">
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={donut.length ? donut : [{ name: '-', value: 1, color: '#e2e8f0' }]}
                dataKey="value" innerRadius={55} outerRadius={80} paddingAngle={2} stroke="none">
                {(donut.length ? donut : [{ color: '#e2e8f0' }]).map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-bold text-slate-800">{donutTotal}</span>
            <span className="text-xs text-slate-400">งานที่ค้าง</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-3">
          {AC_STATUS.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
              {s.label} <b className="text-slate-700">{b[s.key] || 0}</b>
            </div>
          ))}
        </div>
      </Card>

      {/* right: trend area */}
      <Card title="แนวโน้มงาน 6 เดือน">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={b.trend || []} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gRepair" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.primary} stopOpacity={0.3} />
                <stop offset="95%" stopColor={C.primary} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gWash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={C.cyan} stopOpacity={0.3} />
                <stop offset="95%" stopColor={C.cyan} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <Tooltip />
            <Area type="monotone" dataKey="repair" name="ซ่อม" stroke={C.primary} strokeWidth={2} fill="url(#gRepair)" />
            <Area type="monotone" dataKey="wash" name="ล้าง" stroke={C.cyan} strokeWidth={2} fill="url(#gWash)" />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex gap-4 justify-center mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: C.primary }} /> งานซ่อม</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: C.cyan }} /> งานล้าง</span>
        </div>
      </Card>

      {/* center-bottom: invoice progress */}
      <Card title="สถานะวางบิล (งานล้าง)"
        action={<button onClick={() => navigate('/simple-wo?view=ready')} className="text-blue-600"><ArrowUpRight size={16} /></button>}>
        <div className="space-y-4">
          <ProgressRow label="งานค้าง (ยังไม่เซ็นครบ)" value={b.wo_pending} total={billTotal} color={C.slate} />
          <ProgressRow label="รอวางบิล" value={b.wo_ready} total={billTotal} color={C.sky} />
          <ProgressRow label="วางบิลแล้ว" value={b.wo_billed} total={billTotal} color={C.teal} />
        </div>
      </Card>

      {/* right-bottom: open tickets (รอรับงานซ่อม) */}
      <Card title="งานซ่อมรอรับ"
        action={<button onClick={() => navigate('/ac-repair')} className="text-blue-600 text-xs hover:underline flex items-center gap-0.5">ทั้งหมด <ChevronRight size={13} /></button>}>
        <div className="space-y-2">
          {openTickets.length ? openTickets.map((j) => (
            <button key={j.id} onClick={() => navigate('/ac-repair')}
              className="w-full text-left flex items-start gap-3 rounded-xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/40 p-3 transition-colors">
              <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                <Wrench size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-700 line-clamp-1">{j.description}</p>
                <p className="text-xs text-slate-400 mt-0.5">{j.department || '—'} · {fmtDate(j.register_time)}</p>
              </div>
            </button>
          )) : <p className="text-center text-slate-400 text-sm py-8">ไม่มีงานรอรับ</p>}
        </div>
      </Card>
    </div>
  );
}

// ── super-admin: all-branch grid ─────────────────────────────────────────────
function AllBranchDashboard({ data, enterBranch }) {
  const t = data.total;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Highlight icon={Wrench}      value={t.ac_active}  label="งานซ่อมค้าง (รวม)" tone="blue" />
        <Highlight icon={Sparkles}    value={t.ac_close}   label="ซ่อมปิดแล้ว"      tone="sky" />
        <Highlight icon={ReceiptText} value={t.wo_ready}   label="รอวางบิล (รวม)"   tone="teal" />
        <Highlight icon={Building2}   value={data.branches.length} label="สาขาทั้งหมด" tone="indigo" />
      </div>

      <Card title={`แยกตามสาขา (${data.branches.length})`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.branches.map((b) => {
            const woOpen = (b.wo_pending || 0) + (b.wo_ready || 0);
            return (
              <button key={b.id} onClick={() => enterBranch(b)}
                className="text-left rounded-2xl border border-slate-100 hover:border-blue-300 hover:shadow-md p-4 transition-all bg-gradient-to-br from-white to-blue-50/30">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-slate-800 truncate">{b.name}</h3>
                  {b.error && <span className="text-xs text-red-500">!</span>}
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-blue-50 border border-blue-100 py-2">
                    <div className="text-xl font-bold text-blue-700">{b.ac_active || 0}</div>
                    <div className="text-xs text-blue-600">ซ่อมค้าง</div>
                  </div>
                  <div className="rounded-xl bg-teal-50 border border-teal-100 py-2">
                    <div className="text-xl font-bold text-teal-700">{b.wo_ready || 0}</div>
                    <div className="text-xs text-teal-600">รอวางบิล</div>
                  </div>
                </div>
                <div className="flex justify-between text-xs text-slate-500 mt-3">
                  <span>ล้างค้าง {woOpen}</span>
                  <span className="text-blue-600 flex items-center gap-0.5">เข้าสาขา <ChevronRight size={12} /></span>
                </div>
              </button>
            );
          })}
        </div>
      </Card>
    </>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { isBranch, name, switchBranch } = useTenantStore();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const { data } = await api.get('/dashboard');
      setData(data);
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally { setLoading(false); }
  }, [isBranch]);

  useEffect(() => { load(); }, [load]);

  function enterBranch(b) { switchBranch(b.slug, b.name); navigate('/simple-wo'); }

  const isSuper = user?.isSuper || user?.role === 'super_admin';

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
        {/* header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-400">จัดการและติดตามงานซ่อม-ล้างแอร์</p>
            <h1 className="text-2xl font-bold text-slate-900">ภาพรวมระบบ</h1>
            <p className="text-sm text-blue-600 mt-0.5">
              {data?.scope === 'all' ? 'ทุกสาขา' : (name || 'สาขาปัจจุบัน')}
            </p>
          </div>
          {isSuper && isBranch && (
            <button onClick={() => switchBranch(null)}
              className="px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-700 hover:bg-slate-50">
              ← ดูทุกสาขา
            </button>
          )}
        </div>

        {err && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
            <span>{err}</span>
            <button onClick={load} className="text-xs underline ml-4">ลองใหม่</button>
          </div>
        )}

        {loading ? (
          <p className="text-center text-slate-400 py-20">กำลังโหลด…</p>
        ) : !data ? null : data.scope === 'branch' ? (
          <BranchDashboard b={data.branch} navigate={navigate} />
        ) : (
          <div className="space-y-4">
            <AllBranchDashboard data={data} enterBranch={enterBranch} />
          </div>
        )}
      </div>
    </Layout>
  );
}
