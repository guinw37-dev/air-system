import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useTenantStore } from '../store/tenant';
import { useAuthStore } from '../store/auth';
import Layout from '../components/Layout';

// ── small presentational bits ────────────────────────────────────────────────
function Stat({ value, label, tone = 'gray', onClick }) {
  const tones = {
    gray:   'bg-white border-gray-200 text-gray-800',
    blue:   'bg-blue-50 border-blue-200 text-blue-800',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    teal:   'bg-teal-50 border-teal-200 text-teal-800',
    green:  'bg-green-50 border-green-200 text-green-800',
    red:    'bg-red-50 border-red-200 text-red-700',
  };
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border p-3 text-center ${tones[tone]} ${onClick ? 'cursor-pointer hover:shadow-sm transition-shadow' : ''}`}
    >
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="text-xs mt-1 opacity-80">{label}</div>
    </div>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{children}</h2>
      {action}
    </div>
  );
}

// ── branch summary block (reused by branch-mode + each super card) ───────────
function BranchBlock({ b, onGoAc, onGoWo }) {
  return (
    <>
      <SectionTitle action={onGoAc && <button onClick={onGoAc} className="text-xs text-blue-600 hover:underline">ดูทั้งหมด →</button>}>
        งานซ่อมแอร์
      </SectionTitle>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-5">
        <Stat value={b.ac_register} label="แจ้งซ่อม" tone="gray" />
        <Stat value={b.ac_assign}   label="รับงาน" tone="blue" />
        <Stat value={b.ac_work}     label="กำลังซ่อม" tone="yellow" />
        <Stat value={b.ac_clear}    label="ซ่อมเสร็จ" tone="teal" />
        <Stat value={b.ac_close}    label="ปิดงาน" tone="green" />
      </div>

      <SectionTitle action={onGoWo && <button onClick={onGoWo} className="text-xs text-blue-600 hover:underline">ดูทั้งหมด →</button>}>
        งานล้างแอร์
      </SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        <Stat value={b.wo_pending} label="งานค้าง" tone="yellow" />
        <Stat value={b.wo_ready}   label="รอวางบิล" tone="teal" />
        <Stat value={b.wo_billed}  label="วางบิลแล้ว" tone="green" />
      </div>
    </>
  );
}

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

  // Super-admin clicks a branch card → switch into it and open its work list.
  function enterBranch(b) {
    switchBranch(b.slug, b.name);
    navigate('/simple-wo');
  }

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">ภาพรวม</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {data?.scope === 'all' ? 'ทุกสาขา' : (name || 'สาขาปัจจุบัน')}
            </p>
          </div>
          {/* super-admin who switched into a branch can pop back to the all view */}
          {(user?.isSuper || user?.role === 'super_admin') && isBranch && (
            <button
              onClick={() => { switchBranch(null); }}
              className="px-3 py-2 border rounded-xl text-sm text-gray-700 hover:bg-gray-50"
            >
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
          <p className="text-center text-gray-400 py-16">กำลังโหลด…</p>
        ) : !data ? null : data.scope === 'branch' ? (
          /* ── single branch ── */
          <div className="bg-white border rounded-2xl p-5">
            <BranchBlock
              b={data.branch}
              onGoAc={() => navigate('/ac-repair')}
              onGoWo={() => navigate('/simple-wo')}
            />
          </div>
        ) : (
          /* ── super-admin: all branches ── */
          <>
            {/* grand total */}
            <div>
              <SectionTitle>รวมทุกสาขา</SectionTitle>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat value={data.total.ac_active} label="งานซ่อมค้าง" tone="yellow" />
                <Stat value={data.total.ac_close}  label="ซ่อมปิดแล้ว" tone="green" />
                <Stat value={data.total.wo_ready}  label="รอวางบิล" tone="teal" />
                <Stat value={data.total.wo_billed} label="วางบิลแล้ว" tone="green" />
              </div>
            </div>

            {/* per-branch cards */}
            <div>
              <SectionTitle>แยกตามสาขา ({data.branches.length})</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.branches.map((b) => {
                  const acActive = b.ac_active || 0;
                  const woOpen = (b.wo_pending || 0) + (b.wo_ready || 0);
                  return (
                    <button
                      key={b.id}
                      onClick={() => enterBranch(b)}
                      className="text-left bg-white border rounded-2xl p-4 hover:shadow-md hover:border-blue-300 transition-all"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-gray-800 truncate">{b.name}</h3>
                        {b.error && <span className="text-xs text-red-500">!</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-center">
                        <div className="rounded-lg bg-yellow-50 border border-yellow-200 py-2">
                          <div className="text-xl font-bold text-yellow-800">{acActive}</div>
                          <div className="text-xs text-yellow-700">ซ่อมค้าง</div>
                        </div>
                        <div className="rounded-lg bg-teal-50 border border-teal-200 py-2">
                          <div className="text-xl font-bold text-teal-800">{b.wo_ready || 0}</div>
                          <div className="text-xs text-teal-700">รอวางบิล</div>
                        </div>
                      </div>
                      <div className="flex justify-between text-xs text-gray-500 mt-3">
                        <span>ล้างค้าง {woOpen}</span>
                        <span className="text-blue-600">เข้าสาขา →</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
