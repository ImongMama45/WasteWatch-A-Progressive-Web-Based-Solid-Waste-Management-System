import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardLayout from '../components/DashboardLayout'
import { useNotifications } from '../hooks/useNotifications'

export default function NotificationsPage() {
  const navigate = useNavigate()
  const { fetchAll, markRead } = useNotifications()
  const [allNotifs, setAllNotifs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('All') // 'All', 'Alerts', 'Updates'

  useEffect(() => {
    let mounted = true
    fetchAll().then(data => {
      if (mounted) {
        setAllNotifs(data.results || data || []) // handle paginated vs array
        setLoading(false)
      }
    })
    return () => { mounted = false }
  }, [fetchAll])

  // Mark all as read when the page unmounts or mounts?
  // Let's explicitly give them a button, or just mark them read on mount.
  useEffect(() => {
    // Only mark read if there are unread
    if (allNotifs.some(n => !n.is_read)) {
      markRead() // marks all as read
    }
  }, [allNotifs, markRead])

  const filtered = allNotifs.filter(n => {
    if (filter === 'All') return true
    if (filter === 'Alerts') return ['alert', 'escalation', 'incident'].includes(n.type)
    if (filter === 'Updates') return ['info', 'system', 'announcement'].includes(n.type)
    return true
  })

  return (
    <DashboardLayout>
      <div className="page" style={{ width: '80%', maxWidth: 1400, margin: '0 auto', minHeight: '100vh', padding: 0 }}>

        {/* Header matching the design */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              background: 'none', border: 'none', color: '#666',
              fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: 0, width: 'fit-content'
            }}
          >
            &lt; BACK
          </button>

          <h1 style={{
            fontSize: '24px', fontWeight: 800, margin: 0,
            color: '#1a2e1a', letterSpacing: '-0.02em', textTransform: 'uppercase'
          }}>
            NOTIFICATIONS
          </h1>

          {/* Chips */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {['All', 'Alerts', 'Updates'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '6px 16px', borderRadius: '20px', border: 'none',
                  fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  background: filter === f ? '#0d2c4a' : '#e2e8f0',
                  color: filter === f ? '#fff' : '#64748b',
                  transition: 'all 0.2s'
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Notifications List */}
        <div style={{ padding: '0 20px 40px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>Loading notifications...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
              No {filter !== 'All' ? filter.toLowerCase() : ''} notifications.
            </div>
          ) : (
            filtered.map(n => (
              <div
                key={n.id}
                style={{
                  background: '#fff', borderRadius: '12px', padding: '16px',
                  display: 'flex', gap: '12px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                  position: 'relative'
                }}
              >
                {/* Unread indicator */}
                {!n.is_read && (
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: '#ef4444', flexShrink: 0, marginTop: '4px'
                  }} />
                )}
                {n.is_read && <div style={{ width: '8px', flexShrink: 0 }} />}

                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: '14px', fontWeight: 600, color: '#1a2e1a',
                    marginBottom: '4px', lineHeight: 1.4
                  }}>
                    {n.title}
                  </div>
                  <div style={{
                    fontSize: '13px', color: '#64748b', lineHeight: 1.4,
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                  }}>
                    {n.message}
                  </div>
                </div>

                <div style={{
                  fontSize: '11px', color: '#94a3b8', flexShrink: 0,
                  paddingTop: '2px', whiteSpace: 'nowrap'
                }}>
                  {formatTimeAgo(n.created_at)}
                </div>
              </div>
            ))
          )}
        </div>

      </div>
    </DashboardLayout>
  )
}

function formatTimeAgo(dateString) {
  const d = new Date(dateString)
  const now = new Date()
  const diffMs = now - d
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins} mins ago`
  if (diffHours < 24) return `${diffHours} hours ago`
  if (diffDays === 1) return 'Yesterday'
  return `${diffDays} days ago`
}
