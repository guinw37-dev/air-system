import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Wrench, Database,
  Users, ChevronLeft, ChevronDown, LogOut, Menu, X, CalendarCheck, Activity, FileUp,
  AlertCircle, TableProperties, Bell, Package, BadgeDollarSign, FilePlus2, Building2, ClipboardList,
  Clock, BarChart3, FileBarChart, CalendarRange, CalendarClock, MessageCircle,
} from 'lucide-react'
import { useAuthStore } from '../store/auth'
import api from '../api/client'
import SyncIndicator from './SyncIndicator'
import Logo from './Logo'

// Trimmed nav. Hidden entries (Dashboard, PM Schedule, PM Plan, ติดตามการล้าง,
// อะไหล่, สรุปยอดล้าง) — routes still resolve by URL; just no sidebar link.
const NAV = [
  { path: '/dashboard',    icon: LayoutDashboard,  label: 'ภาพรวม',         roles: null },
  { path: '/wash-report',  icon: FileBarChart,     label: 'รายงานล้างแอร์',  roles: null },
  { path: '/simple-wo',    icon: FilePlus2,        label: 'ใบงาน',          roles: null,
    children: [
      { to: '/simple-wo',                              label: 'งานค้าง (ยังไม่เสร็จ)' },
      { to: '/simple-wo?pending=supervisor',           label: 'รอหัวหน้าช่างเซ็น' },
      { to: '/simple-wo?pending=building',             label: 'รอช่างอาคารเซ็น' },
      { to: '/simple-wo?pending=engineer',             label: 'รอวิศวกรรมเซ็น' },
      { to: '/simple-wo?view=ready',                   label: 'ดำเนินการเสร็จสิ้น', roles: ['admin', 'super_admin'] },
      { to: '/simple-wo?view=all',                     label: 'ทั้งหมด' },
    ] },
  { path: '/ac-repair',    icon: Wrench,           label: 'งานซ่อมแอร์',     roles: null },
  { path: '/attendance',         icon: Clock,       label: 'ลงเวลา',               roles: null },
  { path: '/attendance-summary', icon: BarChart3,  label: 'สรุปการลงเวลาช่าง',   roles: ['admin', 'super_admin'] },
  { path: '/unit-history', icon: Activity,         label: 'ประวัติแอร์',     roles: null },
  { path: '/wash-units',   icon: ClipboardList,    label: 'ทะเบียนแอร์',    roles: null },
  { path: '/wash-calendar', icon: CalendarRange,   label: 'ปฏิทินล้างแอร์',  roles: null },
  { path: '/targets',      icon: CalendarCheck,    label: 'เป้าหมายล้าง',   roles: ['admin', 'super_admin'] },
  { path: '/wash-adjust',  icon: TableProperties,  label: 'ปรับยอดล้าง',    roles: ['admin', 'super_admin'] },
  { path: '/week-config',  icon: CalendarClock,    label: 'ตั้งค่าสัปดาห์',   roles: ['admin', 'super_admin'] },
  { path: '/master',       icon: Database,         label: 'Master Data',   roles: ['admin'] },
  { path: '/import',       icon: FileUp,           label: 'Import ข้อมูล', roles: ['admin'] },
  { path: '/users',        icon: Users,            label: 'ผู้ใช้งาน',       roles: ['admin', 'super_admin'] },
  { path: '/line-settings', icon: MessageCircle,   label: 'ตั้งค่า LINE',    superOnly: true },
  { path: '/branches',     icon: Building2,        label: 'จัดการสาขา',     superOnly: true },
]

