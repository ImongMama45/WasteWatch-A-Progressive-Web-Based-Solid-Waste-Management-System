/**
 * ArticleDetailModal.jsx
 * ----------------------
 * Accessible modal displaying full article details with deep-linking support.
 * Light-Themed Municipal Editorial layout for Lucena City CENRO Public Information Hub.
 * Features:
 * - Decoupled Category, Content Type, Priority, and Pinned badges.
 * - Estimated reading time and Philippine locale publication dates.
 * - In-flight skeleton loading state for seamless deep-link transitions.
 * - Canonical share URL generation via buildArticleShareUrl.
 * - Focus trapping (Tab cycling), initial focus management, and focus restoration.
 * - React state-managed image loading and error fallback without DOM mutations.
 * - Zero emojis. Lucide SVG icons only.
 */

import { useState, useEffect, useRef } from 'react'
import {
  X,
  Calendar,
  MapPin,
  Pin,
  Share2,
  Check,
  AlertCircle,
  Clock,
  Info,
} from 'lucide-react'
import {
  CATEGORY_CONFIG,
  TYPE_CONFIG,
  PRIORITY_CONFIG,
  getCategoryLabel,
  calculateReadingTime,
} from '../utils/newsConfig'
import { buildArticleShareUrl } from '../utils/newsUtils'
import { useModal } from '../../../hooks/useModal'
import './ArticleDetailModal.css'

