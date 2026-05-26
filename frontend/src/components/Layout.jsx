import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, LayoutDashboard, ClipboardList, Wrench, LogOut } from 'lucide-react'
import { useAuthStore } from '../store/auth'

export default function Layout({ children, title, back, actions }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'หน้าหลัก' },
    { path: '/work-orders', icon: ClipboardList, label: 'ใบงาน' },
    { path: '/repair-logs', icon: Wrench, label: 'แจ้งซ่อม' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-lg mx-auto">
      {/* Top Bar */}
      <header className="bg-blue-700 text-white px-4 py-3 flex items-center gap-3 sticky top-0 z-30 shadow-md">
        {back && (
          <button onClick={() => navigate(back)} className="p-1 -ml-1 rounded-lg active:bg-blue-600">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <h1 className="flex-1 font-semibold text-base truncate">{title || 'Air System'}</h1>
        {actions}
        {!back && (
          <button
            onClick={() => { logout(); navigate('/login') }}
            className="p-1 rounded-lg active:bg-blue-600"
          >
            <LogOut className="h-5 w-5" />
          </button>
        )}
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-24">
        {children}
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-30 max-w-lg mx-auto">
        {navItems.map(({ path, icon: Icon, label }) => {
          const active = path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(path)
          return (
            <Link
              key={path}
              to={path}
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 text-xs ${
                active ? 'text-blue-600' : 'text-gray-500'
              }`}
            >
              <Icon className={`h-6 w-6 ${active ? 'text-blue-600' : 'text-gray-400'}`} />
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
