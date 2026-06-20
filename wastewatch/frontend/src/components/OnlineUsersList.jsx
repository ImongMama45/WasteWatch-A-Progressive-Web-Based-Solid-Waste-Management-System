import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'

const ROLE_CONFIG = {
  driver:       { label: 'Drivers',            order: 1 },
  watcher:      { label: 'Watchers',           order: 2 },
  brgy_official:{ label: 'Barangay Officials', order: 3 },
}

const STATUS_DOT = {
  online: { color: '#16A34A', label: 'Online' },
  idle:   { color: '#D97706', label: 'Idle'   },
}

function relativeTime(isoString) {
  const diff = Math.floor((Date.now() - new Date(isoString)) / 1000)
  if (diff < 10)  return 'just now'
  if (diff < 60)  return `${diff}s ago`
  if (diff < 120) return '1 min ago'
  return `${Math.floor(diff / 60)} min ago`
}

export default function OnlineUsersList() {
  const [users, setUsers]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState(false)
  const [lastFetch, setLastFetch] = useState(null)
  const [error, setError]         = useState(false)

  const fetchOnline = useCallback(() => {
    api.get('/api/accounts/online/')
      .then(r => {
        setUsers(r.data.users || [])
        setLastFetch(new Date())
        setError(false)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchOnline()
    const t = setInterval(fetchOnline, 30_000)
    return () => clearInterval(t)
  }, [fetchOnline])

  // Group and sort by role priority
  const grouped = Object.entries(ROLE_CONFIG)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([role, cfg]) => ({
      role,
      label: cfg.label,
      users: users.filter(u => u.role === role),
    }))
    .filter(g => g.users.length > 0)

  const totalOnline = users.filter(u => u.status === 'online').length
  const totalIdle   = users.filter(u => u.status === 'idle').length
  const total       = users.length

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: 12,
    }}>
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          gap: 8, padding: '11px 14px', background: 'none',
          border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: total > 0 ? '#16A34A' : 'var(--text-light)',
        }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          {loading ? 'Checking presence…' : `${total} personnel online`}
        </span>
        {!loading && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {totalOnline > 0 && `${totalOnline} active`}
            {totalOnline > 0 && totalIdle > 0 && ' · '}
            {totalIdle > 0 && `${totalIdle} idle`}
          </span>
        )}
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded list */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {error && (
            <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--danger)' }}>
              ⚠ Could not fetch presence data
            </div>
          )}

          {!error && total === 0 && (
            <div style={{
              padding: '18px 14px', textAlign: 'center',
              fontSize: 12, color: 'var(--text-muted)',
            }}>
              No personnel currently online
            </div>
          )}

          {grouped.map(group => (
            <div key={group.role}>
              <div style={{
                padding: '7px 14px 4px',
                fontSize: 10, fontWeight: 800,
                textTransform: 'uppercase', letterSpacing: '.07em',
                color: 'var(--text-muted)',
                background: 'var(--surface-2)',
              }}>
                {group.label} ({group.users.length})
              </div>
              {group.users.map(u => {
                const dot = STATUS_DOT[u.status] || STATUS_DOT.idle
                return (
                  <div key={u.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 14px',
                    borderBottom: '1px solid var(--border)',
                  }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: dot.color, flexShrink: 0,
                    }} />
                    <span style={{
                      flex: 1, fontSize: 13,
                      fontWeight: 600, color: 'var(--text)',
                    }}>
                      {u.full_name}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {relativeTime(u.last_activity)}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}

          {lastFetch && (
            <div style={{
              padding: '6px 14px', fontSize: 10,
              color: 'var(--text-light)', textAlign: 'right',
            }}>
              Updated {relativeTime(lastFetch.toISOString())}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
