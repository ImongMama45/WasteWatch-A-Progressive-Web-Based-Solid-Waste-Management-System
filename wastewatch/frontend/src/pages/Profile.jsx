import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import DashboardLayout from '../components/DashboardLayout'
import BarangaySelect from '../components/BarangaySelect'
import { ICONS } from '../api/navConfig'

// Mock extra data for demo purposes since the backend might not have all fields yet
const MOCK_EXTRA_DATA = {
  admin: { access: 'Full' },
  driver: { truck: 'Truck 04', plate: 'ABC 1234', crew: 'Juan, Pedro' },
  brgy_official: { reportsHandled: 42 },
  watcher: { reportsHandled: 128 },
  citizen: { status: 'Active' }
}

const MOCK_ACTIVITIES = [
  { id: 1, action: 'Changed password', time: '2 hours ago' },
  { id: 2, action: 'Updated profile picture', time: 'Yesterday' },
  { id: 3, action: 'Logged in from new device', time: '3 days ago' }
]

export default function Profile() {
  const { user, barangays, updateUser } = useAuth()
  const navigate = useNavigate()

  const [isEditing, setIsEditing] = useState(false)
  const [toast, setToast] = useState(null)

  // Form state
  const [form, setForm] = useState({
    first_name: user?.first_name || '',
    last_name: user?.last_name || '',
    username: user?.username || '',
    email: user?.email || '',
    phone: user?.phone_number || '0912 345 6789', // Mock fallback
    barangay: user?.barangay || '',               // Store the ID here
    profile_pic: null,
  })

  // Password state
  const [pwd, setPwd] = useState({ current: '', new: '', confirm: '' })

  if (!user) {
    return (
      <DashboardLayout>
        <div style={{ padding: 40, textAlign: 'center' }}>Loading profile...</div>
      </DashboardLayout>
    )
  }

  const role = user.role?.toLowerCase() || 'citizen'
  const extra = MOCK_EXTRA_DATA[role] || MOCK_EXTRA_DATA.citizen

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function handleSaveProfile(e) {
    e.preventDefault()
    try {
      const payload = new FormData()
      payload.append('first_name', form.first_name)
      payload.append('last_name', form.last_name)
      payload.append('username', form.username)
      payload.append('full_name', `${form.first_name} ${form.last_name}`.trim())
      if (form.barangay) payload.append('barangay', form.barangay)
      if (form.profile_pic) payload.append('profile_pic', form.profile_pic)

      await updateUser(payload)
      setIsEditing(false)
      showToast('Profile updated successfully.')
    } catch (err) {
      showToast('Failed to update profile.')
    }
  }

  function handleSavePassword(e) {
    e.preventDefault()
    if (pwd.new !== pwd.confirm) {
      showToast('New passwords do not match.')
      return
    }
    if (!pwd.current) {
      showToast('Current password is required.')
      return
    }
    setPwd({ current: '', new: '', confirm: '' })
    showToast('Password changed successfully.')
  }

  return (
    <DashboardLayout>
      {toast && (
        <div style={{ position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', background: '#0f172a', color: '#fff', padding: '10px 22px', borderRadius: 12, zIndex: 9999, fontSize: 13, fontWeight: 600, border: '1px solid rgba(46,204,113,0.3)', whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      <style>{`
        .profile-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        .section-title { font-family: var(--font-head); font-weight: 800; font-size: 16px; margin: 0 0 16px; display: flex; align-items: center; gap: 8px; }
        .info-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--border); }
        .info-row:last-child { border-bottom: none; }
        .info-label { font-size: 12px; font-weight: 700; color: var(--text-muted); letter-spacing: 0.05em; text-transform: uppercase; width: 140px; flex-shrink: 0; }
        .info-value { font-size: 14px; font-weight: 600; color: var(--text); flex: 1; }
        .role-badge { background: var(--accent); color: #0d1117; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 800; text-transform: uppercase; display: inline-block; }
      `}</style>

      <div className="page" style={{ maxWidth: 1200, margin: '0 auto' }}>

        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 800, margin: '0 0 4px' }}>My Profile</h2>
          <p className="text-muted text-sm" style={{ margin: 0 }}>Manage your personal information and account security.</p>
        </div>

        {/* 1. Header Card */}
        <div className="profile-card" style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {user.profile_pic ? (
            <img 
              src={user.profile_pic} 
              alt="Profile" 
              style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover' }} 
            />
          ) : (
            <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--accent)', color: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 800 }}>
              {user.first_name?.[0]?.toUpperCase() || user.full_name?.[0]?.toUpperCase() || '?'}
            </div>
          )}
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{user.full_name || `${user.first_name} ${user.last_name}`}</div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>@{user.username || 'username'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="role-badge">{role.replace('_', ' ')}</span>
              {(role === 'brgy_official' || role === 'watcher' || role === 'citizen') && (
                <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}><div style={{ width: 14, height: 14, color: '#14b8a6' }}>{ICONS.pin}</div> Brgy. {user.barangay_name || 'Unassigned'}</span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>

          {/* 2. Personal Information */}
          <div className="profile-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="section-title" style={{ margin: 0 }}>Personal Information</div>
              {!isEditing && (
                <button className="btn btn-outline btn-sm" onClick={() => setIsEditing(true)}>Edit Profile</button>
              )}
            </div>

            {isEditing ? (
              <form onSubmit={handleSaveProfile}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <div>
                    <label className="form-label">First Name</label>
                    <input className="form-input" value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} required />
                  </div>
                  <div>
                    <label className="form-label">Last Name</label>
                    <input className="form-input" value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} required />
                  </div>
                  <div>
                    <label className="form-label">Username</label>
                    <input className="form-input" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} required />
                  </div>
                  <div>
                    <label className="form-label">Email</label>
                    <input className="form-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
                  </div>
                  <div>
                    <label className="form-label">Profile Picture</label>
                    <input className="form-input" type="file" accept="image/*" onChange={e => setForm({ ...form, profile_pic: e.target.files[0] })} style={{ padding: 8 }} />
                  </div>
                  <div>
                    <label className="form-label">Contact Number</label>
                    <input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  {(role === 'brgy_official' || role === 'watcher' || role === 'citizen') && (
                    <div>
                      <label className="form-label">Barangay (Opsyonal)</label>
                      <BarangaySelect 
                        barangays={barangays}
                        value={form.barangay}
                        onChange={id => setForm({ ...form, barangay: id })}
                        label="Piliin ang barangay (Opsyonal)"
                      />
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-outline" onClick={() => setIsEditing(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save Changes</button>
                </div>
              </form>
            ) : (
              <div>
                <div className="info-row">
                  <div className="info-label">First Name</div>
                  <div className="info-value">{user.first_name || '—'}</div>
                </div>
                <div className="info-row">
                  <div className="info-label">Last Name</div>
                  <div className="info-value">{user.last_name || '—'}</div>
                </div>
                <div className="info-row">
                  <div className="info-label">Username</div>
                  <div className="info-value">@{user.username || '—'}</div>
                </div>
                <div className="info-row">
                  <div className="info-label">Email Address</div>
                  <div className="info-value">{user.email}</div>
                </div>
                <div className="info-row">
                  <div className="info-label">Contact Number</div>
                  <div className="info-value">{form.phone || 'Not provided'}</div>
                </div>
                {(role === 'brgy_official' || role === 'watcher' || role === 'citizen') && (
                  <div className="info-row">
                    <div className="info-label">Barangay</div>
                    <div className="info-value">{user.barangay_name || 'Not assigned'}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. Role-Specific Information */}
          <div className="profile-card">
            <div className="section-title">Assignment Details</div>

            {role === 'admin' && (
              <div className="info-row">
                <div className="info-label">System Access</div>
                <div className="info-value">Full Administrator Access</div>
              </div>
            )}

            {role === 'driver' && (
              <>
                <div className="info-row">
                  <div className="info-label">Assigned Truck</div>
                  <div className="info-value">{extra.truck}</div>
                </div>
                <div className="info-row">
                  <div className="info-label">Plate Number</div>
                  <div className="info-value">{extra.plate}</div>
                </div>
                <div className="info-row">
                  <div className="info-label">Crew Members</div>
                  <div className="info-value">{extra.crew}</div>
                </div>
              </>
            )}

            {(role === 'brgy_official' || role === 'watcher') && (
              <>
                <div className="info-row">
                  <div className="info-label">Jurisdiction</div>
                  <div className="info-value">Barangay {user.barangay_name || 'Unassigned'}</div>
                </div>
                <div className="info-row">
                  <div className="info-label">Reports Handled</div>
                  <div className="info-value">{extra.reportsHandled} verified reports</div>
                </div>
              </>
            )}

            {role === 'citizen' && (
              <div className="info-row">
                <div className="info-label">Account Status</div>
                <div className="info-value" style={{ color: '#2ecc71' }}>Active Resident</div>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
            {/* 4. Security Section */}
            <div className="profile-card">
              <div className="section-title">Security</div>
              <form onSubmit={handleSavePassword}>
                <div style={{ marginBottom: 12 }}>
                  <label className="form-label">Current Password</label>
                  <input className="form-input" type="password" value={pwd.current} onChange={e => setPwd({ ...pwd, current: e.target.value })} required />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label className="form-label">New Password</label>
                  <input className="form-input" type="password" value={pwd.new} onChange={e => setPwd({ ...pwd, new: e.target.value })} required />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label className="form-label">Confirm New Password</label>
                  <input className="form-input" type="password" value={pwd.confirm} onChange={e => setPwd({ ...pwd, confirm: e.target.value })} required />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Change Password</button>
              </form>
            </div>

            {/* 5. Activity Summary */}
            <div className="profile-card">
              <div className="section-title">Recent Activity</div>
              {MOCK_ACTIVITIES.map((act, i) => (
                <div key={act.id} style={{ display: 'flex', gap: 12, marginBottom: i === MOCK_ACTIVITIES.length - 1 ? 0 : 16 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', marginTop: 6, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{act.action}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{act.time}</div>
                  </div>
                </div>
              ))}
              <button onClick={() => navigate("/admin/activity-log")} className="btn btn-outline btn-sm" style={{ width: '100%', marginTop: 20 }}>
                View All Activity
              </button>
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  )
}
