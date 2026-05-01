/**
 * pages/Register.jsx
 * ------------------
 * Registration page. Role is always set to 'citizen' by the backend.
 */

import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [barangays, setBarangays] = useState([])
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    barangay: '',
    password: '',
    password2: '',
  })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)

  // Load barangays for the dropdown
  useEffect(() => {
    api.get('/api/barangays/')
      .then(res => setBarangays(res.data))
      .catch(() => { })   // Silently fail — barangay is optional
  }, [])

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    // Clear error for the field being edited
    setErrors(prev => ({ ...prev, [e.target.name]: '' }))
  }

  // Client-side validation before hitting the API
  function validate() {
    const errs = {}
    if (!form.full_name.trim()) errs.full_name = 'Full name is required.'
    if (!form.email.trim()) errs.email = 'Email is required.'
    if (form.password.length < 8) errs.password = 'Password must be at least 8 characters.'
    if (form.password !== form.password2) errs.password2 = 'Passwords do not match.'
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }

    setLoading(true)
    try {
      await register(form)
      navigate('/login', { state: { message: 'Account created! Please sign in.' } })
    } catch (err) {
      // Django returns field-level errors as { field: ["message"] }
      const data = err.response?.data || {}
      const mapped = {}
      for (const [key, val] of Object.entries(data)) {
        mapped[key] = Array.isArray(val) ? val[0] : val
      }
      setErrors(mapped)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">

        <div className="auth-logo">
          <div className="logo-icon">🗑️</div>
          <h1>Create Account</h1>
          <p>Join WasteWatch as a Citizen</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>

          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input
              className={`form-input ${errors.full_name ? 'error' : ''}`}
              type="text" name="full_name"
              value={form.full_name} onChange={handleChange}
              placeholder="Juan dela Cruz"
            />
            {errors.full_name && <p className="form-error">{errors.full_name}</p>}
          </div>

          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className={`form-input ${errors.email ? 'error' : ''}`}
              type="email" name="email"
              value={form.email} onChange={handleChange}
              placeholder="juan@example.com"
            />
            {errors.email && <p className="form-error">{errors.email}</p>}
          </div>

          <div className="form-group">
            <label className="form-label">Barangay <span className="text-muted">(optional)</span></label>
            <select
              className="form-input"
              name="barangay"
              value={form.barangay}
              onChange={handleChange}
            >
              <option value="">— Select your barangay —</option>
              {barangays.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className={`form-input ${errors.password ? 'error' : ''}`}
              type="password" name="password"
              value={form.password} onChange={handleChange}
              placeholder="At least 8 characters"
            />
            {errors.password && <p className="form-error">{errors.password}</p>}
          </div>

          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <input
              className={`form-input ${errors.password2 ? 'error' : ''}`}
              type="password" name="password2"
              value={form.password2} onChange={handleChange}
              placeholder="••••••••"
            />
            {errors.password2 && <p className="form-error">{errors.password2}</p>}
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full"
            style={{ marginTop: 8 }}
            disabled={loading}
          >
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="text-center text-sm text-muted" style={{ marginTop: 20 }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--accent)' }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
