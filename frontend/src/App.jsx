import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import { initOfflineSync } from './lib/offline/sync'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import WorkOrderList from './pages/WorkOrderList'
import WorkOrderCreate from './pages/WorkOrderCreate'
import WorkOrderDetail from './pages/WorkOrderDetail'
import WorkOrderUnitDetail from './pages/WorkOrderUnitDetail'
import AcItemDetail from './pages/AcItemDetail'
import RepairLogs from './pages/RepairLogs'
import MasterData from './pages/MasterData'
import Users from './pages/Users'
import PMSchedule from './pages/PMSchedule'
import PMPlan from './pages/PMPlan'
import CleaningStatus from './pages/CleaningStatus'
import CleaningDashboard from './pages/CleaningDashboard'
import ImportPage from './pages/ImportPage'

function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.token)
  return token ? children : <Navigate to="/login" replace />
}

function RequireRole({ children, roles }) {
  const user = useAuthStore((s) => s.user)
  if (!roles.includes(user?.role)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  useEffect(() => { initOfflineSync() }, [])
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />

        {/* Work Orders — phase-2 routes */}
        <Route path="/work-orders" element={<RequireAuth><WorkOrderList /></RequireAuth>} />
        <Route path="/work-orders/new" element={<RequireAuth><WorkOrderCreate /></RequireAuth>} />
        <Route path="/work-orders/:id" element={<RequireAuth><WorkOrderDetail /></RequireAuth>} />
        {/* New unit-level detail page */}
        <Route path="/work-orders/:id/units/:unitId" element={<RequireAuth><WorkOrderUnitDetail /></RequireAuth>} />
        {/* Keep old items route alive for any existing links */}
        <Route path="/work-orders/:id/items/:itemId" element={<RequireAuth><AcItemDetail /></RequireAuth>} />

        <Route path="/repair-logs" element={<RequireAuth><RepairLogs /></RequireAuth>} />
        <Route path="/pm" element={<RequireAuth><PMSchedule /></RequireAuth>} />
        <Route path="/pm-plan" element={<RequireAuth><PMPlan /></RequireAuth>} />
        <Route path="/cleaning-status" element={<RequireAuth><CleaningStatus /></RequireAuth>} />
        <Route path="/cleaning-dashboard" element={<RequireAuth><CleaningDashboard /></RequireAuth>} />
        <Route path="/import" element={
          <RequireAuth><RequireRole roles={['admin', 'central_admin', 'approver']}><ImportPage /></RequireRole></RequireAuth>
        } />
        <Route path="/master" element={
          <RequireAuth><RequireRole roles={['admin', 'central_admin', 'approver']}><MasterData /></RequireRole></RequireAuth>
        } />
        <Route path="/users" element={
          <RequireAuth><RequireRole roles={['admin']}><Users /></RequireRole></RequireAuth>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
