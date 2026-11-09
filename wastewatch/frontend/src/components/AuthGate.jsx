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
import { Lock } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Skeleton } from './ui/Skeleton'

export default function AuthGate({ children, feature = 'this feature', inline = false }) {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  // While checking session, render subtle skeleton placeholder to prevent layout flash
  if (loading) {
    return inline
      ? <Skeleton width={140} height={34} radius={8} />
      : <Skeleton width="100%" height={128} radius={12} />
  }

  // Authenticated — render normally
  if (user) return children

  // Not authenticated — show lock prompt
  if (inline) {
    return (
      <div
        className="ww-fade-in"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          borderRadius: 8,
          border: '1px dashed var(--border)',
          color: 'var(--text-muted)',
          fontSize: 13,
          cursor: 'pointer',
        }}
        onClick={() => navigate('/login')}
      >
        <Lock size={14} /> <span>Login to {feature}</span>
      </div>
    )
  }

  return (
    <div
      className="ww-fade-in"
      style={{
        background: 'var(--surface)',
        border: '1px dashed var(--border)',
        borderRadius: 12,
        padding: '20px 16px',
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'inline-flex', padding: 10, borderRadius: '50%', background: 'rgba(15,23,42,0.05)', color: 'var(--text-muted)', marginBottom: 8 }}>
        <Lock size={22} />
      </div>
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
