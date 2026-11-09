import { X, AlertTriangle } from 'lucide-react'
import { useModal } from '../../../hooks/useModal'

export default function DeleteConfirmModal({
  isOpen = false,
  item = null,
  onClose,
  onConfirm,
  deleting = false,
}) {
  useModal(isOpen, onClose)

  if (!isOpen || !item) return null

  return (
    <div className="workspace-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
      <div className="workspace-modal" style={{ maxWidth: '440px' }}>
        <div className="workspace-modal-header" style={{ borderBottomColor: '#fecaca' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={20} color="#dc2626" />
            <h2 id="delete-dialog-title" className="workspace-modal-title" style={{ color: '#991b1b', fontSize: '1.1rem' }}>
              Confirm Permanent Deletion
            </h2>
          </div>
          <button
            type="button"
            className="workspace-modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div className="workspace-modal-body">
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#334155', lineHeight: 1.5 }}>
            Are you sure you want to permanently delete{' '}
            <strong style={{ color: '#0f172a' }}>"{item.title}"</strong>?
          </p>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
            This action cannot be undone. Public readers will immediately lose access to this notice.
          </p>
        </div>

        <div className="workspace-modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => onConfirm(item)}
            disabled={deleting}
            data-testid="btn-confirm-delete"
          >
            {deleting ? 'Deleting...' : 'Delete Permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}
