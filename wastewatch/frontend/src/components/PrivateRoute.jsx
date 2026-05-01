/**
 * components/PrivateRoute.jsx
 * ----------------------------
 * PWA-aware route guard.
 * - While loading: show spinner (never block)
 * - Unauthenticated: redirect to /login with ?next= param
 * - Authenticated: render children
 */

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
      }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!user) {
    // Preserve intended destination so we can redirect back after login
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  }

  return children
}
