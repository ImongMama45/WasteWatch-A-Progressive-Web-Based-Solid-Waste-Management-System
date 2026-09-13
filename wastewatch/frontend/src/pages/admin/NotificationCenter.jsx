import { useState, useEffect, useCallback } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import api from '../../api/client'

const BARANGAYS = [
  'Isabang', 'Cotta', 'Kanlurang Cotta', 'Ibabang Dupay',
  'Gulang-Gulang', 'Mayao Crossing', 'Barangay 1', 'Barangay 2',
  'Barangay 3', 'Ilayang Dupay',
]

const TYPES = {
  alert: { label: 'Alert', color: '#e74c3c', bg: 'rgba(231,76,60,0.08)', border: 'rgba(231,76,60,0.3)', icon: '🚨' },
  announcement: { label: 'Announcement', color: '#5dade2', bg: 'rgba(93,173,226,0.08)', border: 'rgba(93,173,226,0.3)', icon: '📢' },
  reminder: { label: 'Reminder', color: '#f39c12', bg: 'rgba(243,156,18,0.08)', border: 'rgba(243,156,18,0.3)', icon: '⏰' },
  info: { label: 'Info', color: '#2ecc71', bg: 'rgba(46,204,113,0.08)', border: 'rgba(46,204,113,0.3)', icon: 'ℹ️' },
}

const TYPE_TO_NOTIF = {
  alert: 'ANNOUNCEMENT',
  announcement: 'ANNOUNCEMENT',
  reminder: 'SCHEDULE_CHANGE',
  info: 'COLLECTION_DONE',
}

const EMPTY = { type: 'announcement', title: '', body: '', target: 'city-wide', barangays: [] }

function TypeBadge({ t }) {
  const m = TYPES[t] || TYPES.info
  return <span style={{ background: m.bg, border: `1px solid ${m.border}`, color: m.color, borderRadius: 20, padding: '2px 10px', fontSize: 9, fontWeight: 800, letterSpacing: '.06em' }}>{m.icon} {m.label.toUpperCase()}</span>
}

