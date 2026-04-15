/**
 * components/Navbar.jsx
 * ----------------------
 * Top navigation bar shown on every authenticated page.
 */

import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <nav style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 20px',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      {/* Brand */}
      <a
        href="/dashboard"
        onClick={e => { e.preventDefault(); navigate('/dashboard') }}
        style={{ display: 'flex', alignItems: 'center', gap: 10,
                 fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800,
                 color: 'var(--text)', textDecoration: 'none' }}
      >
        <span style={{
          width: 32, height: 32,
          background: 'var(--accent)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
        }}>🗑️</span>
        WasteWatch
      </a>

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {user && (
          <>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {user.full_name}
            </span>
            <button className="btn btn-outline btn-sm" onClick={handleLogout}>
              Logout
            </button>
          </>
        )}
      </div>
    </nav>
  )
}
