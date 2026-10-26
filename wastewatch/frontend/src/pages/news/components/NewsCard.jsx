/**
 * NewsCard.jsx
 * -------------
 * Three card variants: news | announcement | emergency
 * Uses Lucide React icons. Matches .card design system.
 * Zero emojis.
 */

import { MapPin, Calendar, ChevronRight, Pin } from 'lucide-react'
import { TYPE_CONFIG, PRIORITY_CONFIG } from '../utils/newsConfig'

// ─── Animated card CSS injected once ─────────────────────────────────────────
const CSS = `
@keyframes nc-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
.nc-card { 
  transition: all .3s cubic-bezier(0.25, 0.8, 0.25, 1); 
  animation: nc-in .4s cubic-bezier(0.16, 1, 0.3, 1) both; 
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(46,125,50,0.03);
}
.nc-card:hover { 
  box-shadow: 0 12px 30px rgba(46,125,50,0.08); 
  transform: translateY(-3px); 
  border-color: rgba(46,204,113,.4) !important;
}
.nc-read-btn { transition: all .2s; }
.nc-card:hover .nc-read-btn { color: var(--accent) !important; gap: 6px !important; }
`
let _injected = false
function inject() {
  if (_injected) return; _injected = true
  const el = document.createElement('style'); el.textContent = CSS; document.head.appendChild(el)
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function NewsCard({ item, onReadMore, style = {}, animDelay = 0 }) {
  inject()
  const type     = item.type || 'news'
  const cfg      = TYPE_CONFIG[type] || TYPE_CONFIG.news
  const pCfg     = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.low
  const { Icon } = cfg

  const formattedDate = (() => {
    try {
      return new Date(item.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return item.date }
  })()

  const brgyName = item.barangay_name || (typeof item.barangay === 'string' ? item.barangay : null)
  const isPinned = Boolean(item.is_pinned ?? item.isPinned)
  const imageUrl = item.image_url || (typeof item.image === 'string' ? item.image : null)

  function handleClick() {
    onReadMore?.(item)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onReadMore?.(item)
    }
  }

  return (
    <div
      role="article"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="nc-card"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: type === 'emergency' ? `4px solid #e74c3c` : type === 'announcement' ? `4px solid var(--accent)` : `1px solid var(--border)`,
        borderRadius: '16px',
        padding: '18px 22px',
        animationDelay: `${animDelay}ms`,
        outline: 'none',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {/* Top row — icon + badges */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Type badge */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 9, fontWeight: 800, letterSpacing: '.08em',
            textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20,
            background: cfg.badgeBg, color: cfg.badgeColor,
            border: `1px solid ${cfg.badgeBorder}`,
          }}>
            <Icon size={10} strokeWidth={2.5} />
            {item.category || cfg.label}
          </span>
          {/* Pinned badge */}
          {isPinned && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 9, fontWeight: 700, letterSpacing: '.06em',
              padding: '2px 7px', borderRadius: 20,
              background: 'rgba(46,204,113,.08)', color: 'var(--accent)',
              border: '1px solid rgba(46,204,113,.25)',
            }}>
              <Pin size={9} strokeWidth={2.5} />
              Pinned
            </span>
          )}
        </div>
        {/* Priority */}
        <span style={{
          fontSize: 8, fontWeight: 800, letterSpacing: '.07em',
          padding: '2px 7px', borderRadius: 20, flexShrink: 0,
          background: pCfg.bg, color: pCfg.color,
          border: `1px solid ${pCfg.border}`,
        }}>
          {pCfg.label}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flex: 1 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title */}
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', lineHeight: 1.3, marginBottom: 6 }}>
            {item.title}
          </div>

          {/* Body */}
          <div style={{
            fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12,
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {item.description || item.body}
          </div>
        </div>

        {/* Thumbnail preview if available */}
        {imageUrl && (
          <div style={{
            width: 80, height: 70, borderRadius: 10, overflow: 'hidden',
            flexShrink: 0, border: '1px solid var(--border)',
          }}>
            <img
              src={imageUrl}
              alt=""
              onError={e => { e.currentTarget.parentElement.style.display = 'none' }}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
        )}
      </div>

      {/* Meta row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Date */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
            <Calendar size={11} strokeWidth={2} />
            {formattedDate}
          </span>
          {/* Barangay */}
          {brgyName && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
              <MapPin size={11} strokeWidth={2} />
              {brgyName}
            </span>
          )}
        </div>
        {/* Read more visual CTA */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="nc-read-btn"
          onClick={(e) => {
            e.stopPropagation()
            handleClick()
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 3,
            fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-body)', padding: 0,
          }}
        >
          Read More
          <ChevronRight size={13} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}
