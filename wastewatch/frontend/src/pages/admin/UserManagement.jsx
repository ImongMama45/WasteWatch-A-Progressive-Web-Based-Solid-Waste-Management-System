import { useState, useEffect, useMemo, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import {
  Users,
  Plus,
  Search,
  X,
  Edit2,
  Trash2,
  Shield,
  Truck,
  MapPin,
  CheckCircle2,
  UserX,
  Eye,
  EyeOff,
  AlertTriangle,
  RotateCcw,
  Check,
  Building2,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Key
} from 'lucide-react'
import DashboardLayout from '../../components/DashboardLayout'
import { useAuth } from '../../context/AuthContext'
import { useUsers } from '../../hooks/useUsers'
import { useNotification } from '../../context/NotificationContext'
import api from '../../api/client'
import { getApiErrorMessage } from '../../utils/notificationHelpers'
import { StatCardSkeleton, TableRowsSkeleton } from '../../components/ui/Skeleton'
import Pagination from '../../components/ui/Pagination'

const ROLES = ['watcher', 'driver', 'brgy_official', 'citizen', 'dumpsite']

const ROLE_META = {
  watcher: { label: 'Watcher', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.25)' },
  driver: { label: 'Driver', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.25)' },
  brgy_official: { label: 'Brgy. Official', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.08)', border: 'rgba(139, 92, 246, 0.25)' },
  citizen: { label: 'Citizen', color: '#10b981', bg: 'rgba(16, 185, 129, 0.08)', border: 'rgba(16, 185, 129, 0.25)' },
  admin: { label: 'Admin', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239, 68, 68, 0.25)' },
  dumpsite: { label: 'Dumpsite Op', color: '#64748b', bg: 'rgba(100, 116, 139, 0.08)', border: 'rgba(100, 116, 139, 0.25)' },
}

const EMPTY_FORM = {
  first_name: '',
  last_name: '',
  username: '',
  email: '',
  password: '',
  password2: '',
  role: 'citizen',
  barangay: '',
  dumpsite: '',
  employee_type: '',
  is_active: true,
  profile_pic: null,
}

export function getDisplayName(u) {
  if (u.full_name && u.full_name.trim()) return u.full_name
  const parts = [u.first_name, u.last_name].filter(Boolean)
  if (parts.length > 0) return parts.join(' ')
  return u.email ? u.email.split('@')[0] : 'Unknown User'
}

function RoleBadge({ role }) {
  const m = ROLE_META[role] || { label: role, color: '#64748b', bg: '#f0f2f5', border: '#e4e6eb' }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      background: m.bg,
      border: `1px solid ${m.border}`,
      color: m.color,
      borderRadius: 4,
      padding: '2px 7px',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap'
    }}>
      {m.label}
    </span>
  )
}

