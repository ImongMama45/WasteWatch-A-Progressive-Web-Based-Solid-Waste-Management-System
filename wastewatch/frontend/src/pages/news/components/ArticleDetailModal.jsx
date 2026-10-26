/**
 * ArticleDetailModal.jsx
 * ----------------------
 * Accessible modal displaying full article details with deep-linking support.
 * Uses shared newsConfig and useModal hook for body scroll locking.
 * Material / Lucide icons only. Zero emojis.
 */

import { useState } from 'react'
import {
  X,
  Calendar,
  MapPin,
  Pin,
  Share2,
  Check,
  AlertCircle,
} from 'lucide-react'
import { TYPE_CONFIG } from '../utils/newsConfig'
import { useModal } from '../../../hooks/useModal'

export default function ArticleDetailModal({ item, notFound = false, onClose }) {
  const [copied, setCopied] = useState(false)
  const isOpen = Boolean(item || notFound)

  useModal(isOpen, onClose)

  if (!isOpen) return null

  // Not Found State
  if (notFound) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="article-not-found-title"
        onClick={e => e.target === e.currentTarget && onClose?.()}
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
            background: 'var(--surface)',
            borderRadius: '16px',
            padding: '28px',
            maxWidth: 420,
            width: '100%',
            boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
            border: '1px solid var(--border)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(231,76,60,0.1)',
              color: '#e74c3c',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 14px',
            }}
          >
            <AlertCircle size={22} strokeWidth={2} />
          </div>

          <h2
            id="article-not-found-title"
            style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px', color: 'var(--text)' }}
          >
            Article Not Available
          </h2>

          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 20px' }}>
            This article is no longer available or may have been removed.
          </p>

          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
            style={{ width: '100%' }}
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  const type = item.type || 'news'
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.news
  const { Icon } = cfg

  const brgyName =
    item.barangay_name ||
    (typeof item.barangay === 'string' ? item.barangay : null) ||
    (item.barangay && typeof item.barangay === 'object' ? item.barangay.name : null) ||
    'City-Wide'

  const formattedDate = (() => {
    try {
      return new Date(item.date).toLocaleDateString('en-PH', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return item.date
    }
  })()

  const imageUrl = item.image_url || (typeof item.image === 'string' ? item.image : null)
  const isPinned = Boolean(item.is_pinned ?? item.isPinned)

  async function handleShare() {
    const shareUrl = `${window.location.origin}/announcements?article=${item.id}`
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
      setTimeout(() => setCopied(false), 2200)
    } catch {
      // Fallback silent fail
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="article-modal-title"
      onClick={e => e.target === e.currentTarget && onClose?.()}
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
          background: 'var(--surface)',
          borderRadius: '16px',
          width: '100%',
          maxWidth: 680,
          maxHeight: '88vh',
          overflowY: 'auto',
          boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        {/* Sticky Header with Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            position: 'sticky',
            top: 0,
            background: 'var(--surface)',
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
                background: cfg.badgeBg,
                color: cfg.badgeColor,
                border: `1px solid ${cfg.badgeBorder}`,
              }}
            >
              <Icon size={12} strokeWidth={2.5} />
              {item.category || cfg.label}
            </span>

            {isPinned && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 20,
                  background: 'rgba(46,204,113,.1)',
                  color: 'var(--accent)',
                  border: '1px solid rgba(46,204,113,.25)',
                }}
              >
                <Pin size={11} strokeWidth={2.5} />
                Pinned
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={handleShare}
              title="Share article link"
              aria-label="Share article link"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 11px',
                borderRadius: 8,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: copied ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'inherit',
                transition: 'all .15s',
              }}
            >
              {copied ? <Check size={14} strokeWidth={2.5} /> : <Share2 size={14} strokeWidth={2} />}
              {copied ? 'Link Copied' : 'Share'}
            </button>

            <button
              type="button"
              onClick={onClose}
              title="Close"
              aria-label="Close"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                padding: 4,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content Container */}
        <div style={{ padding: '22px 24px' }}>
          {/* Cover image if available */}
          {imageUrl && (
            <div
              style={{
                marginBottom: 18,
                borderRadius: 12,
                overflow: 'hidden',
                maxHeight: 300,
                border: '1px solid var(--border)',
              }}
            >
              <img
                src={imageUrl}
                alt={item.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
          )}

          {/* Title */}
          <h1
            id="article-modal-title"
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: 'var(--text)',
              lineHeight: 1.3,
              margin: '0 0 12px 0',
            }}
          >
            {item.title}
          </h1>

          {/* Meta Info Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
              fontSize: 12,
              color: 'var(--text-muted)',
              paddingBottom: 14,
              borderBottom: '1px solid var(--border)',
              marginBottom: 18,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Calendar size={13} strokeWidth={2} />
              {formattedDate}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <MapPin size={13} strokeWidth={2} />
              {brgyName}
            </span>
          </div>

          {/* Body Content */}
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: 'var(--text)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {item.description || item.body || ''}
          </div>
        </div>
      </div>
    </div>
  )
}
