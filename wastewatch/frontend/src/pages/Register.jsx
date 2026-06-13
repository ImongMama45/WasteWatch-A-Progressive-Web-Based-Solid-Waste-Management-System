/**
 * pages/Register.jsx
 * ------------------
 * Registration page. Role is always set to 'citizen' by the backend.
 */

import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'
import BarangaySelect from '../components/BarangaySelect'
import { ICONS } from '../api/navConfig'

export default function Register() {
  const { register, barangays } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    username: '',
    email: '',
    barangay: '',
    password: '',
    password2: '',
    profile_pic: null,
  })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    if (e.target.name === 'profile_pic') {
      setForm(prev => ({ ...prev, profile_pic: e.target.files[0] }))
    } else {
      setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    }
    // Clear error for the field being edited
    setErrors(prev => ({ ...prev, [e.target.name]: '' }))
  }

  // Client-side validation before hitting the API
  function validate() {
    const errs = {}
    if (!form.first_name.trim()) errs.first_name = 'First name is required.'
    if (!form.last_name.trim()) errs.last_name = 'Last name is required.'
    if (!form.username.trim()) errs.username = 'Username is required.'
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
      const payload = new FormData()
      Object.keys(form).forEach(key => {
        if (form[key] !== null && form[key] !== '') {
          payload.append(key, form[key])
        }
      })
      await register(payload)
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
          <div className="logo-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 28, height: 28 }}>{ICONS.trash}</div>
          </div>
          <h1>Create Account</h1>
          <p>Join WasteWatch as a Citizen</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">First Name</label>
              <input
                className={`form-input ${errors.first_name ? 'error' : ''}`}
                type="text" name="first_name"
                value={form.first_name} onChange={handleChange}
                placeholder="Juan"
              />
              {errors.first_name && <p className="form-error">{errors.first_name}</p>}
            </div>
            <div className="form-group">
              <label className="form-label">Last Name</label>
              <input
                className={`form-input ${errors.last_name ? 'error' : ''}`}
                type="text" name="last_name"
                value={form.last_name} onChange={handleChange}
                placeholder="dela Cruz"
              />
              {errors.last_name && <p className="form-error">{errors.last_name}</p>}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              className={`form-input ${errors.username ? 'error' : ''}`}
              type="text" name="username"
              value={form.username} onChange={handleChange}
              placeholder="juandelacruz99"
            />
            {errors.username && <p className="form-error">{errors.username}</p>}
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
            <label className="form-label">Profile Picture (Optional)</label>
            <input
              className="form-input"
              type="file" name="profile_pic"
              accept="image/*"
              onChange={handleChange}
              style={{ padding: '8px' }}
            />
            {errors.profile_pic && <p className="form-error">{errors.profile_pic}</p>}
          </div>

          <div className="form-group">
            <label className="form-label">Barangay (Opsyonal)</label>
            <BarangaySelect
              barangays={barangays}
              value={form.barangay}
              onChange={id => setForm(prev => ({ ...prev, barangay: id }))}
              label="Piliin ang barangay (Opsyonal)"
            />
            {errors.barangay && <p className="form-error">{errors.barangay}</p>}
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