function Avatar({ name, active, profile_pic }) {
  if (profile_pic) {
    return (
      <img
        src={profile_pic}
        alt={name}
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          flexShrink: 0,
          objectFit: 'cover',
          border: active ? '2px solid var(--accent, #10b981)' : '2px solid #cbd5e1'
        }}
      />
    )
  }
  return (
    <div style={{
      width: 34,
      height: 34,
      borderRadius: '50%',
      flexShrink: 0,
      background: active ? 'var(--accent, #10b981)' : '#cbd5e1',
      color: active ? '#ffffff' : '#475569',
      fontWeight: 800,
      fontSize: 13,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  )
}

function UserModal({ user, onSave, onClose, barangays, dumpsites, initialSecretPassword = false }) {
  const isEdit = !!user
  const [form, setForm] = useState(user ? {
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    username: user.username || '',
    email: user.email || '',
    password: '',
    password2: '',
    role: user.role || 'citizen',
    employee_type: user.employee_type || '',
    barangay: user.barangay || '',
    dumpsite: user.dumpsite || '',
    is_active: user.is_active ?? true,
    profile_pic: null,
  } : { ...EMPTY_FORM })

  const [err, setErr] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [unlockedPassword, setUnlockedPassword] = useState(!isEdit || initialSecretPassword)
  const [secretToast, setSecretToast] = useState(false)
  const clickCountRef = useRef(0)
  const clickTimerRef = useRef(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function toggleSecretPassword() {
    if (!isEdit) return
    setUnlockedPassword(prev => {
      const next = !prev
      if (next) {
        setSecretToast(true)
        setTimeout(() => setSecretToast(false), 2400)
      } else {
        set('password', '')
        set('password2', '')
      }
      return next
    })
  }

  // Keyboard shortcut: Alt+P or Ctrl+Shift+P toggles hidden password editing
  useEffect(() => {
    if (!isEdit) return
    function handleKeyDown(e) {
      if ((e.altKey && (e.key === 'p' || e.key === 'P')) ||
          (e.ctrlKey && e.shiftKey && (e.key === 'p' || e.key === 'P'))) {
        e.preventDefault()
        toggleSecretPassword()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEdit])

  // Triple-click on title
  function handleTitleClick() {
    if (!isEdit) return
    clickCountRef.current += 1
    if (clickCountRef.current >= 3) {
      toggleSecretPassword()
      clickCountRef.current = 0
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    } else {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
      clickTimerRef.current = setTimeout(() => {
        clickCountRef.current = 0
      }, 600)
    }
  }

  // Double-click on title
  function handleTitleDoubleClick() {
    if (!isEdit) return
    toggleSecretPassword()
  }

  function validate() {
    if (!form.first_name.trim()) return 'First name is required.'
    if (!form.last_name.trim()) return 'Last name is required.'
    if (!form.username.trim()) return 'Username is required.'
    if (!form.email.trim()) return 'Email is required.'
    if (!isEdit && !form.password.trim()) return 'Password is required for new users.'
    if (form.password && form.password.length < 6) return 'Password must be at least 6 characters.'
    if (form.password && form.password !== form.password2) return 'Passwords do not match.'
    if (form.role === 'dumpsite' && !form.dumpsite) return 'Please assign a dumpsite facility.'
    return ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errorMsg = validate()
    if (errorMsg) {
      setErr(errorMsg)
      return
    }
    setSubmitting(true)
    try {
      const payload = { ...form }
      if (payload.role !== 'citizen') payload.employee_type = ''
      payload.full_name = `${form.first_name} ${form.last_name}`.trim()
      delete payload.password2
      if (isEdit && !payload.password) {
        delete payload.password
      }
      const passwordChanged = isEdit && Boolean(form.password)
      await onSave(payload, passwordChanged)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(5px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface, #ffffff)',
          borderRadius: 18,
          border: '1px solid var(--border, #e2e8f0)',
          padding: 24,
          width: '100%',
          maxWidth: 480,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 25px 60px rgba(0,0,0,0.25)',
          position: 'relative'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3
              onClick={handleTitleClick}
              onDoubleClick={handleTitleDoubleClick}
              title={isEdit ? 'Tip: Double-click or Alt+P to unlock credential management' : undefined}
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 900,
                color: 'var(--text)',
                cursor: isEdit ? 'pointer' : 'default',
                userSelect: 'none'
              }}
            >
              {isEdit ? 'Edit User Account' : 'Register New User'}
            </h3>
            {isEdit && unlockedPassword && (
              <span style={{
                fontSize: 10,
                fontWeight: 800,
                color: '#b45309',
                background: '#fef3c7',
                border: '1px solid #fde68a',
                padding: '2px 6px',
                borderRadius: 4,
                letterSpacing: '0.04em',
                textTransform: 'uppercase'
              }}>
                Security Override
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isEdit && (
              <button
                type="button"
                onClick={toggleSecretPassword}
                title={unlockedPassword ? 'Hide Password Override' : 'Secret Credential Override (Alt+P)'}
                style={{
                  background: unlockedPassword ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
                  border: 'none',
                  borderRadius: 8,
                  width: 30,
                  height: 30,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: unlockedPassword ? '#d97706' : '#cbd5e1',
                  transition: 'all 0.2s ease',
                  opacity: unlockedPassword ? 1 : 0.4
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#d97706' }}
                onMouseLeave={e => {
                  if (!unlockedPassword) {
                    e.currentTarget.style.opacity = '0.4'
                    e.currentTarget.style.color = '#cbd5e1'
                  }
                }}
              >
                <Key size={15} />
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: 'var(--surface-2, #f1f5f9)',
                border: 'none',
                borderRadius: 8,
                width: 30,
                height: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-muted)'
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {secretToast && (
          <div style={{
            background: '#fef3c7',
            border: '1px solid #fde68a',
            color: '#92400e',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 700,
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <Key size={14} color="#d97706" />
            <span>Administrative credential override unlocked.</span>
          </div>
        )}

        {err && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            color: '#ef4444',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 12,
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            <AlertTriangle size={14} />
            <span>{err}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>First Name</label>
              <input
                className="form-input"
                value={form.first_name}
                onChange={e => set('first_name', e.target.value)}
                placeholder="Juan"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #cbd5e1)', background: 'var(--surface-2, #f8fafc)', color: 'var(--text)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Last Name</label>
              <input
                className="form-input"
                value={form.last_name}
                onChange={e => set('last_name', e.target.value)}
                placeholder="Dela Cruz"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #cbd5e1)', background: 'var(--surface-2, #f8fafc)', color: 'var(--text)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Username</label>
              <input
                className="form-input"
                value={form.username}
                onChange={e => set('username', e.target.value)}
                placeholder="juandelacruz"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #cbd5e1)', background: 'var(--surface-2, #f8fafc)', color: 'var(--text)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Email</label>
              <input
                className="form-input"
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="juan@city.gov.ph"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #cbd5e1)', background: 'var(--surface-2, #f8fafc)', color: 'var(--text)' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>System Role</label>
              <select
                value={form.role}
                onChange={e => {
                  const newRole = e.target.value
                  setForm(f => ({
                    ...f,
                    role: newRole,
                    employee_type: newRole === 'citizen' ? f.employee_type : ''
                  }))
                }}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #cbd5e1)', background: 'var(--surface-2, #f8fafc)', color: 'var(--text)', fontWeight: 600, outline: 'none' }}
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>{ROLE_META[r]?.label || r}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Barangay Zone</label>
              <select
                value={form.barangay}
                onChange={e => set('barangay', e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #cbd5e1)', background: 'var(--surface-2, #f8fafc)', color: 'var(--text)', outline: 'none' }}
              >
                <option value="">— Unassigned Zone —</option>
                {barangays.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>

          {form.role === 'dumpsite' && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Assigned Dumpsite</label>
              <select
                value={form.dumpsite}
                onChange={e => set('dumpsite', e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #cbd5e1)', background: 'var(--surface-2, #f8fafc)', color: 'var(--text)', outline: 'none' }}
              >
                <option value="">— Select Facility —</option>
                {dumpsites.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}

          {isEdit && unlockedPassword && (
            <div style={{
              background: 'rgba(245, 158, 11, 0.05)',
              border: '1px solid rgba(245, 158, 11, 0.28)',
              borderRadius: 10,
              padding: '12px 14px',
              marginBottom: 14
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Key size={14} color="#d97706" />
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Password Override
                  </span>
                </div>
                <button
                  type="button"
                  onClick={toggleSecretPassword}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#92400e',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: '2px 6px',
                    borderRadius: 4
                  }}
                >
                  Hide Override
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
                <div style={{ position: 'relative' }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                    New Password
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="form-input"
                    value={form.password}
                    onChange={e => set('password', e.target.value)}
                    placeholder="Min 6 chars"
                    autoFocus
                    style={{ width: '100%', padding: '8px 30px 8px 10px', borderRadius: 8, border: '1px solid var(--border, #cbd5e1)', background: '#ffffff', color: 'var(--text)' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    style={{ position: 'absolute', right: 8, top: 26, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                    Confirm New Password
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="form-input"
                    value={form.password2}
                    onChange={e => set('password2', e.target.value)}
                    placeholder="Re-type new password"
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #cbd5e1)', background: '#ffffff', color: 'var(--text)' }}
                  />
                </div>
              </div>

              <div style={{ fontSize: 11, color: '#78716c', lineHeight: 1.4 }}>
                Enter a new password to overwrite this user&apos;s credentials. Leave blank to keep existing password.
              </div>
            </div>
          )}

          {!isEdit && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  value={form.password}
                  onChange={e => set('password', e.target.value)}
                  placeholder="Min 6 chars"
                  style={{ width: '100%', padding: '8px 30px 8px 10px', borderRadius: 8, border: '1px solid var(--border, #cbd5e1)', background: 'var(--surface-2, #f8fafc)', color: 'var(--text)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  style={{ position: 'absolute', right: 8, top: 26, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Confirm Password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  value={form.password2}
                  onChange={e => set('password2', e.target.value)}
                  placeholder="Re-type password"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #cbd5e1)', background: 'var(--surface-2, #f8fafc)', color: 'var(--text)' }}
                />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
            {form.role === 'citizen' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={form.employee_type === 'crew_member'}
                  onChange={e => set('employee_type', e.target.checked ? 'crew_member' : '')}
                  style={{ width: 16, height: 16, accentColor: '#f59e0b' }}
                />
                <span>Crew Member (Citizen assigned to collection truck teams)</span>
              </label>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={e => set('is_active', e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--accent, #10b981)' }}
              />
              <span>Account Active (Allowed to sign in and perform actions)</span>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '9px 14px',
                borderRadius: 8,
                border: '1px solid var(--border, #cbd5e1)',
                background: 'var(--surface, #ffffff)',
                color: 'var(--text)',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                flex: 1,
                padding: '9px 14px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--accent, #10b981)',
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 800,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.75 : 1,
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)'
              }}
            >
              {submitting ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create User')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function UserManagement() {
  const { user: currentUser } = useAuth()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 10

  const userParams = useMemo(() => ({
    page: currentPage,
    page_size: 10,
    role: roleFilter,
    status: statusFilter,
    search: search.trim()
  }), [currentPage, roleFilter, statusFilter, search])

  const { users, pagination, loading, refresh: refreshUsers } = useUsers(userParams)
  const { notify } = useNotification()

  const [barangays, setBarangays] = useState([])
  const [dumpsites, setDumpsites] = useState([])

  const [modal, setModal] = useState(null)
  const [deleteModal, setDeleteModal] = useState(null)
  const [liftModal, setLiftModal] = useState(null)
  const [liftReason, setLiftReason] = useState('')
  const [toast, setToast] = useState(null)

  const [focusedUserId, setFocusedUserId] = useState(null)
  const [disciplinaryActionTarget, setDisciplinaryActionTarget] = useState(null)

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  // Handle incoming navigation from Escalation Management
  useEffect(() => {
    const focusSearch = location.state?.search || searchParams.get('search')
    const focusId = location.state?.focusUserId || searchParams.get('focus')
    const role = location.state?.role || searchParams.get('role')

    if (focusSearch) {
      setSearch(focusSearch)
    }
    if (role) {
      setRoleFilter(role)
    }
    if (focusId) {
      const numId = Number(focusId)
      setFocusedUserId(numId)
      setDisciplinaryActionTarget({
        id: numId,
        action: location.state?.action || 'disable'
      })
      setTimeout(() => {
        document.getElementById(`user-row-${numId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 350)
    }
  }, [location.state, searchParams])

  useEffect(() => {
    api.get('/api/barangays/').then(res => setBarangays(Array.isArray(res.data) ? res.data : [])).catch(() => {})
    api.get('/api/dumpsite/dumpsites/').then(res => setDumpsites(Array.isArray(res.data) ? res.data : [])).catch(() => {})
  }, [])

  async function handleSave(formObj, passwordChanged = false) {
    if (modal !== 'add' && (modal?.role === 'admin' || modal?.is_superuser || modal?.id === currentUser?.id || modal?.username?.toLowerCase() === 'admin')) {
      showToast(modal?.id === currentUser?.id ? 'Your administrator account must be updated via Profile settings.' : 'Administrator accounts cannot be edited here.')
      setModal(null)
      return
    }
    try {
      const formData = new FormData()
      Object.keys(formObj).forEach(key => {
        if (key === 'profile_pic' && !formObj[key]) return
        if (key === 'password' || key === 'password2') {
          if (formObj[key]) formData.append(key, formObj[key])
          return
        }
        if (formObj[key] !== null && formObj[key] !== undefined) {
          formData.append(key, formObj[key])
        }
      })

      if (modal === 'add') {
        await api.post('/api/accounts/users/', formData)
        showToast('User created successfully.')
      } else {
        const targetId = modal.id || modal.user?.id
        await api.patch(`/api/accounts/users/${targetId}/`, formData)
        showToast(passwordChanged ? 'User updated and password successfully reset.' : 'User account updated.')
      }
      setModal(null)
      await refreshUsers()
    } catch (err) {
      notify({ variant: 'error-outline', message: getApiErrorMessage(err, 'Failed to save user') })
    }
  }

  async function toggleActive(u) {
    if (u.role === 'admin' || u.id === currentUser?.id) {
      showToast(u.id === currentUser?.id ? 'You cannot deactivate your own active administrator account.' : 'Administrator accounts cannot be deactivated.')
      return
    }
    try {
      const newStatus = !u.is_active
      await api.patch(`/api/accounts/users/${u.id}/`, { is_active: newStatus })
      showToast(newStatus ? `Account ${u.full_name || u.username} activated.` : `Account ${u.full_name || u.username} deactivated.`)
      await refreshUsers()
    } catch {
      showToast('Failed to update account status.')
    }
  }

  async function toggleCrew(u) {
    if (u.role !== 'citizen') {
      showToast('Only citizens can be designated as crew members.')
      return
    }
    try {
      const newType = u.employee_type === 'crew_member' ? '' : 'crew_member'
      await api.patch(`/api/accounts/users/${u.id}/`, { employee_type: newType })
      showToast(newType ? `${getDisplayName(u)} designated as crew member.` : `${getDisplayName(u)} removed from crew.`)
      await refreshUsers()
    } catch {
      showToast('Failed to update crew status.')
    }
  }

  async function confirmDeleteUser() {
    if (!deleteModal) return
    if (deleteModal.role === 'admin' || deleteModal.id === currentUser?.id) {
      showToast(deleteModal.id === currentUser?.id ? 'You cannot delete your own administrator account.' : 'Administrator accounts cannot be deleted.')
      setDeleteModal(null)
      return
    }
    try {
      await api.delete(`/api/accounts/users/${deleteModal.id}/`)
      showToast('User deleted.')
      setDeleteModal(null)
      await refreshUsers()
    } catch {
      showToast('Failed to delete user.')
    }
  }

  async function confirmLiftSuspension() {
    if (!liftReason.trim()) {
      showToast('Reason is required to lift suspension.')
      return
    }
    try {
      await api.patch(`/api/accounts/users/${liftModal.id}/lift_suspension/`, { reason: liftReason })
      showToast('Driver suspension lifted successfully.')
      setLiftModal(null)
      setLiftReason('')
      await refreshUsers()
    } catch {
      showToast('Failed to lift suspension.')
    }
  }

  const counts = useMemo(() => {
    if (pagination?.summary) {
      return pagination.summary
    }
    return {
      all: pagination?.count || users.length,
      active: users.filter(u => u.is_active).length,
      inactive: users.filter(u => !u.is_active).length,
      driver: users.filter(u => u.role === 'driver').length,
      watcher: users.filter(u => u.role === 'watcher').length,
      brgy_official: users.filter(u => u.role === 'brgy_official').length,
      citizen: users.filter(u => u.role === 'citizen').length,
      dumpsite: users.filter(u => u.role === 'dumpsite').length,
      crew: users.filter(u => u.employee_type === 'crew_member').length,
    }
  }, [pagination, users])

  const paginatedUsers = users
  const totalPages = pagination?.total_pages || 1
  const totalCount = pagination?.count || users.length

  return (
    <DashboardLayout>
      <style>{`
        .meta-page-canvas {
          background: #f0f2f5;
          min-height: calc(100vh - 60px);
          padding: 24px 32px 60px;
        }
        .meta-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }
        .meta-stat-card {
          background: #ffffff;
          border: 1px solid #e4e6eb;
          border-radius: 8px;
          padding: 16px 20px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .meta-stat-card:hover {
          border-color: #ccd0d5;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
        }
        .meta-table-row {
          transition: background-color 0.12s ease;
        }
        .meta-table-row:hover {
          background: #f9fafb !important;
        }
        .meta-btn-secondary {
          background: #ffffff;
          border: 1px solid #ccd0d5;
          color: #050505;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.15s ease, border-color 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
        }
        .meta-btn-secondary:hover {
          background: #f0f2f5;
          border-color: #bec3c9;
        }
        .meta-btn-primary {
          background: #16a34a;
          border: 1px solid #16a34a;
          color: #ffffff;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 16px;
        }
        .meta-btn-primary:hover {
          background: #15803d;
          border-color: #15803d;
        }
        .meta-tab-btn {
          padding: 7px 13px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          background: transparent;
          color: #65676b;
          transition: all 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: inherit;
        }
        .meta-tab-btn:hover {
          background: #f0f2f5;
          color: #050505;
        }
        .meta-tab-btn.active {
          background: #ffffff;
          color: #050505;
          border: 1px solid #ccd0d5;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        }
        .meta-select {
          height: 36px;
          padding: 0 12px;
          border-radius: 6px;
          border: 1px solid #ccd0d5;
          background: #ffffff;
          color: #050505;
          font-size: 13px;
          font-weight: 500;
          outline: none;
          cursor: pointer;
          transition: border-color 0.15s ease;
        }
        .meta-select:focus {
          border-color: #16a34a;
          box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.15);
        }
        .meta-input {
          height: 36px;
          padding: 0 12px;
          border-radius: 6px;
          border: 1px solid #ccd0d5;
          background: #ffffff;
          color: #050505;
          font-size: 13px;
          outline: none;
          transition: border-color 0.15s ease;
        }
        .meta-input:focus {
          border-color: #16a34a;
          box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.15);
        }
      `}</style>

      {/* Floating Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1c1e21',
          color: '#ffffff',
          padding: '10px 18px',
          borderRadius: 6,
          zIndex: 99999,
          fontSize: 13,
          fontWeight: 600,
          border: '1px solid #333942',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}>
          <CheckCircle2 size={16} color="#16a34a" />
          <span>{toast}</span>
        </div>
      )}

      {/* Disciplinary Review Alert Banner if routed from Escalation */}
      {disciplinaryActionTarget && (
        <div style={{
          background: '#fee2e2',
          border: '1px solid #fecaca',
          borderRadius: 6,
          padding: '12px 16px',
          marginBottom: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldAlert size={18} color="#991b1b" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#991b1b' }}>
                Disciplinary Action Mode: Account Review
              </div>
              <div style={{ fontSize: 12, color: '#7f1d1d' }}>
                Target user is highlighted below. Toggle the account access switch to deactivate or restrict login access.
              </div>
            </div>
          </div>

          <button
            onClick={() => setDisciplinaryActionTarget(null)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#991b1b',
              cursor: 'pointer',
              padding: 4
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Add / Edit Modal */}
      {modal && (
        <UserModal
          user={modal === 'add' ? null : modal}
          initialSecretPassword={modal?._secretPassword || false}
          onSave={handleSave}
          onClose={() => setModal(null)}
          barangays={barangays}
          dumpsites={dumpsites}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16
          }}
          onClick={() => setDeleteModal(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 8,
              border: '1px solid #e4e6eb',
              padding: 20,
              width: '100%',
              maxWidth: 400,
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: '#b91c1c' }}>
              <Trash2 size={20} />
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#050505' }}>Confirm Deletion</h3>
            </div>
            <p style={{ fontSize: 13, color: '#65676b', margin: '0 0 18px', lineHeight: 1.5 }}>
              Are you sure you want to delete account <strong>{getDisplayName(deleteModal)}</strong>? This operation cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setDeleteModal(null)}
                className="meta-btn-secondary"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteUser}
                style={{
                  flex: 1,
                  padding: '7px 14px',
                  borderRadius: 6,
                  border: '1px solid #b91c1c',
                  background: '#b91c1c',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer'
                }}
              >
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lift Suspension Modal */}
      {liftModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16
          }}
          onClick={() => setLiftModal(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 8,
              border: '1px solid #e4e6eb',
              padding: 20,
              width: '100%',
              maxWidth: 440,
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)'
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: '#16a34a' }}>
              <Shield size={20} />
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#050505' }}>
                Lift Driver Suspension
              </h3>
            </div>
            <p style={{ fontSize: 13, color: '#65676b', margin: '0 0 14px', lineHeight: 1.5 }}>
              Enter the administrative reason or retraining clearance for lifting <strong>{getDisplayName(liftModal)}</strong>'s suspension.
            </p>
            <textarea
              rows={3}
              value={liftReason}
              onChange={e => setLiftReason(e.target.value)}
              placeholder="e.g., Completed safety refresher orientation and fine settled…"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #ccd0d5',
                background: '#ffffff',
                color: '#050505',
                fontSize: 13,
                outline: 'none',
                marginBottom: 16,
                resize: 'vertical'
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setLiftModal(null)}
                className="meta-btn-secondary"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Cancel
              </button>
              <button
                onClick={confirmLiftSuspension}
                className="meta-btn-primary"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                Lift Suspension
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="meta-page-canvas">
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>

          {/* ── Page Header (Meta Business Suite Style) ── */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
            flexWrap: 'wrap',
            gap: 16
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 style={{
                  fontSize: 22,
                  fontWeight: 700,
                  margin: 0,
                  color: '#050505',
                  letterSpacing: '-0.02em',
                  lineHeight: 1.2
                }}>
                  User Management
                </h1>
                <span style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#65676b',
                  background: '#e4e6eb',
                  padding: '2px 8px',
                  borderRadius: 4
                }}>
                  {counts.all} Users
                </span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#65676b' }}>
                Manage municipal accounts, roles, access permissions, and driver suspensions.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={() => setModal('add')}
                className="meta-btn-primary"
              >
                <Plus size={15} />
                <span>Add New User</span>
              </button>
            </div>
          </div>

          {/* ── KPI Metric Summary (Meta Business Suite Style) ── */}
          {loading && users.length === 0 ? (
            <StatCardSkeleton count={4} style={{ marginBottom: 18 }} />
          ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 14,
            marginBottom: 18
          }}>
            {[
              {
                label: 'Total Users',
                value: counts.all,
                subtext: 'Registered system accounts',
                icon: Users
              },
              {
                label: 'Active Accounts',
                value: counts.active,
                subtext: 'Can log in and operate',
                icon: CheckCircle2,
                highlight: '#166534'
              },
              {
                label: 'Disabled / Inactive',
                value: counts.inactive,
                subtext: 'Deactivated accounts',
                icon: UserX,
                highlight: counts.inactive > 0 ? '#b91c1c' : undefined
              },
              {
                label: 'Drivers & Fleet',
                value: counts.driver,
                subtext: 'Collection route drivers',
                icon: Truck
              },
            ].map(s => {
              const IconComp = s.icon
              return (
                <div key={s.label} className="meta-stat-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {s.label}
                    </span>
                    <IconComp size={16} color="#8a8d91" />
                  </div>
                  <div style={{
                    fontSize: 26,
                    fontWeight: 700,
                    color: s.highlight || '#050505',
                    lineHeight: 1.15,
                    marginBottom: 4
                  }}>
                    {s.value}
                  </div>
                  <div style={{ fontSize: 12, color: '#65676b' }}>
                    {s.subtext}
                  </div>
                </div>
              )
            })}
          </div>
          )}

          {/* ── Toolbar: Filters & Search ── */}
          <div className="meta-card" style={{
            padding: '12px 16px',
            marginBottom: 16,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center'
          }}>
            {/* Role Filter Tabs */}
            <div style={{ display: 'flex', gap: 4, background: '#f0f2f5', borderRadius: 6, padding: 3, flexWrap: 'wrap' }}>
              {[
                { key: 'all', label: 'All' },
                { key: 'watcher', label: 'Watchers' },
                { key: 'driver', label: 'Drivers' },
                { key: 'brgy_official', label: 'Brgy Officials' },
                { key: 'citizen', label: 'Citizens' },
                { key: 'crew', label: 'Crew' },
                { key: 'dumpsite', label: 'Dumpsite Ops' },
              ].map(f => {
                const active = roleFilter === f.key
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => { setRoleFilter(f.key); setCurrentPage(1); }}
                    className={`meta-tab-btn ${active ? 'active' : ''}`}
                  >
                    <span>{f.label}</span>
                    <span style={{ fontSize: 11, color: active ? '#166534' : '#8a8d91' }}>
                      ({counts[f.key] ?? counts.all})
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Status Select */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Status:
              </span>
              <select
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                className="meta-select"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="inactive">Disabled Only</option>
              </select>
            </div>

            {/* Search Box */}
            <div style={{ position: 'relative', width: 260, maxWidth: '100%', marginLeft: 'auto' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#8a8d91' }} />
              <input
                className="meta-input"
                placeholder="Search name, email, zone…"
                value={search}
                onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                style={{
                  width: '100%',
                  paddingLeft: 32,
                  paddingRight: 28
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#8a8d91',
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* ── Enterprise Users Table (Meta Business Suite Style) ── */}
          <div className="meta-card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: 860 }}>
                <thead style={{ background: '#f7f8fa', borderBottom: '1px solid #e4e6eb' }}>
                  <tr>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>User Details</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Role</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Jurisdiction / Zone</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Performance</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>Account Access</th>
                    <th style={{ padding: '12px 16px', fontSize: 11, fontWeight: 700, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && users.length === 0 ? (
                    <TableRowsSkeleton rows={6} cols={6} />
                  ) : paginatedUsers.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ padding: '50px 20px', textAlign: 'center' }}>
                        <Users size={32} color="#8a8d91" style={{ margin: '0 auto 8px', opacity: 0.7 }} />
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#050505' }}>No users match criteria</div>
                        <div style={{ fontSize: 12, color: '#65676b', marginTop: 2 }}>Try clearing the search query or role filter.</div>
                      </td>
                    </tr>
                  ) : (
                    paginatedUsers.map((u, idx) => {
                      const isFocused = focusedUserId === u.id
                      const isSelf = Boolean(
                        currentUser && (
                          currentUser.id === u.id ||
                          (currentUser.email && u.email && currentUser.email.toLowerCase() === u.email.toLowerCase()) ||
                          (currentUser.username && u.username && currentUser.username.toLowerCase() === u.username.toLowerCase())
                        )
                      )
                      const isAdmin = u.role === 'admin' || Boolean(u.is_superuser) || Boolean(u.is_staff) || u.username?.toLowerCase() === 'admin'
                      const isProtected = isSelf || isAdmin

                      return (
                        <tr
                          id={`user-row-${u.id}`}
                          key={u.id}
                          className="meta-table-row"
                          style={{
                            borderBottom: idx === paginatedUsers.length - 1 ? 'none' : '1px solid #e4e6eb',
                            background: isFocused ? '#fee2e2' : undefined
                          }}
                        >
                          {/* User Identity */}
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <Avatar name={getDisplayName(u)} active={u.is_active} profile_pic={u.profile_pic} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <strong style={{ fontSize: 13, color: u.is_active ? '#050505' : '#8a8d91', fontWeight: 600 }}>
                                    {getDisplayName(u)}
                                  </strong>
                                  {isSelf && (
                                    <span style={{
                                      fontSize: 10,
                                      fontWeight: 700,
                                      background: '#dbeafe',
                                      color: '#1d4ed8',
                                      border: '1px solid #bfdbfe',
                                      padding: '1px 6px',
                                      borderRadius: 4,
                                      letterSpacing: '0.04em'
                                    }}>
                                      YOU
                                    </span>
                                  )}
                                  {isFocused && (
                                    <span style={{
                                      fontSize: 10,
                                      fontWeight: 700,
                                      background: '#b91c1c',
                                      color: '#ffffff',
                                      padding: '1px 6px',
                                      borderRadius: 4
                                    }}>
                                      TARGET
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 12, color: '#65676b' }}>
                                  {u.email || `@${u.username}`}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Role */}
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <RoleBadge role={isAdmin ? 'admin' : u.role} />
                              {u.role === 'citizen' && !isProtected && (
                                u.employee_type === 'crew_member' ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleCrew(u)}
                                    title="Click to remove Crew designation"
                                    style={{
                                      border: '1px solid #fde68a',
                                      background: '#fef3c7',
                                      color: '#92400e',
                                      borderRadius: 4,
                                      padding: '2px 7px',
                                      fontSize: 10,
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 3.5,
                                      transition: 'opacity 0.15s ease'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                                  >
                                    <Users size={10} color="#92400e" />
                                    <span>CREW</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => toggleCrew(u)}
                                    title="Click to toggle Crew Member designation"
                                    style={{
                                      border: '1px dashed #cbd5e1',
                                      background: 'transparent',
                                      color: '#94a3b8',
                                      borderRadius: 4,
                                      padding: '2px 7px',
                                      fontSize: 10,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 3.5,
                                      transition: 'all 0.15s ease'
                                    }}
                                    onMouseEnter={e => {
                                      e.currentTarget.style.borderColor = '#f59e0b'
                                      e.currentTarget.style.color = '#d97706'
                                      e.currentTarget.style.background = '#fffbeb'
                                    }}
                                    onMouseLeave={e => {
                                      e.currentTarget.style.borderColor = '#cbd5e1'
                                      e.currentTarget.style.color = '#94a3b8'
                                      e.currentTarget.style.background = 'transparent'
                                    }}
                                  >
                                    <span>+ Crew</span>
                                  </button>
                                )
                              )}
                            </div>
                          </td>

                          {/* Jurisdiction */}
                          <td style={{ padding: '12px 16px', fontSize: 13, color: '#050505' }}>
                            {u.barangay_name ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                <MapPin size={13} color="#16a34a" />
                                <span>Brgy. {u.barangay_name}</span>
                              </span>
                            ) : u.dumpsite_name ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                <Building2 size={13} color="#65676b" />
                                <span>{u.dumpsite_name}</span>
                              </span>
                            ) : (
                              <span style={{ color: '#8a8d91' }}>—</span>
                            )}
                          </td>

                          {/* Performance / Demerits */}
                          <td style={{ padding: '12px 16px', fontSize: 13 }}>
                            {u.role === 'driver' ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontWeight: 600, color: (u.points || 0) < 0 ? '#b91c1c' : '#050505' }}>
                                  {u.points ?? 0} pts
                                </span>
                                {u.is_suspended && (
                                  <span style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    background: '#fee2e2',
                                    color: '#991b1b',
                                    border: '1px solid #fecaca',
                                    padding: '1px 6px',
                                    borderRadius: 4
                                  }}>
                                    SUSPENDED
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: '#65676b', fontSize: 12 }}>Score: {u.trust_score ?? 100}%</span>
                            )}
                          </td>

                          {/* Interactive Toggle Switch (Active vs Disabled) */}
                          <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                            {isProtected ? (
                              <span
                                title={isSelf ? 'You cannot deactivate your own active administrator account' : 'System administrator accounts are protected'}
                                style={{
                                  background: '#f1f5f9',
                                  border: '1px solid #e2e8f0',
                                  color: '#64748b',
                                  borderRadius: 4,
                                  padding: '3px 10px',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  cursor: 'not-allowed',
                                  opacity: 0.9
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                                <span>ACTIVE</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleActive(u)}
                                title={u.is_active ? 'Click to Disable Account' : 'Click to Activate Account'}
                                style={{
                                  background: u.is_active ? '#e7f3ed' : '#fee2e2',
                                  border: `1px solid ${u.is_active ? '#bbf7d0' : '#fecaca'}`,
                                  color: u.is_active ? '#166534' : '#991b1b',
                                  borderRadius: 4,
                                  padding: '3px 10px',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  transition: 'all 0.15s ease'
                                }}
                              >
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: u.is_active ? '#16a34a' : '#ef4444' }} />
                                <span>{u.is_active ? 'ACTIVE' : 'DISABLED'}</span>
                              </button>
                            )}
                          </td>

                          {/* Action Icons */}
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              {u.role === 'driver' && u.is_suspended && (
                                <button
                                  type="button"
                                  onClick={() => setLiftModal(u)}
                                  title="Lift Driver Suspension"
                                  className="meta-btn-secondary"
                                  style={{
                                    padding: '4px 8px',
                                    fontSize: 11,
                                    color: '#166534',
                                    borderColor: '#bbf7d0',
                                    background: '#e7f3ed'
                                  }}
                                >
                                  <Shield size={12} />
                                  <span>Lift</span>
                                </button>
                              )}

                              {isProtected ? (
                                <span
                                  title={isSelf ? 'Your administrator account can be managed in Profile settings' : 'Administrator accounts cannot be edited or deleted here'}
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: '#64748b',
                                    background: '#f1f5f9',
                                    border: '1px solid #e2e8f0',
                                    padding: '4px 8px',
                                    borderRadius: 6,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    cursor: 'default'
                                  }}
                                >
                                  <Shield size={11} color="#64748b" />
                                  <span>Protected</span>
                                </span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      if (e.altKey || e.shiftKey) {
                                        setModal({ ...u, _secretPassword: true })
                                      } else {
                                        setModal(u)
                                      }
                                    }}
                                    title="Edit User Information"
                                    className="meta-btn-secondary"
                                    style={{ padding: '5px' }}
                                  >
                                    <Edit2 size={13} color="#65676b" />
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => setDeleteModal(u)}
                                    title="Delete Account"
                                    className="meta-btn-secondary"
                                    style={{ padding: '5px', borderColor: '#fecaca' }}
                                  >
                                    <Trash2 size={13} color="#b91c1c" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Standard WasteWatch Pagination */}
            <div style={{ padding: '0 16px 16px' }}>
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalCount={totalCount}
                pageSize={10}
                onPageChange={setCurrentPage}
                loading={loading}
              />
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  )
}

