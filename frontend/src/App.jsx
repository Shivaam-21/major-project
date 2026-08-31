import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useContext } from 'react'
import { AuthContext } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'

// Layouts
import UserLayout from './layouts/UserLayout'
import AdminLayout from './layouts/AdminLayout'

// Auth Pages
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'

// User Pages
import UserDashboard from './pages/user/UserDashboard'
import MakePayment from './pages/user/MakePayment'
import TransactionHistory from './pages/user/TransactionHistory'
import Analytics from './pages/user/Analytics'
import Profile from './pages/user/Profile'

// Admin Pages
import AdminDashboard from './pages/admin/AdminDashboard'
import LiveMonitor from './pages/admin/LiveMonitor'
import Transactions from './pages/admin/Transactions'
import Alerts from './pages/admin/Alerts'
import FraudRing from './pages/admin/FraudRing'
import Users from './pages/admin/Users'
import Reports from './pages/admin/Reports'

// Global Components
import NetworkStatus from './components/NetworkStatus'

function App() {
  const { user } = useContext(AuthContext)

  return (
    <BrowserRouter>
      <NetworkStatus />
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* User Routes */}
        <Route element={<ProtectedRoute allowedRoles={['user']} />}>
          <Route element={<UserLayout />}>
            <Route path="/user" element={<Navigate to="/user/dashboard" replace />} />
            <Route path="/user/dashboard" element={<UserDashboard />} />
            <Route path="/user/UserDashboard" element={<Navigate to="/user/dashboard" replace />} />
            <Route path="/user/payment" element={<MakePayment />} />
            <Route path="/user/MakePayment" element={<Navigate to="/user/payment" replace />} />
            <Route path="/user/transactions" element={<TransactionHistory />} />
            <Route path="/user/TransactionHistory" element={<Navigate to="/user/transactions" replace />} />
            <Route path="/user/analytics" element={<Analytics />} />
            <Route path="/user/Analytics" element={<Navigate to="/user/analytics" replace />} />
            <Route path="/user/profile" element={<Profile />} />
            <Route path="/user/Profile" element={<Navigate to="/user/profile" replace />} />
          </Route>
        </Route>

        {/* Admin Routes */}
        <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/AdminDashboard" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="/admin/live" element={<LiveMonitor />} />
            <Route path="/admin/transactions" element={<Transactions />} />
            <Route path="/admin/Transactions" element={<Navigate to="/admin/transactions" replace />} />
            <Route path="/admin/alerts" element={<Alerts />} />
            <Route path="/admin/Alerts" element={<Navigate to="/admin/alerts" replace />} />
            <Route path="/admin/fraud-ring" element={<FraudRing />} />
            <Route path="/admin/users" element={<Users />} />
            <Route path="/admin/Users" element={<Navigate to="/admin/users" replace />} />
            <Route path="/admin/reports" element={<Reports />} />
            <Route path="/admin/Reports" element={<Navigate to="/admin/reports" replace />} />
          </Route>
        </Route>

        {/* Default Redirect */}
        <Route
          path="/"
          element={
            <Navigate
              to={user ? (user.role === 'admin' ? '/admin/dashboard' : '/user/dashboard') : '/login'}
              replace
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
