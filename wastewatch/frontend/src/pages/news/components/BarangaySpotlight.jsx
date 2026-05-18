/**
 * BarangaySpotlight.jsx
 * ----------------------
 * Section showcasing top-performing barangays.
 * Eco-themed cards with Lucide icons.
 */

import { Award, TrendingUp, Users, ArrowUpRight } from 'lucide-react'
import { BARANGAY_SPOTLIGHTS } from '../data/newsData'

const ICON_MAP = { award: Award, 'trending-up': TrendingUp, users: Users }

const ACCENT_COLORS = [
  { color: '#f59e0b', bg: 'rgba(245,158,11,.08)', border: 'rgba(245,158,11,.25)' },
  { color: 'var(--accent)', bg: 'rgba(46,204,113,.08)', border: 'rgba(46,204,113,.25)' },
  { color: 'var(--info)', bg: 'rgba(93,173,226,.08)', border: 'rgba(93,173,226,.25)' },
]

export default function BarangaySpotlight({ items = BARANGAY_SPOTLIGHTS }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Award size={18} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div>
          <div className="section-title" style={{ margin: 0, fontSize: 16 }}>Barangay Spotlight</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Outstanding communities for {new Date().toLocaleString('en-PH', { month: 'long', year: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item, i) => {
          const { color, bg, border } = ACCENT_COLORS[i % ACCENT_COLORS.length]
          const Icon = ICON_MAP[item.icon] || Award
          const scoreColor =
            item.score >= 90 ? 'var(--accent)' :
            item.score >= 80 ? 'var(--warning)' : 'var(--text-muted)'

          return (
            <div key={item.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '12px 14px',
              background: bg,
              border: `1px solid ${border}`,
              borderLeft: `4px solid ${color}`,
              borderRadius: 'var(--radius)',
            }}>
              {/* Icon bubble */}
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                background: 'var(--surface)', border: `1px solid ${border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: color,
              }}>
                <Icon size={18} strokeWidth={2} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Achievement badge */}
                <div style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '.08em',
                  textTransform: 'uppercase', color: color, marginBottom: 3,
                }}>
                  {item.achievement}
                </div>
                {/* Barangay name */}
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>
                  {item.barangay}
                </div>
                {/* Description */}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 8 }}>
                  {item.description}
                </div>
                {/* Score + improvement */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* Score */}
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    background: 'var(--surface)', borderRadius: 8, padding: '5px 10px',
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontWeight: 800, fontSize: 18, color: scoreColor, lineHeight: 1 }}>
                      {item.score}%
                    </div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.05em', marginTop: 1 }}>
                      COMPLIANCE
                    </div>
                  </div>
                  {/* Improvement */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <ArrowUpRight size={14} strokeWidth={2.5} style={{ color: 'var(--accent)' }} />
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>
                      {item.improvement}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>this month</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
