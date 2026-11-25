import React, { useState, useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export default function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary', // 'primary' | 'danger' | 'warning'
  requireNotes = false,
  notesLabel = 'Notes / Reason',
  notesPlaceholder = 'Enter audit or resolution notes...',
  defaultNotes = '',
  submitting = false,
  onConfirm,
  onCancel,
  children = null,
}) {
  const [notes, setNotes] = useState(defaultNotes)
  const [notesError, setNotesError] = useState('')

  useEffect(() => {
    if (open) {
      setNotes(defaultNotes || '')
      setNotesError('')
    }
  }, [open, defaultNotes])

  if (!open) return null

  const tone =
    variant === 'danger'
      ? { bg: '#fee2e2', color: '#b91c1c', btnBg: '#dc2626' }
      : variant === 'warning'
      ? { bg: '#fef3c7', color: '#b45309', btnBg: '#d97706' }
      : { bg: '#e7f5eb', color: '#15803d', btnBg: '#16a34a' }

  const handleConfirm = (e) => {
    e.preventDefault()
    if (requireNotes && !notes.trim()) {
      setNotesError('Please enter required notes before continuing.')
      return
    }
    setNotesError('')
    onConfirm(notes.trim())
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2500,
        background: 'rgba(0,0,0,0.48)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={() => !submitting && onCancel && onCancel()}
    >
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e4e6eb',
          borderRadius: 10,
          width: '100%',
          maxWidth: 460,
          padding: '20px 22px',
          boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                background: tone.bg,
                color: tone.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <AlertTriangle size={20} />
            </div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#1c1e21' }}>{title}</h3>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            style={{
              background: 'none',
              border: 'none',
              color: '#65676b',
              cursor: submitting ? 'not-allowed' : 'pointer',
              padding: 4,
              display: 'flex',
            }}
            aria-label="Close confirmation dialog"
          >
            <X size={18} />
          </button>
        </div>

        {description && (
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#4b5563', lineHeight: 1.5 }}>
            {description}
          </p>
        )}

        <form onSubmit={handleConfirm}>
          {children}

          {(requireNotes || notesLabel) && (requireNotes || defaultNotes !== undefined) && (
            <div style={{ marginBottom: 14 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#65676b',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: 6,
                }}
              >
                {notesLabel} {requireNotes ? '*' : '(optional)'}
              </label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value)
                  if (notesError) setNotesError('')
                }}
                placeholder={notesPlaceholder}
                style={{
                  width: '100%',
                  borderRadius: 6,
                  border: `1px solid ${notesError ? '#dc2626' : '#ced0d4'}`,
                  padding: '8px 10px',
                  fontSize: 13,
                  color: '#1c1e21',
                  background: '#ffffff',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
              {notesError && (
                <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4, fontWeight: 600 }}>
                  {notesError}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 10, borderTop: '1px solid #e4e6eb' }}>
            <button
              type="button"
              disabled={submitting}
              onClick={onCancel}
              style={{
                height: 36,
                padding: '0 16px',
                borderRadius: 6,
                border: '1px solid #ced0d4',
                background: '#ffffff',
                color: '#1c1e21',
                fontSize: 13,
                fontWeight: 600,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                height: 36,
                padding: '0 18px',
                borderRadius: 6,
                border: 'none',
                background: tone.btnBg,
                color: '#ffffff',
                fontSize: 13,
                fontWeight: 600,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'Processing...' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
