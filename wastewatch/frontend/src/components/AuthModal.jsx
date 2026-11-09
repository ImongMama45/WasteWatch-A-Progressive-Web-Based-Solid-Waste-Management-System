/**
 * components/AuthModal.jsx
 * -------------------------
 * Sliding panel auth modal for Lucena City WasteWatch.
 * Retains the two-panel sliding overlay design while supporting:
 *   - Citizen-only registration with phone number, location, and consent
 *   - Email verification flow with resend countdown
 *   - Forgot password and reset password flows
 *   - Admin/Staff guidance that specialized accounts are provisioned by administrators
 *   - Zero emojis, using Lucide icons exclusively
 */

import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Mail,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  ShieldAlert,
  KeyRound,
  UserCheck,
  RefreshCw,
  X,
  Phone,
  Home
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import BarangaySelect from './BarangaySelect'

export default function AuthModal({ defaultMode = 'login', onClose }) {
  const {
    user,
    logout,
    login,
    register,
    barangays,
    verifyEmail,
    resendVerification,
    forgotPassword,
    resetPassword
  } = useAuth()

  const navigate = useNavigate()
  const [params] = useSearchParams()
  const nextUrl = params.get('next') || '/dashboard'

  // URL parameters for email verification or password reset
  const queryToken = params.get('token')
  const queryUid = params.get('uid')

  // Top-level panel state: 'register' shows the sign-up panel, 'login' shows the sign-in panel
  const [isRegister, setIsRegister] = useState(defaultMode === 'register')

  // Sign-in sub-view: 'login' | 'forgot' | 'forgot-sent' | 'reset' | 'reset-success' | 'verify-status'
  const initialLoginView = (() => {
    if (defaultMode === 'reset-password' || (queryUid && queryToken)) return 'reset'
    if (defaultMode === 'verify-email' || queryToken) return 'verify-status'
    if (defaultMode === 'forgot-password') return 'forgot'
    return 'login'
  })()
  const [loginView, setLoginView] = useState(initialLoginView)

  // Registration step: 1 (Basics) | 2 (Resident Details & Consent) | 'sent' (Verification link sent)
  const [regStep, setRegStep] = useState(1)

  // Form states
  const [form, setForm] = useState({
    email: '',
    password: '',
    password2: '',
    full_name: '',
    phone_number: '',
    barangay: null,
    address_line: '',
    accept_terms: false,
  })

  // Password reset specific form
  const [resetForm, setResetForm] = useState({
    password: '',
    password2: '',
  })

  const [forgotEmail, setForgotEmail] = useState('')
  const [unverifiedEmail, setUnverifiedEmail] = useState('')

  // UI status states
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  // Password visibility toggles
  const [showPassword, setShowPassword] = useState(false)
  const [showPassword2, setShowPassword2] = useState(false)
  const [showResetPw, setShowResetPw] = useState(false)
  const [showResetPw2, setShowResetPw2] = useState(false)

  // Verification URL status
  const [verifyState, setVerifyState] = useState({
    loading: false,
    success: false,
    message: '',
  })

  // Lock body scroll while modal is active
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = 'auto' }
  }, [])

  // Clear errors when panel toggles
  useEffect(() => {
    setError('')
    setSuccessMsg('')
  }, [isRegister, loginView, regStep])

  // Handle countdown timer for resend buttons
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => {
      setResendCooldown(prev => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  // Automatically execute verification when arriving on verify-email with a token
  useEffect(() => {
    if (queryToken && !queryUid && loginView === 'verify-status' && !verifyState.success && !verifyState.loading) {
      setVerifyState({ loading: true, success: false, message: 'Validating verification link...' })
      verifyEmail(queryToken)
        .then(res => {
          setVerifyState({
            loading: false,
            success: true,
            message: res.message || 'Your email has been verified successfully. You can now sign in.'
          })
        })
        .catch(err => {
          setVerifyState({
            loading: false,
            success: false,
            message: err.response?.data?.error || 'Verification link is invalid or has expired.'
          })
        })
    }
  }, [queryToken, queryUid, loginView])

  function handleChange(e) {
    const { name, value, type, checked } = e.target
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
  }

  // ── Login Handler ──────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setUnverifiedEmail('')

    if (user) {
      setError('Active session detected. Please sign out of your current account before signing in.')
      return
    }

    setLoading(true)

    try {
      await login(form.email, form.password)
      if (onClose) onClose()
      navigate(nextUrl)
    } catch (err) {
      const errCode = err.response?.data?.code
      const errMsg = err.response?.data?.error || 'Invalid email or password.'
      
      if (errCode === 'email_not_verified') {
        setUnverifiedEmail(err.response?.data?.email || form.email)
        setError(errMsg)
      } else {
        setError(errMsg)
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Resend Verification Handler ───────────────────────────────────────────
  async function handleResendVerification(targetEmail) {
    const emailToSend = targetEmail || unverifiedEmail || form.email
    if (!emailToSend) return
    
    setError('')
    setSuccessMsg('')
    setLoading(true)

    try {
      const res = await resendVerification(emailToSend)
      setSuccessMsg(res.message || 'A new verification link has been sent to your email.')
      setResendCooldown(res.cooldown_seconds || 60)
    } catch (err) {
      if (err.response?.status === 429) {
        setError('Please wait a moment before requesting another link.')
      } else {
        setError(err.response?.data?.error || 'Could not send verification email. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Registration Step 1 -> 2 ──────────────────────────────────────────────
  function handleNextRegisterStep(e) {
    e.preventDefault()
    setError('')

    if (!form.full_name.trim()) {
      setError('Please provide your full name.')
      return
    }
    if (!form.email.trim()) {
      setError('Please provide a valid email address.')
      return
    }
    if (!form.phone_number.trim()) {
      setError('Please enter your Philippine mobile number (e.g. 09171234567).')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (form.password !== form.password2) {
      setError('Passwords do not match.')
      return
    }

    setRegStep(2)
  }

  // ── Registration Final Submit ─────────────────────────────────────────────
  async function handleRegister(e) {
    e.preventDefault()
    setError('')

    if (user) {
      setError('Active session detected. Please sign out of your current account before creating a new account.')
      return
    }

    if (!form.barangay) {
      setError('Please select your barangay in Lucena City.')
      return
    }
    if (!form.accept_terms) {
      setError('You must accept the Terms of Service and Privacy Policy to register.')
      return
    }

    setLoading(true)
    try {
      const nameParts = form.full_name.trim().split(' ')
      const first_name = nameParts[0] || ''
      const last_name = nameParts.length > 1 ? nameParts.slice(1).join(' ') : ' '

      const payload = {
        first_name,
        last_name,
        email: form.email.trim().toLowerCase(),
        phone_number: form.phone_number.trim(),
        barangay: form.barangay,
        address_line: form.address_line.trim(),
        password: form.password,
        password2: form.password2,
        accept_terms: true,
      }

      await register(payload)
      setRegStep('sent')
      setResendCooldown(60)
    } catch (err) {
      const data = err.response?.data || {}
      if (typeof data === 'string') {
        setError('Server error. Please try again later.')
        return
      }

      const fieldErrors = []
      if (data?.first_name) fieldErrors.push(`First Name: ${data.first_name[0]}`)
      if (data?.last_name) fieldErrors.push(`Last Name: ${data.last_name[0]}`)
      if (data?.email) fieldErrors.push(`Email: ${data.email[0]}`)
      if (data?.phone_number) fieldErrors.push(`Mobile: ${data.phone_number[0]}`)
      if (data?.barangay) fieldErrors.push(`Barangay: ${data.barangay[0]}`)
      if (data?.password) fieldErrors.push(Array.isArray(data.password) ? data.password[0] : data.password)
      if (data?.accept_terms) fieldErrors.push(data.accept_terms[0])
      if (data?.non_field_errors) fieldErrors.push(data.non_field_errors[0])
      if (data?.error) fieldErrors.push(data.error)

      setError(fieldErrors.length > 0 ? fieldErrors.join(' | ') : 'Registration failed. Please check your inputs.')
    } finally {
      setLoading(false)
    }
  }

  // ── Forgot Password Request ───────────────────────────────────────────────
  async function handleForgotPassword(e) {
    e.preventDefault()
    if (!forgotEmail) return
    setError('')
    setSuccessMsg('')
    setLoading(true)

    try {
      const res = await forgotPassword(forgotEmail)
      setSuccessMsg(res.message || 'If a citizen account matches that email, reset instructions have been sent.')
      setResendCooldown(res.cooldown_seconds || 60)
      setLoginView('forgot-sent')
    } catch (err) {
      if (err.response?.status === 429) {
        setError('Please wait a moment before requesting another reset email.')
      } else {
        setError(err.response?.data?.error || 'Unable to process reset request.')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Reset Password Submit ─────────────────────────────────────────────────
  async function handleResetPassword(e) {
    e.preventDefault()
    setError('')

    if (resetForm.password !== resetForm.password2) {
      setError('Passwords do not match.')
      return
    }
    if (resetForm.password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }

    setLoading(true)
    try {
      await resetPassword({
        uid: queryUid,
        token: queryToken,
        password: resetForm.password,
        password2: resetForm.password2
      })
      setLoginView('reset-success')
    } catch (err) {
      setError(err.response?.data?.error || 'Password reset failed. The link may have expired.')
    } finally {
      setLoading(false)
    }
  }

  // ── Active Session Guard: Prevent logged-in users from seeing or submitting auth forms ──
  if (user && loginView !== 'verify-status') {
    return (
      <div className="auth-modal-backdrop" onClick={onClose} style={{
        position: 'fixed', inset: 0,
        background: 'rgba(13, 17, 23, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 10000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20
      }}>
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: 'var(--surface, #ffffff)',
            borderRadius: 16,
            maxWidth: 440,
            width: '100%',
            padding: '32px 28px',
            textAlign: 'center',
            boxShadow: '0 24px 48px rgba(0,0,0,0.3)',
            border: '1px solid var(--border, #e2e8f0)',
            position: 'relative'
          }}
        >
          <button
            onClick={onClose}
            type="button"
            style={{
              position: 'absolute', top: 16, right: 16,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted, #64748b)', padding: 4
            }}
          >
            <X size={20} />
          </button>

          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px'
          }}>
            <ShieldAlert size={28} />
          </div>

          <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px', color: 'var(--text, #0f172a)' }}>
            Active Session Detected
          </h2>

          <p style={{ fontSize: 13, color: 'var(--text-muted, #64748b)', lineHeight: 1.5, margin: '0 0 16px' }}>
            You are currently signed in as <strong style={{ color: 'var(--text, #0f172a)' }}>{user.full_name || user.email}</strong> (<span style={{ fontFamily: 'monospace' }}>{user.email}</span>).
          </p>

          <div style={{
            background: 'var(--surface-2, #f8fafc)',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: 8,
            padding: '12px 14px',
            fontSize: 12,
            color: 'var(--text-muted, #64748b)',
            lineHeight: 1.45,
            marginBottom: 22,
            textAlign: 'left'
          }}>
            For security and session integrity, you cannot log into another account or create a new user while an active session exists. Please sign out first to change accounts.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '11px', borderRadius: 8, fontWeight: 700 }}
              onClick={() => {
                if (onClose) onClose()
                navigate(nextUrl)
              }}
            >
              Continue to Dashboard
            </button>

            <button
              type="button"
              className="btn btn-outline"
              style={{
                width: '100%', padding: '10px', borderRadius: 8, fontWeight: 700,
                color: '#dc2626', borderColor: '#fca5a5'
              }}
              onClick={async () => {
                await logout()
              }}
            >
              Sign Out of Current Account
            </button>
          </div>
        </div>
      </div>
    )
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
          width: 880px; max-width: 100%;
          height: 620px;
          background: var(--surface);
          border-radius: 20px;
          box-shadow: 0 16px 40px rgba(0,0,0,0.3), 0 6px 12px rgba(0,0,0,0.2);
          overflow: hidden;
          border: 1px solid var(--border);
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
          background: linear-gradient(rgba(10, 25, 15, 0.65), rgba(10, 25, 15, 0.85)), url('/lucena_cleaning_bg.png');
          background-size: cover;
          background-position: center;
          color: white; position: relative; left: -100%; height: 100%; width: 200%;
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

        .auth-form-scrollable {
          display: flex; flex-direction: column;
          padding: 28px 36px; height: 100%; box-sizing: border-box;
          overflow-y: auto; text-align: left;
        }

        .auth-form-scrollable::-webkit-scrollbar {
          width: 5px;
        }
        .auth-form-scrollable::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 4px;
        }

        .auth-modal-close {
          position: absolute; top: 16px; right: 16px;
          background: rgba(0,0,0,0.06); border: none;
          width: 32px; height: 32px; border-radius: 50%;
          color: inherit; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          z-index: 200; transition: background 0.2s;
        }
        .auth-modal-close:hover {
          background: rgba(0,0,0,0.14);
        }

        .auth-notice-box {
          background: rgba(46, 125, 50, 0.08);
          border: 1px solid rgba(46, 125, 50, 0.2);
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 11.5px;
          color: var(--text-muted);
          line-height: 1.45;
          margin-bottom: 14px;
          display: flex;
          align-items: flex-start;
          gap: 8px;
        }

        .step-progress-indicator {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-bottom: 14px;
        }
        .step-dot {
          width: 24px;
          height: 4px;
          border-radius: 2px;
          background: var(--border);
          transition: background 0.3s;
        }
        .step-dot.active {
          background: var(--accent);
        }

        .mobile-only { display: none; }

        @media (max-width: 768px) {
          .auth-modal-backdrop {
            align-items: center;
            justify-content: center;
            padding: 16px;
          }

          .auth-modal-container {
            width: 100%;
            max-width: 440px;
            height: auto;
            max-height: 90vh;
            border-radius: 20px;
          }

          .auth-form-container {
            position: relative;
            width: 100%;
            height: auto;
          }

          .sign-in-container,
          .sign-up-container {
            width: 100%;
            transform: none !important;
            opacity: 1 !important;
            z-index: 1 !important;
          }

          .auth-overlay-container { display: none; }
          .sign-up-container { display: none; }

          .auth-modal-container.right-panel-active .sign-in-container { display: none; }
          .auth-modal-container.right-panel-active .sign-up-container {
            display: block;
            width: 100%;
          }

          .auth-form-scrollable {
            padding: 32px 24px 28px;
            height: auto;
            max-height: 85vh;
          }

          .auth-modal-close {
            top: 12px; right: 12px;
          }

          .mobile-only { display: block !important; }
        }
      `}</style>

      <div className={`auth-modal-container ${isRegister ? 'right-panel-active' : ''}`}>
        <button
          className="auth-modal-close"
          onClick={onClose}
          aria-label="Close modal"
        >
          <X size={18} />
        </button>

        {/* ════════════════ SIGN-UP PANEL (CITIZEN ONLY) ════════════════ */}
        <div className="auth-form-container sign-up-container">
          <div className="auth-form-scrollable">
            {regStep === 'sent' ? (
              // ── Post-Registration Verification Sent State ──
              <div style={{ textAlign: 'center', margin: 'auto 0', padding: '20px 0' }}>
                <div style={{
                  width: 56, height: 56, borderRadius: '50%',
                  background: 'rgba(46, 125, 50, 0.12)',
                  color: 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 16px'
                }}>
                  <Mail size={28} />
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Verify Your Email</h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 20 }}>
                  We sent an activation link to <strong style={{ color: 'var(--text)' }}>{form.email}</strong>.
                  Please click the link in your inbox to activate your citizen account before signing in.
                </p>

                {error && <div className="alert alert-error" style={{ marginBottom: 12, fontSize: 12 }}>{error}</div>}
                {successMsg && <div className="alert alert-success" style={{ marginBottom: 12, fontSize: 12 }}>{successMsg}</div>}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ borderRadius: 24, padding: '8px 20px', fontSize: 12.5 }}
                    onClick={() => handleResendVerification(form.email)}
                    disabled={loading || resendCooldown > 0}
                  >
                    {resendCooldown > 0 ? `Resend link in ${resendCooldown}s` : 'Resend verification email'}
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ borderRadius: 24, width: 180, marginTop: 8 }}
                    onClick={() => {
                      setIsRegister(false)
                      setLoginView('login')
                      setRegStep(1)
                    }}
                  >
                    Go to Sign In
                  </button>
                </div>
              </div>
            ) : (
              // ── Active Registration Steps ──
              <>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h1 style={{ fontSize: 21, fontWeight: 700, margin: 0 }}>Create Citizen Account</h1>
                    <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, background: 'rgba(46,125,50,0.1)', padding: '2px 8px', borderRadius: 12 }}>
                      Step {regStep} of 2
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                    Lucena City Solid Waste Management Portal
                  </p>
                </div>

                <div className="step-progress-indicator">
                  <div className={`step-dot ${regStep >= 1 ? 'active' : ''}`} />
                  <div className={`step-dot ${regStep >= 2 ? 'active' : ''}`} />
                </div>

                {/* Specialized accounts guidance banner */}
                <div className="auth-notice-box">
                  <ShieldAlert size={16} style={{ flexShrink: 0, color: 'var(--accent)', marginTop: 2 }} />
                  <div>
                    <strong>Citizens Only:</strong> Driver, Watcher, and Barangay Official accounts are created directly by administrators.
                  </div>
                </div>

                {error && isRegister && (
                  <div className="alert alert-error" style={{ marginBottom: 12, fontSize: 12 }}>
                    <AlertCircle size={14} style={{ marginRight: 6, flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}

                {regStep === 1 ? (
                  // ── Step 1: Personal Details ──
                  <form onSubmit={handleNextRegisterStep} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>
                        Full Name *
                      </label>
                      <input
                        className="form-input"
                        style={{ width: '100%', background: 'var(--surface-2)', fontSize: 13 }}
                        type="text"
                        name="full_name"
                        value={form.full_name}
                        onChange={handleChange}
                        placeholder="Juan Dela Cruz"
                        required
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>
                        Email Address *
                      </label>
                      <input
                        className="form-input"
                        style={{ width: '100%', background: 'var(--surface-2)', fontSize: 13 }}
                        type="email"
                        name="email"
                        value={form.email}
                        onChange={handleChange}
                        placeholder="your.email@example.com"
                        required
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>
                        Mobile Number * (Philippine Mobile)
                      </label>
                      <div style={{ position: 'relative' }}>
                        <input
                          className="form-input"
                          style={{ width: '100%', background: 'var(--surface-2)', fontSize: 13, paddingLeft: 34 }}
                          type="tel"
                          name="phone_number"
                          value={form.phone_number}
                          onChange={handleChange}
                          placeholder="09171234567"
                          required
                        />
                        <Phone size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>
                        Password * (min. 8 characters)
                      </label>
                      <div style={{ position: 'relative' }}>
                        <input
                          className="form-input"
                          style={{ width: '100%', background: 'var(--surface-2)', fontSize: 13, paddingRight: 38 }}
                          type={showPassword ? 'text' : 'password'}
                          name="password"
                          value={form.password}
                          onChange={handleChange}
                          placeholder="Create secure password"
                          required
                          minLength={8}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>
                        Confirm Password *
                      </label>
                      <div style={{ position: 'relative' }}>
                        <input
                          className="form-input"
                          style={{ width: '100%', background: 'var(--surface-2)', fontSize: 13, paddingRight: 38 }}
                          type={showPassword2 ? 'text' : 'password'}
                          name="password2"
                          value={form.password2}
                          onChange={handleChange}
                          placeholder="Re-type password"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword2(!showPassword2)}
                          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
                        >
                          {showPassword2 ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>

                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-primary"
                        style={{ borderRadius: 30, padding: '10px 24px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}
                        type="submit"
                      >
                        Next Step <ArrowRight size={15} />
                      </button>
                    </div>
                  </form>
                ) : (
                  // ── Step 2: Barangay & Consent ──
                  <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>
                        Barangay Residence *
                      </label>
                      <BarangaySelect
                        barangays={barangays}
                        value={form.barangay}
                        onChange={id => setForm(f => ({ ...f, barangay: id }))}
                        label="Select your barangay in Lucena"
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>
                        Street / Purok / House No. (Optional)
                      </label>
                      <div style={{ position: 'relative' }}>
                        <input
                          className="form-input"
                          style={{ width: '100%', background: 'var(--surface-2)', fontSize: 13, paddingLeft: 34 }}
                          type="text"
                          name="address_line"
                          value={form.address_line}
                          onChange={handleChange}
                          placeholder="e.g. Purok 3, Ilayang Iyam"
                        />
                        <Home size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      </div>
                    </div>

                    <div style={{
                      background: 'var(--surface-2)',
                      padding: '12px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      marginTop: 4
                    }}>
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, cursor: 'pointer', color: 'var(--text)' }}>
                        <input
                          type="checkbox"
                          name="accept_terms"
                          checked={form.accept_terms}
                          onChange={handleChange}
                          style={{ marginTop: 2, accentColor: 'var(--accent)' }}
                          required
                        />
                        <span>
                          I agree to the <strong>Terms of Service</strong> and <strong>Privacy Policy</strong> for WasteWatch Lucena City Solid Waste Management System.
                        </span>
                      </label>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ borderRadius: 30, padding: '8px 18px', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 5 }}
                        onClick={() => setRegStep(1)}
                        disabled={loading}
                      >
                        <ArrowLeft size={14} /> Back
                      </button>

                      <button
                        className="btn btn-primary"
                        style={{ borderRadius: 30, padding: '10px 24px', fontSize: 13 }}
                        type="submit"
                        disabled={loading}
                      >
                        {loading ? 'CREATING…' : 'SIGN UP'}
                      </button>
                    </div>
                  </form>
                )}

                <p className="mobile-only" style={{ marginTop: 20, fontSize: 13, textAlign: 'center' }}>
                  Already have an account?{' '}
                  <span
                    style={{ color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => {
                      setIsRegister(false)
                      setLoginView('login')
                    }}
                  >
                    Sign in
                  </span>
                </p>
              </>
            )}
          </div>
        </div>

        {/* ════════════════ SIGN-IN PANEL ════════════════ */}
        <div className="auth-form-container sign-in-container">
          <div className="auth-form-scrollable">
            {/* ── View 1: Email Verification Status (from URL token) ── */}
            {loginView === 'verify-status' && (
              <div style={{ textAlign: 'center', margin: 'auto 0', padding: '16px 0' }}>
                <div style={{
                  width: 52, height: 52, borderRadius: '50%',
                  background: verifyState.success ? 'rgba(46,125,50,0.12)' : 'rgba(211,47,47,0.12)',
                  color: verifyState.success ? 'var(--accent)' : '#d32f2f',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 16px'
                }}>
                  {verifyState.loading ? (
                    <RefreshCw size={26} className="spin" />
                  ) : verifyState.success ? (
                    <CheckCircle2 size={28} />
                  ) : (
                    <AlertCircle size={28} />
                  )}
                </div>

                <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 10px' }}>
                  {verifyState.loading ? 'Verifying Account' : verifyState.success ? 'Email Verified!' : 'Verification Issue'}
                </h2>

                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 24 }}>
                  {verifyState.message}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                  {verifyState.success ? (
                    <button
                      className="btn btn-primary"
                      style={{ width: 180, borderRadius: 30 }}
                      onClick={() => setLoginView('login')}
                    >
                      Sign In Now
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn btn-outline"
                        style={{ borderRadius: 30, padding: '8px 20px', fontSize: 12.5 }}
                        onClick={() => {
                          setLoginView('login')
                          setError('Please enter your email and try signing in, then request a new verification link.')
                        }}
                      >
                        Return to Sign In
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── View 2: Forgot Password Form ── */}
            {loginView === 'forgot' && (
              <div style={{ margin: 'auto 0' }}>
                <button
                  type="button"
                  onClick={() => setLoginView('login')}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 16 }}
                >
                  <ArrowLeft size={14} /> Back to Sign In
                </button>

                <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Forgot Password</h1>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                  Enter your registered citizen email to receive password reset instructions.
                </p>

                <div className="auth-notice-box">
                  <KeyRound size={15} style={{ flexShrink: 0, color: 'var(--accent)', marginTop: 2 }} />
                  <div>
                    Staff, Watchers, Drivers, and Officials should contact the system administrator to reset credentials.
                  </div>
                </div>

                {error && <div className="alert alert-error" style={{ marginBottom: 12, fontSize: 12 }}>{error}</div>}

                <form onSubmit={handleForgotPassword}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>
                    Citizen Email Address
                  </label>
                  <input
                    className="form-input"
                    style={{ marginBottom: 16, width: '100%', background: 'var(--surface-2)' }}
                    type="email"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    placeholder="your.email@example.com"
                    required
                  />

                  <div style={{ textAlign: 'center' }}>
                    <button
                      className="btn btn-primary"
                      style={{ width: 200, borderRadius: 30 }}
                      type="submit"
                      disabled={loading || resendCooldown > 0}
                    >
                      {loading ? 'SENDING…' : 'SEND RESET LINK'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* ── View 3: Forgot Password Sent Confirmation ── */}
            {loginView === 'forgot-sent' && (
              <div style={{ textAlign: 'center', margin: 'auto 0', padding: '16px 0' }}>
                <div style={{
                  width: 52, height: 52, borderRadius: '50%',
                  background: 'rgba(46, 125, 50, 0.12)',
                  color: 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 16px'
                }}>
                  <Mail size={26} />
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Check Your Email</h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 20 }}>
                  {successMsg || 'If an account matches that email, reset instructions have been sent.'}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ borderRadius: 24, padding: '8px 20px', fontSize: 12.5 }}
                    onClick={handleForgotPassword}
                    disabled={loading || resendCooldown > 0}
                  >
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend email'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ borderRadius: 24, width: 170 }}
                    onClick={() => setLoginView('login')}
                  >
                    Return to Sign In
                  </button>
                </div>
              </div>
            )}

            {/* ── View 4: Reset Password Form ── */}
            {loginView === 'reset' && (
              <div style={{ margin: 'auto 0' }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Set New Password</h1>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                  Choose a new password for your citizen account.
                </p>

                {error && <div className="alert alert-error" style={{ marginBottom: 12, fontSize: 12 }}>{error}</div>}

                <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>
                      New Password *
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="form-input"
                        style={{ width: '100%', background: 'var(--surface-2)', paddingRight: 38 }}
                        type={showResetPw ? 'text' : 'password'}
                        value={resetForm.password}
                        onChange={e => setResetForm(f => ({ ...f, password: e.target.value }))}
                        placeholder="At least 8 characters"
                        required
                        minLength={8}
                      />
                      <button
                        type="button"
                        onClick={() => setShowResetPw(!showResetPw)}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
                      >
                        {showResetPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 3, display: 'block' }}>
                      Confirm New Password *
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="form-input"
                        style={{ width: '100%', background: 'var(--surface-2)', paddingRight: 38 }}
                        type={showResetPw2 ? 'text' : 'password'}
                        value={resetForm.password2}
                        onChange={e => setResetForm(f => ({ ...f, password2: e.target.value }))}
                        placeholder="Repeat new password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowResetPw2(!showResetPw2)}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
                      >
                        {showResetPw2 ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <div style={{ textAlign: 'center', marginTop: 12 }}>
                    <button
                      className="btn btn-primary"
                      style={{ width: 200, borderRadius: 30 }}
                      type="submit"
                      disabled={loading}
                    >
                      {loading ? 'SAVING…' : 'UPDATE PASSWORD'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* ── View 5: Reset Password Success ── */}
            {loginView === 'reset-success' && (
              <div style={{ textAlign: 'center', margin: 'auto 0', padding: '16px 0' }}>
                <div style={{
                  width: 52, height: 52, borderRadius: '50%',
                  background: 'rgba(46, 125, 50, 0.12)',
                  color: 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 16px'
                }}>
                  <CheckCircle2 size={28} />
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Password Updated!</h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 20 }}>
                  Your password has been changed successfully. You may now sign in using your new credentials.
                </p>
                <button
                  className="btn btn-primary"
                  style={{ width: 180, borderRadius: 30 }}
                  onClick={() => setLoginView('login')}
                >
                  Sign In
                </button>
              </div>
            )}

            {/* ── View 6: Standard Login Form ── */}
            {loginView === 'login' && (
              <form onSubmit={handleLogin} style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column' }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>Sign in</h1>
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 20, textAlign: 'center' }}>
                  WasteWatch Solid Waste Management System
                </p>

                {error && !isRegister && (
                  <div className="alert alert-error" style={{ marginBottom: 14, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertCircle size={15} style={{ flexShrink: 0 }} />
                      <span>{error}</span>
                    </div>

                    {unverifiedEmail && (
                      <button
                        type="button"
                        onClick={() => handleResendVerification(unverifiedEmail)}
                        disabled={loading || resendCooldown > 0}
                        style={{
                          background: 'none', border: 'none', color: 'var(--accent)',
                          textDecoration: 'underline', cursor: 'pointer', fontSize: 11.5,
                          alignSelf: 'flex-start', padding: 0
                        }}
                      >
                        {resendCooldown > 0 ? `Resend activation link in ${resendCooldown}s` : 'Resend activation email now'}
                      </button>
                    )}
                  </div>
                )}

                {successMsg && (
                  <div className="alert alert-success" style={{ marginBottom: 14, fontSize: 12 }}>
                    {successMsg}
                  </div>
                )}

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>
                    Email Address
                  </label>
                  <input
                    className="form-input"
                    style={{ width: '100%', background: 'var(--surface-2)', fontSize: 13 }}
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="e.g. name@example.com"
                    required
                  />
                </div>

                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setLoginView('forgot')}
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11.5, cursor: 'pointer', padding: 0 }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="form-input"
                      style={{ width: '100%', background: 'var(--surface-2)', paddingRight: 40, fontSize: 13 }}
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      value={form.password}
                      onChange={handleChange}
                      placeholder="Enter your password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div style={{ textAlign: 'center', marginTop: 20 }}>
                  <button
                    className="btn btn-primary"
                    style={{ width: 170, borderRadius: 30, padding: '10px 0' }}
                    type="submit"
                    disabled={loading}
                  >
                    {loading ? 'SIGNING IN…' : 'SIGN IN'}
                  </button>
                </div>

                <p className="mobile-only" style={{ marginTop: 24, fontSize: 13, textAlign: 'center' }}>
                  New citizen?{' '}
                  <span
                    style={{ color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => {
                      setIsRegister(true)
                      setRegStep(1)
                    }}
                  >
                    Create citizen account
                  </span>
                </p>
              </form>
            )}
          </div>
        </div>

        {/* ════════════════ OVERLAY PANEL ════════════════ */}
        <div className="auth-overlay-container">
          <div className="auth-overlay">
            {/* Left Overlay: Visible when Sign Up is shown */}
            <div className="auth-overlay-panel auth-overlay-left">
              <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>Welcome Back!</h1>
              <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 28, opacity: 0.9 }}>
                Already registered as a Lucena citizen or staff member? Log in to continue where you left off.
              </p>
              <button
                className="btn"
                style={{
                  background: 'transparent',
                  border: '2px solid white',
                  color: 'white',
                  borderRadius: 30,
                  padding: '9px 28px',
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: 0.5
                }}
                onClick={() => {
                  setIsRegister(false)
                  setLoginView('login')
                }}
              >
                SIGN IN
              </button>
            </div>

            {/* Right Overlay: Visible when Sign In is shown */}
            <div className="auth-overlay-panel auth-overlay-right">
              <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>New Citizen?</h1>
              <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 28, opacity: 0.9 }}>
                Sign up as a Lucena resident to track waste collections, submit reports, and help keep our city clean.
              </p>
              <button
                className="btn"
                style={{
                  background: 'transparent',
                  border: '2px solid white',
                  color: 'white',
                  borderRadius: 30,
                  padding: '9px 28px',
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: 0.5
                }}
                onClick={() => {
                  setIsRegister(true)
                  setRegStep(1)
                }}
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
