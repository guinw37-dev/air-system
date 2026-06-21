import { useState, useEffect, useCallback, Fragment } from 'react';
import dayjs from 'dayjs';
import api from '../api/client';
import Layout from '../components/Layout';
import { useAuthStore } from '../store/auth';
import { getDeviceId } from '../lib/device';

const ADMIN_ROLES = ['admin', 'super_admin'];

function fmtTime(ts) {
  return ts ? dayjs(ts).format('HH:mm') : '—';
}

function fmtDateTH(dateStr) {
  // dateStr can be a ISO timestamp or YYYY-MM-DD
  const d = dayjs(dateStr);
  return d.format('DD/MM/') + String(d.year() + 543);
}

export default function Attendance() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = ADMIN_ROLES.includes(user?.role);

  // --- My today card ---
  const [today, setToday] = useState(null);       // null = not loaded, false = no row
  const [todayLoading, setTodayLoading] = useState(true);
  const [todayErr, setTodayErr] = useState('');
  const [actionLoading, setActionLoading] = useState('');

  // --- My recent 7 days ---
  const [recent, setRecent] = useState([]);
  const [recentLoading, setRecentLoading] = useState(true);

  // --- Note ---
  const [note, setNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteMsg, setNoteMsg] = useState('');

  // --- Admin table ---
  const [adminDate, setAdminDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [adminRows, setAdminRows] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminErr, setAdminErr] = useState('');

  const loadToday = useCallback(async () => {
    setTodayLoading(true); setTodayErr('');
    try {
      const r = await api.get('/attendance/me/today');
      setToday(r.data || false);
      if (r.data?.note) setNote(r.data.note);
    } catch (e) {
      setTodayErr(e.response?.data?.error || e.message);
      setToday(false);
    } finally {
      setTodayLoading(false);
    }
  }, []);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const r = await api.get('/attendance/me', { params: { days: 7 } });
      setRecent(r.data || []);
    } catch {
      setRecent([]);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  const loadAdmin = useCallback(async (date) => {
    if (!isAdmin) return;
    setAdminLoading(true); setAdminErr('');
    try {
      const r = await api.get('/attendance', { params: { date } });
      setAdminRows(r.data || []);
    } catch (e) {
      setAdminErr(e.response?.data?.error || e.message);
      setAdminRows([]);
    } finally {
      setAdminLoading(false);
    }
  }, [isAdmin]);

  // --- Admin monthly summary ---
  const [sumMonth, setSumMonth] = useState(dayjs().format('YYYY-MM'));
  const [sumRows, setSumRows] = useState([]);
  const [sumLoading, setSumLoading] = useState(false);

  const loadSummary = useCallback(async (month) => {
    if (!isAdmin) return;
    setSumLoading(true);
    try {
      const r = await api.get('/attendance/summary', { params: { month } });
      setSumRows(r.data || []);
    } catch {
      setSumRows([]);
    } finally {
      setSumLoading(false);
    }
  }, [isAdmin]);

  const exportSummaryCsv = () => {
    const head = ['ช่าง', 'วันเข้างาน', 'วันครบ(เข้า+ออก)'];
    const lines = sumRows.map((r) => [r.user_name || '', r.days, r.days_complete].join(','));
    const csv = '﻿' + [head.join(','), ...lines].join('\n');   // BOM → Excel อ่านไทยถูก
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `สรุปลงเวลา-${sumMonth}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // --- Admin device behavior ---
  const [devRows, setDevRows] = useState([]);
  const [devLoading, setDevLoading] = useState(false);
  const [devOpen, setDevOpen] = useState(null);   // expanded user_id
  const loadDevices = useCallback(async () => {
    if (!isAdmin) return;
    setDevLoading(true);
    try {
      const r = await api.get('/attendance/devices');
      setDevRows(r.data || []);
    } catch { setDevRows([]); } finally { setDevLoading(false); }
  }, [isAdmin]);

  useEffect(() => { loadToday(); loadRecent(); }, [loadToday, loadRecent]);
  useEffect(() => { loadAdmin(adminDate); }, [loadAdmin, adminDate]);
  useEffect(() => { loadSummary(sumMonth); }, [loadSummary, sumMonth]);
  useEffect(() => { loadDevices(); }, [loadDevices]);

  async function doCheckIn() {
    setActionLoading('in'); setTodayErr('');
    try {
      await api.post('/attendance/check-in', { device_id: getDeviceId() });
      await loadToday(); await loadRecent();
    } catch (e) {
      setTodayErr(e.response?.data?.error || e.message);
    } finally {
      setActionLoading('');
    }
  }

  async function doCheckOut() {
    setActionLoading('out'); setTodayErr('');
    try {
      await api.post('/attendance/check-out', { device_id: getDeviceId() });
      await loadToday(); await loadRecent();
    } catch (e) {
      setTodayErr(e.response?.data?.error || e.message);
    } finally {
      setActionLoading('');
    }
  }

  async function saveNote(e) {
    e.preventDefault();
    setNoteSaving(true); setNoteMsg('');
    try {
      await api.post('/attendance/me/note', { note });
      setNoteMsg('บันทึกหมายเหตุแล้ว');
      await loadToday();
    } catch (e) {
      setNoteMsg(e.response?.data?.error || e.message);
    } finally {
      setNoteSaving(false);
    }
  }

  // Status badge for today
  const checkedIn = !!today?.check_in_at;
  const checkedOut = !!today?.check_out_at;

  let statusLabel = 'ยังไม่ได้ลงเวลา';
  let statusColor = 'bg-gray-100 text-gray-500';
  if (checkedIn && !checkedOut) { statusLabel = 'เข้างานแล้ว · รอออกงาน'; statusColor = 'bg-amber-50 text-amber-700 border border-amber-200'; }
  if (checkedIn && checkedOut) { statusLabel = 'ครบทั้งวัน'; statusColor = 'bg-emerald-50 text-emerald-700 border border-emerald-200'; }

  const todayLabel = fmtDateTH(dayjs().format('YYYY-MM-DD'));

  return (
    <Layout>
      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">

        {/* Page heading */}
        <div>
          <h1 className="text-xl font-bold text-gray-900">ลงเวลาเข้า-ออกงาน</h1>
          <p className="text-sm text-gray-500 mt-0.5">วันที่ {todayLabel}</p>
        </div>

        {/* ===== TODAY CARD ===== */}
        <div className="bg-white border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-gray-800">สถานะวันนี้</span>
            {!todayLoading && (
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor}`}>
                {statusLabel}
              </span>
            )}
          </div>

          {todayLoading ? (
            <p className="text-sm text-gray-400 text-center py-4">กำลังโหลด…</p>
          ) : (
            <>
              {/* Time display row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">เวลาเข้างาน</p>
                  <p className={`text-2xl font-bold tabular-nums ${checkedIn ? 'text-emerald-600' : 'text-gray-300'}`}>
                    {fmtTime(today?.check_in_at)}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">เวลาออกงาน</p>
                  <p className={`text-2xl font-bold tabular-nums ${checkedOut ? 'text-blue-600' : 'text-gray-300'}`}>
                    {fmtTime(today?.check_out_at)}
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={doCheckIn}
                  disabled={checkedIn || actionLoading === 'in'}
                  className="py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600"
                >
                  {actionLoading === 'in' ? 'กำลังบันทึก…' : checkedIn ? `เข้างาน ${fmtTime(today.check_in_at)}` : 'เข้างาน'}
                </button>
                <button
                  onClick={doCheckOut}
                  disabled={!checkedIn || checkedOut || actionLoading === 'out'}
                  className="py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-600"
                >
                  {actionLoading === 'out' ? 'กำลังบันทึก…' : checkedOut ? `ออกงาน ${fmtTime(today.check_out_at)}` : 'ออกงาน'}
                </button>
              </div>

              {todayErr && <p className="text-sm text-red-600">{todayErr}</p>}

              {/* Note */}
              <form onSubmit={saveNote} className="space-y-2">
                <label className="block text-xs text-gray-500 font-medium">หมายเหตุ (ไม่บังคับ)</label>
                <div className="flex gap-2">
                  <input
                    value={note}
                    onChange={(e) => { setNote(e.target.value); setNoteMsg(''); }}
                    placeholder="เช่น ลา ป่วย มาสาย…"
                    className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <button
                    type="submit"
                    disabled={noteSaving}
                    className="px-4 py-2 bg-gray-700 text-white rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50 whitespace-nowrap"
                  >
                    {noteSaving ? 'บันทึก…' : 'บันทึก'}
                  </button>
                </div>
                {noteMsg && <p className="text-xs text-emerald-600">{noteMsg}</p>}
              </form>
            </>
          )}
        </div>

        {/* ===== RECENT 7 DAYS ===== */}
        <div className="bg-white border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <span className="text-sm font-semibold text-gray-700">ย้อนหลัง 7 วัน</span>
          </div>
          {recentLoading ? (
            <p className="text-sm text-gray-400 text-center py-6">กำลังโหลด…</p>
          ) : recent.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">ยังไม่มีข้อมูล</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs border-b">
                  <th className="py-2.5 px-4">วันที่</th>
                  <th className="py-2.5 px-3">เข้างาน</th>
                  <th className="py-2.5 px-3">ออกงาน</th>
                  <th className="py-2.5 px-3 hidden sm:table-cell">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row, i) => (
                  <tr key={row.work_date || i} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2.5 px-4 text-gray-700 whitespace-nowrap">{fmtDateTH(row.work_date)}</td>
                    <td className={`py-2.5 px-3 tabular-nums font-medium ${row.check_in_at ? 'text-emerald-600' : 'text-gray-300'}`}>
                      {fmtTime(row.check_in_at)}
                    </td>
                    <td className={`py-2.5 px-3 tabular-nums font-medium ${row.check_out_at ? 'text-blue-600' : 'text-gray-300'}`}>
                      {fmtTime(row.check_out_at)}
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 text-xs hidden sm:table-cell">{row.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ===== ADMIN TABLE ===== */}
        {isAdmin && (
          <div className="bg-white border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm font-semibold text-gray-700">ตารางการเข้างานช่าง</span>
              <input
                type="date"
                value={adminDate}
                onChange={(e) => setAdminDate(e.target.value)}
                className="border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>

            {adminLoading ? (
              <p className="text-sm text-gray-400 text-center py-6">กำลังโหลด…</p>
            ) : adminErr ? (
              <p className="text-sm text-red-500 text-center py-6">{adminErr}</p>
            ) : adminRows.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีช่างลงเวลา</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 text-xs border-b">
                      <th className="py-2.5 px-4">ช่าง</th>
                      <th className="py-2.5 px-3">เข้างาน</th>
                      <th className="py-2.5 px-3">ออกงาน</th>
                      <th className="py-2.5 px-3">เครื่อง</th>
                      <th className="py-2.5 px-3 hidden sm:table-cell">หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminRows.map((row, i) => {
                      const hasIn = !!row.check_in_at;
                      const hasOut = !!row.check_out_at;
                      return (
                        <tr key={row.user_id || i} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="py-2.5 px-4 font-medium text-gray-800">{row.user_name || '—'}</td>
                          <td className={`py-2.5 px-3 tabular-nums font-medium ${hasIn ? 'text-emerald-600' : 'text-gray-300'}`}>
                            {fmtTime(row.check_in_at)}
                          </td>
                          <td className={`py-2.5 px-3 tabular-nums font-medium ${hasOut ? 'text-blue-600' : 'text-gray-300'}`}>
                            {fmtTime(row.check_out_at)}
                          </td>
                          <td className="py-2.5 px-3 text-xs">
                            {row.shared_device ? (
                              <span className="text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 whitespace-nowrap" title="เครื่องนี้ถูกใช้ลงเวลาหลายคน — อาจลงแทนกัน">
                                ⚠ เครื่องซ้ำ
                              </span>
                            ) : row.other_device ? (
                              <span className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 whitespace-nowrap" title="ลงจากเครื่องที่ไม่ใช่เครื่องประจำของช่างคนนี้">
                                เครื่องไม่ประจำ
                              </span>
                            ) : row.device_id ? (
                              <span className="text-gray-400 font-mono">…{String(row.device_id).slice(-5)}</span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="py-2.5 px-3 text-gray-500 text-xs hidden sm:table-cell">{row.note || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ===== ADMIN MONTHLY SUMMARY ===== */}
        {isAdmin && (
          <div className="bg-white border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm font-semibold text-gray-700">สรุปการเข้างานรายเดือน</span>
              <div className="flex items-center gap-2">
                <input
                  type="month"
                  value={sumMonth}
                  onChange={(e) => setSumMonth(e.target.value)}
                  className="border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <button
                  onClick={exportSummaryCsv}
                  disabled={sumRows.length === 0}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-40 whitespace-nowrap"
                >
                  ดาวน์โหลด CSV
                </button>
              </div>
            </div>

            {sumLoading ? (
              <p className="text-sm text-gray-400 text-center py-6">กำลังโหลด…</p>
            ) : sumRows.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีข้อมูลในเดือนนี้</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 text-xs border-b">
                      <th className="py-2.5 px-4">ช่าง</th>
                      <th className="py-2.5 px-3 text-center">วันเข้างาน</th>
                      <th className="py-2.5 px-3 text-center">วันครบ (เข้า+ออก)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sumRows.map((row, i) => (
                      <tr key={row.user_id || i} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="py-2.5 px-4 font-medium text-gray-800">{row.user_name || '—'}</td>
                        <td className="py-2.5 px-3 text-center tabular-nums font-bold text-emerald-600">{row.days}</td>
                        <td className="py-2.5 px-3 text-center tabular-nums text-blue-600">{row.days_complete}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ===== ADMIN DEVICE BEHAVIOR ===== */}
        {isAdmin && (
          <div className="bg-white border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50">
              <span className="text-sm font-semibold text-gray-700">พฤติกรรมเครื่องของช่าง</span>
              <p className="text-xs text-gray-400 mt-0.5">ช่างใช้กี่เครื่องลงเวลา · ใช้หลายเครื่อง = น่าตรวจ (ยังไม่บังคับ)</p>
            </div>
            {devLoading ? (
              <p className="text-sm text-gray-400 text-center py-6">กำลังโหลด…</p>
            ) : devRows.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีข้อมูล</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 text-xs border-b">
                      <th className="py-2.5 px-4">ช่าง</th>
                      <th className="py-2.5 px-3 text-center">จำนวนเครื่อง</th>
                      <th className="py-2.5 px-3 text-center">ลงเวลารวม</th>
                      <th className="py-2.5 px-3">ล่าสุด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devRows.map((row, i) => (
                      <Fragment key={row.user_id || i}>
                        <tr
                          onClick={() => setDevOpen(devOpen === row.user_id ? null : row.user_id)}
                          className="border-b last:border-0 hover:bg-gray-50 cursor-pointer">
                          <td className="py-2.5 px-4 font-medium text-gray-800">{row.user_name || '—'}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span className={`tabular-nums font-bold ${row.device_count > 1 ? 'text-amber-600' : 'text-gray-700'}`}>
                              {row.device_count}
                            </span>
                            {row.device_count > 1 && <span className="text-amber-500 ml-1">⚠</span>}
                          </td>
                          <td className="py-2.5 px-3 text-center tabular-nums text-gray-500">{row.total_uses}</td>
                          <td className="py-2.5 px-3 text-gray-500 text-xs">{row.last_seen ? fmtDateTH(row.last_seen) : '—'}</td>
                        </tr>
                        {devOpen === row.user_id && (
                          <tr className="bg-gray-50/60">
                            <td colSpan={4} className="px-4 py-2">
                              <div className="space-y-1">
                                {(row.devices || []).map((d, j) => (
                                  <div key={d.device_id || j} className="flex items-center gap-2 text-xs text-gray-600">
                                    <span className="font-mono text-gray-400">…{String(d.device_id).slice(-6)}</span>
                                    {j === 0 && <span className="text-emerald-600 border border-emerald-200 bg-emerald-50 rounded px-1">เครื่องประจำ</span>}
                                    <span className="flex-1" />
                                    <span>ลง {d.use_count} ครั้ง</span>
                                    <span className="text-gray-400">· ล่าสุด {fmtDateTH(d.last_seen)}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>
    </Layout>
  );
}
