/**
 * EmergencyAlertDetailModal.jsx
 * -----------------------------
 * Accessible dialog presenting complete municipal emergency advisory details.
 * Keyed via ?alert=<id> to guarantee complete isolation from ArticleDetailModal (?article=<id>).
 * Respects strict data restrictions: only renders actual database fields (title, body, date).
 * Zero emojis. Material / Lucide SVG icons only.
 */

import { useState, useRef } from 'react'
import {
  X,
  Calendar,
  ShieldAlert,
  Share2,
  Check,
  AlertCircle,
} from 'lucide-react'
import { useModal } from '../../../hooks/useModal'

export default function EmergencyAlertDetailModal({ alert, notFound = false, onClose }) {
  const [copied, setCopied] = useState(false)
  const [shareFallbackUrl, setShareFallbackUrl] = useState(null)
  const mouseDownTargetRef = useRef(null)
  const isOpen = Boolean(alert || notFound)

  useModal(isOpen, onClose)

  if (!isOpen) return null

  // 1. Unavailable / Inactive State
  if (notFound) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-not-found-title"
        onMouseDown={e => { mouseDownTargetRef.current = e.target }}
        onClick={e => {
          if (mouseDownTargetRef.current === e.currentTarget && e.target === e.currentTarget) {
            onClose?.()
          }
        }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 20,
        }}
      >
        <div
          style={{
            background: 'var(--surface, #ffffff)',
            borderRadius: '16px',
            padding: '28px',
            maxWidth: 420,
            width: '100%',
            boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
            border: '1px solid var(--border, #e2e8f0)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: '#fee2e2',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 14px',
            }}
          >
            <AlertCircle size={22} strokeWidth={2.2} />
          </div>

          <h2
            id="alert-not-found-title"
            style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px', color: '#0f172a' }}
          >
            Advisory Not Available
          </h2>

          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5, margin: '0 0 20px' }}>
            This advisory is unavailable or is no longer active.
          </p>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: '100%',
              padding: '10px 16px',
              borderRadius: 8,
              background: '#0f172a',
              color: '#ffffff',
              border: 'none',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  // 2. Active Emergency Alert Detail Presentation
  const formattedDate = (() => {
    try {
      if (!alert.date) return ''
      return new Date(alert.date).toLocaleDateString('en-PH', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return alert.date || ''
    }
  })()

  async function handleShare() {
    const shareUrl = `${window.location.origin}/announcements?alert=${alert.id}`
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl)
      } else {
        const input = document.createElement('input')
        input.value = shareUrl
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        document.body.removeChild(input)
      }
      setCopied(true)
      setShareFallbackUrl(null)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      setShareFallbackUrl(shareUrl)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-alert-title"
      onMouseDown={e => { mouseDownTargetRef.current = e.target }}
      onClick={e => {
        if (mouseDownTargetRef.current === e.currentTarget && e.target === e.currentTarget) {
          onClose?.()
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 20,
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: 620,
          maxHeight: '88vh',
          overflowY: 'auto',
          boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
          border: '1px solid #fecaca',
          borderLeft: '5px solid #dc2626',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        {/* Sticky Header with Status and Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid #fee2e2',
            position: 'sticky',
            top: 0,
            background: '#fff1f2',
            zIndex: 2,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '.07em',
                textTransform: 'uppercase',
                padding: '3px 9px',
                borderRadius: 20,
                background: '#fee2e2',
                color: '#dc2626',
                border: '1px solid #fca5a5',
              }}
            >
              <ShieldAlert size={12} strokeWidth={2.5} />
              Public Emergency Advisory
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={handleShare}
              title="Share advisory link"
              aria-label="Share advisory link"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 11px',
                borderRadius: 8,
                background: '#ffffff',
                border: '1px solid #fecaca',
                fontSize: 12,
                fontWeight: 700,
                color: copied ? '#15803d' : '#991b1b',
                cursor: 'pointer',
                transition: 'all .15s ease',
              }}
            >
              {copied ? <Check size={13} strokeWidth={2.5} /> : <Share2 size={13} strokeWidth={2.2} />}
              <span>{copied ? 'Copied' : 'Share'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close emergency advisory"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#ffffff',
                border: '1px solid #fecaca',
                color: '#991b1b',
                cursor: 'pointer',
              }}
            >
              <X size={16} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        {/* Fallback share URL box */}
        {shareFallbackUrl && (
          <div style={{ padding: '10px 20px', background: '#fef2f2', borderBottom: '1px solid #fee2e2' }}>
            <div style={{ fontSize: 11, color: '#991b1b', marginBottom: 4, fontWeight: 600 }}>
              Copy advisory link:
            </div>
            <input
              readOnly
              value={shareFallbackUrl}
              onFocus={e => e.target.select()}
              style={{
                width: '100%',
                fontSize: 12,
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid #fca5a5',
                background: '#ffffff',
                color: '#991b1b',
              }}
              autoFocus
            />
          </div>
        )}

        {/* Advisory Body Container */}
        <div style={{ padding: '24px' }}>
          {/* Title */}
          <h1
            id="emergency-alert-title"
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: '#991b1b',
              lineHeight: 1.3,
              margin: '0 0 10px 0',
            }}
          >
            {alert.title}
          </h1>

          {/* Meta Bar */}
          {formattedDate && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: '#64748b',
                paddingBottom: 14,
                borderBottom: '1px solid #f1f5f9',
                marginBottom: 18,
              }}
            >
              <Calendar size={13} strokeWidth={2} />
              <span>Published on {formattedDate}</span>
            </div>
          )}

          {/* Advisory Content with preserved paragraph breaks */}
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: '#1e293b',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {alert.body}
          </div>
        </div>
      </div>
    </div>
  )
}
