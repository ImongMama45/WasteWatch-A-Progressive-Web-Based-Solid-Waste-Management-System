/**
 * NewsHeader.jsx
 * --------------
 * Official public information masthead for Lucena City CENRO.
 * Displays municipal identity, localized Philippine date (Asia/Manila),
 * and role-gated Administrative actions.
 * Zero emojis. Material / Lucide SVG icons only.
 */

import { Building2, Calendar, PlusCircle } from 'lucide-react'

export default function NewsHeader({
  isAdmin = false,
  onCreateNotice,
}) {
  const currentDateStr = new Date().toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <header
      className="nh-masthead"
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        padding: '16px 20px',
        marginBottom: 20,
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 480px', minWidth: 0 }}>
          {/* Municipal Agency & Date Eyebrow */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              marginBottom: 6,
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: '#15803d',
              }}
            >
              <Building2 size={13} strokeWidth={2.4} />
              <span>Lucena City CENRO</span>
            </div>

            <span style={{ color: '#cbd5e1', fontSize: 12 }}>·</span>

            {/* Localized Date */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11.5,
                fontWeight: 600,
                color: '#64748b',
              }}
            >
              <Calendar size={12} strokeWidth={2.2} style={{ color: '#059669' }} />
              <span>{currentDateStr}</span>
            </div>
          </div>

          {/* Main Title */}
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: '#0f172a',
              margin: '0 0 4px 0',
              letterSpacing: '-0.02em',
              lineHeight: 1.28,
            }}
          >
            Lucena City CENRO Public Information Hub
          </h1>

          {/* Subtitle */}
          <p
            style={{
              fontSize: 13,
              color: '#64748b',
              margin: 0,
              maxWidth: 720,
              lineHeight: 1.5,
            }}
          >
            The official municipal information portal for solid waste management advisories,
            environmental programs, schedule updates, and community cleanliness standings.
          </p>
        </div>

        {/* Action Controls */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {/* Admin Create Notice Action */}
          {isAdmin && (
            <button
              type="button"
              onClick={onCreateNotice}
              aria-label="Create a new official announcement"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '7px 14px',
                borderRadius: 8,
                background: '#16a34a',
                color: '#ffffff',
                border: '1px solid #15803d',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(22,163,74,0.2)',
                transition: 'background .15s, transform .15s',
                minHeight: 36,
              }}
            >
              <PlusCircle size={14} strokeWidth={2.4} />
              <span>Create Notice</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

