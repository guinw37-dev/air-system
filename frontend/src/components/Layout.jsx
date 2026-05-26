import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, ClipboardList, Wrench, Database,
  Users, ChevronLeft, LogOut, Menu, X, Snowflake, CalendarCheck, Activity, FileUp
} from 'lucide-react'
import { useAuthStore } from '../store/auth'

const NAV = [
  { path: '/',             icon: LayoutDashboard, label: 'Dashboard',     roles: null },
  { path: '/repair-logs',  icon: Wrench,           label: 'แจ้งซ่อม',       roles: null },
  { path: '/pm',             icon: CalendarCheck, label: 'PM Schedule',   roles: null },
  { path: '/cleaning-status',icon: Activity,      label: 'ติดตามการล้าง', roles: null },
  { path: '/work-orders',  icon: ClipboardList,   label: 'ใบงาน',          roles: null },
  { path: '/master',       icon: Database,         label: 'Master Data',   roles: ['admin', 'owner'] },
  { path: '/import',       icon: FileUp,           label: 'Import ข้อมูล', roles: ['admin', 'owner'] },
  { path: '/users',        icon: Users,            label: 'ผู้ใช้งาน',       roles: ['admin'] },
]

export default function Layout({ children, title, back, actions }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const visibleNav = NAV.filter((n) => !n.roles || n.roles.includes(user?.role))

  const isActive = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)

  const doLogout = () => { logout(); navigate('/login') }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">

      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex flex-col w-56 bg-blue-900 text-white shrink-0">
        <div className="flex items-center gap-2 px-5 py-5 border-b border-blue-800">
          <Snowflake className="h-6 w-6 text-blue-300" />
          <div>
            <p className="font-bold text-sm leading-none">Air System</p>
            <p className="text-xs text-blue-400 mt-0.5">Technical Water</p>
          </div>
        </div>

        <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2">
          {visibleNav.map(({ path, icon: Icon, label }) => (
            <Link
              key={path}
              to={path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive(path)
                  ? 'bg-blue-700 text-white'
                  : 'text-blue-200 hover:bg-blue-800 hover:text-white'
              }`}
            >
              <Icon className="h-4.5 w-4.5 shrink-0" style={{ width: 18, height: 18 }} />
              {label}
            </Link>
          ))}
        </nav>

        <div className="px-2 py-3 border-t border-blue-800">
          <div className="px-3 py-2 mb-1">
            <p className="text-xs text-blue-300 truncate">{user?.name}</p>
            <p className="text-xs text-blue-500 capitalize">{user?.role}</p>
          </div>
          <button
            onClick={doLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-blue-300 hover:bg-blue-800 hover:text-white transition-colors"
          >
            <LogOut className="h-4 w-4" /> ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed left-0 top-0 bottom-0 w-64 bg-blue-900 text-white z-50 flex flex-col lg:hidden">
            <div className="flex items-center justify-between px-5 py-5 border-b border-blue-800">
              <div className="flex items-center gap-2">
                <Snowflake className="h-5 w-5 text-blue-300" />
                <p className="font-bold text-sm">Air System</p>
              </div>
              <button onClick={() => setSidebarOpen(false)}><X className="h-5 w-5 text-blue-300" /></button>
            </div>
            <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2">
              {visibleNav.map(({ path, icon: Icon, label }) => (
                <Link
                  key={path}
                  to={path}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${
                    isActive(path) ? 'bg-blue-700 text-white' : 'text-blue-200'
                  }`}
                >
                  <Icon style={{ width: 18, height: 18 }} />
                  {label}
                </Link>
              ))}
            </nav>
            <div className="px-5 py-4 border-t border-blue-800">
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
