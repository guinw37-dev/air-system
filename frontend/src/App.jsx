import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import { useTenantStore } from './store/tenant'
import { initOfflineSync } from './lib/offline/sync'
import ErrorBoundary from './components/ErrorBoundary'
import Login from './pages/Login'
import WorkOrderList from './pages/WorkOrderList'
import WorkOrderCreate from './pages/WorkOrderCreate'
import WorkOrderDetail from './pages/WorkOrderDetail'
import WorkOrderUnitDetail from './pages/WorkOrderUnitDetail'
import RepairLogs from './pages/RepairLogs'
import MasterData from './pages/MasterData'
import Users from './pages/Users'
import ImportPage from './pages/ImportPage'
import SignPage from './pages/SignPage'
import Notifications from './pages/Notifications'
import UnitDetail from './pages/UnitDetail'
import Deductions from './pages/Deductions'
import SimpleWoList from './pages/SimpleWoList'
import SimpleWoForm from './pages/SimpleWoForm'
import SimpleWoDetail from './pages/SimpleWoDetail'
import Branches from './pages/Branches'
import Landing from './pages/Landing'
import SelectBranch from './pages/SelectBranch'

function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.token)
  return token ? children : <Navigate to="/login" replace />
}

function RequireRole({ children, roles }) {
  const user = useAuthStore((s) => s.user)
  if (!roles.includes(user?.role)) return <Navigate to="/" replace />
  return children
}

// Apex root shows the branch landing when no one is logged in; everywhere else
// (a branch, or an authenticated session) goes to the dashboard.
function Home() {
  const token = useAuthStore((s) => s.token)
  const isBranch = useTenantStore((s) => s.isBranch)
  if (!isBranch && !token) return <Landing />
  return <Navigate to="/simple-wo" replace />
}

export default function App() {
  const resolved = useTenantStore((s) => s.resolved)
  useEffect(() => {
    initOfflineSync()
    useTenantStore.getState().resolve()
  }, [])
  // Block render until the branch is resolved so the first API calls (and login)
  // carry the correct X-Branch.
  if (!resolved) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#64748b' }}>
        กำลังโหลด…
      </div>
    )
  }
  return (
    <BrowserRouter>
      <ErrorBoundary>
      <Routes>
        {/* Public routes — no auth required */}
        <Route path="/login" element={<Login />} />
        <Route path="/sign/:token" element={<SignPage />} />

        <Route path="/" element={<Home />} />
        <Route path="/select-branch" element={<RequireAuth><SelectBranch /></RequireAuth>} />

        {/* Work Orders — phase-2 routes */}
        <Route path="/work-orders" element={<RequireAuth><WorkOrderList /></RequireAuth>} />
        <Route path="/work-orders/new" element={<RequireAuth><WorkOrderCreate /></RequireAuth>} />
        <Route path="/work-orders/:id" element={<RequireAuth><WorkOrderDetail /></RequireAuth>} />
        {/* New unit-level detail page */}
        <Route path="/work-orders/:id/units/:unitId" element={<RequireAuth><WorkOrderUnitDetail /></RequireAuth>} />

        {/* Simple Work Orders — one-step flow */}
        <Route path="/simple-wo" element={<RequireAuth><SimpleWoList /></RequireAuth>} />
        <Route path="/simple-wo/new" element={<RequireAuth><SimpleWoForm /></RequireAuth>} />
        <Route path="/simple-wo/:id/edit" element={<RequireAuth><SimpleWoForm /></RequireAuth>} />
        <Route path="/simple-wo/:id" element={<RequireAuth><SimpleWoDetail /></RequireAuth>} />

        <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />
        <Route path="/repair-logs" element={<RequireAuth><RepairLogs /></RequireAuth>} />
        <Route path="/import" element={
          <RequireAuth><RequireRole roles={['admin', 'central_admin']}><ImportPage /></RequireRole></RequireAuth>
        } />
        <Route path="/master" element={
          <RequireAuth><RequireRole roles={['admin', 'central_admin']}><MasterData /></RequireRole></RequireAuth>
        } />
        <Route path="/users" element={
          <RequireAuth><RequireRole roles={['admin', 'super_admin']}><Users /></RequireRole></RequireAuth>
        } />
        <Route path="/branches" element={
          <RequireAuth><RequireRole roles={['admin', 'super_admin']}><Branches /></RequireRole></RequireAuth>
        } />
        <Route path="/units/:id" element={<RequireAuth><UnitDetail /></RequireAuth>} />
        <Route path="/deductions" element={
          <RequireAuth><RequireRole roles={['admin', 'central_admin', 'approver', 'checker']}><Deductions /></RequireRole></RequireAuth>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
