/**
 * App.jsx - WasteWatch PWA Router
 * ---------------------------------
 * Key features:
 * 1. `/` -> PublicDashboard (eagerly loaded, offline-capable)
 * 2. `/dashboard` -> role-based authenticated dashboard
 * 3. Route-level code splitting with React.lazy + <Suspense fallback={<AppShellSkeleton />}>
 * 4. PrivateRoute redirects with ?next= so users return after login
 */

import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Trash2, ArrowLeft } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext'
import PrivateRoute from './components/PrivateRoute'
import DashboardLayout from './components/DashboardLayout'
import ShiftStatusBanner from './components/ShiftStatusBanner'
import { AppShellSkeleton, MobileFlowSkeleton, MapSkeleton } from './components/ui/Skeleton'

// Eager public entry for instant PWA startup
import PublicDashboard from './pages/dashboard/PublicDashboard'
import AuthModal from './components/AuthModal'

// Lazy-loaded route modules with Suspense skeleton fallbacks
const DashboardRouter = lazy(() => import('./pages/dashboard/DashboardRouter'))
const MapView = lazy(() => import('./pages/MapView'))
const PublicMap = lazy(() => import('./pages/PublicMap'))
const EscalateToAdmin = lazy(() => import('./pages/brgy_official/EscalateToAdmin'))
const ValidateReports = lazy(() => import('./pages/brgy_official/ValidateReports'))
const Profile = lazy(() => import('./pages/Profile'))
const CollectionSchedule = lazy(() => import('./pages/CollectionSchedule'))
const AnalyticsTabs = lazy(() => import('./pages/analytics/AnalyticsTabs'))
const NewsPage = lazy(() => import('./pages/news/NewsPage'))
const CommunityPage = lazy(() => import('./pages/community/CommunityPage'))
const WatcherTasksHub = lazy(() => import('./pages/watcher/WatcherTasksHub'))
const WatcherMapTaskModule = lazy(() => import('./pages/watcher/WatcherMapTaskModule'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))

// Admin pages
const TruckManagement = lazy(() => import('./pages/admin/TruckManagement'))
const UserManagement = lazy(() => import('./pages/admin/UserManagement'))
const DumpsiteManagement = lazy(() => import('./pages/admin/DumpsiteManagement'))
const RouteBuilder = lazy(() => import('./pages/admin/RouteBuilder'))
const EscalationManagement = lazy(() => import('./pages/admin/EscalationManagement'))
const PerformanceAnalytics = lazy(() => import('./pages/analytics/PerformanceAnalytics'))
const HotspotDetection = lazy(() => import('./pages/admin/HotspotDetection'))
const NotificationCenter = lazy(() => import('./pages/admin/NotificationCenter'))
const ActivityLog = lazy(() => import('./pages/admin/ActivityLog'))
const AdminReports = lazy(() => import('./pages/admin/AdminReports'))
const BarangayManagement = lazy(() => import('./pages/admin/BarangayManagement'))
const BarangayDetail = lazy(() => import('./pages/admin/BarangayDetail'))
const EscalationDetail = lazy(() => import('./pages/admin/EscalationDetail'))
const AdminContentManagement = lazy(() => import('./pages/admin/AdminContentManagement'))
const AdminEventManagement = lazy(() => import('./pages/admin/events/AdminEventManagement'))

// Driver pages
const RouteOverview = lazy(() => import('./pages/driver/RouteOverview'))
const DriverAnalytics = lazy(() => import('./pages/driver/DriverAnalytics'))
const DriverCollectionLog = lazy(() => import('./pages/driver/DriverCollectionLog'))
const DriverHotspotAlert = lazy(() => import('./pages/driver/DriverHotspotAlert'))
const DriverStatusPanel = lazy(() => import('./pages/driver/DriverStatusPanel'))
const DriverRouteFlow = lazy(() => import('./pages/driver/DriverRouteFlow'))

// Dumpsite pages
const ArrivalLogger = lazy(() => import('./pages/dumpsite/ArrivalLogger'))
const CollectionLogs = lazy(() => import('./pages/dumpsite/CollectionLogs'))
const TruckQueue = lazy(() => import('./pages/dumpsite/TruckQueue'))
const BarangayBreakdown = lazy(() => import('./pages/dumpsite/BarangayBreakdown'))

