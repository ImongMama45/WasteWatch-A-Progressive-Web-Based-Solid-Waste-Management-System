import { useState } from 'react'
import DashboardLayout from '../../components/DashboardLayout'

// ── Mock Data ─────────────────────────────────────────────────────────────────

const ACTIONS = {
  create: { label: 'Create', color: '#2ecc71', bg: 'rgba(46,204,113,0.1)', border: 'rgba(46,204,113,0.3)', icon: '➕' },
  update: { label: 'Update', color: '#5dade2', bg: 'rgba(93,173,226,0.1)', border: 'rgba(93,173,226,0.3)', icon: '✏️' },
  delete: { label: 'Delete', color: '#e74c3c', bg: 'rgba(231,76,60,0.1)', border: 'rgba(231,76,60,0.3)', icon: '🗑️' },
  system: { label: 'System', color: '#f39c12', bg: 'rgba(243,156,18,0.1)', border: 'rgba(243,156,18,0.3)', icon: '⚙️' },
}

const MODULES = ['Users', 'Trucks', 'Dumpsites', 'Routes', 'Escalations', 'Notifications']

const INITIAL_LOGS = [
  { id: 1, action: 'delete', module: 'Users', admin: 'Admin Dela Cruz', details: 'Deleted user account for "Carlo Ramos" (Driver).', time: '10 mins ago', timestamp: '2026-05-02 04:30:12' },
  { id: 2, action: 'create', module: 'Notifications', admin: 'Admin Dela Cruz', details: 'Sent City-wide alert "Typhoon Preparedness".', time: '1 hour ago', timestamp: '2026-05-02 03:40:00' },
  { id: 3, action: 'update', module: 'Escalations', admin: 'Admin Reyes', details: 'Assigned Escalation E003 to driver Ana Mendoza.', time: '2 hours ago', timestamp: '2026-05-02 02:20:15' },
  { id: 4, action: 'create', module: 'Routes', admin: 'Admin Dela Cruz', details: 'Created new collection route for Truck LCN-002 (Cotta).', time: '5 hours ago', timestamp: '2026-05-01 23:10:45' },
  { id: 5, action: 'update', module: 'Trucks', admin: 'Admin Reyes', details: 'Updated status of Truck LCN-004 to "Under Maintenance".', time: '1 day ago', timestamp: '2026-05-01 10:05:00' },
  { id: 6, action: 'delete', module: 'Dumpsites', admin: 'Admin Dela Cruz', details: 'Removed temporary transfer station "Market Zone A".', time: '1 day ago', timestamp: '2026-05-01 09:15:22' },
  { id: 7, action: 'system', module: 'System', admin: 'System API', details: 'Automated database backup completed successfully.', time: '2 days ago', timestamp: '2026-04-30 00:00:00' },
]

function ActionBadge({ action }) {
  const m = ACTIONS[action] || ACTIONS.system
  return (
    <span style={{
      background: m.bg, border: `1px solid ${m.border}`, color: m.color,
      borderRadius: 20, padding: '3px 10px', fontSize: 10, fontWeight: 800,
      letterSpacing: '.06em', display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <span>{m.icon}</span> {m.label.toUpperCase()}
    </span>
  )
}

export default function ActivityLog() {
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [moduleFilter, setModuleFilter] = useState('all')

  const filteredLogs = INITIAL_LOGS.filter(log => {
    const mAction = actionFilter === 'all' || log.action === actionFilter
    const mModule = moduleFilter === 'all' || log.module === moduleFilter
    const mSearch = !search || 
      log.details.toLowerCase().includes(search.toLowerCase()) || 
      log.admin.toLowerCase().includes(search.toLowerCase())
    return mAction && mModule && mSearch
  })

  return (
    <DashboardLayout>
      <style>{`
        .log-row { transition: background .15s; }
        .log-row:hover { background: var(--surface-2); }
        .timeline-line { position: absolute; left: 19px; top: 38px; bottom: -12px; width: 2px; background: var(--border); }
        .log-row:last-child .timeline-line { display: none; }
      `}</style>

      <div className="page" style={{ maxWidth: 1000, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 800, margin: 0 }}>Activity &amp; Audit Log</h2>
            <span style={{ background: 'rgba(93,173,226,0.1)', color: '#5dade2', border: '1px solid rgba(93,173,226,0.3)', fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>ADMIN ONLY</span>
          </div>
          <p className="text-muted text-sm">Track system changes, administrative actions, and deletions history.</p>
        </div>

        {/* Filters Card */}
        <div className="card" style={{ padding: 16, marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
          
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', borderRadius: 10, padding: 4 }}>
            {['all', 'create', 'update', 'delete'].map(act => {
              const active = actionFilter === act
              return (
                <button key={act} onClick={() => setActionFilter(act)} style={{
                  padding: '6px 14px', borderRadius: 8, border: 'none',
                  fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)',
                  background: active ? 'var(--surface)' : 'transparent',
                  color: active ? (act === 'all' ? 'var(--text)' : ACTIONS[act].color) : 'var(--text-muted)',
                  boxShadow: active ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
                  cursor: 'pointer', transition: 'all .15s'
                }}>
                  {act === 'all' ? 'All Actions' : ACTIONS[act].label}
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>MODULE:</span>
            <select className="form-input" style={{ width: 140, padding: '6px 10px', fontSize: 12 }} 
              value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}>
              <option value="all">All Modules</option>
              {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <input 
            className="form-input" 
            placeholder="Search details or admin name..." 
            value={search} onChange={e => setSearch(e.target.value)} 
            style={{ flex: 1, minWidth: 200 }} 
          />
        </div>

        {/* Timeline Log */}
        <div className="card" style={{ padding: '8px 0' }}>
          {filteredLogs.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
              <div style={{ fontWeight: 700 }}>No activity matches your filters.</div>
            </div>
          )}

          {filteredLogs.map(log => {
            const isDelete = log.action === 'delete'
            return (
              <div key={log.id} className="log-row" style={{ position: 'relative', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <div className="timeline-line" />
                
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  
                  {/* Icon Node */}
                  <div style={{ 
                    width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                    background: isDelete ? 'rgba(231,76,60,0.15)' : 'var(--surface-2)',
                    border: `2px solid ${isDelete ? '#e74c3c' : 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, zIndex: 2
                  }}>
                    {ACTIONS[log.action]?.icon || '⚙️'}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <ActionBadge action={log.action} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 4 }}>
                          {log.module.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{log.time}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{log.timestamp}</div>
                      </div>
                    </div>

                    <div style={{ 
                      fontSize: 14, lineHeight: 1.5, marginBottom: 6,
                      color: isDelete ? '#e74c3c' : 'var(--text)',
                      fontWeight: isDelete ? 600 : 400
                    }}>
                      {log.details}
                    </div>

                    <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>👤 Admin:</span>
                      <strong style={{ color: 'var(--text)' }}>{log.admin}</strong>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

      </div>
    </DashboardLayout>
  )
}
