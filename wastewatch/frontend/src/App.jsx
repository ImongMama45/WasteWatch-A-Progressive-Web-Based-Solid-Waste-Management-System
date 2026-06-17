/**
 * App.jsx — WasteWatch PWA Router
 * ---------------------------------
 * Key changes from original:
 *
 * 1. `/` → PublicDashboard (no auth required, works offline)
 * 2. `/dashboard` → role-based authenticated dashboard
 * 3. Login/Register are accessible but not forced
 * 4. PrivateRoute redirects with ?next= so users return after login
 * 5. Route-based pages are available on all screen sizes
 */

import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import PrivateRoute from './components/PrivateRoute'
import DashboardLayout from './components/DashboardLayout'

// Public pages
import PublicDashboard from './pages/dashboard/PublicDashboard'
import AuthModal from './components/AuthModal'
// Authenticated pages — import these from your existing files
// (these are placeholders — wire up your actual page components)
import DashboardRouter from './pages/dashboard/DashboardRouter'
import ReportForm from './pages/ReportForm'
import VerificationTasks from './pages/watcher/VerificationTasksModule'
import MapView from './pages/MapView'
import EscalateToAdmin from './pages/EscalateToAdmin'
import ValidateReports from './pages/ValidateReports'
import Profile from './pages/Profile'
import CollectionSchedule from './pages/CollectionSchedule'
import AnalyticsTabs from './pages/analytics/AnalyticsTabs'
import NewsPage from './pages/news/NewsPage'
import WatcherTasksHub from './pages/watcher/WatcherTasksHub'
import ConfirmCollectionModule from './pages/watcher/ConfirmCollectionModule'
import NotificationsPage from './pages/NotificationsPage'

// These may not exist yet — uncomment when ready:
import TruckManagement from './pages/admin/TruckManagement'
import UserManagement from './pages/admin/UserManagement'
import DumpsiteManagement from './pages/admin/DumpsiteManagement'
import RouteBuilder from './pages/admin/RouteBuilder'
import EscalationManagement from './pages/admin/EscalationManagement'
import PerformanceAnalytics from './pages/analytics/PerformanceAnalytics'
import HotspotDetection from './pages/admin/HotspotDetection'
import NotificationCenter from './pages/admin/NotificationCenter'
import ActivityLog from './pages/admin/ActivityLog'

import RouteOverview from './pages/driver/RouteOverview'
import DriverAnalytics from './pages/driver/DriverAnalytics'
import DriverCollectionLog from './pages/driver/DriverCollectionLog'
import DriverHotspotAlert from './pages/driver/DriverHotspotAlert'
import DriverStatusPanel from './pages/driver/DriverStatusPanel'
import DriverRouteFlow from './pages/driver/DriverRouteFlow'
import AboutPage from './pages/AboutPage'

import ArrivalLogger from './pages/dumpsite/ArrivalLogger'
import CollectionLogs from './pages/dumpsite/CollectionLogs'
import TruckQueue from './pages/dumpsite/TruckQueue'
import BarangayBreakdown from './pages/dumpsite/BarangayBreakdown'

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
          <Route path="/about" element={<AboutPage />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/announcements" element={<NewsPage />} />
          <Route path="/schedule" element={<CollectionSchedule />} />

          {/* ── PROTECTED — all screen sizes ── */}
          <Route path="/dashboard" element={
            <PrivateRoute><DashboardRouter /></PrivateRoute>
          } />

          {/* New hub route — watcher landing page */}
          <Route path="/watcher-tasks" element={
            <PrivateRoute><WatcherTasksHub /></PrivateRoute>
          } />

          {/* New map-based post-collection module */}
          <Route path="/watcher/confirm" element={
            <PrivateRoute><ConfirmCollectionModule /></PrivateRoute>
          } />

          {/* Redirect the old /collection/confirm to the new module */}
          <Route path="/collection/confirm" element={
            <Navigate to="/watcher/confirm" replace />
          } />

          {/* WATCHER PAGE: Pre-collection map module */}
          <Route path="/verification-tasks" element={
            <PrivateRoute><VerificationTasks /></PrivateRoute>
          } />

          {/* General Page*/}
          <Route path="/profile" element={
            <PrivateRoute><Profile /></PrivateRoute>
          } />

          <Route path="/notifications" element={
            <PrivateRoute><NotificationsPage /></PrivateRoute>
          } />

          <Route path="/analytics" element={
            <PrivateRoute><AnalyticsTabs /></PrivateRoute>
          } />

          {/* BARANGAY OFFICIAL PAGE */}
          <Route path="/brgy/escalate" element={
            <PrivateRoute><EscalateToAdmin /></PrivateRoute>
          } />

          <Route path="/brgy/validate-reports" element={
            <PrivateRoute roles={['admin', 'brgy_official']}><ValidateReports /></PrivateRoute>
          } />

          {/* ADMIN PAGE */}
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

          {/* ── DRIVER MODULE ── */}
          <Route path="/driver/flow" element={
            <PrivateRoute>
              <DriverRouteFlow />
            </PrivateRoute>
          } />

          <Route
            path="/driver/route"
            element={
              <PrivateRoute>
                <DashboardLayout>
                  <RouteOverview />
                </DashboardLayout>
              </PrivateRoute>
            }
          />

          <Route path="/driver/log" element={
            <PrivateRoute>
              <DashboardLayout>
                <DriverCollectionLog />
              </DashboardLayout>
            </PrivateRoute>
          } />

          <Route path="/driver/hotspots" element={
            <PrivateRoute>
              <DashboardLayout>
                <DriverHotspotAlert />
              </DashboardLayout>
            </PrivateRoute>
          } />

          <Route path="/driver/status" element={
            <PrivateRoute>
              <DashboardLayout>
                <DriverStatusPanel />
              </DashboardLayout>
            </PrivateRoute>
          } />

          <Route path="/driver/analytics" element={
            <PrivateRoute>
              <DashboardLayout>
                <DriverAnalytics />
              </DashboardLayout>
            </PrivateRoute>

          } />

          <Route path="/report/submit" element={
            <PrivateRoute>
              <ReportForm />
            </PrivateRoute>
          } />

          {/* ── DUMPSITE MODULE ── */}
          <Route path="/dumpsite/log-arrival" element={
            <PrivateRoute roles={['dumpsite', 'admin']}>
              <DashboardLayout><ArrivalLogger /></DashboardLayout>
            </PrivateRoute>
          } />

          <Route path="/dumpsite/queue" element={
            <PrivateRoute roles={['dumpsite', 'admin']}>
              <DashboardLayout><TruckQueue /></DashboardLayout>
            </PrivateRoute>
          } />

          <Route path="/dumpsite/logs" element={
            <PrivateRoute roles={['dumpsite', 'admin']}>
              <DashboardLayout><CollectionLogs /></DashboardLayout>
            </PrivateRoute>
          } />

          <Route path="/dumpsite/barangay" element={
            <PrivateRoute roles={['dumpsite', 'admin']}>
              <DashboardLayout><BarangayBreakdown /></DashboardLayout>
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
