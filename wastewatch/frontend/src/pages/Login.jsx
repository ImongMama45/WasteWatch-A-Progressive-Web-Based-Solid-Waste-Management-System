/**
 * pages/Login.jsx
 * ---------------
 * PWA Login — after successful auth, redirects to ?next= or dashboard.
 * Shows a "Back to Home" link so users aren't trapped.
 */

import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const nextUrl = params.get('next') || '/dashboard'

  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(form.email, form.password)
      navigate(nextUrl)         // Return to where they were going
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">

        {/* Back to home — don't trap users */}
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-body)',
            marginBottom: 16, padding: 0, display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          ‹ Back to Home
        </button>

        <div className="auth-logo">
          <div className="logo-icon">🗑️</div>
          <h1>WasteWatch</h1>
          <p>Sign in to your account</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email" name="email"
              value={form.email} onChange={handleChange}
              placeholder="juan@example.com" required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password" name="password"
              value={form.password} onChange={handleChange}
              placeholder="••••••••" required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full"
            style={{ marginTop: 8 }}
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-sm text-muted" style={{ marginTop: 20 }}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color: 'var(--accent)' }}>Register here</Link>
        </p>
      </div>
    </div>
  )
}