export default function Layout({ children, title, back, actions }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [unreadCount, setUnreadCount] = useState(0)
  const notifPollRef = useRef(null)

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

  const NavLink = ({ path, icon: Icon, label, badge, onClick }) => {
    const active = isActive(path)
    return (
      <Link
        to={path}
        onClick={onClick}
        className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
          active
            ? 'bg-white text-primary-dark shadow-sm shadow-black/10'
            : 'text-blue-100/80 hover:bg-white/10 hover:text-white'
        }`}
      >
        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-sky-300" />}
        <Icon className="shrink-0" style={{ width: 18, height: 18 }} />
        <span className="flex-1">{label}</span>
        {badge > 0 && (
          <span className="bg-rose-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center leading-none">
            {badge}
          </span>
        )}
      </Link>
    )
  }

  // Is a sub-link (with a ?pending=…/?view=… query) the one currently shown?
  const subActive = (to) => {
    const [p, q] = to.split('?')
    const w = new URLSearchParams(q || ''), h = new URLSearchParams(location.search)
    return location.pathname === p
      && (w.get('pending') || '') === (h.get('pending') || '')
      && (w.get('view') || '') === (h.get('view') || '')
  }

  // Collapsible nav group (e.g. ใบงาน → ทั้งหมด / รอแต่ละขั้นเซ็น). Open by default
  // when its base path is active.
  const NavGroup = ({ item, onNavigate }) => {
    const Icon = item.icon
    const [open, setOpen] = useState(isActive(item.path))
    const children = item.children.filter((c) => !c.roles || c.roles.includes(user?.role))
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
            isActive(item.path) ? 'text-white' : 'text-blue-100/80 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Icon className="shrink-0" style={{ width: 18, height: 18 }} />
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="ml-4 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-white/15 pl-2">
            {children.map((c) => (
              <Link
                key={c.to}
                to={c.to}
                onClick={onNavigate}
                className={`px-3 py-2 rounded-lg text-[13px] transition-colors ${
                  subActive(c.to) ? 'bg-white/15 text-white font-medium' : 'text-blue-100/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                {c.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Render a nav entry as either a leaf link or a collapsible group.
  const renderNav = (item, onNavigate) =>
    item.children
      ? <NavGroup key={item.path} item={item} onNavigate={onNavigate} />
      : <NavLink key={item.path} path={item.path} icon={item.icon} label={item.label} onClick={onNavigate} />


  return (
    <div className="flex h-screen bg-page overflow-hidden">

      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex flex-col w-60 bg-gradient-to-b from-primary-dark via-primary-dark to-primary text-white shrink-0">
        <div className="flex items-center gap-3 px-5 py-5">
          <Logo size={40} className="shrink-0 drop-shadow" />
          <div>
            <p className="font-bold text-[15px] leading-none tracking-tight">Air System</p>
            <p className="text-xs text-blue-300/80 mt-1">Technical Water Co.,Ltd</p>
          </div>
        </div>
        <div className="mx-4 border-t border-white/10" />

        <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2 overflow-y-auto">
          {visibleNav.map((item) => renderNav(item))}
        </nav>

        <div className="px-3 py-3 border-t border-white/10">
          <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
            <div className="h-8 w-8 rounded-full bg-white/15 flex items-center justify-center text-sm font-bold shrink-0">
              {user?.name?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-white truncate leading-tight">{user?.name}</p>
              <p className="text-xs text-blue-300/70 capitalize">{user?.role}</p>
            </div>
          </div>
          <button
            onClick={doLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-blue-100/80 hover:bg-white/10 hover:text-white transition-colors"
          >
            <LogOut className="h-4 w-4" /> ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed left-0 top-0 bottom-0 w-64 bg-gradient-to-b from-primary-dark via-primary-dark to-primary text-white z-50 flex flex-col lg:hidden">
            <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <Logo size={34} />
                <p className="font-bold text-sm tracking-tight">Air System</p>
              </div>
              <button onClick={() => setSidebarOpen(false)}><X className="h-5 w-5 text-blue-200" /></button>
            </div>
            <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2 overflow-y-auto">
              {visibleNav.map((item) => renderNav(item, () => setSidebarOpen(false)))}
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

        {/* Page content — extra bottom padding on mobile for the tab bar */}
        <main className="flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>

        {/* Bottom tab bar — mobile only (thumb-reachable for field techs) */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-line flex items-stretch pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_rgba(22,62,94,.06)]">
          {[
            { to: '/simple-wo',    icon: FilePlus2, label: 'ใบงาน' },
            { to: '/ac-repair',    icon: Wrench,    label: 'ซ่อมแอร์' },
            { to: '/notifications', icon: Bell,     label: 'แจ้งเตือน', badge: unreadCount },
          ].map(({ to, icon: Icon, label, badge }) => {
            const active = isActive(to)
            return (
              <Link key={to} to={to} className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] ${active ? 'text-primary' : 'text-ink-muted'}`}>
                <Icon style={{ width: 22, height: 22 }} />
                <span className="text-[11px] font-medium">{label}</span>
                {badge > 0 && (
                  <span className="absolute top-1.5 right-[22%] bg-rose-500 text-white text-[9px] font-bold min-w-[15px] h-[15px] px-0.5 rounded-full flex items-center justify-center leading-none">{badge > 99 ? '99+' : badge}</span>
                )}
              </Link>
            )
          })}
          <button onClick={() => setSidebarOpen(true)} className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] text-ink-muted">
            <Menu style={{ width: 22, height: 22 }} />
            <span className="text-[11px] font-medium">เมนู</span>
          </button>
        </nav>
      </div>
    </div>
  )
}
