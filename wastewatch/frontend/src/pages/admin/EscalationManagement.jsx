import { useState, useMemo } from 'react'
import DashboardLayout from '../../components/DashboardLayout'
import { useEscalations } from '../../hooks/useEscalations'
import { useUsers } from '../../hooks/useUsers'

const PRIORITY = {
  high: { label: 'High', color: '#e74c3c', bg: 'rgba(231,76,60,0.08)', border: 'rgba(231,76,60,0.3)', bar: '#e74c3c' },
  medium: { label: 'Medium', color: '#f39c12', bg: 'rgba(243,156,18,0.08)', border: 'rgba(243,156,18,0.3)', bar: '#f39c12' },
  low: { label: 'Low', color: '#2ecc71', bg: 'rgba(46,204,113,0.08)', border: 'rgba(46,204,113,0.3)', bar: '#2ecc71' },
}

const STATUS_META = {
  open: { label: 'Open', color: '#e74c3c', bg: 'rgba(231,76,60,0.1)' },
  in_progress: { label: 'In Progress', color: '#f39c12', bg: 'rgba(243,156,18,0.1)' },
  resolved: { label: 'Resolved', color: '#2ecc71', bg: 'rgba(46,204,113,0.1)' },
}

const TYPE_ICON = {
  'Overflow': '🗑️',
  'Illegal Dumping': '🚯',
  'Missed Pickup': '📭',
  'Road Blockage': '🚧',
  'Littering': '🍂',
  'Health Hazard': '⚠️',
}

function PriorityBadge({ p }) {
  const m = PRIORITY[p] || PRIORITY.low
  return <span style={{ background: m.bg, border: `1px solid ${m.border}`, color: m.color, borderRadius: 20, padding: '2px 10px', fontSize: 9, fontWeight: 800, letterSpacing: '.06em' }}>{m.label.toUpperCase()}</span>
}

function StatusBadge({ s }) {
  const m = STATUS_META[s] || STATUS_META.open
  return <span style={{ background: m.bg, color: m.color, borderRadius: 20, padding: '2px 10px', fontSize: 9, fontWeight: 800 }}>{m.label.toUpperCase()}</span>
}

function AssignModal({ esc, onSave, onClose, staff }) {
  const [assignee, setAssignee] = useState(esc.assignee || '')
  const [deadline, setDeadline] = useState(esc.deadline || '')
  const [notes, setNotes] = useState(esc.notes || '')
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 24, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 16, margin: 0 }}>Assign &amp; Set Deadline</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>
        <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: 12 }}>
          <div style={{ fontWeight: 700 }}>{esc.title}</div>
          <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{esc.barangay_name} · {esc.report_count} reports</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label className="form-label">Assign To</label>
          <select className="form-input" value={assignee} onChange={e => setAssignee(e.target.value)}>
            <option value="">— Select staff —</option>
            {staff.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label className="form-label">Deadline</label>
          <input className="form-input" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label className="form-label">Notes</label>
          <textarea className="form-input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Action taken, instructions…" style={{ resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => onSave({ assignee, deadline, notes, status: assignee ? 'in_progress' : esc.status })}>Save</button>
        </div>
      </div>
    </div>
  )
}

