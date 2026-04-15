/**
 * App.jsx
 * -------
 * Root component — sets up React Router routes and wraps everything
 * in <AuthProvider> so every page can access the logged-in user.
 *
 * Route structure:
 *   /login             — public
 *   /register          — public
 *   /dashboard         — private (requires login)
 *   /report/submit     — private
 *   /report/:id        — private
 *   /collection/confirm — private
 *   /                  — redirects to /dashboard
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import PrivateRoute from './components/PrivateRoute'

// Pages
import Login      from './pages/Login'
import Register   from './pages/Register'
import Dashboard  from './pages/Dashboard'
import ReportForm from './pages/ReportForm'

// Lazy-loaded future pages (imported here when you build them):
// import ReportDetail       from './pages/ReportDetail'
// import ConfirmCollection  from './pages/ConfirmCollection'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected routes — all wrapped in <PrivateRoute> */}
          <Route path="/dashboard" element={
            <PrivateRoute><Dashboard /></PrivateRoute>
          } />

          <Route path="/report/submit" element={
            <PrivateRoute><ReportForm /></PrivateRoute>
          } />

          {/*
            Add more protected routes here as you build them:

            <Route path="/report/:id" element={
              <PrivateRoute><ReportDetail /></PrivateRoute>
            } />

            <Route path="/collection/confirm" element={
              <PrivateRoute><ConfirmCollection /></PrivateRoute>
            } />

            Future role-based routes:
            <Route path="/driver/routes" element={
              <PrivateRoute requiredRole="driver"><DriverRoutes /></PrivateRoute>
            } />
          */}

          {/* Redirect root to dashboard */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* 404 fallback */}
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
