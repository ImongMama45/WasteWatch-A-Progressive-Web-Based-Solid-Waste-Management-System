import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import PrivateRoute from './components/PrivateRoute'
import MobileOnlyRoute from './components/MobileOnlyRoute'

// Pages
import Login from './pages/Login'
import Register from './pages/Register'
import DashboardRouter from './pages/dashboard/DashboardRouter'
import ReportForm from './pages/ReportForm'
import ConfirmCollection from './pages/ConfirmCollection'
import VerificationTasks from './pages/VerificationTasks'
import MapView from './pages/MapView'
import EscalateToAdmin from './pages/EscalateToAdmin'
import ValidateReports from './pages/ValidateReports'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected — available on all screen sizes */}
          <Route path="/dashboard" element={
            <PrivateRoute><DashboardRouter /></PrivateRoute>
          } />

          <Route path="/map" element={
            <PrivateRoute><MapView /></PrivateRoute>
          } />

          <Route path="/verification-tasks" element={
            <PrivateRoute><VerificationTasks /></PrivateRoute>
          } />

          <Route path="/brgy/escalate" element={
            <PrivateRoute><EscalateToAdmin /></PrivateRoute>
          } />

          <Route path="/brgy/validate-reports" element={
            <PrivateRoute><ValidateReports /></PrivateRoute>
          } />

          {/* Protected — mobile only (camera + GPS required) */}
          <Route path="/report/submit" element={
            <PrivateRoute>
              <MobileOnlyRoute>
                <ReportForm />
              </MobileOnlyRoute>
            </PrivateRoute>
          } />

          <Route path="/collection/confirm" element={
            <PrivateRoute>
              <MobileOnlyRoute>
                <ConfirmCollection />
              </MobileOnlyRoute>
            </PrivateRoute>
          } />

          {/* Redirect root → dashboard */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* 404 */}
          <Route path="*" element={
            <div style={{
              minHeight: '100vh', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-head)',
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🗑️</div>
              <h1 style={{ fontSize: 24, marginBottom: 8 }}>Page not found</h1>
              <a href="/dashboard" style={{ color: 'var(--accent)' }}>Go to Dashboard</a>
            </div>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}