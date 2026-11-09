/**
 * NewsHeader.jsx
 * --------------
 * Official public information masthead for Lucena City CENRO.
 * Displays municipal identity, localized Philippine date (Asia/Manila),
 * and role-gated Administrative actions.
 * Zero emojis. Material / Lucide SVG icons only.
 */

import { Building2, Calendar, RefreshCw, PlusCircle } from 'lucide-react'

export default function NewsHeader({
  isAdmin = false,
  onCreateNotice,
  onRefresh,
  isRefreshing = false,
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
        borderRadius: 16,
        padding: '24px 28px',
        marginBottom: 24,
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 500px', minWidth: 0 }}>
          {/* Municipal Eyebrow / Badges */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              marginBottom: 10,
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                color: '#16a34a',
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                padding: '3px 10px',
                borderRadius: 20,
              }}
            >
              <Building2 size={13} strokeWidth={2.2} />
              <span>Lucena City CENRO</span>
            </div>

            {/* Localized Date Badge */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
                color: '#64748b',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                padding: '3px 10px',
                borderRadius: 20,
              }}
            >
              <Calendar size={12} strokeWidth={2.2} style={{ color: '#059669' }} />
              <span>{currentDateStr}</span>
            </div>
          </div>

          {/* Main Title */}
          <h1
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: '#0f172a',
              margin: '0 0 6px 0',
              letterSpacing: '-0.02em',
              lineHeight: 1.25,
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
              lineHeight: 1.55,
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
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          {/* Refresh Action */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label="Refresh notices"
            title="Refresh announcements and active advisories"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 14px',
              borderRadius: 10,
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              color: '#475569',
              fontSize: 12,
              fontWeight: 700,
              cursor: isRefreshing ? 'default' : 'pointer',
              transition: 'background .15s, border-color .15s',
              minHeight: 40,
            }}
          >
            <RefreshCw
              size={14}
              strokeWidth={2.2}
              style={{
                animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
              }}
            />
            <span>{isRefreshing ? 'Updating…' : 'Refresh'}</span>
          </button>

          {/* Admin Create Notice Action */}
          {isAdmin && (
            <button
              type="button"
              onClick={onCreateNotice}
              aria-label="Create a new official announcement"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 16px',
                borderRadius: 10,
                background: '#16a34a',
                color: '#ffffff',
                border: '1px solid #15803d',
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(22,163,74,0.25)',
                transition: 'background .15s, transform .15s',
                minHeight: 40,
              }}
            >
              <PlusCircle size={15} strokeWidth={2.5} />
              <span>Create Notice</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

