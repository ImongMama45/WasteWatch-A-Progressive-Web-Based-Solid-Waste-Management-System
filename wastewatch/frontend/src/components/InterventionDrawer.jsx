import { useState } from 'react'
import { useInterventions } from '../hooks/useInterventions'
import api from '../api/client'

const DISPATCH_COLUMNS = [
  { key: 'created', label: 'Dispatched' },
  { key: 'acknowledged', label: 'Driver Acknowledged' },
]
const FLAG_COLUMNS = [
  { key: 'flagged', label: 'Flagged' },
  { key: 'acknowledged', label: 'Brgy Acknowledged' },
]

function InterventionCard({ item, type, onAction, onFlyTo }) {
  const [showNotes, setShowNotes] = useState(false)
  const [notes, setNotes] = useState('')

  const handleResolve = () => {
    if (!showNotes) {
      setShowNotes(true)
      return
    }
    onAction(item.id, 'resolve', notes)
    setShowNotes(false)
  }

  const handleFly = () => {
    const lat = parseFloat(item.hotspot_latitude)
    const lng = parseFloat(item.hotspot_longitude)
    if (!isNaN(lat) && !isNaN(lng)) {
      onFlyTo(item.hotspot, lat, lng)
    }
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '10px 12px', marginBottom: 8, cursor: 'pointer',
    }} onClick={handleFly}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{item.hotspot_name}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
        {type === 'dispatch'
          ? `🚛 ${item.truck_plate || '—'}`
          : `👤 Flagged by ${item.created_by_name || '—'}`}
        {' · '}{new Date(item.created_at).toLocaleDateString()}
      </div>

      {showNotes && (
        <div onClick={e => e.stopPropagation()} style={{ marginBottom: 8 }}>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional resolution notes..."
            style={{ width: '100%', padding: '6px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', resize: 'vertical' }}
            rows={2}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
        {item.status !== 'acknowledged' && (
          <button onClick={() => onAction(item.id, 'acknowledge')} style={btnStyle('#3498db')}>
            Mark Acknowledged
          </button>
        )}
        <button onClick={handleResolve} style={btnStyle('#2ecc71')}>
          {showNotes ? 'Confirm Resolve' : (type === 'dispatch' ? 'Mark Collected' : 'Mark Resolved')}
        </button>
        {showNotes && (
          <button onClick={() => setShowNotes(false)} style={btnStyle('#95a5a6')}>Cancel</button>
        )}
        {!showNotes && (
          <button onClick={() => onAction(item.id, 'cancel')} style={btnStyle('#e74c3c')}>
            Cancel Task
          </button>
        )}
      </div>
    </div>
  )
}

function btnStyle(color) {
  return {
    background: `${color}18`, border: `1px solid ${color}55`, color,
    borderRadius: 6, padding: '4px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
  }
}

export default function InterventionDrawer({ open, onClose, onFlyTo }) {
  const [tab, setTab] = useState('dispatch')
  const dispatches = useInterventions('dispatch')
  const flags = useInterventions('flag')
  const active = tab === 'dispatch' ? dispatches : flags
  const columns = tab === 'dispatch' ? DISPATCH_COLUMNS : FLAG_COLUMNS

  async function handleAction(id, action, resolutionNotes = '') {
    try {
      await api.post(`/api/watcher/interventions/${id}/${action}/`, { notes: resolutionNotes })
      active.refresh()
    } catch (err) {
      console.error(`[InterventionDrawer] ${action} failed`, err)
    }
  }

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, zIndex: 9998,
      background: 'var(--surface)', borderLeft: '1px solid var(--border)',
      boxShadow: '-8px 0 32px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Action Progress</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}>×</button>
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
        {['dispatch', 'flag'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            background: tab === t ? 'var(--surface-3)' : 'transparent',
            color: tab === t ? '#fff' : 'var(--text-muted)',
          }}>
            {t === 'dispatch' ? `Dispatches (${dispatches.items.length})` : `Flags (${flags.items.length})`}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
        {active.loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>Loading…</div>
        ) : active.items.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>Nothing active.</div>
        ) : (
          columns.map(col => {
            const rows = active.items.filter(i => i.status === col.key)
            if (rows.length === 0) return null
            return (
              <div key={col.key} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                  {col.label} ({rows.length})
                </div>
                {rows.map(item => (
                  <InterventionCard key={item.id} item={item} type={tab} onAction={handleAction} onFlyTo={onFlyTo} />
                ))}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
