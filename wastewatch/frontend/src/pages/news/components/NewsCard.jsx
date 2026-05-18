/**
 * NewsCard.jsx
 * -------------
 * Three card variants: news | announcement | emergency
 * Uses Lucide React icons. Matches .card design system.
 */

import { Newspaper, Megaphone, AlertTriangle, MapPin, Calendar, ChevronRight, Pin } from 'lucide-react'

// ─── Config ───────────────────────────────────────────────────────────────────
const TYPE_CONFIG = {
  emergency: {
    Icon: AlertTriangle,
    badgeColor: 'var(--danger)',
    badgeBg: 'rgba(231,76,60,.08)',
    badgeBorder: 'rgba(231,76,60,.25)',
    accentBorder: 'rgba(231,76,60,.4)',
    label: 'Emergency',
  },
  announcement: {
    Icon: Megaphone,
    badgeColor: 'var(--info)',
    badgeBg: 'rgba(93,173,226,.08)',
    badgeBorder: 'rgba(93,173,226,.25)',
    accentBorder: 'rgba(93,173,226,.3)',
    label: 'Announcement',
  },
  news: {
    Icon: Newspaper,
    badgeColor: 'var(--text-muted)',
    badgeBg: 'rgba(0,0,0,.04)',
    badgeBorder: 'var(--border)',
    accentBorder: 'var(--border)',
    label: 'News',
  },
}

const PRIORITY_CONFIG = {
  high:   { label: 'HIGH',   color: 'var(--danger)',  bg: 'rgba(231,76,60,.08)',  border: 'rgba(231,76,60,.2)'  },
  medium: { label: 'MED',    color: 'var(--warning)', bg: 'rgba(243,156,18,.08)', border: 'rgba(243,156,18,.2)' },
  low:    { label: 'LOW',    color: 'var(--text-muted)', bg: 'rgba(0,0,0,.04)', border: 'var(--border)' },
}

// ─── Animated card CSS injected once ─────────────────────────────────────────
const CSS = `
@keyframes nc-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
.nc-card { transition: box-shadow .2s, transform .15s; animation: nc-in .2s ease both; }
.nc-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,.08); transform: translateY(-1px); }
.nc-read-btn { transition: color .15s, gap .15s; }
.nc-read-btn:hover { color: var(--accent) !important; }
`
let _injected = false
function inject() {
  if (_injected) return; _injected = true
  const el = document.createElement('style'); el.textContent = CSS; document.head.appendChild(el)
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function NewsCard({ item, style = {}, animDelay = 0 }) {
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

  return (
    <div
      className="nc-card"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${cfg.accentBorder}`,
        borderLeft: type === 'emergency' ? `4px solid var(--danger)` : `1px solid ${cfg.accentBorder}`,
        borderRadius: 'var(--radius)',
        padding: '14px 16px',
        animationDelay: `${animDelay}ms`,
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
          {item.isPinned && (
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

      {/* Title */}
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', lineHeight: 1.3, marginBottom: 6 }}>
        {item.title}
      </div>

      {/* Body */}
      <div style={{
        fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12,
        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {item.description}
      </div>

      {/* Meta row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Date */}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}>
            <Calendar size={11} strokeWidth={2} />
            {formattedDate}
          </span>
          {/* Barangay */}
          {item.barangay && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-muted)' }}>
              <MapPin size={11} strokeWidth={2} />
              {item.barangay}
            </span>
          )}
        </div>
        {/* Read more */}
        <button className="nc-read-btn" style={{
          display: 'flex', alignItems: 'center', gap: 3,
          fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'var(--font-body)', padding: 0,
        }}>
          Read More
          <ChevronRight size={13} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}
