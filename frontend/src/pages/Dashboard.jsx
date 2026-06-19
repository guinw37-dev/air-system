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
import { CONDITION_ISSUE_LABEL, PRIORITY_LABEL, PRIORITY_COLOR } from '../lib/condition';
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
const WO_TYPE = [
  { key: 'wo_major', label: 'ล้างใหญ่', color: '#0F6E56' },
  { key: 'wo_minor', label: 'ล้างย่อย', color: '#14b8a6' },
  { key: 'wo_fan',   label: 'พัดลม',   color: '#5DCAA5' },
];

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

// highlight tile — white card with a soft icon chip (Panze style)
function Highlight({ icon: Icon, value, label, tone = 'blue' }) {
  const chip = {
    blue: 'bg-blue-50 text-blue-600',
    teal: 'bg-teal-50 text-teal-600',
  }[tone] || 'bg-blue-50 text-blue-600';
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
      <div className={`w-9 h-9 rounded-xl ${chip} flex items-center justify-center mb-3`}>
        <Icon size={18} />
      </div>
      <div className="text-2xl font-bold text-slate-800 leading-none">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

// reusable donut with a centre total + legend (used for ซ่อม and ล้าง)
function DonutCard({ icon: Icon, accent, title, segments, total, onGo }) {
  const data = segments.filter((s) => s.value > 0);
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon size={15} style={{ color: accent }} />
          <span className="font-bold text-slate-800 text-sm">{title}</span>
        </div>
        {onGo && <button onClick={onGo} className="text-blue-600"><ArrowUpRight size={16} /></button>}
      </div>
      <div className="flex items-center gap-3">
        <div className="relative shrink-0" style={{ width: 104, height: 104 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data.length ? data : [{ name: '-', value: 1, color: '#e2e8f0' }]}
                dataKey="value" innerRadius={36} outerRadius={50} paddingAngle={2} stroke="none">
                {(data.length ? data : [{ color: '#e2e8f0' }]).map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xl font-bold text-slate-800">{total}</span>
            <span className="text-[10px] text-slate-400">รวม</span>
          </div>
        </div>
        <div className="flex-1 space-y-1">
          {segments.map((s) => (
            <div key={s.label} className="flex items-center gap-2 text-xs text-slate-500">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="flex-1">{s.label}</span>
              <b className="text-slate-700">{s.value}</b>
            </div>
          ))}
        </div>
      </div>
    </Card>
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

// ── เป้าหมายล้าง (เป้า+คงค้าง vs ล้างได้ vs เหลือ) — เลือกเดือนย้อนหลังได้ ──────
const WT_LABEL = { major: 'ล้างใหญ่', minor: 'ล้างย่อย', fan: 'พัดลม', '': 'รวม' };
const monthOptions = () => Array.from({ length: 6 }, (_, i) => dayjs().subtract(i, 'month').format('YYYY-MM'));
const monthLabel = (m) => `${m.slice(5)}/${Number(m.slice(0, 4)) + 543}`;
function TargetSection({ navigate }) {
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/targets/progress', { params: { month } }).then((r) => setData(r.data)).catch(() => {});
  }, [month]);
  if (!data || !data.targets?.length) return null;
  return (
    <Card title="เป้าหมายล้าง"
      action={
        <div className="flex items-center gap-2">
          <select value={month} onChange={(e) => setMonth(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1 text-slate-600">
            {monthOptions().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <button onClick={() => navigate('/targets')} className="text-blue-600"><ArrowUpRight size={16} /></button>
        </div>
      }>
      <div className="space-y-3">
        {data.targets.map((t) => {
          const tone = t.pct >= 100 ? C.teal : t.pct >= 60 ? C.sky : '#f59e0b';
          return (
            <div key={t.id}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-slate-700">
                  {t.zone} <span className="text-slate-400">· {WT_LABEL[t.work_type || ''] || t.work_type}</span>
                  {t.carry_in > 0 && <span className="ml-1.5 text-xs text-amber-600">+คงค้าง {t.carry_in}</span>}
                </span>
                <span className="text-slate-500">
                  <b className="text-slate-800">{t.done}</b>/{t.effective_target}
                  {t.remaining > 0 && <span className="text-amber-600"> · เหลือ {t.remaining}</span>}
                  <b className="ml-2" style={{ color: tone }}>{t.pct}%</b>
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, t.pct)}%`, background: tone }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── แอร์เสื่อมสภาพ / ต้องแก้ — fetched on its own (heavier query) ──────────────
function ConditionSection({ navigate }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/simple-wo/condition-summary').then((r) => setData(r.data)).catch(() => {});
  }, []);
  if (!data || !data.total) return null;
  const issues = Object.entries(data.byIssue || {}).sort((a, b) => b[1] - a[1]);
  const prio = data.byPriority || {};
  return (
    <Card title={`แอร์เสื่อมสภาพ / ต้องแก้ (${data.total})`}
      action={<button onClick={() => navigate('/simple-wo?view=all')} className="text-blue-600"><ArrowUpRight size={16} /></button>}>
      {/* priority chips */}
      <div className="flex gap-2 mb-3">
        {['urgent', 'normal', 'low'].filter((p) => prio[p]).map((p) => (
          <span key={p} className="text-xs font-medium px-2.5 py-1 rounded-lg text-white" style={{ background: PRIORITY_COLOR[p] }}>
            {PRIORITY_LABEL[p]} {prio[p]}
          </span>
        ))}
      </div>
      {/* by issue */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mb-3">
        {issues.map(([k, n]) => (
          <div key={k} className="flex items-center justify-between text-sm">
            <span className="text-slate-600 truncate">{CONDITION_ISSUE_LABEL[k] || k}</span>
            <b className="text-slate-800">{n}</b>
          </div>
        ))}
      </div>
      {/* per-location list (top 6) */}
      <div className="border-t border-slate-100 pt-2 space-y-1">
        {(data.items || []).slice(0, 6).map((it) => (
          <button key={it.id} onClick={() => navigate(`/simple-wo/${it.id}`)}
            className="w-full text-left flex items-center gap-2 text-sm hover:bg-blue-50/40 rounded px-1.5 py-1">
            {it.condition?.priority && (
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PRIORITY_COLOR[it.condition.priority] || '#94a3b8' }} />
            )}
            <span className="text-slate-700 truncate flex-1">
              {[it.building, it.room || it.location].filter(Boolean).join(' › ') || it.wo_number}
            </span>
            <span className="text-xs text-slate-400">{(it.condition?.issues || []).length} รายการ</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

// ── branch-mode rich dashboard ───────────────────────────────────────────────
function BranchDashboard({ b, navigate }) {
  const acSegments = AC_STATUS.map((s) => ({ label: s.label, value: b[s.key] || 0, color: s.color }));
  const woSegments = WO_TYPE.map((s) => ({ label: s.label, value: b[s.key] || 0, color: s.color }));
  const billTotal = (b.wo_pending || 0) + (b.wo_ready || 0) + (b.wo_billed || 0);
  const openTickets = (b.recentRepair || []).filter((j) => j.status === 'Register');

  return (
    <div className="space-y-4">
      {/* highlights */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Highlight icon={Wrench}      value={b.ac_active}  label="งานซ่อมค้าง" tone="blue" />
        <Highlight icon={Sparkles}    value={b.wo_active}  label="งานล้างค้าง" tone="teal" />
        <Highlight icon={ReceiptText} value={b.wo_ready}   label="รอวางบิล"   tone="blue" />
        <Highlight icon={Clock}       value={b.wo_billed}  label="วางบิลแล้ว" tone="teal" />
      </div>

      {/* เป้าหมายล้างเดือนนี้ */}
      <TargetSection navigate={navigate} />

      {/* two donuts: ซ่อม + ล้าง */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DonutCard icon={Wrench} accent={C.primary} title="งานซ่อมแอร์"
          segments={acSegments} total={b.ac_active} onGo={() => navigate('/ac-repair')} />
        <DonutCard icon={Sparkles} accent="#0F6E56" title="งานล้างแอร์ (ค้าง)"
          segments={woSegments} total={b.wo_active} onGo={() => navigate('/simple-wo')} />
      </div>

      {/* trend full width */}
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
            <Area type="monotone" dataKey="repair" name="ซ่อม" stroke={C.primary} strokeWidth={2.5} fill="url(#gRepair)" />
            <Area type="monotone" dataKey="wash" name="ล้าง" stroke={C.cyan} strokeWidth={2.5} fill="url(#gWash)" />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex gap-4 justify-center mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: C.primary }} /> งานซ่อม</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: C.cyan }} /> งานล้าง</span>
        </div>
      </Card>

      {/* invoice progress + open repair tickets */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="สถานะวางบิล (งานล้าง)"
          action={<button onClick={() => navigate('/simple-wo?view=ready')} className="text-blue-600"><ArrowUpRight size={16} /></button>}>
          <div className="space-y-4">
            <ProgressRow label="งานค้าง (ยังไม่เซ็นครบ)" value={b.wo_pending} total={billTotal} color={C.slate} />
            <ProgressRow label="รอวางบิล" value={b.wo_ready} total={billTotal} color={C.sky} />
            <ProgressRow label="วางบิลแล้ว" value={b.wo_billed} total={billTotal} color={C.teal} />
          </div>
        </Card>

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

      <ConditionSection navigate={navigate} />
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
