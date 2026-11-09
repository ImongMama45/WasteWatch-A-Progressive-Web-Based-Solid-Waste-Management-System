import { useState } from 'react'
import {
  Truck,
  User,
  Calendar,
  Clock,
  MapPin,
  CheckCircle2,
  Check,
  X,
  XCircle,
  Activity,
  ArrowRight,
  ShieldAlert,
  Send,
  CornerDownRight
} from 'lucide-react'
import { useInterventions } from '../hooks/useInterventions'
import api from '../api/client'
import { FeedCardSkeleton } from './ui/Skeleton'

const DISPATCH_COLUMNS = [
  { key: 'created', label: 'Dispatched', badgeColor: '#3b82f6', badgeBg: 'rgba(59, 130, 246, 0.1)' },
  { key: 'acknowledged', label: 'Driver Acknowledged', badgeColor: '#10b981', badgeBg: 'rgba(16, 185, 129, 0.1)' },
]
const FLAG_COLUMNS = [
  { key: 'flagged', label: 'Flagged to Barangay', badgeColor: '#f59e0b', badgeBg: 'rgba(245, 158, 11, 0.1)' },
  { key: 'acknowledged', label: 'Barangay Acknowledged', badgeColor: '#10b981', badgeBg: 'rgba(16, 185, 129, 0.1)' },
]

