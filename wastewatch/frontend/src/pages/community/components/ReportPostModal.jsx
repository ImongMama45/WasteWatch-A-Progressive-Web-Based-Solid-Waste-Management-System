/**
 * ReportPostModal.jsx
 * -------------------
 * Citizen moderation reporting modal. Allows users to report inappropriate posts
 * to city administrators.
 * No emojis. Lucide icons only.
 */

import { useState } from 'react'
import { ShieldAlert, X, AlertCircle, CheckCircle2 } from 'lucide-react'

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or Commercial Advertisement' },
  { value: 'offensive', label: 'Inappropriate or Offensive Language' },
  { value: 'misinformation', label: 'False or Misleading Information' },
  { value: 'harassment', label: 'Harassment or Personal Attack' },
  { value: 'other', label: 'Other Waste Management Concern' },
]

export default function ReportPostModal({ post, onClose, onSubmit }) {
  const [reason, setReason] = useState('spam')
  const [details, setDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState(null)

  if (!post) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const res = await onSubmit(post.id, reason, details)
    setSubmitting(false)
    if (res.success) {
      setSubmitted(true)
      setTimeout(() => {
        onClose()
      }, 1600)
    } else {
      setError(res.error || 'Failed to submit report. Please try again.')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: 16,
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 16,
          width: '100%',
          maxWidth: 480,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          animation: 'fadeIn 0.18s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#fafafa',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#fee2e2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#dc2626',
              }}
            >
              <ShieldAlert size={18} strokeWidth={2.2} />
            </div>
            <div>
              <h3 id="report-modal-title" style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                Report Post
              </h3>
              <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
                Help keep Lucena City discussions constructive and respectful
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close report dialog"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 6,
              cursor: 'pointer',
              color: '#64748b',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: 22 }}>
          {submitted ? (
            <div style={{ textAlign: 'center', padding: '24px 8px' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: '#dcfce7',
                  color: '#16a34a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 14px',
                }}
              >
                <CheckCircle2 size={28} />
              </div>
              <h4 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 6px' }}>
                Report Submitted
              </h4>
              <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
                Thank you. City moderators have been notified and will review this content.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {error && (
                <div
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: 8,
                    padding: '10px 14px',
                    marginBottom: 16,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: '#b91c1c',
                    fontSize: 13,
                  }}
                >
                  <AlertCircle size={16} style={{ flexShrink: 0 }} />
                  <span>{error}</span>
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: 8,
                  }}
                >
                  Select a reason:
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {REPORT_REASONS.map(r => (
                    <label
                      key={r.value}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '9px 12px',
                        borderRadius: 8,
                        border: reason === r.value ? '1.5px solid #16a34a' : '1px solid #e2e8f0',
                        background: reason === r.value ? '#f0fdf4' : '#ffffff',
                        cursor: 'pointer',
                        fontSize: 13,
                        color: reason === r.value ? '#15803d' : '#334155',
                        fontWeight: reason === r.value ? 600 : 400,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <input
                        type="radio"
                        name="reportReason"
                        value={r.value}
                        checked={reason === r.value}
                        onChange={(e) => setReason(e.target.value)}
                        style={{ accentColor: '#16a34a' }}
                      />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label
                  htmlFor="report-details"
                  style={{
                    display: 'block',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: 6,
                  }}
                >
                  Additional details (optional):
                </label>
                <textarea
                  id="report-details"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Provide context for our review team..."
                  rows={3}
                  maxLength={500}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#475569',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: '8px 18px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#dc2626',
                    color: '#ffffff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  {submitting ? 'Submitting...' : 'Submit Report'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