export default function NotificationCenter() {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ ...EMPTY })
  const [filterType, setFilterType] = useState('all')
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState(null)
  const [preview, setPreview] = useState(null)
  const [sending, setSending] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/notifications/')
      // Shape the API data to match the existing display format
      setNotifications(
        res.data.map(n => ({
          id: n.id,
          type: _notifTypeToLocal(n.type),
          title: n.title,
          body: n.message,
          target: n.barangay_name || 'City-wide',
          sentBy: 'System',
          sentAt: new Date(n.created_at).toLocaleString('en-PH', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
          }),
          reach: 0,   // not tracked in model; show 0 or omit
          is_read: n.is_read,
          barangay: n.barangay,
        }))
      )
    } catch {
      showToast('⚠️ Could not load notifications.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  function toggleBrgy(b) {
    setForm(f => ({
      ...f,
      barangays: f.barangays.includes(b)
        ? f.barangays.filter(x => x !== b)
        : [...f.barangays, b],
    }))
  }

  function targetLabel(f) {
    if (f.target === 'city-wide') return 'City-wide'
    if (f.barangays.length === 0) return 'No barangay selected'
    if (f.barangays.length === 1) return f.barangays[0]
    return `${f.barangays.length} Barangays`
  }

  function estimatedReach(f) {
    if (f.target === 'city-wide') return '~1,240 residents'
    return f.barangays.length === 0 ? '0' : `~${f.barangays.length * 195} residents`
  }

  function validate() {
    if (!form.title.trim()) return 'Title is required.'
    if (!form.body.trim()) return 'Message body is required.'
    if (form.target === 'barangay' && form.barangays.length === 0)
      return 'Please select at least one barangay.'
    return ''
  }

  async function handleSend() {
    const err = validate()
    if (err) { showToast('⚠️ ' + err); return }
    setSending(true)
    try {
      const notifType = TYPE_TO_NOTIF[form.type] || 'ANNOUNCEMENT'

      if (form.target === 'city-wide') {
        // Single system-wide notification (user=null, barangay=null)
        await api.post('/api/notifications/', {
          title: form.title,
          message: form.body,
          type: notifType,
          user: null,
          barangay: null,
        })
      } else {
        // One row per selected barangay — fetch barangay IDs first
        const brgyRes = await api.get('/api/barangays/')
        const brgyMap = Object.fromEntries(brgyRes.data.map(b => [b.name, b.id]))
        await Promise.all(
          form.barangays.map(name =>
            api.post('/api/notifications/', {
              title: form.title,
              message: form.body,
              type: notifType,
              user: null,
              barangay: brgyMap[name] ?? null,
            })
          )
        )
      }

      await fetchAll()
      setForm({ ...EMPTY })
      showToast('✅ Notification sent successfully!')
    } catch (e) {
      showToast('⚠️ Failed to send: ' + (e.response?.data?.detail || e.message))
    } finally {
      setSending(false)
    }
  }


  const filtered = notifications.filter(n => {
    const mt = filterType === 'all' || n.type === filterType
    const mq = !search ||
      n.title.toLowerCase().includes(search.toLowerCase()) ||
      n.target.toLowerCase().includes(search.toLowerCase())
    return mt && mq
  })

  const typeCounts = Object.fromEntries(
    Object.keys(TYPES).map(t => [t, notifications.filter(n => n.type === t).length])
  )

  return (
    <DashboardLayout>
      {toast && (
        <div style={{ position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', background: '#0f172a', color: '#fff', padding: '10px 22px', borderRadius: 12, zIndex: 9999, fontSize: 13, fontWeight: 600, border: '1px solid rgba(46,204,113,0.3)', whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      {/* Preview modal */}
      {preview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setPreview(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 16, margin: 0 }}>Notification Detail</h3>
              <button onClick={() => setPreview(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 26 }}>{TYPES[preview.type]?.icon}</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{preview.title}</div>
                <TypeBadge t={preview.type} />
              </div>
            </div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '12px 14px', fontSize: 13, lineHeight: 1.7, marginBottom: 16, color: 'var(--text-muted)' }}>
              {preview.body}
            </div>
            {[
              { label: 'Target', value: preview.target },
              { label: 'Sent by', value: preview.sentBy },
              { label: 'Sent at', value: preview.sentAt },
              { label: 'Reach', value: `~${preview.reach.toLocaleString()} recipients` },
            ].map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>{r.label.toUpperCase()}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .notif-row { transition: background .12s; cursor: pointer; }
        .notif-row:hover { background: var(--surface-2) !important; }
        .nc-type-btn { transition: all .15s; cursor: pointer; }
        .nc-type-btn:hover { opacity: .8; }
        .brgy-chip { transition: all .15s; cursor: pointer; }
        .brgy-chip:hover { opacity: .85; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="page">

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>Notification Center</h2>
            <span style={{ background: 'rgba(231,76,60,0.1)', color: '#e74c3c', border: '1px solid rgba(231,76,60,0.3)', fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>ADMIN</span>
          </div>
          <p className="text-muted text-sm">Send alerts and announcements city-wide or to specific barangays.</p>
        </div>

        {/* KPI strip */}
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          {[
            { label: 'Total Sent', value: notifications.length, color: 'var(--text)' },
            { label: 'Alerts', value: typeCounts.alert || 0, color: '#e74c3c' },
            { label: 'Announcements', value: typeCounts.announcement || 0, color: '#5dade2' },
            { label: 'Reminders', value: typeCounts.reminder || 0, color: '#f39c12' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className="label">{s.label}</div>
              <div className="value" style={{ color: s.color, fontSize: 30 }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, alignItems: 'start' }}>

          {/* ── Notification List ── */}
          <div>
            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', borderRadius: 10, padding: 4 }}>
                <button className="nc-type-btn" onClick={() => setFilterType('all')} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', background: filterType === 'all' ? 'var(--surface)' : 'transparent', color: filterType === 'all' ? 'var(--text)' : 'var(--text-muted)', boxShadow: filterType === 'all' ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>
                  All ({notifications.length})
                </button>
                {Object.entries(TYPES).map(([k, m]) => (
                  <button key={k} className="nc-type-btn" onClick={() => setFilterType(k)} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', background: filterType === k ? 'var(--surface)' : 'transparent', color: filterType === k ? m.color : 'var(--text-muted)', boxShadow: filterType === k ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>
                    {m.icon} ({typeCounts[k] || 0})
                  </button>
                ))}
              </div>
              <input className="form-input" placeholder="Search title or target…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 220, marginLeft: 'auto' }} />
            </div>

            {filtered.length === 0 && (
              <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>No notifications found</div>
                <div className="text-muted text-sm">Try adjusting your filters.</div>
              </div>
            )}

            {filtered.map(n => {
              const m = TYPES[n.type] || TYPES.info
              return (
                <div key={n.id} className="notif-row" onClick={() => setPreview(n)} style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderLeft: `3px solid ${m.color}`,
                  borderRadius: 12, padding: '14px 16px', marginBottom: 10,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    {/* Icon */}
                    <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: m.bg, border: `1px solid ${m.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                      {m.icon}
                    </div>

                    {/* Body */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{n.title}</span>
                        <TypeBadge t={n.type} />
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {n.body}
                      </p>
                      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                        <span>📍 {n.target}</span>
                        <span>👤 {n.sentBy}</span>
                        <span>🕐 {n.sentAt}</span>
                        <span style={{ color: m.color, fontWeight: 700 }}>~{n.reach.toLocaleString()} reached</span>
                      </div>
                    </div>

                    <div style={{ fontSize: 16, color: 'var(--text-muted)', flexShrink: 0 }}>›</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Compose Form ── */}
          <div className="card" style={{ padding: 20, position: 'sticky', top: 80 }}>
            <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 15, margin: '0 0 18px' }}>
              ✉️ Compose Notification
            </h3>

            {/* Type picker */}
            <label className="form-label">Type</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
              {Object.entries(TYPES).map(([k, m]) => (
                <button key={k} className="nc-type-btn" onClick={() => set('type', k)} style={{
                  padding: '8px 10px', borderRadius: 10, border: `1px solid ${form.type === k ? m.color : 'var(--border)'}`,
                  background: form.type === k ? m.bg : 'transparent',
                  color: form.type === k ? m.color : 'var(--text-muted)',
                  fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-body)',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span>{m.icon}</span> {m.label}
                </button>
              ))}
            </div>

            {/* Title */}
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">Title</label>
              <input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Special Collection Schedule" maxLength={80} />
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'right', marginTop: 2 }}>{form.title.length}/80</div>
            </div>

            {/* Body */}
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">Message</label>
              <textarea className="form-input" rows={3} value={form.body} onChange={e => set('body', e.target.value)} placeholder="Enter the notification message…" style={{ resize: 'vertical' }} maxLength={500} />
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'right', marginTop: 2 }}>{form.body.length}/500</div>
            </div>

            {/* Target */}
            <div style={{ marginBottom: 14 }}>
              <label className="form-label">Target Audience</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {[['city-wide', '🌆 City-wide'], ['barangay', '📍 Per Barangay']].map(([v, l]) => (
                  <button key={v} className="nc-type-btn" onClick={() => set('target', v)} style={{
                    flex: 1, padding: '8px', borderRadius: 10, border: '1px solid',
                    fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)',
                    borderColor: form.target === v ? 'var(--accent)' : 'var(--border)',
                    color: form.target === v ? 'var(--accent)' : 'var(--text-muted)',
                    background: form.target === v ? 'rgba(46,204,113,0.08)' : 'transparent',
                  }}>{l}</button>
                ))}
              </div>

              {form.target === 'barangay' && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 7 }}>
                    SELECT BARANGAYS ({form.barangays.length} selected)
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {BARANGAYS.map(b => {
                      const on = form.barangays.includes(b)
                      return (
                        <button key={b} className="brgy-chip" onClick={() => toggleBrgy(b)} style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                          border: '1px solid', fontFamily: 'var(--font-body)',
                          borderColor: on ? 'var(--accent)' : 'var(--border)',
                          color: on ? 'var(--accent)' : 'var(--text-muted)',
                          background: on ? 'rgba(46,204,113,0.08)' : 'transparent',
                        }}>{b}</button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Estimated reach */}
            <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', marginBottom: 2 }}>TARGET</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{targetLabel(form)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', marginBottom: 2 }}>EST. REACH</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{estimatedReach(form)}</div>
              </div>
            </div>

            <button
              onClick={handleSend}
              disabled={sending}
              style={{
                width: '100%', padding: '12px', borderRadius: 12, border: 'none',
                background: sending ? 'rgba(46,204,113,0.4)' : 'var(--accent)',
                color: '#0d1117', fontWeight: 800, fontSize: 14,
                fontFamily: 'var(--font-body)', cursor: sending ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'all .2s',
              }}
            >
              {sending ? (
                <>
                  <div style={{ width: 14, height: 14, border: '2px solid #0d1117', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                  Sending…
                </>
              ) : '📤 Send Notification'}
            </button>
          </div>
        </div>

      </div>
    </DashboardLayout>
  )
}

function _notifTypeToLocal(type) {
  switch (type) {
    case 'ANNOUNCEMENT': return 'announcement'
    case 'SCHEDULE_CHANGE': return 'reminder'
    case 'TRUCK_NEAR': return 'alert'
    case 'COLLECTION_DONE': return 'info'
    default: return 'info'
  }
}