export default function EscalationManagement() {
  const { items, loading, saveEscalation, resolveEscalation } = useEscalations()
  const { users } = useUsers()
  
  const staff = useMemo(() => users.filter(u => u.role !== 'citizen'), [users])

  const [priorityFilter, setPriorityFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [assignModal, setAssignModal] = useState(null)
  const [toast, setToast] = useState(null)

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  async function handleResolve(id) {
    const res = await resolveEscalation(id)
    if (res.ok) {
      setExpanded(null)
      showToast('✅ Escalation marked as resolved.')
    }
  }

  async function handleSaveAssign(id, data) {
    const res = await saveEscalation(id, data)
    if (res.ok) {
      setAssignModal(null)
      showToast('✅ Task assigned successfully.')
    }
  }

  const counts = useMemo(() => ({
    all: items.length,
    open: items.filter(e => e.status === 'open').length,
    in_progress: items.filter(e => e.status === 'in_progress').length,
    resolved: items.filter(e => e.status === 'resolved').length,
    high: items.filter(e => e.priority === 'high').length,
  }), [items])

  const filtered = useMemo(() => items.filter(e => {
    const mp = priorityFilter === 'all' || e.priority === priorityFilter
    const ms = statusFilter === 'all' || e.status === statusFilter
    const mq = !search || e.title.toLowerCase().includes(search.toLowerCase()) || (e.barangay_name || '').toLowerCase().includes(search.toLowerCase())
    return mp && ms && mq
  }), [items, priorityFilter, statusFilter, search])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    const so = { open: 0, in_progress: 1, resolved: 2 }
    return (so[a.status] - so[b.status]) || (order[a.priority] - order[b.priority])
  }), [filtered])

  return (
    <DashboardLayout>

      {toast && (
        <div style={{ position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', background: '#0f172a', color: '#fff', padding: '10px 22px', borderRadius: 12, zIndex: 9999, fontSize: 13, fontWeight: 600, border: '1px solid rgba(46,204,113,0.3)', whiteSpace: 'nowrap' }}>{toast}</div>
      )}
      {assignModal && (
        <AssignModal esc={assignModal} onSave={data => saveAssign(assignModal.id, data)} onClose={() => setAssignModal(null)} />
      )}

      <style>{`
        @keyframes slideDown { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:translateY(0)} }
        .esc-card { transition: box-shadow .15s, border-color .15s; cursor: pointer; }
        .esc-card:hover { box-shadow: 0 4px 18px rgba(0,0,0,.08); }
        .esc-act { transition: all .15s; cursor: pointer; }
        .esc-act:hover { opacity: .82; transform: scale(.97); }
      `}</style>

      <div className="page" style={{ maxWidth: 1000, margin: '0 auto', paddingBottom: 0 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 800, margin: 0 }}>Escalation Management</h2>
              {counts.open > 0 && (
                <span style={{ background: 'rgba(231,76,60,0.1)', color: '#e74c3c', border: '1px solid rgba(231,76,60,0.3)', fontSize: 9, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>
                  {counts.open} OPEN
                </span>
              )}
            </div>
            <p className="text-muted text-sm">Barangay-escalated issues requiring admin action.</p>
          </div>
        </div>

        {/* KPI strip */}
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          {[
            { label: 'Total', value: counts.all, color: '#ffffffff' },
            { label: 'Open', value: counts.open, color: '#e74c3c' },
            { label: 'In Progress', value: counts.in_progress, color: '#f39c12' },
            { label: 'Resolved', value: counts.resolved, color: '#2ecc71' },
          ].map(s => (
            <div key={s.label} className="stat-card">
              <div className="label">{s.label}</div>
              <div className="value" style={{ color: s.color, fontSize: 30 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Critical alert banner */}
        {counts.high > 0 && items.some(e => e.priority === 'high' && e.status !== 'resolved') && (
          <div style={{ background: 'rgba(231,76,60,0.05)', border: '1.5px solid rgba(231,76,60,0.3)', borderRadius: 12, padding: '12px 16px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(231,76,60,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🚨</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e74c3c', marginBottom: 1 }}>
                {items.filter(e => e.priority === 'high' && e.status !== 'resolved').length} high-priority escalation(s) need immediate attention
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Assign tasks and set deadlines to resolve critical issues.</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Priority tabs */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface-2)', borderRadius: 10, padding: 4 }}>
            {['all', 'high', 'medium', 'low'].map(f => (
              <button key={f} onClick={() => setPriorityFilter(f)} style={{
                padding: '6px 12px', borderRadius: 8, border: 'none',
                fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)',
                background: priorityFilter === f ? 'var(--surface)' : 'transparent',
                color: priorityFilter === f ? (PRIORITY[f]?.color || 'var(--text)') : 'var(--text-muted)',
                boxShadow: priorityFilter === f ? '0 1px 4px rgba(0,0,0,.08)' : 'none',
                transition: 'all .15s', cursor: 'pointer',
              }}>
                {f === 'all' ? `All (${counts.all})` : `${PRIORITY[f].label} (${counts[f]})`}
              </button>
            ))}
          </div>

          {/* Status pills */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[['all', 'All'], ['open', 'Open'], ['in_progress', 'In Progress'], ['resolved', 'Resolved']].map(([v, l]) => (
              <button key={v} onClick={() => setStatusFilter(v)} style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                border: '1px solid', fontFamily: 'var(--font-body)', cursor: 'pointer', transition: 'all .15s',
                borderColor: statusFilter === v ? 'var(--accent)' : 'var(--border)',
                color: statusFilter === v ? 'var(--accent)' : 'var(--text-muted)',
                background: statusFilter === v ? 'rgba(46,204,113,0.08)' : 'transparent',
              }}>{l}</button>
            ))}
          </div>

          <input className="form-input" placeholder="Search title or barangay…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 240, marginLeft: 'auto' }} />
        </div>

        {/* List */}
        {sorted.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>No escalations found</div>
            <div className="text-muted text-sm">Adjust your filters or check back later.</div>
          </div>
        )}

        {sorted.map(e => {
          const p = PRIORITY[e.priority] || PRIORITY.low
          const isOpen = expanded === e.id
          const isResolved = e.status === 'resolved'
          return (
            <div key={e.id} className="esc-card" style={{
              background: isResolved ? 'rgba(0,0,0,0.02)' : 'var(--surface)',
              border: isOpen ? `1.5px solid ${p.border}` : '1px solid var(--border)',
              borderRadius: 14, marginBottom: 10, overflow: 'hidden',
              opacity: isResolved ? 0.7 : 1,
            }}>
              {/* Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}
                onClick={() => setExpanded(prev => prev === e.id ? null : e.id)}>
                {/* Priority bar */}
                <div style={{ width: 3, height: 42, borderRadius: 2, background: p.bar, flexShrink: 0 }} />

                {/* Icon */}
                <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: p.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>
                  {TYPE_ICON[e.type] || '⚠️'}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{e.title}</span>
                    <PriorityBadge p={e.priority} />
                    <StatusBadge s={e.status} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>📋 {e.type}</span>
                    <span>📣 {e.report_count} reports</span>
                    <span>📍 Brgy. {e.barangay_name}</span>
                    <span>👤 {e.raised_by_name}</span>
                  </div>
                </div>

                {/* Right meta */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{e.ago || 'recently'}</div>
                  {e.deadline && <div style={{ fontSize: 10, color: '#f39c12', fontWeight: 700 }}>⏰ {e.deadline}</div>}
                  <div style={{ fontSize: 14, color: 'var(--text-muted)', transform: isOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform .2s' }}>›</div>
                </div>
              </div>

              {/* Expanded */}
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px', animation: 'slideDown .18s' }}
                  onClick={ev => ev.stopPropagation()}>

                  {/* Context info */}
                  <div style={{ background: p.bg, border: `1px solid ${p.border}`, borderRadius: 8, padding: '9px 12px', marginBottom: 14, fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)' }}>
                    <strong style={{ color: p.color }}>Escalated by {e.raised_by_name}</strong> — {e.type} with {e.report_count} community reports in Barangay {e.barangay_name}.
                    {e.notes && <> Notes: <em>{e.notes}</em></>}
                  </div>

                  {/* Assignee / deadline */}
                  {e.assignee && (
                    <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                      <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px', flex: 1, minWidth: 120 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.06em', marginBottom: 3 }}>ASSIGNED TO</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>👤 {e.assignee_name || 'Assigned'}</div>
                      </div>
                      {e.deadline && (
                        <div style={{ background: 'rgba(243,156,18,0.07)', border: '1px solid rgba(243,156,18,0.25)', borderRadius: 8, padding: '8px 12px', flex: 1, minWidth: 120 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: '#f39c12', letterSpacing: '.06em', marginBottom: 3 }}>DEADLINE</div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>⏰ {e.deadline}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  {!isResolved && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="esc-act" onClick={() => setAssignModal(e)} style={{
                        flex: 1, minWidth: 100, background: 'rgba(93,173,226,0.08)',
                        border: '1px solid rgba(93,173,226,0.35)', color: '#5dade2',
                        borderRadius: 10, padding: '9px', fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-body)',
                      }}>
                        👤 {e.assignee ? 'Reassign' : 'Assign Task'}
                      </button>
                      <button className="esc-act" onClick={() => handleResolve(e.id)} style={{
                        flex: 1, minWidth: 100, background: 'var(--accent)', color: '#0d1117',
                        border: 'none', borderRadius: 10, padding: '9px',
                        fontWeight: 700, fontSize: 12, fontFamily: 'var(--font-body)',
                      }}>
                        ✓ Mark Resolved
                      </button>
                    </div>
                  )}

                  {isResolved && (
                    <div style={{ background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.25)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#2ecc71', fontWeight: 600, textAlign: 'center' }}>
                      ✅ This escalation has been resolved.
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

      </div>
    </DashboardLayout>
  )
}
