/**
 * components/AuthModal.jsx
 * -------------------------
 * Sliding panel auth modal.
 * Changes from previous version:
 *   • Sign-Up form now includes a searchable barangay dropdown.
 *   • Barangay list comes from AuthContext (fetched once, cached offline).
 *   • `barangay` (ID) is sent to AuthContext.register().
 *   • Custom BarangaySelect component lives in this file (no extra dep).
 */

import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// ─────────────────────────────────────────────────────────────────────────────
// BarangaySelect  — compact searchable dropdown
// Renders as a text input that filters a dropdown list of barangays.
// ─────────────────────────────────────────────────────────────────────────────

function BarangaySelect({ barangays, value, onChange }) {
  const [query,  setQuery]  = useState('')
  const [open,   setOpen]   = useState(false)
  const wrapRef             = useRef(null)

  // Label for the selected barangay
  const selectedLabel = value
    ? (barangays.find(b => b.id === value)?.name ?? '')
    : ''

  // Filtered list
  const filtered = barangays.filter(b =>
    b.name.toLowerCase().includes(query.toLowerCase())
  )

  // Close on outside click
  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  function handleSelect(brgy) {
    onChange(brgy.id)
    setQuery('')
    setOpen(false)
  }

  function handleClear(e) {
    e.stopPropagation()
    onChange(null)
    setQuery('')
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', marginBottom: 12 }}>
      {/* Trigger */}
      <div
        style={{
          display:        'flex',
          alignItems:     'center',
          gap:            6,
          width:          '100%',
          background:     'var(--surface-2)',
          border:         open
            ? '1.5px solid var(--accent)'
            : '1.5px solid var(--border)',
          borderRadius:   8,
          padding:        '10px 12px',
          cursor:         'pointer',
          fontSize:       13,
          color:          value ? 'var(--text)' : 'var(--text-muted)',
          transition:     'border-color .18s',
          userSelect:     'none',
          boxSizing:      'border-box',
        }}
        onClick={() => setOpen(o => !o)}
        role="combobox"
        aria-expanded={open}
        aria-label="Select barangay"
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedLabel || 'Pumili ng barangay'}
        </span>
        {value && (
          <button
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 14, padding: 0, lineHeight: 1,
            }}
            onClick={handleClear}
            aria-label="Clear selection"
          >
            ×
          </button>
        )}
        <span style={{
          color:      'var(--text-muted)',
          fontSize:   10,
          transform:  open ? 'rotate(180deg)' : 'none',
          transition: 'transform .18s',
          flexShrink: 0,
        }}>▼</span>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position:     'absolute',
          top:          'calc(100% + 4px)',
          left:         0,
          right:        0,
          zIndex:       9999,
          background:   'var(--surface)',
          border:       '1.5px solid var(--border)',
          borderRadius: 10,
          boxShadow:    '0 8px 28px rgba(0,0,0,0.2)',
          overflow:     'hidden',
          animation:    'brgy-drop-in .15s ease',
        }}>
          {/* Search input */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
            <input
              autoFocus
              type="text"
              placeholder="🔍 Hanapin ang barangay…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                width:        '100%',
                border:       'none',
                outline:      'none',
                background:   'transparent',
                color:        'var(--text)',
                fontSize:     12,
                fontFamily:   'inherit',
                boxSizing:    'border-box',
              }}
            />
          </div>

          {/* List */}
          <ul style={{
            listStyle:  'none',
            margin:     0,
            padding:    '4px 0',
            maxHeight:  180,
            overflowY:  'auto',
            overscrollBehavior: 'contain',
          }}>
            {filtered.length === 0 ? (
              <li style={{
                padding:  '10px 14px',
                fontSize: 12,
                color:    'var(--text-muted)',
                textAlign: 'center',
              }}>
                Walang nahanap
              </li>
            ) : (
              filtered.map(b => (
                <li
                  key={b.id}
                  onClick={() => handleSelect(b)}
                  style={{
                    padding:    '9px 14px',
                    fontSize:   13,
                    cursor:     'pointer',
                    color:      b.id === value ? 'var(--accent)' : 'var(--text)',
                    background: b.id === value ? 'rgba(var(--accent-rgb, 46,204,113),0.08)' : 'transparent',
                    fontWeight: b.id === value ? 600 : 400,
                    transition: 'background .12s',
                    display:    'flex',
                    alignItems: 'center',
                    gap:        8,
                  }}
                  onMouseEnter={e => { if (b.id !== value) e.currentTarget.style.background = 'var(--surface-2)' }}
                  onMouseLeave={e => { if (b.id !== value) e.currentTarget.style.background = 'transparent' }}
                >
                  {b.id === value && <span style={{ fontSize: 11 }}>✓</span>}
                  {b.name}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthModal
// ─────────────────────────────────────────────────────────────────────────────

export default function AuthModal({ defaultMode = 'login', onClose }) {
  const { login, register, barangays } = useAuth()
  const navigate  = useNavigate()
  const [params]  = useSearchParams()
  const nextUrl   = params.get('next') || '/dashboard'

  const [isRegister, setIsRegister] = useState(defaultMode === 'register')

  const [form, setForm] = useState({
    email:     '',
    password:  '',
    password2: '',
    full_name: '',
    barangay:  null,   // numeric ID; required for registration
  })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  // Block body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = 'auto' }
  }, [])

  // Clear error when switching panels
  useEffect(() => { setError('') }, [isRegister])

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(form.email, form.password)
      if (onClose) onClose()
      navigate(nextUrl)
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  // ── Register ──────────────────────────────────────────────────────────────
  async function handleRegister(e) {
    e.preventDefault()
    setError('')

    // Client-side password match guard
    if (form.password !== form.password2) {
      setError('Passwords do not match.')
      return
    }

    if (!form.barangay) {
      setError('Please select your barangay.')
      return
    }

    setLoading(true)
    try {
      await register({
        full_name: form.full_name,
        email:     form.email,
        password:  form.password,
        password2: form.password2,
        barangay:  form.barangay,
      })

      // Auto-login after registration
      await login(form.email, form.password)

      if (onClose) onClose()
      navigate('/dashboard')
    } catch (err) {
      const data = err.response?.data
      const firstError =
        data?.email?.[0]      ||
        data?.password?.[0]   ||
        data?.full_name?.[0]  ||
        data?.barangay?.[0]   ||
        data?.detail          ||
        (data && Object.values(data)[0]?.[0]) ||
        'Registration failed.'
      setError(firstError)
    } finally {
      setLoading(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="auth-modal-backdrop">
      <style>{`
        /* ── Keyframes ── */
        @keyframes show {
          0%, 49.99% { opacity: 0; z-index: 1; }
          50%, 100%  { opacity: 1; z-index: 5; }
        }

        @keyframes brgy-drop-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Backdrop ── */
        .auth-modal-backdrop {
          position: fixed; inset: 0;
          background: rgba(13, 17, 23, 0.85);
          backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center;
          z-index: 9999; padding: 20px;
        }

        /* ── Container ── */
        .auth-modal-container {
          position: relative;
          width: 850px; max-width: 100%;
          /* Taller to fit the extra barangay field in Sign-Up */
          height: 580px;
          background: var(--surface);
          border-radius: 20px;
          box-shadow: 0 14px 28px rgba(0,0,0,0.25), 0 10px 10px rgba(0,0,0,0.22);
          overflow: hidden;
        }

        /* ── Sliding panels ── */
        .auth-form-container {
          position: absolute; top: 0; height: 100%;
          transition: all 0.6s ease-in-out;
        }

        .sign-in-container {
          left: 0; width: 50%; z-index: 2; background: var(--surface);
        }
        .auth-modal-container.right-panel-active .sign-in-container {
          transform: translateX(100%);
        }

        .sign-up-container {
          left: 0; width: 50%; opacity: 0; z-index: 1; background: var(--surface);
          overflow-y: auto;           /* scroll if content is tall */
        }
        .auth-modal-container.right-panel-active .sign-up-container {
          transform: translateX(100%); opacity: 1; z-index: 5;
          animation: show 0.6s;
        }

        /* ── Overlay (right half, desktop only) ── */
        .auth-overlay-container {
          position: absolute; top: 0; left: 50%; width: 50%; height: 100%;
          overflow: hidden; transition: transform 0.6s ease-in-out; z-index: 100;
        }
        .auth-modal-container.right-panel-active .auth-overlay-container {
          transform: translateX(-100%);
        }

        .auth-overlay {
          background: linear-gradient(135deg, var(--accent) 0%, #16a085 100%);
          color: #0d1117; position: relative; left: -100%; height: 100%; width: 200%;
          transform: translateX(0); transition: transform 0.6s ease-in-out;
        }
        .auth-modal-container.right-panel-active .auth-overlay {
          transform: translateX(50%);
        }

        .auth-overlay-panel {
          position: absolute; display: flex; align-items: center;
          justify-content: center; flex-direction: column;
          padding: 0 40px; text-align: center; top: 0; height: 100%; width: 50%;
          transition: transform 0.6s ease-in-out;
        }

        .auth-overlay-left  { transform: translateX(-20%); }
        .auth-modal-container.right-panel-active .auth-overlay-left { transform: translateX(0); }

        .auth-overlay-right { right: 0; transform: translateX(0); }
        .auth-modal-container.right-panel-active .auth-overlay-right { transform: translateX(20%); }

        /* ── Form content area ── */
        .auth-form-content {
          display: flex; align-items: center; justify-content: flex-start;
          flex-direction: column; padding: 32px 40px 28px; height: 100%;
          text-align: center; overflow-y: auto;
        }

        /* ── Close button ── */
        .auth-modal-close {
          position: absolute; top: 20px; right: 20px;
          background: rgba(0,0,0,0.1); border: none;
          width: 32px; height: 32px; border-radius: 50%;
          color: inherit; font-size: 20px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          z-index: 200; transition: background 0.2s;
        }
        .auth-modal-close:hover { background: rgba(0,0,0,0.2); }

        /* ── Social circles ── */
        .social-circle {
          border: 1px solid var(--border); border-radius: 50%;
          width: 40px; height: 40px;
          display: inline-flex; align-items: center; justify-content: center;
          margin: 0 5px; cursor: pointer;
        }

        /* ── Barangay badge (shown after selection, below the dropdown) ── */
        .brgy-selected-badge {
          display: inline-flex; align-items: center; gap: 5px;
          background: rgba(46,204,113,0.1); border: 1px solid rgba(46,204,113,0.3);
          color: var(--accent); border-radius: 20px;
          padding: 3px 10px; font-size: 11px; font-weight: 600;
          margin-bottom: 4px;
        }

        /* ── Mobile ── */
        @media (max-width: 768px) {
          .auth-modal-container {
            height: auto; min-height: 540px;
            display: flex; flex-direction: column;
          }
          .auth-form-container {
            position: relative; width: 100%; height: auto; padding: 0;
          }
          .sign-in-container, .sign-up-container {
            width: 100%; transform: none !important;
            opacity: 1 !important; z-index: 1 !important;
          }
          .auth-overlay-container { display: none; }
          .sign-up-container      { display: none; }
          .auth-modal-container.right-panel-active .sign-in-container { display: none; }
          .auth-modal-container.right-panel-active .sign-up-container { display: block; }
          .auth-form-content { padding: 32px 24px 28px; }
        }
      `}</style>

      <div className={`auth-modal-container ${isRegister ? 'right-panel-active' : ''}`}>

        <button
          className="auth-modal-close"
          style={{ color: isRegister ? 'var(--text)' : '#0d1117' }}
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        {/* ══════════ SIGN-UP PANEL ══════════ */}
        <div className="auth-form-container sign-up-container">
          <form className="auth-form-content" onSubmit={handleRegister}>

            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 800, marginBottom: 12, marginTop: 0 }}>
              Create Account
            </h1>

            {/* Social icons */}
            <div style={{ display: 'flex', marginBottom: 14 }}>
              <div className="social-circle">f</div>
              <div className="social-circle">G+</div>
              <div className="social-circle">in</div>
            </div>

            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
              or use your email for registration:
            </span>

            {/* Error */}
            {error && isRegister && (
              <div className="alert alert-error" style={{ padding: '8px 12px', marginBottom: 10, width: '100%', fontSize: 12 }}>
                {error}
              </div>
            )}

            {/* Name */}
            <input
              className="form-input"
              style={{ width: '100%', marginBottom: 10, background: 'var(--surface-2)' }}
              type="text"
              name="full_name"
              value={form.full_name}
              onChange={handleChange}
              placeholder="Full Name"
              required
            />

            {/* Email */}
            <input
              className="form-input"
              style={{ width: '100%', marginBottom: 10, background: 'var(--surface-2)' }}
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="Email"
              required
            />

            {/* Password */}
            <input
              className="form-input"
              style={{ width: '100%', marginBottom: 10, background: 'var(--surface-2)' }}
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Password"
              required
              minLength={8}
            />

            {/* Confirm password */}
            <input
              className="form-input"
              style={{ width: '100%', marginBottom: 10, background: 'var(--surface-2)' }}
              type="password"
              name="password2"
              value={form.password2}
              onChange={handleChange}
              placeholder="Confirm Password"
              required
            />

            {/* ── Barangay searchable dropdown ── */}
            <BarangaySelect
              barangays={barangays}
              value={form.barangay}
              onChange={id => setForm(prev => ({ ...prev, barangay: id }))}
            />

            {/* Subtle hint */}
            <p style={{
              fontSize:    10,
              color:       'var(--text-muted)',
              margin:      '-6px 0 14px',
              lineHeight:  1.4,
              textAlign:   'left',
              width:       '100%',
            }}>
              💡 Piliin ang inyong barangay para sa personalized na serbisyo.
              Maaaring baguhin ito mamaya.
            </p>

            {/* Submit */}
            <button
              className="btn btn-primary"
              style={{ width: 160, borderRadius: 30, padding: '11px 24px', fontWeight: 700 }}
              type="submit"
              disabled={loading}
            >
              {loading ? 'WAIT…' : 'SIGN UP'}
            </button>

            {/* Mobile toggle */}
            <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
              <span
                style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 600 }}
                onClick={() => setIsRegister(false)}
              >
                Already have an account? Sign in.
              </span>
            </p>

          </form>
        </div>

        {/* ══════════ SIGN-IN PANEL ══════════ */}
        <div className="auth-form-container sign-in-container">
          <form className="auth-form-content" onSubmit={handleLogin}>

            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 800, marginBottom: 16, marginTop: 0 }}>
              Sign in
            </h1>

            <div style={{ display: 'flex', marginBottom: 20 }}>
              <div className="social-circle">f</div>
              <div className="social-circle">G+</div>
              <div className="social-circle">in</div>
            </div>

            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              or use your account
            </span>

            {error && !isRegister && (
              <div className="alert alert-error" style={{ padding: 8, marginBottom: 10, width: '100%' }}>
                {error}
              </div>
            )}

            <input
              className="form-input"
              style={{ width: '100%', marginBottom: 12, background: 'var(--surface-2)' }}
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="Email"
              required
            />

            <input
              className="form-input"
              style={{ width: '100%', marginBottom: 12, background: 'var(--surface-2)' }}
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Password"
              required
            />

            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24, textDecoration: 'underline', cursor: 'pointer' }}>
              Forgot your password?
            </div>

            <button
              className="btn btn-primary"
              style={{ width: 160, borderRadius: 30, padding: '12px 24px', fontWeight: 700 }}
              type="submit"
              disabled={loading}
            >
              {loading ? 'WAIT…' : 'SIGN IN'}
            </button>

            {/* Mobile toggle */}
            <p style={{ marginTop: 20, fontSize: 13, color: 'var(--text-muted)' }}>
              <span
                style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 600 }}
                onClick={() => setIsRegister(true)}
              >
                New here? Sign up.
              </span>
            </p>

          </form>
        </div>

        {/* ══════════ OVERLAY (desktop only) ══════════ */}
        <div className="auth-overlay-container">
          <div className="auth-overlay">

            {/* Left panel — shows when register is active */}
            <div className="auth-overlay-panel auth-overlay-left">
              <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 32, fontWeight: 800, marginBottom: 16 }}>
                Welcome Back!
              </h1>
              <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 30, opacity: 0.9 }}>
                To keep connected with us please login with your personal info
              </p>
              <button
                className="btn"
                style={{ background: 'transparent', border: '2px solid #0d1117', color: '#0d1117', width: 160, borderRadius: 30, padding: '12px 24px', fontWeight: 700 }}
                onClick={() => setIsRegister(false)}
              >
                SIGN IN
              </button>
            </div>

            {/* Right panel — shows when login is active */}
            <div className="auth-overlay-panel auth-overlay-right">
              <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 32, fontWeight: 800, marginBottom: 16 }}>
                Hello, Friend!
              </h1>
              <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 14, opacity: 0.9 }}>
                Enter your personal details and start your journey with WasteWatch
              </p>
              <p style={{ fontSize: 12, opacity: 0.75, marginBottom: 24, lineHeight: 1.5 }}>
                Piliin ang inyong barangay sa registration para makita ang pinakamalapit na schedule at hotspot.
              </p>
              <button
                className="btn"
                style={{ background: 'transparent', border: '2px solid #0d1117', color: '#0d1117', width: 160, borderRadius: 30, padding: '12px 24px', fontWeight: 700 }}
                onClick={() => setIsRegister(true)}
              >
                SIGN UP
              </button>
            </div>

          </div>
        </div>

      </div>
    </div>
  )
}
