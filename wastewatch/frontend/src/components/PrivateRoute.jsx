/**
 * components/PrivateRoute.jsx
 * ----------------------------
 * PWA-aware route guard.
 * - While loading: show spinner (never block)
 * - Unauthenticated: redirect to /login with ?next= param
 * - Unauthorized (wrong role): show Unauthorized page
 * - Authenticated + authorized: render children
 */

import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function UnauthorizedPage() {
  const navigate = useNavigate()
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      fontFamily: 'var(--font-body)',
      gap: 0,
      padding: '0 24px',
      textAlign: 'center',
    }}>
      <style>{`
        @keyframes prShake {
          0%,100% { transform: rotate(0deg); }
          20%,60%  { transform: rotate(-8deg); }
          40%,80%  { transform: rotate(8deg); }
        }
        .pr-lock { animation: prShake 0.5s ease 0.2s both; display: inline-block; }
      `}</style>

      <div className="pr-lock" style={{ fontSize: 56, marginBottom: 16, lineHeight: 1 }}>🔒</div>

      <h1 style={{
        fontFamily: 'var(--font-head)',
        fontSize: 22, fontWeight: 800,
        color: 'var(--text)', margin: '0 0 8px',
      }}>
        Access Denied
      </h1>

      <p style={{
        fontSize: 14, color: 'var(--text-muted)',
        maxWidth: 320, lineHeight: 1.6, margin: '0 0 24px',
      }}>
        You don't have permission to view this page.
        This area is restricted to specific roles.
      </p>

      <button
        onClick={() => navigate('/dashboard')}
        style={{
          padding: '12px 28px', borderRadius: 12,
          background: 'var(--accent)',
          color: '#fff', border: 'none',
          fontFamily: 'var(--font-head)',
          fontSize: 14, fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(46,204,113,0.3)',
          transition: 'opacity .15s',
        }}
        onMouseOver={e => e.currentTarget.style.opacity = '.85'}
        onMouseOut={e => e.currentTarget.style.opacity = '1'}
      >
        ← Back to My Dashboard
      </button>
    </div>
  )
}

export default function PrivateRoute({ children, roles }) {
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
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  }

  if (roles && !roles.includes(user.role)) {
    return <UnauthorizedPage />
  }

  return children
}
