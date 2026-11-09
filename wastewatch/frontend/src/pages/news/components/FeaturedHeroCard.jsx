/**
 * FeaturedHeroCard.jsx
 * --------------------
 * Prominent editorial hero card for the primary featured city announcement.
 * Utilizes selectFeaturedAnnouncement priority: featured > pinned > high-priority.
 * Deduplicated from the regular NewsFeed.
 * Zero emojis. Material / Lucide SVG icons only.
 */

import { useState } from 'react'
import {
  Sparkles,
  Pin,
  AlertCircle,
  Calendar,
  MapPin,
  Clock,
  ArrowRight,
  Building2,
  Megaphone,
} from 'lucide-react'
import {
  calculateReadingTime,
  getCategoryLabel,
  CATEGORY_CONFIG,
} from '../utils/newsConfig'

export default function FeaturedHeroCard({ item, onReadMore }) {
  const rawImageUrl = item?.image_url || (typeof item?.image === 'string' ? item?.image : null) || null
  const currentKey = item ? `${item.id}:${rawImageUrl}` : ''
  const [prevKey, setPrevKey] = useState(currentKey)
  const [imgError, setImgError] = useState(false)

  // Reset image-error state synchronously when hero identity or image URL changes
  if (currentKey !== prevKey) {
    setPrevKey(currentKey)
    setImgError(false)
  }

  // Clean omission if no eligible hero announcement exists
  if (!item) return null

  const isFeatured = Boolean(item.is_featured)
  const isPinned = Boolean(item.is_pinned)
  const isHighPriority = item.priority === 'high'

  const priorityBadge = isFeatured
    ? {
        label: 'Featured Announcement',
        Icon: Sparkles,
        color: '#16a34a',
        bg: '#f0fdf4',
        border: '#bbf7d0',
      }
    : isPinned
    ? {
        label: 'Pinned Advisory',
        Icon: Pin,
        color: '#0284c7',
        bg: '#f0f9ff',
        border: '#bae6fd',
      }
    : isHighPriority
    ? {
        label: 'Urgent Notice',
        Icon: AlertCircle,
        color: '#d97706',
        bg: '#fffbeb',
        border: '#fde68a',
      }
    : {
        label: 'City Notice',
        Icon: Megaphone,
        color: '#475569',
        bg: '#f8fafc',
        border: '#e2e8f0',
      }

  const categoryLabel = getCategoryLabel(item.category)
  const catCfg = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG[categoryLabel] || CATEGORY_CONFIG.All
  const CategoryIcon = catCfg?.Icon || Megaphone

  const formattedDate = (() => {
    try {
      if (!item.date) return null
      return new Date(item.date).toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return item.date
    }
  })()

  const brgyName =
    item.barangay_name ||
    (typeof item.barangay === 'string' ? item.barangay : null) ||
    (item.barangay && typeof item.barangay === 'object' ? item.barangay.name : null) ||
    'City-Wide'

  const descriptionText = item.description || item.body || ''
  const readDuration = calculateReadingTime(descriptionText)
  const imageUrl = (!imgError && (item.image_url || (typeof item.image === 'string' ? item.image : null))) || null

  const PriorityIcon = priorityBadge.Icon

  return (
    <article
      className="fhc-hero-root"
      aria-label={`Featured: ${item.title}`}
      style={{
        background: '#ffffff',
        border: '1px solid #cbd5e1',
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: 24,
        boxShadow: '0 4px 16px -2px rgba(15, 23, 42, 0.06)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: imageUrl ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr',
          minHeight: 260,
        }}
      >
        {/* Main Content Column */}
        <div
          style={{
            padding: '24px 28px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div>
            {/* Metadata Badge Row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                marginBottom: 12,
              }}
            >
              {/* Priority / Tier Distinction */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '.06em',
                  textTransform: 'uppercase',
                  color: priorityBadge.color,
                  background: priorityBadge.bg,
                  border: `1px solid ${priorityBadge.border}`,
                  padding: '3px 9px',
                  borderRadius: 20,
                }}
              >
                <PriorityIcon size={12} strokeWidth={2.4} />
                <span>{priorityBadge.label}</span>
              </span>

              {/* Category Badge */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '.05em',
                  textTransform: 'uppercase',
                  color: catCfg?.color || '#16a34a',
                  background: catCfg?.bg || 'rgba(22,163,74,.08)',
                  border: `1px solid ${catCfg?.border || 'rgba(22,163,74,.2)'}`,
                  padding: '3px 9px',
                  borderRadius: 20,
                }}
              >
                <CategoryIcon size={11} strokeWidth={2.2} />
                <span>{categoryLabel}</span>
              </span>

              {/* Barangay Target */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#64748b',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  padding: '3px 8px',
                  borderRadius: 20,
                }}
              >
                <MapPin size={11} strokeWidth={2.2} />
                <span>{brgyName}</span>
              </span>
            </div>

            {/* Hero Title */}
            <h2
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: '#0f172a',
                lineHeight: 1.35,
                margin: '0 0 10px 0',
                letterSpacing: '-0.015em',
              }}
            >
              {item.title}
            </h2>

            {/* Description Excerpt */}
            {descriptionText && (
              <p
                style={{
                  fontSize: 13,
                  color: '#475569',
                  lineHeight: 1.6,
                  margin: 0,
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {descriptionText}
              </p>
            )}
          </div>

          {/* Footer Metadata & CTA */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              paddingTop: 14,
              borderTop: '1px solid #f1f5f9',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {formattedDate && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    color: '#64748b',
                    fontWeight: 600,
                  }}
                >
                  <Calendar size={12} strokeWidth={2} />
                  <span>{formattedDate}</span>
                </span>
              )}

              {readDuration && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    color: '#64748b',
                    fontWeight: 600,
                  }}
                >
                  <Clock size={12} strokeWidth={2} />
                  <span>{readDuration}</span>
                </span>
              )}
            </div>

            {/* Read Article Action */}
            <button
              type="button"
              onClick={() => onReadMore?.(item)}
              aria-label={`Read full announcement: ${item.title}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 9,
                background: '#16a34a',
                color: '#ffffff',
                border: 'none',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'background .15s, transform .15s',
                boxShadow: '0 2px 6px rgba(22,163,74,0.2)',
              }}
            >
              <span>Read Full Notice</span>
              <ArrowRight size={13} strokeWidth={2.4} />
            </button>
          </div>
        </div>

        {/* Media Column (Image or Municipal Graphic Fallback) */}
        {imageUrl ? (
          <div
            style={{
              position: 'relative',
              background: '#0f172a',
              minHeight: 220,
              overflow: 'hidden',
            }}
          >
            <img
              src={imageUrl}
              alt={item.title || 'Featured municipal announcement'}
              onError={() => setImgError(true)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          </div>
        ) : (
          <div
            style={{
              background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 50%, #e0f2fe 100%)',
              borderLeft: '1px solid #e2e8f0',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              position: 'relative',
              minHeight: 180,
            }}
          >
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: 14,
                background: '#ffffff',
                border: '1px solid #bbf7d0',
                color: '#16a34a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(22,163,74,0.12)',
                marginBottom: 12,
              }}
            >
              <Building2 size={28} strokeWidth={2} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
              Lucena City CENRO
            </div>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
              Official Municipal Communication
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

