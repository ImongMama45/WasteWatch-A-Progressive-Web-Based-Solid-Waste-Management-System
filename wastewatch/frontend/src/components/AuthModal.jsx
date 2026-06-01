/**
 * components/AuthModal.jsx
 * -------------------------
 * Sliding panel auth modal.
 * RESTORED: Fixed layout and misplaced panels.
 */

import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import BarangaySelect from './BarangaySelect'

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
    barangay:  null,
  })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = 'auto' }
  }, [])

  useEffect(() => { setError('') }, [isRegister])

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

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

  async function handleRegister(e) {
    e.preventDefault()
    setError('')

    console.log('DEBUG: Registration Attempt', form);

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
      const payload = {
        full_name: form.full_name,
        email:     form.email,
        password:  form.password,
        password2: form.password2,
        barangay:  form.barangay,
        role:      'citizen'
      };
      console.log('DEBUG: Sending Payload', payload);
      await register(payload)

      await login(form.email, form.password)
      if (onClose) onClose()
      navigate('/dashboard')
    } catch (err) {
      console.error('DEBUG: Registration Error', err.response?.data);
      const data = err.response?.data
      if (typeof data === 'string') {
        setError('Server error. Please try again later.')
        return
      }
      const fieldErrors = []
      if (data?.full_name) fieldErrors.push(`Name: ${data.full_name[0]}`)
      if (data?.email) fieldErrors.push(`Email: ${data.email[0]}`)
      if (data?.password) fieldErrors.push(`Password: ${data.password[0]}`)
      if (data?.barangay) fieldErrors.push(`Barangay: ${data.barangay[0]}`)
      if (data?.non_field_errors) fieldErrors.push(data.non_field_errors[0])
      
      setError(fieldErrors.length > 0 ? fieldErrors.join(' | ') : (data?.error || 'Registration failed.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-modal-backdrop">
      <style>{`
        @keyframes show {
          0%, 49.99% { opacity: 0; z-index: 1; }
          50%, 100%  { opacity: 1; z-index: 5; }
        }

        .auth-modal-backdrop {
          position: fixed; inset: 0;
          background: rgba(13, 17, 23, 0.85);
          backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center;
          z-index: 9999; padding: 20px;
        }

        .auth-modal-container {
          position: relative;
          width: 850px; max-width: 100%;
          height: 600px;
          background: var(--surface);
          border-radius: 20px;
          box-shadow: 0 14px 28px rgba(0,0,0,0.25), 0 10px 10px rgba(0,0,0,0.22);
          overflow: hidden;
        }

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
        }
        .auth-modal-container.right-panel-active .sign-up-container {
          transform: translateX(100%); opacity: 1; z-index: 5;
          animation: show 0.6s;
        }

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

        .auth-form-content {
          display: flex; align-items: center; justify-content: center;
          flex-direction: column; padding: 0 40px; height: 100%;
          text-align: center;
        }

        .auth-modal-close {
          position: absolute; top: 20px; right: 20px;
          background: rgba(0,0,0,0.1); border: none;
          width: 32px; height: 32px; border-radius: 50%;
          color: inherit; font-size: 20px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          z-index: 200;
        }

        @media (max-width: 768px) {
          .auth-modal-container { height: auto; min-height: 550px; }
          .auth-form-container { position: relative; width: 100%; }
          .sign-in-container, .sign-up-container { width: 100%; transform: none !important; opacity: 1 !important; z-index: 1 !important; }
          .auth-overlay-container { display: none; }
          .sign-up-container { display: none; }
          .auth-modal-container.right-panel-active .sign-in-container { display: none; }
          .auth-modal-container.right-panel-active .sign-up-container { display: flex; }
          .auth-form-content { padding: 40px 24px; }
        }
      `}</style>

      <div className={`auth-modal-container ${isRegister ? 'right-panel-active' : ''}`}>
        <button className="auth-modal-close" onClick={onClose}>×</button>

        {/* SIGN-UP PANEL */}
        <div className="auth-form-container sign-up-container">
          <form className="auth-form-content" onSubmit={handleRegister}>
            <h1 style={{ marginBottom: 12 }}>Create Account</h1>
            
            {error && isRegister && <div className="alert alert-error" style={{ marginBottom: 10, width: '100%' }}>{error}</div>}

            <input className="form-input" style={{ marginBottom: 8, background: 'var(--surface-2)' }} type="text" name="full_name" value={form.full_name} onChange={handleChange} placeholder="Full Name" required />
            <input className="form-input" style={{ marginBottom: 8, background: 'var(--surface-2)' }} type="email" name="email" value={form.email} onChange={handleChange} placeholder="Email" required />
            
            <div style={{ width: '100%', textAlign: 'left', marginBottom: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, display: 'block' }}>Barangay</label>
              <BarangaySelect barangays={barangays} value={form.barangay} onChange={id => setForm(f => ({ ...f, barangay: id }))} />
            </div>

            <input className="form-input" style={{ marginBottom: 8, background: 'var(--surface-2)' }} type="password" name="password" value={form.password} onChange={handleChange} placeholder="Password" required />
            <input className="form-input" style={{ marginBottom: 12, background: 'var(--surface-2)' }} type="password" name="password2" value={form.password2} onChange={handleChange} placeholder="Confirm Password" required />

            <button className="btn btn-primary" style={{ width: 160, borderRadius: 30 }} type="submit" disabled={loading}>{loading ? 'WAIT…' : 'SIGN UP'}</button>
            <p className="mobile-only" style={{ marginTop: 16, fontSize: 13 }} onClick={() => setIsRegister(false)}>Already have an account? <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Sign in</span></p>
          </form>
        </div>

        {/* SIGN-IN PANEL */}
        <div className="auth-form-container sign-in-container">
          <form className="auth-form-content" onSubmit={handleLogin}>
            <h1 style={{ marginBottom: 20 }}>Sign in</h1>
            {error && !isRegister && <div className="alert alert-error" style={{ marginBottom: 10, width: '100%' }}>{error}</div>}
            <input className="form-input" style={{ marginBottom: 12, background: 'var(--surface-2)' }} type="email" name="email" value={form.email} onChange={handleChange} placeholder="Email" required />
            <input className="form-input" style={{ marginBottom: 24, background: 'var(--surface-2)' }} type="password" name="password" value={form.password} onChange={handleChange} placeholder="Password" required />
            <button className="btn btn-primary" style={{ width: 160, borderRadius: 30 }} type="submit" disabled={loading}>{loading ? 'WAIT…' : 'SIGN IN'}</button>
            <p className="mobile-only" style={{ marginTop: 20, fontSize: 13 }} onClick={() => setIsRegister(true)}>New here? <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Sign up</span></p>
          </form>
        </div>

        {/* OVERLAY */}
        <div className="auth-overlay-container">
          <div className="auth-overlay">
            <div className="auth-overlay-panel auth-overlay-left">
              <h1>Welcome Back!</h1>
              <p style={{ marginBottom: 30 }}>To keep connected with us please login with your personal info</p>
              <button className="btn" style={{ background: 'transparent', border: '2px solid #0d1117', color: '#0d1117', borderRadius: 30 }} onClick={() => setIsRegister(false)}>SIGN IN</button>
            </div>
            <div className="auth-overlay-panel auth-overlay-right">
              <h1>Hello, Friend!</h1>
              <p style={{ marginBottom: 30 }}>Enter your personal details and start your journey with us</p>
              <button className="btn" style={{ background: 'transparent', border: '2px solid #0d1117', color: '#0d1117', borderRadius: 30 }} onClick={() => setIsRegister(true)}>SIGN UP</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
