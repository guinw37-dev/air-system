import { useState, useEffect, useCallback } from 'react';
import dayjs from 'dayjs';
import api from '../api/client';
import Layout from '../components/Layout';
import { getDeviceId } from '../lib/device';

function fmtTime(ts) {
  return ts ? dayjs(ts).format('HH:mm') : '—';
}

function fmtDateTH(dateStr) {
  // dateStr can be a ISO timestamp or YYYY-MM-DD
  const d = dayjs(dateStr);
  return d.format('DD/MM/') + String(d.year() + 543);
}

/** Tries to get current GPS coords. Resolves with { lat, lng } or null on fail/deny/timeout. */
function getGPS() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

/** Inline badge showing GPS / in-area status from today's attendance row. */
function GeoStatusBadge({ today }) {
  if (!today) return null;
  const { in_area, geo_site } = today;
  if (in_area === true) {
    return (
      <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle" />
        อยู่ในพื้นที่ {geo_site || ''}
      </p>
    );
  }
  if (in_area === false) {
    return (
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1.5 align-middle" />
        อยู่นอกพื้นที่ลงเวลา
        {today.lat && today.lng ? (
          <a
            href={`https://www.google.com/maps?q=${today.lat},${today.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-2 underline hover:text-amber-900"
          >
            แผนที่
          </a>
        ) : null}
      </p>
    );
  }
  // in_area === null — no GPS recorded
  return (
    <p className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
      <span className="inline-block w-2 h-2 rounded-full bg-gray-300 mr-1.5 align-middle" />
      ไม่มีพิกัด GPS
    </p>
  );
}

const LEAVE_TYPE_LABELS = {
  sick: 'ลาป่วย',
  personal: 'ลากิจ',
  vacation: 'ลาพักร้อน',
  other: 'อื่นๆ',
};

const LEAVE_STATUS_STYLES = {
  pending: { label: 'รออนุมัติ', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  approved: { label: 'อนุมัติ', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  rejected: { label: 'ไม่อนุมัติ', cls: 'bg-red-50 text-red-700 border border-red-200' },
};

const LEAVE_FORM_INIT = { leave_type: 'sick', start_date: '', end_date: '', reason: '' };

export default function Attendance() {
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

  // --- Leave request form ---
  const [leaveForm, setLeaveForm] = useState(LEAVE_FORM_INIT);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveErr, setLeaveErr] = useState('');
  const [leaveSuccess, setLeaveSuccess] = useState('');

  // --- My leave list ---
  const [myLeaves, setMyLeaves] = useState([]);
  const [myLeavesLoading, setMyLeavesLoading] = useState(true);

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

  const loadMyLeaves = useCallback(async () => {
    setMyLeavesLoading(true);
    try {
      const r = await api.get('/attendance/leave/me');
      setMyLeaves(r.data || []);
    } catch {
      setMyLeaves([]);
    } finally {
      setMyLeavesLoading(false);
    }
  }, []);

  // สาขาบังคับ GPS ไหม (จาก /settings) — ถ้าบังคับและเปิด location ไม่ได้ → กันลงเวลา
  const [requireGps, setRequireGps] = useState(false);
  useEffect(() => {
    api.get('/attendance/settings').then((r) => setRequireGps(!!r.data?.require_gps)).catch(() => {});
  }, []);

  useEffect(() => { loadToday(); loadRecent(); loadMyLeaves(); }, [loadToday, loadRecent, loadMyLeaves]);

  async function doCheckIn() {
    setActionLoading('in'); setTodayErr('');
    try {
      const coords = await getGPS();
      if (requireGps && !coords) { setTodayErr('สาขานี้บังคับลงเวลาด้วย GPS — กรุณาเปิดตำแหน่ง (Location) แล้วลองใหม่'); return; }
      const body = { device_id: getDeviceId(), ...(coords || {}) };
      await api.post('/attendance/check-in', body);
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
      const coords = await getGPS();
      if (requireGps && !coords) { setTodayErr('สาขานี้บังคับลงเวลาด้วย GPS — กรุณาเปิดตำแหน่ง (Location) แล้วลองใหม่'); return; }
      const body = { device_id: getDeviceId(), ...(coords || {}) };
      await api.post('/attendance/check-out', body);
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

  function setLeaveField(k, v) {
    setLeaveForm((f) => ({ ...f, [k]: v }));
    setLeaveErr('');
    setLeaveSuccess('');
  }

  async function submitLeave(e) {
    e.preventDefault();
    setLeaveErr(''); setLeaveSuccess('');
    if (!leaveForm.start_date) { setLeaveErr('กรุณาระบุวันที่เริ่มลา'); return; }
    if (!leaveForm.end_date) { setLeaveErr('กรุณาระบุวันที่สิ้นสุด'); return; }
    if (leaveForm.end_date < leaveForm.start_date) { setLeaveErr('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม'); return; }
    setLeaveSubmitting(true);
    try {
      await api.post('/attendance/leave', {
        leave_type: leaveForm.leave_type,
        start_date: leaveForm.start_date,
        end_date: leaveForm.end_date,
        reason: leaveForm.reason,
      });
      setLeaveSuccess('ส่งใบลาแล้ว — รอผู้ดูแลอนุมัติ');
      setLeaveForm(LEAVE_FORM_INIT);
      await loadMyLeaves();
    } catch (e) {
      setLeaveErr(e.response?.data?.error || e.message);
    } finally {
      setLeaveSubmitting(false);
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

              {/* GPS / in-area status — shown once there's a row */}
              {today && <GeoStatusBadge today={today} />}

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

        {/* ===== LEAVE REQUEST SECTION ===== */}
        <div className="bg-white border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <span className="text-sm font-semibold text-gray-700">แจ้งลา</span>
            <p className="text-xs text-gray-400 mt-0.5">ยื่นใบลาเพื่อให้ผู้ดูแลอนุมัติ</p>
          </div>

          <form onSubmit={submitLeave} className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Leave type */}
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 font-medium mb-1">
                  ประเภทการลา <span className="text-red-500">*</span>
                </label>
                <select
                  value={leaveForm.leave_type}
                  onChange={(e) => setLeaveField('leave_type', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                >
                  <option value="sick">ลาป่วย</option>
                  <option value="personal">ลากิจ</option>
                  <option value="vacation">ลาพักร้อน</option>
                  <option value="other">อื่นๆ</option>
                </select>
              </div>

              {/* Start date */}
              <div>
                <label className="block text-xs text-gray-500 font-medium mb-1">
                  วันที่เริ่ม <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={leaveForm.start_date}
                  onChange={(e) => setLeaveField('start_date', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>

              {/* End date */}
              <div>
                <label className="block text-xs text-gray-500 font-medium mb-1">
                  ถึงวันที่ <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={leaveForm.end_date}
                  min={leaveForm.start_date || undefined}
                  onChange={(e) => setLeaveField('end_date', e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>

              {/* Reason */}
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-500 font-medium mb-1">เหตุผล</label>
                <textarea
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveField('reason', e.target.value)}
                  rows={2}
                  placeholder="ระบุเหตุผล (ไม่บังคับ)"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                />
              </div>
            </div>

            {leaveErr && <p className="text-sm text-red-600">{leaveErr}</p>}
            {leaveSuccess && <p className="text-sm text-emerald-600">{leaveSuccess}</p>}

            <button
              type="submit"
              disabled={leaveSubmitting}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {leaveSubmitting ? 'กำลังส่ง…' : 'ส่งใบลา'}
            </button>
          </form>
        </div>

        {/* ===== MY LEAVE LIST ===== */}
        <div className="bg-white border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <span className="text-sm font-semibold text-gray-700">ใบลาของฉัน</span>
          </div>

          {myLeavesLoading ? (
            <p className="text-sm text-gray-400 text-center py-6">กำลังโหลด…</p>
          ) : myLeaves.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีใบลา</p>
          ) : (
            <ul className="divide-y">
              {myLeaves.map((row) => {
                const st = LEAVE_STATUS_STYLES[row.status] || LEAVE_STATUS_STYLES.pending;
                return (
                  <li key={row.id} className="px-4 py-3 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium text-gray-800">
                          {LEAVE_TYPE_LABELS[row.leave_type] || row.leave_type}
                          <span className="text-gray-400 font-normal mx-1.5">·</span>
                          <span className="text-gray-600">
                            {fmtDateTH(row.start_date)}
                            {row.end_date !== row.start_date && ` – ${fmtDateTH(row.end_date)}`}
                          </span>
                        </p>
                        {row.reason && (
                          <p className="text-xs text-gray-500">{row.reason}</p>
                        )}
                        {(row.review_note || row.reviewer_name) && (
                          <p className="text-xs text-gray-500">
                            {row.reviewer_name && <span>โดย {row.reviewer_name}</span>}
                            {row.reviewer_name && row.review_note && <span className="mx-1">·</span>}
                            {row.review_note && <span>{row.review_note}</span>}
                          </p>
                        )}
                      </div>
                      <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${st.cls}`}>
                        {st.label}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

      </div>
    </Layout>
  );
}
