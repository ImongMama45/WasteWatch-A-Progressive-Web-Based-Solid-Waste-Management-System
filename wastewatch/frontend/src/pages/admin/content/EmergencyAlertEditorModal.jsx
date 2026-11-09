import { useState, useEffect } from 'react'
import { X, ShieldAlert, AlertTriangle } from 'lucide-react'
import { useModal } from '../../../hooks/useModal'

export default function EmergencyAlertEditorModal({
  isOpen = false,
  alert = null,
  onClose,
  onSave,
  saving = false,
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [errors, setErrors] = useState({})

  useModal(isOpen, onClose)

  useEffect(() => {
    if (alert) {
      setTitle(alert.title || '')
      setBody(alert.body || '')
      setIsActive(Boolean(alert.is_active))
    } else {
      setTitle('')
      setBody('')
      setIsActive(true)
    }
    setErrors({})
  }, [alert, isOpen])

  if (!isOpen) return null

  const validate = () => {
    const newErrors = {}
    if (!title.trim()) {
      newErrors.title = 'Alert title is required'
    } else if (title.trim().length < 5) {
      newErrors.title = 'Title must be at least 5 characters'
    }

    if (!body.trim()) {
      newErrors.body = 'Emergency advisory body instructions are required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return

    onSave(
      {
        title: title.trim(),
        body: body.trim(),
        is_active: isActive,
      },
      alert?.id
    )
  }

  return (
    <div className="workspace-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="alert-modal-title">
      <div className="workspace-modal" style={{ maxWidth: '580px' }}>
        {/* Header */}
        <div className="workspace-modal-header" style={{ borderBottomColor: '#fecaca' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={20} color="#dc2626" />
            <h2 id="alert-modal-title" className="workspace-modal-title" style={{ color: '#991b1b' }}>
              {alert ? 'Edit Emergency Advisory' : 'Create Emergency Advisory'}
            </h2>
          </div>
          <button
            type="button"
            className="workspace-modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="workspace-modal-body">
          <div
            style={{
              padding: '12px 14px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
            }}
          >
            <AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: '2px' }} />
            <p style={{ margin: 0, fontSize: '0.825rem', color: '#991b1b', lineHeight: 1.45 }}>
              Active advisories immediately appear across the top of public feeds and trigger system-wide citizen alerts.
            </p>
          </div>

          {/* Title */}
          <div className="form-group">
            <label className="form-label" htmlFor="alert-title">
              Advisory Title <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              id="alert-title"
              type="text"
              className="form-input"
              placeholder="e.g., Severe Weather Advisory: Heavy Rainfall and Flash Flood Warning"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-alert-title"
            />
            {errors.title && (
              <span style={{ fontSize: '0.785rem', color: '#dc2626' }}>{errors.title}</span>
            )}
          </div>

          {/* Body */}
          <div className="form-group">
            <label className="form-label" htmlFor="alert-body">
              Advisory Instructions & Directives <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea
              id="alert-body"
              className="form-textarea"
              rows={5}
              placeholder="Detail safety protocols, collection suspensions, or emergency shelter instructions..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              data-testid="textarea-alert-body"
            />
            {errors.body && (
              <span style={{ fontSize: '0.785rem', color: '#dc2626' }}>{errors.body}</span>
            )}
          </div>

          {/* Active Broadcast Switch */}
          <div className="form-switch-row">
            <label className="switch-label">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                data-testid="checkbox-alert-active"
              />
              <span style={{ fontWeight: 600, color: isActive ? '#dc2626' : '#64748b' }}>
                {isActive ? 'Broadcast Active (Publicly Visible)' : 'Inactive / Draft Only'}
              </span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="workspace-modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={handleSubmit}
            disabled={saving}
            data-testid="btn-save-alert"
          >
            {saving ? 'Saving...' : alert ? 'Save Changes' : 'Broadcast Advisory'}
          </button>
        </div>
      </div>
    </div>
  )
}
