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

  useEffect(() => { loadToday(); loadRecent(); }, [loadToday, loadRecent]);

  async function doCheckIn() {
    setActionLoading('in'); setTodayErr('');
    try {
      const coords = await getGPS();
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

      </div>
    </Layout>
  );
}
