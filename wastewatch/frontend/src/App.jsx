/**
 * App.jsx — WasteWatch PWA Router
 * ---------------------------------
 * Key changes from original:
 *
 * 1. `/` → PublicDashboard (no auth required, works offline)
 * 2. `/dashboard` → role-based authenticated dashboard
 * 3. Login/Register are accessible but not forced
 * 4. PrivateRoute redirects with ?next= so users return after login
 * 5. MobileOnlyRoute blocks desktop from camera/GPS pages
 */

import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import PrivateRoute from './components/PrivateRoute'
import MobileOnlyRoute from './components/MobileOnlyRoute'

// Public pages
import PublicDashboard from './pages/dashboard/PublicDashboard'
import AuthModal from './components/AuthModal'
// Authenticated pages — import these from your existing files
// (these are placeholders — wire up your actual page components)
import DashboardRouter from './pages/dashboard/DashboardRouter'
import ReportForm from './pages/ReportForm'
import ConfirmCollection from './pages/ConfirmCollection'
import VerificationTasks from './pages/VerificationTasks'
import MapView from './pages/MapView'
import EscalateToAdmin from './pages/EscalateToAdmin'
import ValidateReports from './pages/ValidateReports'
import Profile from './pages/Profile'
import CollectionSchedule from './pages/CollectionSchedule'

// These may not exist yet — uncomment when ready:
import MapView from './pages/MapView'
import EscalateToAdmin from './pages/EscalateToAdmin'
import ValidateReports from './pages/ValidateReports'
import TruckManagement from './pages/admin/TruckManagement'
import UserManagement from './pages/admin/UserManagement'
import DumpsiteManagement from './pages/admin/DumpsiteManagement'
import RouteBuilder from './pages/admin/RouteBuilder'
import EscalationManagement from './pages/admin/EscalationManagement'
import PerformanceAnalytics from './pages/admin/PerformanceAnalytics'
import HotspotDetection from './pages/admin/HotspotDetection'
import NotificationCenter from './pages/admin/NotificationCenter'
import ActivityLog from './pages/admin/ActivityLog'

function AuthOverlay({ mode }) {
  const navigate = useNavigate()
  return (
    <>
      <PublicDashboard />
      <AuthModal defaultMode={mode} onClose={() => navigate('/')} />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <Routes>

          {/* ── PUBLIC — no auth required, offline-capable ── */}
          <Route path="/" element={<PublicDashboard />} />
          <Route path="/login" element={<AuthOverlay mode="login" />} />
          <Route path="/register" element={<AuthOverlay mode="register" />} />

          {/* ── PROTECTED — all screen sizes ── */}
          <Route path="/dashboard" element={
            <PrivateRoute><DashboardRouter /></PrivateRoute>
          } />

          <Route path="/verification-tasks" element={
            <PrivateRoute><VerificationTasks /></PrivateRoute>
          } />

          <Route path="/profile" element={
            <PrivateRoute><Profile /></PrivateRoute>
          } />

          <Route path="/schedule" element={
            <PrivateRoute><CollectionSchedule /></PrivateRoute>
          } />

          <Route path="/map" element={
            <PrivateRoute><MapView /></PrivateRoute>
          } />

          <Route path="/brgy/escalate" element={
            <PrivateRoute><EscalateToAdmin /></PrivateRoute>
          } />

          <Route path="/brgy/validate-reports" element={
            <PrivateRoute><ValidateReports /></PrivateRoute>
          } />


          <Route path="/admin/trucks" element={
            <PrivateRoute><TruckManagement /></PrivateRoute>
          } />

          <Route path="/admin/users" element={
            <PrivateRoute><UserManagement /></PrivateRoute>
          } />

          <Route path="/admin/dumpsites" element={
            <PrivateRoute><DumpsiteManagement /></PrivateRoute>
          } />

          <Route path="/admin/routes" element={
            <PrivateRoute><RouteBuilder /></PrivateRoute>
          } />

          <Route path="/admin/escalations" element={
            <PrivateRoute><EscalationManagement /></PrivateRoute>
          } />

          <Route path="/admin/analytics" element={
            <PrivateRoute><PerformanceAnalytics /></PrivateRoute>
          } />

          <Route path="/admin/hotspots" element={
            <PrivateRoute><HotspotDetection /></PrivateRoute>
          } />

          <Route path="/admin/notifications" element={
            <PrivateRoute><NotificationCenter /></PrivateRoute>
          } />

          <Route path="/admin/activity-log" element={
            <PrivateRoute><ActivityLog /></PrivateRoute>
          } />

          {/* ── PROTECTED + MOBILE ONLY (camera + GPS) ── */}
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

          {/* ── 404 ── */}
          <Route path="*" element={
            <div style={{
              minHeight: '100vh',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-head)',
              background: 'var(--bg)',
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🗑️</div>
              <h1 style={{ fontSize: 24, marginBottom: 8 }}>Page not found</h1>
              <a href="/" style={{ color: 'var(--accent)' }}>← Back to Home</a>
            </div>
          } />

        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
