import { AlertTriangle, CheckCircle2, XCircle, Trash2, Archive, RotateCcw, CheckSquare, Bell } from 'lucide-react'
import { useModal } from '../../../hooks/useModal'

const ACTION_CONFIGS = {
  publish: {
    title: 'Publish Municipal Event',
    icon: <CheckCircle2 size={24} color="#16a34a" />,
    confirmLabel: 'Confirm & Publish',
    confirmBg: '#16a34a',
    message: 'Are you sure you want to publish this event? It will become publicly visible across the WasteWatch portal.',
    notifyWarning: 'Publishing will broadcast a municipal notification to all targeted residents and barangay officials.',
  },
  cancel: {
    title: 'Cancel Municipal Event',
    icon: <XCircle size={24} color="#dc2626" />,
    confirmLabel: 'Confirm Cancellation',
    confirmBg: '#dc2626',
    message: 'Are you sure you want to cancel this event? The event will be visibly flagged as Cancelled.',
    notifyWarning: 'A cancellation notice will be broadcast to all targeted residents and barangay officials.',
  },
  complete: {
    title: 'Mark Event as Completed',
    icon: <CheckSquare size={24} color="#0284c7" />,
    confirmLabel: 'Mark Completed',
    confirmBg: '#0284c7',
    message: 'Are you sure you want to mark this event as completed? It will be preserved for historical records.',
    notifyWarning: null,
  },
  archive: {
    title: 'Archive Municipal Event',
    icon: <Archive size={24} color="#64748b" />,
    confirmLabel: 'Archive Event',
    confirmBg: '#475569',
    message: 'Are you sure you want to archive this event? It will be removed from ordinary public visibility and kept for administrative reference.',
    notifyWarning: null,
  },
  restore: {
    title: 'Restore Event to Draft',
    icon: <RotateCcw size={24} color="#d97706" />,
    confirmLabel: 'Restore to Draft',
    confirmBg: '#d97706',
    message: 'Are you sure you want to restore this event to Draft status? It will be private to administrators until re-published.',
    notifyWarning: null,
  },
  delete: {
    title: 'Permanently Delete Event',
    icon: <Trash2 size={24} color="#dc2626" />,
    confirmLabel: 'Delete Permanently',
    confirmBg: '#dc2626',
    message: 'Are you sure you want to permanently delete this event? This action cannot be undone.',
    notifyWarning: null,
  },
}

export default function EventActionConfirmModal({
  isOpen = false,
  actionType = 'delete', // 'publish' | 'cancel' | 'complete' | 'archive' | 'restore' | 'delete'
  event = null,
  onClose,
  onConfirm,
  loading = false,
}) {
  useModal(isOpen, onClose)

  if (!isOpen || !event) return null

  const config = ACTION_CONFIGS[actionType] || ACTION_CONFIGS.delete

  return (
    <div
      className="event-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      data-testid="event-confirm-modal"
    >
      <div className="event-modal-card" style={{ maxWidth: 480 }}>
        <div className="event-modal-body" style={{ padding: '24px', textAlign: 'center' }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 12px',
            }}
          >
            {config.icon}
          </div>

          <h3 id="confirm-modal-title" style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>
            {config.title}
          </h3>

          <div
            style={{
              background: '#f1f5f9',
              padding: '10px 14px',
              borderRadius: '8px',
              margin: '0 0 14px',
              fontWeight: 600,
              fontSize: '0.9rem',
              color: '#1e293b',
            }}
          >
            {event.title}
          </div>

          <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '0 0 16px', lineHeight: 1.5 }}>
            {config.message}
          </p>

          {config.notifyWarning && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#b45309',
                fontSize: '0.8rem',
                textAlign: 'left',
                lineHeight: 1.4,
              }}
            >
              <Bell size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{config.notifyWarning}</span>
            </div>
          )}
        </div>

        <div className="event-modal-footer">
          <button
            type="button"
            className="btn-refresh-event"
            onClick={onClose}
            disabled={loading}
            data-testid="cancel-action-confirm-btn"
          >
            Cancel
          </button>
          <button
            type="button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 18px',
              borderRadius: '8px',
              backgroundColor: config.confirmBg,
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: 600,
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
            onClick={onConfirm}
            disabled={loading}
            data-testid="confirm-action-submit-btn"
          >
            {loading ? 'Processing...' : config.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
