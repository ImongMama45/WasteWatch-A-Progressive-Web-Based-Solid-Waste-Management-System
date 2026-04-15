/**
 * components/PrivateRoute.jsx
 * ----------------------------
 * Wraps any route that requires authentication.
 * If the user is not logged in, they are redirected to /login.
 *
 * Usage in App.jsx:
 *   <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
 */

import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function PrivateRoute({ children }) {
  const { user, loading } = useAuth()

  // While we're checking the session, show a spinner
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }

  // Not logged in — redirect to login, preserve intended destination
  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}