export default function ArticleDetailModal({
  item,
  notFound = false,
  loading = false,
  onClose,
}) {
  const [copied, setCopied] = useState(false)
  const [shareFallbackUrl, setShareFallbackUrl] = useState(null)
  const [imgError, setImgError] = useState(false)

  const mouseDownTargetRef = useRef(null)
  const modalRef = useRef(null)
  const closeBtnRef = useRef(null)
  const triggerRef = useRef(null)

  const isOpen = Boolean(item || notFound || loading)

  // Body scroll locking and Escape key handling via existing hook
  useModal(isOpen, onClose)

  // Reset image error state whenever the active article ID changes
  useEffect(() => {
    setImgError(false)
    setCopied(false)
    setShareFallbackUrl(null)
  }, [item?.id])

  // Focus capture, trapping, and restoration
  useEffect(() => {
    if (!isOpen) return

    // Save active element that triggered the modal for restoration
    triggerRef.current = document.activeElement

    // Move initial focus to the close button inside modal
    const focusTimer = setTimeout(() => {
      closeBtnRef.current?.focus()
    }, 40)

    function handleTabKey(e) {
      if (e.key !== 'Tab' || !modalRef.current) return

      const focusableElements = modalRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElements.length === 0) return

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }

    window.addEventListener('keydown', handleTabKey)

    return () => {
      clearTimeout(focusTimer)
      window.removeEventListener('keydown', handleTabKey)
      // Restore focus to the element that triggered the modal if still in DOM
      if (triggerRef.current && typeof triggerRef.current.focus === 'function') {
        try {
          triggerRef.current.focus()
        } catch { }
      }
    }
  }, [isOpen])

  if (!isOpen) return null

  // 1. Not Found / Unavailable State
  if (notFound) {
    return (
      <div
        className="adm-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="article-not-found-title"
        onMouseDown={e => { mouseDownTargetRef.current = e.target }}
        onClick={e => {
          if (mouseDownTargetRef.current === e.currentTarget && e.target === e.currentTarget) {
            onClose?.()
          }
        }}
      >
        <div ref={modalRef} className="adm-notfound-card">
          <div className="adm-notfound-icon-wrap">
            <AlertCircle size={24} strokeWidth={2.2} />
          </div>

          <h2 id="article-not-found-title" className="adm-notfound-title">
            Notice Unavailable
          </h2>

          <p className="adm-notfound-text">
            This notice is unavailable or may have been removed.
          </p>

          <button
            ref={closeBtnRef}
            type="button"
            className="adm-notfound-close-btn"
            onClick={onClose}
            aria-label="Close notice dialog"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  // 2. In-Flight Skeleton Loading State
  if (loading && !item) {
    return (
      <div
        className="adm-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="article-loading-title"
        onMouseDown={e => { mouseDownTargetRef.current = e.target }}
        onClick={e => {
          if (mouseDownTargetRef.current === e.currentTarget && e.target === e.currentTarget) {
            onClose?.()
          }
        }}
      >
        <div ref={modalRef} className="adm-modal-window" aria-busy="true">
          <div className="adm-header-bar">
            <div className="adm-badge-stack">
              <div className="adm-skeleton-pulse" style={{ width: 90, height: 22, borderRadius: 9999 }} />
              <div className="adm-skeleton-pulse" style={{ width: 70, height: 22, borderRadius: 9999 }} />
            </div>

            <div className="adm-header-actions">
              <button
                ref={closeBtnRef}
                type="button"
                className="adm-close-btn"
                onClick={onClose}
                aria-label="Close loading dialog"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="adm-scroll-body">
            <div className="adm-skeleton-pulse adm-skeleton-media" />
            <div className="adm-skeleton-pulse adm-skeleton-title-1" />
            <div className="adm-skeleton-pulse adm-skeleton-title-2" />
            <div className="adm-skeleton-pulse adm-skeleton-meta" />
            <div className="adm-skeleton-pulse adm-skeleton-p1" />
            <div className="adm-skeleton-pulse adm-skeleton-p2" />
            <div className="adm-skeleton-pulse adm-skeleton-p3" />
            <div className="adm-skeleton-pulse adm-skeleton-p4" />
          </div>
        </div>
      </div>
    )
  }

  // 3. Fully Resolved Article Presentation
  // Decoupled metadata configuration
  const rawCategory = item?.category || 'General'
  const categoryLabel = getCategoryLabel(rawCategory)
  const catCfg = CATEGORY_CONFIG[rawCategory] || CATEGORY_CONFIG[categoryLabel] || CATEGORY_CONFIG.General
  const CategoryIcon = catCfg?.Icon || Info

  const type = item?.type || 'news'
  const typeCfg = TYPE_CONFIG[type] || TYPE_CONFIG.news
  const TypeIcon = typeCfg?.Icon || Info

  const priority = item?.priority || 'low'
  const pCfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.low
  const hasPriorityBadge = priority === 'high' || priority === 'medium'

  const isPinned = Boolean(item?.is_pinned ?? item?.isPinned)

  const readingTime = calculateReadingTime(item?.description || item?.body)

  const brgyName =
    item?.barangay_name ||
    (typeof item?.barangay === 'string' ? item.barangay : null) ||
    (item?.barangay && typeof item.barangay === 'object' ? item.barangay.name : null) ||
    'City-Wide'

  const formattedDate = (() => {
    try {
      if (!item?.date) return ''
      return new Date(item.date).toLocaleDateString('en-PH', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return item?.date || ''
    }
  })()

  const imageUrl = item?.image_url || (typeof item?.image === 'string' ? item.image : null)

  const rawDescription = String(item?.description || item?.body || '').trim()

  async function handleShare() {
    const shareUrl = buildArticleShareUrl(item?.id)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl)
        setCopied(true)
        setShareFallbackUrl(null)
        setTimeout(() => setCopied(false), 2200)
      } else {
        const input = document.createElement('input')
        input.value = shareUrl
        document.body.appendChild(input)
        input.select()
        const success = document.execCommand('copy')
        document.body.removeChild(input)
        if (success) {
          setCopied(true)
          setShareFallbackUrl(null)
          setTimeout(() => setCopied(false), 2200)
        } else {
          setShareFallbackUrl(shareUrl)
        }
      }
    } catch {
      setShareFallbackUrl(shareUrl)
    }
  }

  return (
    <div
      className="adm-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="article-modal-title"
      onMouseDown={e => { mouseDownTargetRef.current = e.target }}
      onClick={e => {
        if (mouseDownTargetRef.current === e.currentTarget && e.target === e.currentTarget) {
          onClose?.()
        }
      }}
    >
      <div ref={modalRef} className="adm-modal-window">
        {/* Sticky Header with Decoupled Badges and Actions */}
        <div className="adm-header-bar">
          <div className="adm-badge-stack">
            {/* 1. Category Badge */}
            <span
              className="adm-pill"
              style={{
                background: catCfg.bg,
                color: catCfg.color,
                border: `1px solid ${catCfg.border}`,
              }}
            >
              <CategoryIcon size={12} strokeWidth={2.4} />
              {categoryLabel}
            </span>

            {/* 2. Content Type Badge (if distinct from category) */}
            {type !== 'news' && (
              <span
                className="adm-pill"
                style={{
                  background: typeCfg.badgeBg,
                  color: typeCfg.badgeColor,
                  border: `1px solid ${typeCfg.badgeBorder}`,
                }}
              >
                <TypeIcon size={12} strokeWidth={2.4} />
                {typeCfg.label}
              </span>
            )}

            {/* 3. Priority Badge (High / Med) */}
            {hasPriorityBadge && (
              <span
                className="adm-pill"
                style={{
                  background: pCfg.bg,
                  color: pCfg.color,
                  border: `1px solid ${pCfg.border}`,
                }}
              >
                {pCfg.label}
              </span>
            )}

            {/* 4. Pinned Status Badge */}
            {isPinned && (
              <span className="adm-pill adm-pill-pinned">
                <Pin size={11} strokeWidth={2.4} />
                Pinned
              </span>
            )}
          </div>

          <div className="adm-header-actions">
            <button
              type="button"
              className={`adm-share-btn ${copied ? 'copied' : ''}`}
              onClick={handleShare}
              title="Copy canonical notice link"
              aria-label="Copy canonical notice link"
            >
              {copied ? <Check size={14} strokeWidth={2.5} /> : <Share2 size={14} strokeWidth={2} />}
              {copied ? 'Link Copied' : 'Share'}
            </button>

            <button
              ref={closeBtnRef}
              type="button"
              className="adm-close-btn"
              onClick={onClose}
              title="Close notice dialog"
              aria-label="Close notice dialog"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Fallback Drawer for Manual Link Copying */}
        {shareFallbackUrl && (
          <div className="adm-fallback-drawer">
            <div className="adm-fallback-label">Copy link manually:</div>
            <input
              readOnly
              value={shareFallbackUrl}
              onFocus={e => e.target.select()}
              className="adm-fallback-input"
              autoFocus
            />
          </div>
        )}

        {/* Scrollable Content Area */}
        <div className="adm-scroll-body">
          {/* Cover Media Slot */}
          {imageUrl && !imgError && (
            <div className="adm-media-frame">
              <img
                src={imageUrl}
                alt=""
                className="adm-media-img"
                onError={() => setImgError(true)}
              />
            </div>
          )}

          {/* Title */}
          <h1 id="article-modal-title" className="adm-title">
            {item?.title || 'Notice'}
          </h1>

          {/* Publication Metadata Bar */}
          <div className="adm-meta-bar">
            {formattedDate && (
              <span className="adm-meta-item">
                <Calendar size={13} strokeWidth={2} />
                {formattedDate}
              </span>
            )}

            <span className="adm-meta-item">
              <MapPin size={13} strokeWidth={2} />
              {brgyName}
            </span>

            {readingTime && (
              <span className="adm-meta-item">
                <Clock size={13} strokeWidth={2} />
                {readingTime}
              </span>
            )}
          </div>

          {/* Body Content */}
          <div className="adm-content-text">
            {rawDescription ? (
              rawDescription
            ) : (
              <p className="adm-empty-desc">
                No additional details provided for this announcement.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
