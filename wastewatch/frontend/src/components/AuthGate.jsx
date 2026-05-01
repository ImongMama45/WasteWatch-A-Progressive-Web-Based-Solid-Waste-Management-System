/**
 * components/AuthGate.jsx
 * ------------------------
 * Wraps a feature that requires login.
 * Shows a friendly "Login to access" prompt instead of blocking.
 * This implements Progressive Authentication — don't force login upfront.
 *
 * Usage:
 *   <AuthGate feature="submit reports">
 *     <ReportButton />
 *   </AuthGate>
 */

import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function AuthGate({ children, feature = 'this feature', inline = false }) {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  // While checking session, render children (optimistic — avoids flash)
  if (loading) return children

  // Authenticated — render normally
  if (user) return children

  // Not authenticated — show lock prompt
  if (inline) {
    return (
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 14px',
        borderRadius: 8,
        border: '1px dashed var(--border)',
        color: 'var(--text-muted)',
        fontSize: 13,
        cursor: 'pointer',
      }} onClick={() => navigate('/login')}>
        🔒 <span>Login to {feature}</span>
      </div>
    )
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px dashed var(--border)',
      borderRadius: 12,
      padding: '20px 16px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>🔒</div>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
        Login to access {feature}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
        Create a free account or sign in to continue.
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => navigate('/login')}
        >
          Sign In
        </button>
        <button
          className="btn btn-outline btn-sm"
          onClick={() => navigate('/register')}
        >
          Register
        </button>
      </div>
    </div>
  )
}
