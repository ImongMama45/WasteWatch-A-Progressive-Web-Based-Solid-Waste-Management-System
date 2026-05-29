import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function AuthModal({ defaultMode = 'login', onClose }) {
  const { login, register } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const nextUrl = params.get('next') || '/dashboard'

  // true = Register view (Right Panel Active), false = Login view
  const [isRegister, setIsRegister] = useState(defaultMode === 'register')

  const [form, setForm] = useState({ email: '', password: '', password2: '', full_name: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Block scrolling on body when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = 'auto' }
  }, [])

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
    setLoading(true)

    try {
      await register({
        email: form.email,
        password: form.password,
        password2: form.password,
        full_name: form.full_name
      })

      // Auto login after register
      await login(form.email, form.password)

      if (onClose) onClose()

      navigate('/dashboard')

    } catch (err) {
      console.log(err.response?.data)

      const data = err.response?.data

      const firstError =
        data?.email?.[0] ||
        data?.password?.[0] ||
        data?.full_name?.[0] ||
        data?.detail ||
        Object.values(data || {})[0]?.[0] ||
        'Registration failed.'

      setError(firstError)

    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-modal-backdrop">
      <style>{`
        .auth-modal-backdrop {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(13, 17, 23, 0.85); backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center;
          z-index: 9999; padding: 20px;
        }

        .auth-modal-container {
          position: relative; width: 850px; max-width: 100%; height: 550px;
          background: var(--surface); border-radius: 20px;
          box-shadow: 0 14px 28px rgba(0,0,0,0.25), 0 10px 10px rgba(0,0,0,0.22);
          overflow: hidden;
        }

        .auth-form-container {
          position: absolute; top: 0; height: 100%; transition: all 0.6s ease-in-out;
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
          transform: translateX(100%); opacity: 1; z-index: 5; animation: show 0.6s;
        }

        @keyframes show {
          0%, 49.99% { opacity: 0; z-index: 1; }
          50%, 100% { opacity: 1; z-index: 5; }
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
          position: absolute; display: flex; align-items: center; justify-content: center;
          flex-direction: column; padding: 0 40px; text-align: center; top: 0; height: 100%; width: 50%;
          transform: translateX(0); transition: transform 0.6s ease-in-out;
        }

        .auth-overlay-left { transform: translateX(-20%); }
        .auth-modal-container.right-panel-active .auth-overlay-left { transform: translateX(0); }

        .auth-overlay-right { right: 0; transform: translateX(0); }
        .auth-modal-container.right-panel-active .auth-overlay-right { transform: translateX(20%); }

        .auth-form-content {
          display: flex; align-items: center; justify-content: center;
          flex-direction: column; padding: 0 40px; height: 100%; text-align: center;
        }

        .auth-modal-close {
          position: absolute; top: 20px; right: 20px; background: rgba(0,0,0,0.1); border: none;
          width: 32px; height: 32px; border-radius: 50%; color: inherit; font-size: 20px; cursor: pointer;
          display: flex; align-items: center; justify-content: center; z-index: 200; transition: background 0.2s;
        }
        .auth-modal-close:hover { background: rgba(0,0,0,0.2); }
        
        .social-circle {
          border: 1px solid var(--border); border-radius: 50%; width: 40px; height: 40px;
          display: inline-flex; align-items: center; justify-content: center; margin: 0 5px; cursor: pointer;
        }

        /* Mobile Adjustments */
        @media (max-width: 768px) {
          .auth-modal-container { height: auto; min-height: 500px; display: flex; flex-direction: column; }
          .auth-form-container { position: relative; width: 100%; height: auto; padding: 40px 0; }
          .sign-in-container, .sign-up-container { width: 100%; transform: none !important; opacity: 1 !important; z-index: 1 !important; }
          .auth-overlay-container { display: none; }
          .sign-up-container { display: none; }
          .auth-modal-container.right-panel-active .sign-in-container { display: none; }
          .auth-modal-container.right-panel-active .sign-up-container { display: block; }
        }
      `}</style>

      <div className={`auth-modal-container ${isRegister ? 'right-panel-active' : ''}`}>

        <button className="auth-modal-close" style={{ color: isRegister ? 'var(--text)' : '#0d1117' }} onClick={onClose}>×</button>

        {/* --- SIGN UP FORM --- */}
        <div className="auth-form-container sign-up-container">
          <form className="auth-form-content" onSubmit={handleRegister}>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 800, marginBottom: 16 }}>Create Account</h1>

            <div style={{ display: 'flex', marginBottom: 20 }}>
              <div className="social-circle">f</div>
              <div className="social-circle">G+</div>
              <div className="social-circle">in</div>
            </div>

            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>or use your email for registration:</span>

            {error && isRegister && <div className="alert alert-error" style={{ padding: 8, marginBottom: 10, width: '100%' }}>{error}</div>}

            <input className="form-input" style={{ width: '100%', marginBottom: 12, background: 'var(--surface-2)' }} type="text" name="full_name" value={form.full_name} onChange={handleChange} placeholder="👤 Name" required />
            <input className="form-input" style={{ width: '100%', marginBottom: 12, background: 'var(--surface-2)' }} type="email" name="email" value={form.email} onChange={handleChange} placeholder="✉️ Email" required />
            <input className="form-input" style={{ width: '100%', marginBottom: 20, background: 'var(--surface-2)' }} type="password" name="password" value={form.password} onChange={handleChange} placeholder="🔒 Password" required />

            <button className="btn btn-primary" style={{ width: 160, borderRadius: 30, padding: '12px 24px', fontWeight: 700 }} type="submit" disabled={loading}>
              {loading ? 'WAIT...' : 'SIGN UP'}
            </button>

            {/* Mobile toggle link */}
            <div className="desktop-only" style={{ display: 'none' }} />
            <p className="text-muted" style={{ display: 'block', marginTop: 20, fontSize: 13 }} onClick={() => setIsRegister(false)}>
              <span className="mobile-only-block" style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 600 }}>Already have an account? Sign in.</span>
            </p>
          </form>
        </div>

        {/* --- SIGN IN FORM --- */}
        <div className="auth-form-container sign-in-container">
          <form className="auth-form-content" onSubmit={handleLogin}>
            <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 800, marginBottom: 16 }}>Sign in</h1>

            <div style={{ display: 'flex', marginBottom: 20 }}>
              <div className="social-circle">f</div>
              <div className="social-circle">G+</div>
              <div className="social-circle">in</div>
            </div>

            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>or use your account</span>

            {error && !isRegister && <div className="alert alert-error" style={{ padding: 8, marginBottom: 10, width: '100%' }}>{error}</div>}

            <input className="form-input" style={{ width: '100%', marginBottom: 12, background: 'var(--surface-2)' }} type="email" name="email" value={form.email} onChange={handleChange} placeholder="✉️ Email" required />
            <input className="form-input" style={{ width: '100%', marginBottom: 12, background: 'var(--surface-2)' }} type="password" name="password" value={form.password} onChange={handleChange} placeholder="🔒 Password" required />

            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20, textDecoration: 'underline', cursor: 'pointer' }}>Forgot your password?</div>

            <button className="btn btn-primary" style={{ width: 160, borderRadius: 30, padding: '12px 24px', fontWeight: 700 }} type="submit" disabled={loading}>
              {loading ? 'WAIT...' : 'SIGN IN'}
            </button>

            {/* Mobile toggle link */}
            <p className="text-muted" style={{ display: 'block', marginTop: 20, fontSize: 13 }} onClick={() => setIsRegister(true)}>
              <span className="mobile-only-block" style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 600 }}>New here? Sign up.</span>
            </p>
          </form>
        </div>

        {/* --- OVERLAY PANEL (DESKTOP ONLY) --- */}
        <div className="auth-overlay-container">
          <button className="auth-modal-close" style={{ color: isRegister ? '#0d1117' : 'var(--text)' }} onClick={onClose}>×</button>
          <div className="auth-overlay">
            <div className="auth-overlay-panel auth-overlay-left">
              <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 32, fontWeight: 800, marginBottom: 16 }}>Welcome Back!</h1>
              <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 30, opacity: 0.9 }}>
                To keep connected with us please login with your personal info
              </p>
              <button className="btn" style={{ background: 'transparent', border: '2px solid #0d1117', color: '#0d1117', width: 160, borderRadius: 30, padding: '12px 24px', fontWeight: 700 }} onClick={() => setIsRegister(false)}>
                SIGN IN
              </button>
            </div>

            <div className="auth-overlay-panel auth-overlay-right">
              <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 32, fontWeight: 800, marginBottom: 16 }}>Hello, Friend!</h1>
              <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 30, opacity: 0.9 }}>
                Enter your personal details and start your journey with WasteWatch
              </p>
              <button className="btn" style={{ background: 'transparent', border: '2px solid #0d1117', color: '#0d1117', width: 160, borderRadius: 30, padding: '12px 24px', fontWeight: 700 }} onClick={() => setIsRegister(true)}>
                SIGN UP
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
