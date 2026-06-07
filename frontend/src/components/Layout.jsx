import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Wrench, Database,
  Users, ChevronLeft, LogOut, Menu, X, Snowflake, CalendarCheck, Activity, FileUp,
  AlertCircle, TableProperties, Bell, Package, BadgeDollarSign, FilePlus2, Building2,
} from 'lucide-react'
import { useAuthStore } from '../store/auth'
import api from '../api/client'
import SyncIndicator from './SyncIndicator'

const NAV = [
  { path: '/simple-wo',    icon: FilePlus2,        label: 'ใบงาน',          roles: null },
  { path: '/',             icon: LayoutDashboard, label: 'Dashboard',     roles: null },
  // 'แจ้งซ่อม' (RepairLogs) hidden from nav — repair reporting lives in the
  // separate repair-report system. AC abnormalities are raised via "ขอเปิด".
  // Route /repair-logs still resolves; just no nav entry.
  { path: '/pm',             icon: CalendarCheck,   label: 'PM Schedule',  roles: null },
  { path: '/pm-plan',        icon: TableProperties, label: 'PM Plan',      roles: null },
  { path: '/cleaning-status',    icon: Activity,        label: 'ติดตามการล้าง', roles: null },
  { path: '/cleaning-dashboard', icon: LayoutDashboard, label: 'สรุปยอดล้าง',    roles: ['admin', 'checker', 'central_admin', 'approver'] },
  // '/work-orders' (ใบงาน เดิม) hidden from nav — superseded by Simple Work
  // Order above. Route still resolves by typing the URL directly.
  { path: '/parts',        icon: Package,          label: 'อะไหล่',         roles: null },
  { path: '/deductions',   icon: BadgeDollarSign,  label: 'หักเงิน',        roles: ['admin', 'central_admin', 'approver'] },
  { path: '/master',       icon: Database,         label: 'Master Data',   roles: ['admin', 'central_admin'] },
  { path: '/import',       icon: FileUp,           label: 'Import ข้อมูล', roles: ['admin', 'central_admin'] },
  { path: '/users',        icon: Users,            label: 'ผู้ใช้งาน',       roles: ['admin', 'super_admin'] },
  { path: '/branches',     icon: Building2,        label: 'จัดการสาขา',     superOnly: true },
]

export default function Layout({ children, title, back, actions }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [rejectedCount, setRejectedCount] = useState(0)

  const isTechAdmin = ['admin', 'technician', 'checker'].includes(user?.role)
  const [unreadCount, setUnreadCount] = useState(0)
  const notifPollRef = useRef(null)

  useEffect(() => {
    if (!isTechAdmin) return
    api.get('/stats/rejected-count')
      .then((r) => setRejectedCount(r.data.count))
      .catch(() => {})
  }, [isTechAdmin, location.pathname])

  // Poll unread notification count every 30s
  useEffect(() => {
    const fetchUnread = () => {
      api.get('/notifications/unread-count')
        .then((r) => setUnreadCount(r.data.count || 0))
        .catch(() => {})
    }
    fetchUnread()
    notifPollRef.current = setInterval(fetchUnread, 30_000)
    return () => clearInterval(notifPollRef.current)
  }, [])

  const visibleNav = NAV.filter((n) => {
    if (n.superOnly) return user?.isSuper || user?.role === 'super_admin'
    return !n.roles || n.roles.includes(user?.role)
  })

  const isActive = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)

  const doLogout = () => { logout(); navigate('/login') }

  const NavLink = ({ path, icon: Icon, label, badge, onClick }) => (
    <Link
      to={path}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
        isActive(path)
          ? 'bg-primary text-white'
          : 'text-blue-200 hover:bg-white/10 hover:text-white'
      }`}
    >
      <Icon className="shrink-0" style={{ width: 18, height: 18 }} />
      <span className="flex-1">{label}</span>
      {badge > 0 && (
        <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none">
          {badge}
        </span>
      )}
    </Link>
  )

  return (
    <div className="flex h-screen bg-page overflow-hidden">

      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex flex-col w-56 bg-primary-dark text-white shrink-0">
        <div className="flex items-center gap-2 px-5 py-5 border-b border-white/10">
          <Snowflake className="h-6 w-6 text-blue-300" />
          <div>
            <p className="font-bold text-sm leading-none">Air System</p>
            <p className="text-xs text-blue-400 mt-0.5">Technical Water</p>
          </div>
        </div>

        <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2">
          {visibleNav.map(({ path, icon: Icon, label }) => (
            <NavLink key={path} path={path} icon={Icon} label={label} />
          ))}

          {/* Shortcut: งานตีกลับ — admin/technician only */}
          {isTechAdmin && (
            <NavLink
              path="/work-orders?status=rejected"
              icon={AlertCircle}
              label="งานตีกลับ"
              badge={rejectedCount}
            />
          )}
        </nav>

        <div className="px-2 py-3 border-t border-white/10">
          <div className="px-3 py-2 mb-1">
            <p className="text-xs text-blue-300 truncate">{user?.name}</p>
            <p className="text-xs text-blue-500 capitalize">{user?.role}</p>
          </div>
          <button
            onClick={doLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-blue-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <LogOut className="h-4 w-4" /> ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed left-0 top-0 bottom-0 w-64 bg-primary-dark text-white z-50 flex flex-col lg:hidden">
            <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Snowflake className="h-5 w-5 text-blue-300" />
                <p className="font-bold text-sm">Air System</p>
              </div>
              <button onClick={() => setSidebarOpen(false)}><X className="h-5 w-5 text-blue-300" /></button>
            </div>
            <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2">
              {visibleNav.map(({ path, icon: Icon, label }) => (
                <NavLink key={path} path={path} icon={Icon} label={label} onClick={() => setSidebarOpen(false)} />
              ))}

              {/* Shortcut: งานตีกลับ — admin/technician only */}
              {isTechAdmin && (
                <NavLink
                  path="/work-orders?status=rejected"
                  icon={AlertCircle}
                  label="งานตีกลับ"
                  badge={rejectedCount}
                  onClick={() => setSidebarOpen(false)}
                />
              )}
            </nav>
            <div className="px-5 py-4 border-t border-white/10">
              <p className="text-xs text-blue-300">{user?.name}</p>
              <button onClick={doLogout} className="mt-2 text-sm text-blue-400 flex items-center gap-2">
                <LogOut className="h-4 w-4" /> ออกจากระบบ
              </button>
            </div>
          </aside>
        </>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-4 lg:px-6 py-3 flex items-center gap-3 shrink-0 z-10">
          {/* Hamburger — mobile */}
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-1 rounded-lg text-gray-500">
            <Menu className="h-5 w-5" />
          </button>

          {back && (
            <button onClick={() => navigate(back)} className="p-1 rounded-lg text-gray-500 hover:bg-gray-100">
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}

          <h1 className="flex-1 font-semibold text-gray-800 text-base truncate">{title || 'Air System'}</h1>
          <SyncIndicator />
          {/* Notification bell */}
          <button
            onClick={() => navigate('/notifications')}
            className="relative p-1 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold min-w-[16px] h-4 px-0.5 rounded-full flex items-center justify-center leading-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          {actions}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