function InterventionCard({ item, type, onAction, onFlyTo }) {
  const [showNotes, setShowNotes] = useState(false)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [showConfirmCancel, setShowConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const handleResolve = async () => {
    if (!showNotes) {
      setShowNotes(true)
      return
    }
    setSubmitting(true)
    try {
      await onAction(item.id, 'resolve', notes)
    } finally {
      setSubmitting(false)
      setShowNotes(false)
    }
  }

  const handleFly = () => {
    const lat = parseFloat(item.hotspot_latitude)
    const lng = parseFloat(item.hotspot_longitude)
    if (!isNaN(lat) && !isNaN(lng)) {
      onFlyTo(item.hotspot, lat, lng)
    }
  }

  return (
    <div
      onClick={handleFly}
      style={{
        background: 'var(--surface, #ffffff)',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: 14,
        padding: '14px 16px',
        marginBottom: 10,
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      className="intervention-card-hover"
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <MapPin size={13} color="var(--accent, #2ecc71)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.hotspot_name || 'Hotspot Point'}
            </span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 19 }}>
            Click to locate on map
          </div>
        </div>

        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '.06em',
            padding: '3px 8px',
            borderRadius: 6,
            background: item.status === 'acknowledged' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(59, 130, 246, 0.12)',
            color: item.status === 'acknowledged' ? '#10b981' : '#2563eb',
            border: `1px solid ${item.status === 'acknowledged' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
            flexShrink: 0
          }}
        >
          {item.status}
        </span>
      </div>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        fontSize: 11,
        color: 'var(--text-muted)',
        background: 'var(--surface-2, #f8fafc)',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid var(--border, #e2e8f0)',
        marginBottom: 10
      }}>
        {type === 'dispatch' ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700, color: 'var(--text)' }}>
            <Truck size={13} color="#2563eb" />
            {item.truck_plate ? `Truck: ${item.truck_plate}` : 'Unassigned Truck'}
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 700, color: 'var(--text)' }}>
            <User size={13} color="#f59e0b" />
            Flagged by {item.created_by_name || 'System'}
          </span>
        )}

        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          <Calendar size={11} />
          {new Date(item.created_at).toLocaleDateString()}
        </span>
      </div>

      {showNotes && (
        <div onClick={e => e.stopPropagation()} style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: 4 }}>
            Resolution Notes
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Enter resolution notes, collection volume or verification info (optional)..."
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 12,
              borderRadius: 8,
              border: '1px solid var(--border, #cbd5e1)',
              background: 'var(--surface-2, #ffffff)',
              color: 'var(--text)',
              resize: 'vertical',
              boxSizing: 'border-box',
              outline: 'none',
              fontFamily: 'inherit'
            }}
            rows={2}
          />
        </div>
      )}

      {showConfirmCancel && (
        <div onClick={e => e.stopPropagation()} style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 10,
          padding: '8px 12px',
          background: 'rgba(239, 68, 68, 0.08)',
          borderRadius: 8,
          border: '1px solid rgba(239, 68, 68, 0.3)'
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444' }}>
            Confirm cancellation of this task?
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              disabled={cancelling}
              onClick={async () => {
                setCancelling(true)
                try {
                  await onAction(item.id, 'cancel')
                } finally {
                  setCancelling(false)
                  setShowConfirmCancel(false)
                }
              }}
              style={{
                background: '#ef4444',
                border: 'none',
                color: '#ffffff',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {cancelling ? 'Cancelling...' : 'Confirm'}
            </button>
            <button
              disabled={cancelling}
              onClick={() => setShowConfirmCancel(false)}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
        {item.status !== 'acknowledged' && (
          <button
            onClick={() => onAction(item.id, 'acknowledge')}
            style={actionBtnStyle('#2563eb', 'rgba(37, 99, 235, 0.08)', 'rgba(37, 99, 235, 0.3)')}
          >
            <Check size={12} strokeWidth={2.5} /> Acknowledge
          </button>
        )}

        <button
          onClick={handleResolve}
          disabled={submitting}
          style={actionBtnStyle('#10b981', 'rgba(16, 185, 129, 0.08)', 'rgba(16, 185, 129, 0.3)')}
        >
          <CheckCircle2 size={12} />
          {showNotes ? 'Confirm Complete' : (type === 'dispatch' ? 'Mark Collected' : 'Mark Resolved')}
        </button>

        {showNotes ? (
          <button
            onClick={() => setShowNotes(false)}
            style={actionBtnStyle('var(--text-muted)', 'transparent', 'var(--border)')}
          >
            Cancel
          </button>
        ) : (
          !showConfirmCancel && (
            <button
              onClick={() => setShowConfirmCancel(true)}
              style={actionBtnStyle('#ef4444', 'rgba(239, 68, 68, 0.06)', 'rgba(239, 68, 68, 0.25)')}
            >
              <XCircle size={12} /> Cancel Task
            </button>
          )
        )}
      </div>
    </div>
  )
}

function actionBtnStyle(color, bg, border) {
  return {
    background: bg,
    border: `1px solid ${border}`,
    color,
    borderRadius: 8,
    padding: '6px 11px',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontFamily: 'inherit',
    transition: 'all 0.15s ease'
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

  const dispatchCount = dispatches.items.length
  const flagCount = flags.items.length

  return (
    <>
      <style>{`
        @keyframes drawerSlideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes drawerBackdropFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .intervention-drawer-panel {
          animation: drawerSlideIn 0.26s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .intervention-backdrop {
          animation: drawerBackdropFade 0.2s ease-out both;
        }
        .intervention-card-hover:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 14px rgba(0,0,0,0.06) !important;
          border-color: rgba(46,204,113,0.4) !important;
        }
      `}</style>

      {/* Backdrop */}
      <div
        className="intervention-backdrop"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 9997,
        }}
      />

      {/* Drawer Container */}
      <div
        className="intervention-drawer-panel"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '92%',
          maxWidth: 440,
          zIndex: 9998,
          background: 'var(--surface, #ffffff)',
          borderLeft: '1px solid var(--border, #e2e8f0)',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 20px',
          borderBottom: '1px solid var(--border, #e2e8f0)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--surface, #ffffff)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(46,204,113,0.12)', color: 'var(--accent, #2ecc71)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Activity size={16} />
              </div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
                Action Progress
              </h3>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
              Active truck dispatches and barangay escalations
            </p>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'var(--surface-2, rgba(0,0,0,0.04))',
              border: '1px solid var(--border, #e2e8f0)',
              borderRadius: 8,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              transition: 'all 0.15s ease'
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '12px 20px',
          borderBottom: '1px solid var(--border, #e2e8f0)',
          background: 'var(--surface-2, #f8fafc)'
        }}>
          <button
            onClick={() => setTab('dispatch')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 10,
              border: `1.5px solid ${tab === 'dispatch' ? 'var(--accent, #2ecc71)' : 'var(--border, #e2e8f0)'}`,
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              background: tab === 'dispatch' ? 'var(--surface, #ffffff)' : 'transparent',
              color: tab === 'dispatch' ? 'var(--text)' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              boxShadow: tab === 'dispatch' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Truck size={14} color={tab === 'dispatch' ? '#2563eb' : 'currentColor'} />
            Dispatches
            <span style={{
              background: tab === 'dispatch' ? '#2563eb' : 'var(--surface-3, rgba(0,0,0,0.08))',
              color: tab === 'dispatch' ? '#ffffff' : 'var(--text-muted)',
              padding: '1px 6px',
              borderRadius: 12,
              fontSize: 10,
              fontWeight: 800
            }}>
              {dispatchCount}
            </span>
          </button>

          <button
            onClick={() => setTab('flag')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 10,
              border: `1.5px solid ${tab === 'flag' ? 'var(--accent, #2ecc71)' : 'var(--border, #e2e8f0)'}`,
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              background: tab === 'flag' ? 'var(--surface, #ffffff)' : 'transparent',
              color: tab === 'flag' ? 'var(--text)' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              boxShadow: tab === 'flag' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <ShieldAlert size={14} color={tab === 'flag' ? '#f59e0b' : 'currentColor'} />
            Barangay Flags
            <span style={{
              background: tab === 'flag' ? '#f59e0b' : 'var(--surface-3, rgba(0,0,0,0.08))',
              color: tab === 'flag' ? '#ffffff' : 'var(--text-muted)',
              padding: '1px 6px',
              borderRadius: 12,
              fontSize: 10,
              fontWeight: 800
            }}>
              {flagCount}
            </span>
          </button>
        </div>

        {/* List Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {active.loading && active.items.length === 0 ? (
            <FeedCardSkeleton count={3} compact />
          ) : active.items.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '48px 20px',
              color: 'var(--text-muted)',
              background: 'var(--surface-2, rgba(0,0,0,0.02))',
              borderRadius: 16,
              border: '1px dashed var(--border, #e2e8f0)',
              marginTop: 10
            }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'rgba(16, 185, 129, 0.1)',
                color: '#10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px'
              }}>
                <CheckCircle2 size={24} />
              </div>
              <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>
                {tab === 'dispatch' ? 'No Pending Dispatches' : 'No Active Barangay Flags'}
              </div>
              <div style={{ fontSize: 12, maxWidth: 260, margin: '0 auto' }}>
                {tab === 'dispatch'
                  ? 'All truck work orders have been resolved or acknowledged.'
                  : 'No unresolved hotspot alerts currently flagged to barangay officials.'}
              </div>
            </div>
          ) : (
            columns.map(col => {
              const rows = active.items.filter(i => i.status === col.key)
              if (rows.length === 0) return null
              return (
                <div key={col.key} style={{ marginBottom: 20 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 10,
                    fontWeight: 800,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '.06em',
                    marginBottom: 10
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: col.badgeColor }} />
                    {col.label}
                    <span style={{
                      background: col.badgeBg,
                      color: col.badgeColor,
                      padding: '1px 7px',
                      borderRadius: 10,
                      fontSize: 10
                    }}>
                      {rows.length}
                    </span>
                  </div>

                  {rows.map(item => (
                    <InterventionCard
                      key={item.id}
                      item={item}
                      type={tab}
                      onAction={handleAction}
                      onFlyTo={onFlyTo}
                    />
                  ))}
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}

