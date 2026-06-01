/**
 * pages/admin/UserManagement.jsx
 * Admin: Create, edit, assign barangay, activate/deactivate users.
 */

import { useState, useEffect, useMemo } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import { useUsers } from '../../hooks/useUsers'
import api from '../../api/client'
import BarangaySelect from '../../components/BarangaySelect'

// ── Mock Data ─────────────────────────────────────────────────────────────────

const ROLES = ['watcher', 'driver', 'brgy_official', 'citizen', 'dumpsite']

const ROLE_META = {
  watcher: { label: 'Watcher', color: '#5dade2', bg: 'rgba(93,173,226,0.1)', border: 'rgba(93,173,226,0.3)' },
  driver: { label: 'Driver', color: '#f39c12', bg: 'rgba(243,156,18,0.1)', border: 'rgba(243,156,18,0.3)' },
  brgy_official: { label: 'Brgy. Official', color: '#9b59b6', bg: 'rgba(155,89,182,0.1)', border: 'rgba(155,89,182,0.3)' },
  citizen: { label: 'Citizen', color: '#2ecc71', bg: 'rgba(46,204,113,0.1)', border: 'rgba(46,204,113,0.3)' },
  admin: { label: 'Admin', color: '#e74c3c', bg: 'rgba(231,76,60,0.1)', border: 'rgba(231,76,60,0.3)' },
  dumpsite: { label: 'Dumpsite', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.3)' },
}

const EMPTY_FORM = { full_name: '', email: '', password: '', role: 'citizen', barangay: '', is_active: true }

// ── Sub-components ────────────────────────────────────────────────────────────

function RoleBadge({ role }) {
  const m = ROLE_META[role] || { label: role, color: '#888', bg: '#eee', border: '#ccc' }
  return (
    <span style={{
      background: m.bg, border: `1px solid ${m.border}`, color: m.color,
      borderRadius: 20, padding: '2px 10px', fontSize: 9, fontWeight: 800,
      letterSpacing: '.06em', whiteSpace: 'nowrap',
    }}>{m.label.toUpperCase()}</span>
  )
}

