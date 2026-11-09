/**
 * NewsCard.jsx
 * -------------
 * Community editorial card with rich typography, standardized 160px media slot,
 * graceful fallback banner, decoupled category/type/priority badges, accessible controls,
 * and zero emojis.
 */

import { useState } from 'react'
import { MapPin, Calendar, ChevronRight, Pin, Clock, ShieldAlert } from 'lucide-react'
import {
  PRIORITY_CONFIG,
  CATEGORY_CONFIG,
  getCategoryLabel,
  calculateReadingTime,
} from '../utils/newsConfig'
import { resolveCardAccentPrecedence } from '../utils/newsUtils'
import './NewsCard.css'

export default function NewsCard({ item, onReadMore, style = {}, animDelay = 0 }) {
  const [imgError, setImgError] = useState(false)

  if (!item) return null

  // 1. Decoupled Category, Content Type, Priority, and Pinning
  const type = item.type || 'news'
  const rawCategory = item.category || 'General'
  const categoryLabel = getCategoryLabel(rawCategory)
  const catCfg = CATEGORY_CONFIG[rawCategory] || CATEGORY_CONFIG[categoryLabel] || CATEGORY_CONFIG.General
  const CategoryIcon = catCfg?.Icon || catCfg?.icon

  const pCfg = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.low
  const isHighPriority = item.priority === 'high'
  const isMedPriority = item.priority === 'medium'
  const isPinned = Boolean(item.is_pinned ?? item.isPinned)
  const isEmergencyType = type === 'emergency'

  // 2. Primary Visual Accent Precedence (Emergency > High Priority > Pinned > Standard)
  const accent = resolveCardAccentPrecedence(item)

  // 3. Estimated Reading Time (null if < 15 words)
  const readingTime = calculateReadingTime(item.description)

  // 4. Formatted Philippine Date
  const formattedDate = (() => {
    try {
      if (!item.date) return ''
      return new Date(item.date).toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return item.date || ''
    }
  })()

  // 5. Barangay Location Name
  const brgyName =
    item.barangay_name ||
    (typeof item.barangay === 'string' ? item.barangay : null) ||
    (item.barangay && typeof item.barangay === 'object' ? item.barangay.name : null) ||
    'City-Wide'

  const imageUrl = item.image_url || (typeof item.image === 'string' ? item.image : null)

  function handleReadMore() {
    onReadMore?.(item)
  }

  function handleCardClick(e) {
    // If the click originated from an interactive element like a button, let the button handle it
    if (e.target && e.target.closest('button')) {
      return
    }
    handleReadMore()
  }

  return (
    <article
      aria-labelledby={`nc-title-${item.id}`}
      onClick={handleCardClick}
      className={`nc-editorial-card nc-accent-${accent.accent}`}
      style={{
        animationDelay: `${animDelay}ms`,
        ...style,
      }}
    >
      {/* Cover Image or Standardized 160px Fallback Eco-Banner */}
      {imageUrl && !imgError ? (
        <div className="nc-media-wrap">
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="nc-media-img"
            onError={() => setImgError(true)}
          />
        </div>
      ) : (
        <div className="nc-fallback-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, zIndex: 1 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: '#ffffff',
                border: `1px solid ${catCfg?.border || '#bbf7d0'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: catCfg?.color || '#16a34a',
                boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
              }}
            >
              {CategoryIcon && <CategoryIcon size={18} strokeWidth={2} />}
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  color: catCfg?.color || '#16a34a',
                }}
              >
                {categoryLabel}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>
                Lucena City Public Information
              </div>
            </div>
          </div>
          <div className="nc-fallback-watermark">
            {CategoryIcon && <CategoryIcon size={96} strokeWidth={1} />}
          </div>
        </div>
      )}

      {/* Body Content */}
      <div className="nc-body-content">
        {/* Badges strip: Category (subject) + Type + Pinned on Left; Urgency on Right */}
        <div className="nc-badges-strip">
          <div className="nc-badges-left">
            {/* Subject Category tag */}
            <span
              className="nc-badge-pill"
              style={{
                background: catCfg?.bg || 'rgba(22,163,74,.08)',
                color: catCfg?.color || '#16a34a',
                border: `1px solid ${catCfg?.border || 'rgba(22,163,74,.2)'}`,
              }}
            >
              {CategoryIcon && <CategoryIcon size={11} strokeWidth={2.5} />}
              {categoryLabel}
            </span>

            {/* Emergency Type Indicator (when type === 'emergency' distinct from subject category) */}
            {isEmergencyType && (
              <span
                className="nc-badge-pill"
                style={{
                  background: '#fee2e2',
                  color: '#dc2626',
                  border: '1px solid #fca5a5',
                }}
              >
                <ShieldAlert size={11} strokeWidth={2.5} />
                Emergency
              </span>
            )}

            {/* Editorial Pinned badge */}
            {isPinned && (
              <span
                className="nc-badge-pill"
                style={{
                  background: 'rgba(22,163,74,.1)',
                  color: '#16a34a',
                  border: '1px solid rgba(22,163,74,.25)',
                }}
              >
                <Pin size={10} strokeWidth={2.5} />
                Pinned
              </span>
            )}
          </div>

          {/* Urgency Priority Chip */}
          {(isHighPriority || isMedPriority) && (
            <span
              className="nc-priority-chip"
              style={{
                background: pCfg.bg,
                color: pCfg.color,
                border: `1px solid ${pCfg.border}`,
              }}
            >
              {pCfg.label}
            </span>
          )}
        </div>

        {/* Title — Clamped at 2 lines visually, full title preserved via title attribute and DOM text */}
        <h3
          id={`nc-title-${item.id}`}
          title={item.title}
          className="nc-card-title"
        >
          {item.title}
        </h3>

        {/* Description — Clamped at 3 lines */}
        <p className="nc-card-desc">
          {item.description || item.body || ''}
        </p>

        {/* Footer Meta Row */}
        <div className="nc-card-footer">
          <div className="nc-meta-group">
            {formattedDate && (
              <span className="nc-meta-item">
                <Calendar size={12} strokeWidth={2} />
                {formattedDate}
              </span>
            )}

            <span className="nc-meta-item">
              <MapPin size={12} strokeWidth={2} />
              {brgyName}
            </span>

            {readingTime && (
              <span className="nc-meta-item">
                <Clock size={12} strokeWidth={2} />
                {readingTime}
              </span>
            )}
          </div>

          {/* Genuine Accessible Button */}
          <button
            type="button"
            className="nc-action-btn"
            onClick={handleReadMore}
            aria-label={`Read full notice: ${item.title}`}
          >
            <span>Read Notice</span>
            <ChevronRight size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </article>
  )
}