function LogArrivalRoute() {
  const [searchParams] = useSearchParams()
  const truck = searchParams.get('truck')
  const navigate = useNavigate()
  return (
    <DashboardLayout>
      <ArrivalLogger open={true} onClose={() => navigate('/dashboard')} defaultTruckId={truck} />
    </DashboardLayout>
  )
}

function AuthOverlay({ mode }) {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const nextUrl = params.get('next') || '/dashboard'

  // Security guard: If already authenticated, redirect away from login/register/password auth forms
  if (!loading && user && mode !== 'verify-email') {
    return <Navigate to={nextUrl} replace />
  }

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
        <ShiftStatusBanner />
        <Suspense fallback={<AppShellSkeleton />}>
          <Routes>

            {/* ── PUBLIC — no auth required, offline-capable ── */}
            <Route path="/" element={<PublicDashboard />} />
            <Route path="/login" element={<AuthOverlay mode="login" />} />
            <Route path="/register" element={<AuthOverlay mode="register" />} />
            <Route path="/forgot-password" element={<AuthOverlay mode="forgot-password" />} />
            <Route path="/reset-password" element={<AuthOverlay mode="reset-password" />} />
            <Route path="/verify-email" element={<AuthOverlay mode="verify-email" />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/public-map" element={
              <Suspense fallback={<MapSkeleton height="100vh" dark label="Loading Lucena Public Map..." />}>
                <PublicMap />
              </Suspense>
            } />
            <Route path="/announcements" element={<NewsPage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/schedule" element={<CollectionSchedule />} />

            {/* ── PROTECTED — all screen sizes ── */}
            <Route path="/map" element={
              <PrivateRoute roles={['admin', 'brgy_official', 'watcher']}>
                <Suspense fallback={<MapSkeleton height="100vh" dark label="Loading Operations Map..." />}>
                  <MapView />
                </Suspense>
              </PrivateRoute>
            } />
            <Route path="/dashboard" element={
              <PrivateRoute><DashboardRouter /></PrivateRoute>
            } />

            {/* New hub route — watcher landing page */}
            <Route path="/watcher-tasks" element={
              <PrivateRoute roles={['watcher', 'admin']}><WatcherTasksHub /></PrivateRoute>
            } />

            {/* New map-based post-collection module */}
            <Route path="/watcher/confirm" element={
              <PrivateRoute roles={['watcher', 'admin']}>
                <Suspense fallback={<MobileFlowSkeleton label="Loading collection confirmation..." />}>
                  <WatcherMapTaskModule mode="post" />
                </Suspense>
              </PrivateRoute>
            } />

            {/* Redirect the old /collection/confirm to the new module */}
            <Route path="/collection/confirm" element={
              <Navigate to="/watcher/confirm" replace />
            } />

            {/* WATCHER PAGE: Pre-collection map module */}
            <Route path="/verification-tasks" element={
              <PrivateRoute roles={['watcher', 'admin']}>
                <Suspense fallback={<MobileFlowSkeleton label="Loading verification tasks..." />}>
                  <WatcherMapTaskModule mode="pre" />
                </Suspense>
              </PrivateRoute>
            } />

            {/* General Page */}
            <Route path="/profile" element={
              <PrivateRoute><Profile /></PrivateRoute>
            } />

            <Route path="/notifications" element={
              <PrivateRoute><NotificationsPage /></PrivateRoute>
            } />

            <Route path="/analytics" element={
              <PrivateRoute roles={['admin', 'brgy_official', 'driver', 'watcher', 'citizen']}><AnalyticsTabs /></PrivateRoute>
            } />

            {/* BARANGAY OFFICIAL PAGE */}
            <Route path="/brgy/escalate" element={
              <PrivateRoute roles={['brgy_official', 'admin']}><EscalateToAdmin /></PrivateRoute>
            } />

            <Route path="/brgy/validate-reports" element={
              <PrivateRoute roles={['admin', 'brgy_official']}><ValidateReports /></PrivateRoute>
            } />

            <Route path="/admin/validate-reports" element={
              <PrivateRoute roles={['admin', 'brgy_official']}><ValidateReports /></PrivateRoute>
            } />

            {/* ADMIN PAGE — admin only */}
            <Route path="/admin/barangays" element={
              <PrivateRoute roles={['admin']}><BarangayManagement /></PrivateRoute>
            } />

            <Route path="/admin/barangays/:barangayId" element={
              <PrivateRoute roles={['admin']}><BarangayDetail /></PrivateRoute>
            } />

            <Route path="/admin/trucks" element={
              <PrivateRoute roles={['admin']}><TruckManagement /></PrivateRoute>
            } />

            <Route path="/admin/users" element={
              <PrivateRoute roles={['admin']}><UserManagement /></PrivateRoute>
            } />

            <Route path="/admin/dumpsites" element={
              <PrivateRoute roles={['admin']}><DumpsiteManagement /></PrivateRoute>
            } />

            <Route path="/admin/routes" element={
              <PrivateRoute roles={['admin']}><RouteBuilder /></PrivateRoute>
            } />

            <Route path="/admin/escalations" element={
              <PrivateRoute roles={['admin']}><EscalationManagement /></PrivateRoute>
            } />

            <Route path="/admin/escalations/:id" element={
              <PrivateRoute roles={['admin']}><EscalationDetail /></PrivateRoute>
            } />

            <Route path="/admin/reports" element={
              <PrivateRoute roles={['admin', 'brgy_official']}><AdminReports /></PrivateRoute>
            } />

            <Route path="/admin/analytics" element={
              <PrivateRoute roles={['admin']}><PerformanceAnalytics /></PrivateRoute>
            } />

            <Route path="/admin/hotspots" element={
              <PrivateRoute roles={['admin']}><HotspotDetection /></PrivateRoute>
            } />

            <Route path="/admin/notifications" element={
              <PrivateRoute roles={['admin']}><NotificationCenter /></PrivateRoute>
            } />

            <Route path="/admin/activity-log" element={
              <PrivateRoute roles={['admin']}><ActivityLog /></PrivateRoute>
            } />

            <Route path="/admin/content" element={
              <PrivateRoute roles={['admin']}><AdminContentManagement /></PrivateRoute>
            } />

            <Route path="/admin/events" element={
              <PrivateRoute roles={['admin']}><AdminEventManagement /></PrivateRoute>
            } />

            {/* ── DRIVER MODULE — driver & admin only ── */}
            <Route path="/driver/flow" element={
              <PrivateRoute roles={['driver', 'admin']}>
                <Suspense fallback={<MobileFlowSkeleton dark label="Loading driver route flow..." />}>
                  <DriverRouteFlow />
                </Suspense>
              </PrivateRoute>
            } />

            <Route
              path="/driver/route"
              element={
                <PrivateRoute roles={['driver', 'admin']}>
                  <DashboardLayout>
                    <RouteOverview />
                  </DashboardLayout>
                </PrivateRoute>
              }
            />

            <Route path="/driver/log" element={
              <PrivateRoute roles={['driver', 'admin']}>
                <DashboardLayout>
                  <DriverCollectionLog />
                </DashboardLayout>
              </PrivateRoute>
            } />

            <Route path="/driver/hotspots" element={
              <PrivateRoute roles={['driver', 'admin']}>
                <DashboardLayout>
                  <DriverHotspotAlert />
                </DashboardLayout>
              </PrivateRoute>
            } />

            <Route path="/driver/status" element={
              <PrivateRoute roles={['driver', 'admin']}>
                <DashboardLayout>
                  <DriverStatusPanel />
                </DashboardLayout>
              </PrivateRoute>
            } />

            <Route path="/driver/analytics" element={
              <PrivateRoute roles={['driver', 'admin']}>
                <DashboardLayout>
                  <DriverAnalytics />
                </DashboardLayout>
              </PrivateRoute>
            } />

            {/* ── DUMPSITE MODULE ── */}
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

            <Route path="/dumpsite/log-arrival" element={
              <PrivateRoute roles={['dumpsite', 'admin']}>
                <LogArrivalRoute />
              </PrivateRoute>
            } />

            {/* ── 404 ── */}
            <Route path="*" element={
              <div
                className="ww-page-enter"
                style={{
                  minHeight: '100vh',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-head)',
                  background: 'var(--bg)',
                }}
              >
                <div style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
                  <Trash2 size={48} strokeWidth={1.5} />
                </div>
                <h1 style={{ fontSize: 24, marginBottom: 8 }}>Page not found</h1>
                <Link to="/" style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
                  <ArrowLeft size={16} />
                  Back to Home
                </Link>
              </div>
            } />

          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
