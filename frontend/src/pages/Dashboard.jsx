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

// clickable stat tile — big number + label + small sub-note (สำหรับ stage cards)
function StatCard({ icon: Icon, value, label, sub, tone = 'blue', onClick }) {
  const chip = {
    blue: 'bg-blue-50 text-blue-600', teal: 'bg-teal-50 text-teal-600',
    amber: 'bg-amber-50 text-amber-600', slate: 'bg-slate-100 text-slate-500',
    indigo: 'bg-indigo-50 text-indigo-600',
  }[tone] || 'bg-blue-50 text-blue-600';
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`text-left bg-white rounded-2xl border border-slate-100 shadow-sm p-4 transition-all ${
        onClick ? 'hover:border-blue-300 hover:shadow-md cursor-pointer' : 'cursor-default'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 rounded-xl ${chip} flex items-center justify-center`}><Icon size={18} /></div>
        {onClick && <ArrowUpRight size={15} className="text-slate-300" />}
      </div>
      <div className="text-2xl font-bold text-slate-800 leading-none">{value}</div>
      <div className="text-xs font-medium text-slate-600 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </button>
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
  // จำนวนต้องล้าง/วัน = เหลือ ÷ วันที่เหลือในเดือน (เฉพาะเดือนปัจจุบัน, ตัดสิ้นเดือน)
  const isThisMonth = month === dayjs().format('YYYY-MM');
  const daysLeft = isThisMonth ? Math.max(1, dayjs().daysInMonth() - dayjs().date() + 1) : 0;
  const perDay = (remaining) => (isThisMonth && remaining > 0 ? Math.ceil(remaining / daysLeft) : 0);
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
              {perDay(t.remaining) > 0 && (
                <p className="text-xs text-slate-500 mt-1">
                  ต้องล้าง <b className="text-blue-600">{perDay(t.remaining)}</b> เครื่อง/วัน
                  <span className="text-slate-400"> (เหลือ {daysLeft} วันในเดือนนี้)</span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── ล้างได้/เหลือ เทียบทะเบียนแอร์ (per zone × ประเภทแอร์; คลินิก = ตามสถานที่) ──
function CoverageSection() {
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/wash-units/coverage', { params: { month } }).then((r) => setData(r.data)).catch(() => {});
  }, [month]);
  if (!data || !data.groups?.length) return null;
  // group rows by zone
  const byZone = {};
  for (const g of data.groups) (byZone[g.zone] ||= []).push(g);
  return (
    <Card title="ล้างได้ / เหลือ (เทียบทะเบียนแอร์)"
      action={
        <select value={month} onChange={(e) => setMonth(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1 text-slate-600">
          {monthOptions().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      }>
      <div className="space-y-4">
        {Object.entries(byZone).map(([zone, rows]) => (
          <div key={zone}>
            <div className="text-sm font-semibold text-slate-700 mb-1.5">{zone}</div>
            <div className="space-y-2">
              {rows.map((g) => {
                const pct = g.total > 0 ? Math.round((g.done / g.total) * 100) : 0;
                const tone = pct >= 100 ? C.teal : pct >= 60 ? C.sky : '#f59e0b';
                return (
                  <div key={g.kind + g.label}>
                    <div className="flex items-center justify-between text-sm mb-0.5">
                      <span className="text-slate-600 truncate flex-1">
                        {g.kind === 'clinic' && <span className="text-amber-600 mr-1">📍</span>}{g.label}
                      </span>
                      <span className="text-slate-500 text-xs">
                        <b className="text-slate-800">{g.done}</b>/{g.total}
                        {g.remaining > 0 && <span className="text-amber-600"> · เหลือ {g.remaining}</span>}
                        <b className="ml-2" style={{ color: tone }}>{pct}%</b>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: tone }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
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
  const locs = Object.entries(data.byLocation || {}).sort((a, b) => (b[1].urgent - a[1].urgent) || (b[1].count - a[1].count));
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
      {/* สรุปตามสถานที่ — ที่ไหนบ้าง กี่เครื่อง (เร่งด่วนกี่เครื่อง) */}
      {locs.length > 0 && (
        <div className="border-t border-slate-100 pt-2 mb-2">
          <div className="text-xs text-slate-400 mb-1">ตามสถานที่</div>
          <div className="space-y-1">
            {locs.map(([loc, v]) => (
              <div key={loc} className="flex items-center justify-between text-sm">
                <span className="text-slate-600 truncate flex-1">{loc}</span>
                {v.urgent > 0 && (
                  <span className="text-[11px] font-medium text-white px-1.5 py-0.5 rounded mr-2" style={{ background: PRIORITY_COLOR.urgent }}>
                    เร่ง {v.urgent}
                  </span>
                )}
                <b className="text-slate-800">{v.count}</b>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* รายการล่าสุด (top 6) คลิกดูใบงาน */}
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

// ── branch-mode landing — "รายการดำเนินงาน : นับใบงาน" ────────────────────────
// เน้นให้วิศวกรรม/ช่างอาคาร เข้ามาเห็นว่ามีใบงานรอเซ็นกี่ใบ แล้วกดเข้าไปเซ็นได้เลย.
// ล้างได้/เหลือ · แอร์เสื่อมสภาพ · เป้าหมาย · กราฟ → ย้ายไปหน้า Dashboard (WashReport).
function BranchDashboard({ b, navigate }) {
  const acSegments = AC_STATUS.map((s) => ({ label: s.label, value: b[s.key] || 0, color: s.color }));
  const woSegments = WO_TYPE.map((s) => ({ label: s.label, value: b[s.key] || 0, color: s.color }));
  const washDone = (b.wo_ready || 0) + (b.wo_billed || 0);          // เซ็นครบ (รอวางบิล + วางบิลแล้ว)
  const repairPending = (b.ac_register || 0) + (b.ac_assign || 0) + (b.ac_work || 0);

  return (
    <div className="space-y-5">

      {/* ภาพรวมงานล้างแอร์ — แยกตาม stage การเซ็น (กดเข้าดูเฉพาะใบที่ต้องเซ็น) */}
      <div>
        <h2 className="font-bold text-slate-800 mb-3">ภาพรวมงานล้างแอร์</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Sparkles} tone="amber" value={b.wo_wait_supervisor || 0}
            label="รอหัวหน้าช่างตรวจเช็ค"
            onClick={() => navigate('/simple-wo?pending=supervisor')} />
          <StatCard icon={Sparkles} tone="indigo" value={b.wo_wait_building || 0}
            label="รอช่างอาคารตรวจเช็ค"
            onClick={() => navigate('/simple-wo?pending=building')} />
          <StatCard icon={Sparkles} tone="blue" value={b.wo_wait_engineer || 0}
            label="รอวิศวกรรมตรวจเช็ค"
            onClick={() => navigate('/simple-wo?pending=engineer')} />
          <StatCard icon={Sparkles} tone="teal" value={b.wo_done_full || washDone}
            label="ดำเนินการเสร็จสิ้น"
            onClick={() => navigate('/simple-wo?view=ready')} />
        </div>
      </div>

      {/* ภาพรวมงานซ่อม */}
      <div>
        <h2 className="font-bold text-slate-800 mb-3">ภาพรวมงานซ่อม</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard icon={Wrench} tone="amber" value={repairPending}
            label="งานซ่อมคงค้าง"
            onClick={() => navigate('/ac-repair')} />
          <StatCard icon={Wrench} tone="blue" value={b.ac_clear || 0}
            label="งานซ่อม (รอตรวจเช็ค)"
            onClick={() => navigate('/ac-repair')} />
          <StatCard icon={Wrench} tone="teal" value={b.ac_close || 0}
            label="ดำเนินการเสร็จสิ้น"
            onClick={() => navigate('/ac-repair')} />
        </div>
      </div>

      {/* donut ซ่อม + ล้าง — เก็บไว้ดูสถานะย่อย */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DonutCard icon={Wrench} accent={C.primary} title="งานซ่อมแอร์ (รายละเอียดสถานะ)"
          segments={acSegments} total={b.ac_active} onGo={() => navigate('/ac-repair')} />
        <DonutCard icon={Sparkles} accent="#0F6E56" title="งานล้างแอร์ (ค้าง)"
          segments={woSegments} total={b.wo_active} onGo={() => navigate('/simple-wo')} />
      </div>
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
            <p className="text-sm text-slate-400">นับใบงาน · สำหรับวิศวกรรม/ช่างอาคารเข้ามาเซ็นเอกสาร</p>
            <h1 className="text-2xl font-bold text-slate-900">รายการดำเนินงาน</h1>
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
