import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import WorkOrderList from './pages/WorkOrderList'
import WorkOrderCreate from './pages/WorkOrderCreate'
import WorkOrderDetail from './pages/WorkOrderDetail'
import AcItemDetail from './pages/AcItemDetail'
import RepairLogs from './pages/RepairLogs'

function RequireAuth({ children }) {
  const token = useAuthStore((s) => s.token)
  return token ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/work-orders" element={<RequireAuth><WorkOrderList /></RequireAuth>} />
        <Route path="/work-orders/new" element={<RequireAuth><WorkOrderCreate /></RequireAuth>} />
        <Route path="/work-orders/:id" element={<RequireAuth><WorkOrderDetail /></RequireAuth>} />
        <Route path="/work-orders/:id/items/:itemId" element={<RequireAuth><AcItemDetail /></RequireAuth>} />
        <Route path="/repair-logs" element={<RequireAuth><RepairLogs /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