function Avatar({ name, active }) {
  return (
    <div style={{
      width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
      background: active ? 'var(--accent)' : '#bbb',
      color: '#0d1117', fontWeight: 800, fontSize: 13,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{name?.[0]?.toUpperCase() || '?'}</div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function UserModal({ user, onSave, onClose, barangays, dumpsites }) {
  const isEdit = !!user
  const [form, setForm] = useState(user ? {
    full_name: user.full_name, email: user.email, password: '',
    role: user.role, barangay: user.barangay || '', 
    dumpsite: user.dumpsite || '',
    is_active: user.is_active,
  } : { ...EMPTY_FORM, dumpsite: '' })
  const [err, setErr] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function validate() {
    if (!form.full_name.trim()) return 'Full name is required.'
    if (!form.email.trim()) return 'Email is required.'
    if (!isEdit && !form.password.trim()) return 'Password is required for new users.'
    if (form.role === 'dumpsite' && !form.dumpsite) return 'Please assign a dumpsite facility.'
    return ''
  }

  function handleSubmit() {
    const e = validate()
    if (e) { setErr(e); return }
    onSave(form)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--surface)', borderRadius: 16, padding: 24,
        width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, margin: 0 }}>
            {isEdit ? 'Edit User' : 'Add New User'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>

        {err && (
          <div style={{
            background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)',
            color: '#e74c3c', borderRadius: 8, padding: '9px 12px', fontSize: 12, marginBottom: 14,
          }}>{err}</div>
        )}

        <div style={{ marginBottom: 13 }}>
          <label className="form-label">Full Name</label>
          <input className="form-input" value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="e.g. Juan Dela Cruz" />
        </div>

        <div style={{ marginBottom: 13 }}>
          <label className="form-label">Email Address</label>
          <input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="user@lucena.gov.ph" />
        </div>

        <div style={{ marginBottom: 13 }}>
          <label className="form-label">{isEdit ? 'New Password (leave blank to keep)' : 'Password'}</label>
          <input className="form-input" type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="••••••••" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 13 }}>
          <div>
            <label className="form-label">Role</label>
            <select className="form-input" value={form.role} onChange={e => set('role', e.target.value)}>
              {Object.keys(ROLE_META).map(r => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
            </select>
          </div>
          <div>
            {form.role === 'dumpsite' ? (
              <>
                <label className="form-label">Dumpsite Facility</label>
                <select className="form-input" value={form.dumpsite} onChange={e => set('dumpsite', e.target.value)}>
                  <option value="">— Select —</option>
                  {dumpsites.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </>
            ) : (
              <>
                <label className="form-label">Barangay</label>
                <BarangaySelect
                  barangays={barangays}
                  value={form.barangay}
                  onChange={id => set('barangay', id)}
                  label="— Select —"
                />
              </>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <div
              onClick={() => set('is_active', !form.is_active)}
              style={{
                width: 40, height: 22, borderRadius: 20, position: 'relative',
                background: form.is_active ? 'var(--accent)' : '#ccc',
                transition: 'background .2s', cursor: 'pointer', flexShrink: 0,
              }}
            >
              <div style={{
                position: 'absolute', top: 3, left: form.is_active ? 20 : 3,
                width: 16, height: 16, borderRadius: '50%', background: '#fff',
                transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
              }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              Account Active
            </span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSubmit}>
            {isEdit ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function UserManagement() {
  const { users, loading, refresh: refreshUsers } = useUsers()
  const [barangays, setBarangays] = useState([])
  const [dumpsites, setDumpsites] = useState([])
  
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)  // null | 'add' | user object
  const [toast, setToast] = useState(null)

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    api.get('/api/barangays/').then(res => setBarangays(res.data))
    api.get('/api/driver/dumpsites/').then(res => setDumpsites(res.data))
  }, [])

  async function handleSave(form) {
    try {
      if (modal === 'add') {
        await api.post('/api/accounts/users/', form)
        showToast('✅ User created successfully.')
      } else {
        await api.patch(`/api/accounts/users/${modal.id}/`, form)
        showToast('✅ User updated.')
      }
      refreshUsers()
      setModal(null)
    } catch (err) {
      alert(JSON.stringify(err.response?.data || 'Failed to save user'))
    }
  }

  async function toggleActive(u) {
    try {
      await api.patch(`/api/accounts/users/${u.id}/`, { is_active: !u.is_active })
      showToast(u.is_active ? '⛔ Account deactivated.' : '✅ Account activated.')
      refreshUsers()
    } catch {
      showToast('❌ Failed to update status.')
    }
  }

  async function deleteUser(id) {
    if (!window.confirm('Delete this user? This cannot be undone.')) return
    try {
      await api.delete(`/api/accounts/users/${id}/`)
      showToast('🗑 User removed.')
      refreshUsers()
    } catch {
      showToast('❌ Failed to delete user.')
    }
  }

  const counts = useMemo(() => ({
    all: users.length,
    watcher: users.filter(u => u.role === 'watcher').length,
    driver: users.filter(u => u.role === 'driver').length,
    brgy_official: users.filter(u => u.role === 'brgy_official').length,
    citizen: users.filter(u => u.role === 'citizen').length,
    dumpsite: users.filter(u => u.role === 'dumpsite').length,
    active: users.filter(u => u.is_active).length,
    inactive: users.filter(u => !u.is_active).length,
  }), [users])

  const filtered = useMemo(() => users.filter(u => {
    const matchRole = roleFilter === 'all' || u.role === roleFilter
    const matchStatus = statusFilter === 'all' || (statusFilter === 'active' ? u.is_active : !u.is_active)
    const matchSearch = !search ||
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.barangay_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.dumpsite_name || '').toLowerCase().includes(search.toLowerCase())
    return matchRole && matchStatus && matchSearch
  }), [users, roleFilter, statusFilter, search])

  return (
    <DashboardLayout>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
          background: '#0f172a', color: '#fff', padding: '10px 22px',
          borderRadius: 12, zIndex: 9999, fontSize: 13, fontWeight: 600,
          border: '1px solid rgba(46,204,113,0.3)', whiteSpace: 'nowrap',
          animation: 'fadeSlideIn .2s',
        }}>{toast}</div>
      )}

      {/* Modal */}
      {modal && (
        <UserModal
          user={modal === 'add' ? null : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
          barangays={barangays}
          dumpsites={dumpsites}
        />
      )}

      <style>{`
        @keyframes fadeSlideIn { from{opacity:0;transform:translateX(-50%) translateY(-8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        .um-row:hover { background: var(--surface-2) !important; }
        .um-row { transition: background .12s; }
        .um-filter { transition: all .15s; cursor: pointer; }
        .um-filter:hover { opacity: .8; }
      `}</style>

      <div className="page">

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>
                User Management
              </h2>
              <span style={{
                background: 'rgba(231,76,60,0.1)', color: '#e74c3c',
                border: '1px solid rgba(231,76,60,0.3)',
                fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
              }}>ADMIN</span>
            </div>
            <p className="text-muted text-sm">Manage accounts, roles, and assignments.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setModal('add')}>
            + Add User
          </button>
        </div>

        {/* ── KPI Strip ── */}
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          {[
            { label: 'Total Users', value: counts.all, color: '#ffffffff' },
            { label: 'Active', value: counts.active, color: '#2ecc71' },
            { label: 'Inactive', value: counts.inactive, color: '#e74c3c' },
            { label: 'Brgy. Officials', value: counts.brgy_official, color: '#9b59b6' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className="label">{s.label}</div>
              <div className="value" style={{ color: s.color, fontSize: 30 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── Role filter tabs ── */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: 'var(--surface-2)', borderRadius: 10, padding: 4, width: 'fit-content', flexWrap: 'wrap' }}>
          {[
            { key: 'all', label: 'All' },
            { key: 'watcher', label: 'Watchers' },
            { key: 'driver', label: 'Drivers' },
            { key: 'brgy_official', label: 'Brgy. Officials' },
            { key: 'citizen', label: 'Citizens' },
            { key: 'dumpsite', label: 'Dumpsites' },
          ].map(f => (
            <button key={f.key} className="um-filter" onClick={() => setRoleFilter(f.key)} style={{
              padding: '6px 14px', borderRadius: 8, border: 'none',
              fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)',
              background: roleFilter === f.key ? 'var(--surface)' : 'transparent',
              color: roleFilter === f.key ? 'var(--text)' : 'var(--text-muted)',
              boxShadow: roleFilter === f.key ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
            }}>
              {f.label} ({counts[f.key] ?? counts.all})
            </button>
          ))}
        </div>

        {/* ── Status + Search bar ── */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['all', 'active', 'inactive'].map(s => (
              <button key={s} className="um-filter" onClick={() => setStatusFilter(s)} style={{
                padding: '5px 14px', borderRadius: 20, border: '1px solid',
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)',
                borderColor: statusFilter === s ? 'var(--accent)' : 'var(--border)',
                color: statusFilter === s ? 'var(--accent)' : 'var(--text-muted)',
                background: statusFilter === s ? 'rgba(46,204,113,0.08)' : 'transparent',
              }}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <input
            className="form-input"
            placeholder="Search name, email, assignment…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 280, marginLeft: 'auto' }}
          />
        </div>

        {/* ── Table ── */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 2fr 1fr 1.2fr 80px 100px',
            padding: '10px 16px',
            background: 'var(--surface-2)',
            borderBottom: '1px solid var(--border)',
            fontSize: 10, fontWeight: 800, color: 'var(--text-muted)',
            letterSpacing: '.07em', textTransform: 'uppercase',
          }}>
            <span>User</span>
            <span>Email</span>
            <span>Role</span>
            <span>Jurisdiction</span>
            <span style={{ textAlign: 'center' }}>Status</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>

          {/* Rows */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>Loading users...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>👥</div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>No users found</div>
              <div className="text-muted text-sm">Try adjusting your filters.</div>
            </div>
          ) : (
            filtered.map((u, idx) => (
              <div
                key={u.id}
                className="um-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 2fr 1fr 1.2fr 80px 100px',
                  padding: '13px 16px',
                  alignItems: 'center',
                  borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                  background: u.is_active ? 'var(--surface)' : 'rgba(0,0,0,0.015)',
                }}
              >
                {/* Name + avatar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <Avatar name={u.full_name} active={u.is_active} />
                  <span style={{
                    fontSize: 13, fontWeight: 600, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: u.is_active ? 'var(--text)' : 'var(--text-muted)',
                  }}>{u.full_name}</span>
                </div>

                {/* Email */}
                <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.email}
                </span>

                {/* Role */}
                <RoleBadge role={u.role} />

                {/* Jurisdiction (Barangay or Dumpsite) */}
                <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.role === 'dumpsite' ? (u.dumpsite_name || '—') : (u.barangay_name || '—')}
                </span>

                {/* Active toggle */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div
                    onClick={() => toggleActive(u)}
                    title={u.is_active ? 'Deactivate' : 'Activate'}
                    style={{
                      width: 36, height: 20, borderRadius: 20, position: 'relative',
                      background: u.is_active ? 'var(--accent)' : '#ccc',
                      cursor: 'pointer', transition: 'background .2s', flexShrink: 0,
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: 2, left: u.is_active ? 18 : 2,
                      width: 16, height: 16, borderRadius: '50%', background: '#fff',
                      transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                    }} />
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setModal(u)}
                    title="Edit"
                    style={{
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
                      fontSize: 12, color: 'var(--text)',
                    }}
                  >✏️</button>
                  <button
                    onClick={() => deleteUser(u.id)}
                    title="Delete"
                    style={{
                      background: 'rgba(231,76,60,0.07)', border: '1px solid rgba(231,76,60,0.25)',
                      borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
                      fontSize: 12, color: '#e74c3c',
                    }}
                  >🗑</button>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          Showing {filtered.length} of {users.length} users
        </div>

      </div>
    </DashboardLayout>
  )
}
