/**
 * BarangaySpotlight.jsx
 * ----------------------
 * Displays cleanest barangay rankings and environmental achievements.
 * Shows reporting period, methodology, and data source.
 * When data is unavailable, renders an honest official CENRO integration card.
 * Zero emojis.
 */

import { Award, TrendingUp, TrendingDown, Minus, Trophy, ShieldCheck, BarChart3 } from 'lucide-react'
import { Link } from 'react-router-dom'

const ICON_MAP = {
  award: Award,
  trophy: Trophy,
  'trending-up': TrendingUp,
}

export default function BarangaySpotlight({ items = [] }) {
  return (
    <section
      aria-label="Cleanest barangay rankings and environmental achievements"
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        padding: '22px 24px',
        marginBottom: 24,
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 16,
          paddingBottom: 16,
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: '#fef3c7',
              border: '1px solid #fde68a',
              color: '#d97706',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Trophy size={20} strokeWidth={2.2} />
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: '#d97706',
                marginBottom: 2,
              }}
            >
              Barangay Environmental Standings
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0f172a', margin: 0 }}>
              Cleanest Barangay Rankings &amp; Environmental Standings
            </h3>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b' }}>
          <BarChart3 size={14} strokeWidth={2.2} style={{ color: '#16a34a' }} />
          <span>Published Standings</span>
        </div>
      </div>

      {/* Information notice */}
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 16,
          fontSize: 12,
          color: '#475569',
          lineHeight: 1.5,
        }}
      >
        <strong>Performance Overview:</strong> Standings reflect published solid waste segregation and collection compliance records for participating barangays in Lucena City.
      </div>

      {/* Spotlights or Honest Empty State */}
      {items.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {items.map((item, idx) => {
            const Icon = ICON_MAP[item.icon] || Award
            const brgyName =
              typeof item.barangay === 'object' && item.barangay
                ? item.barangay.name
                : item.barangay_name || item.barangay || 'Barangay'

            const score = item.score ?? 0
            const isTop = idx === 0
            const trendUp = item.trend === 'up'
            const trendDown = item.trend === 'down'

            return (
              <div
                key={item.id || idx}
                style={{
                  background: isTop ? '#f0fdf4' : '#ffffff',
                  border: isTop ? '1px solid #86efac' : '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        background: isTop ? '#16a34a' : '#f1f5f9',
                        color: isTop ? '#ffffff' : '#475569',
                        fontSize: 12,
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      #{idx + 1}
                    </div>
                    <div>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                        {brgyName}
                      </h4>
                      <div style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>
                        {item.achievement}
                      </div>
                    </div>
                  </div>

                  {/* Score */}
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#16a34a', lineHeight: 1 }}>
                      {score}%
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                      Compliance
                    </div>
                  </div>
                </div>

                {item.description && (
                  <p style={{ fontSize: 12, color: '#475569', margin: 0, lineHeight: 1.45 }}>
                    {item.description}
                  </p>
                )}

                {item.improvement && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      color: trendUp ? '#16a34a' : trendDown ? '#dc2626' : '#64748b',
                      marginTop: 'auto',
                    }}
                  >
                    {trendUp ? (
                      <TrendingUp size={13} strokeWidth={2.5} />
                    ) : trendDown ? (
                      <TrendingDown size={13} strokeWidth={2.5} />
                    ) : (
                      <Minus size={13} strokeWidth={2} />
                    )}
                    <span>{item.improvement} recorded progress</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '24px 20px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: '#f1f5f9',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 10px',
            }}
          >
            <BarChart3 size={22} strokeWidth={1.8} />
          </div>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: '0 0 4px 0' }}>
            Evaluations in Progress
          </h4>
          <p style={{ fontSize: 12, color: '#64748b', maxWidth: 460, margin: '0 auto 12px', lineHeight: 1.5 }}>
            Barangay cleanliness and waste management standings will appear here once updated evaluation records are published.
          </p>
          <Link
            to="/analytics"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              color: '#16a34a',
              textDecoration: 'none',
            }}
          >
            View Live WasteWatch Analytics &rarr;
          </Link>
        </div>
      )}
    </section>
  )
}
