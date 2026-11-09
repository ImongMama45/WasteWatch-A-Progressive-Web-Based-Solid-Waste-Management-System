import React from 'react'

/**
 * Reusable Skeleton UI & Loading Placeholders for WasteWatch
 * ----------------------------------------------------------
 * Uses CSS shimmer primitives (.ww-sk / .ww-sk--dark) from index.css.
 * Zero emojis — uses clean geometric placeholders and inline SVG icons only.
 */

export function Skeleton({
  width = '100%',
  height = 14,
  radius = 6,
  circle = false,
  dark = false,
  className = '',
  style = {},
}) {
  const resolvedRadius = circle ? '50%' : radius
  return (
    <span
      aria-hidden="true"
      className={`ww-sk ${dark ? 'ww-sk--dark' : ''} ${className}`.trim()}
      style={{
        width,
        height: circle ? width : height,
        borderRadius: resolvedRadius,
        flexShrink: 0,
        ...style,
      }}
    />
  )
}

export function SkeletonText({
  lines = 3,
  widths = ['100%', '96%', '68%'],
  height = 11,
  gap = 9,
  dark = false,
  style = {},
}) {
  return (
    <div
      aria-hidden="true"
      style={{ display: 'flex', flexDirection: 'column', gap, width: '100%', ...style }}
    >
      {Array.from({ length: lines }).map((_, idx) => (
        <Skeleton
          key={idx}
          width={widths[idx % widths.length] || '85%'}
          height={height}
          radius={999}
          dark={dark}
        />
      ))}
    </div>
  )
}

export function SkeletonAvatar({ size = 44, circle = true, radius = 10, dark = false, style = {} }) {
  return (
    <Skeleton
      width={size}
      height={size}
      circle={circle}
      radius={radius}
      dark={dark}
      style={style}
    />
  )
}

export function SkeletonPill({ width = 64, height = 18, dark = false, style = {} }) {
  return <Skeleton width={width} height={height} radius={999} dark={dark} style={style} />
}

/**
 * Center Feed / Content Card Skeleton
 * Mirrors the wireframe card layout:
 * - Circular avatar + title bar + 3 pill tags
 * - 3 full/partial body lines
 * - Optional media block
 */
export function FeedCardSkeleton({
  count = 3,
  showMedia = false,
  dark = false,
  compact = false,
  style = {},
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading content"
      className="ww-fade-in"
      style={{ display: 'flex', flexDirection: 'column', gap: compact ? 12 : 16, ...style }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={dark ? 'ww-sk-surface--dark' : 'ww-sk-surface'}
          style={{
            padding: compact ? '16px' : '22px',
            background: dark ? 'var(--surface-3, #1e2633)' : '#f8fafc',
            border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid #eef2f6',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: compact ? 14 : 18 }}>
            <SkeletonAvatar size={compact ? 38 : 48} circle dark={dark} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton
                width={i % 2 === 0 ? '46%' : '58%'}
                height={compact ? 14 : 16}
                radius={6}
                dark={dark}
                style={{ marginBottom: 8 }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <SkeletonPill width={52} height={14} dark={dark} />
                <SkeletonPill width={52} height={14} dark={dark} />
                <SkeletonPill width={52} height={14} dark={dark} />
              </div>
            </div>
          </div>

          {showMedia && (
            <Skeleton
              width="100%"
              height={160}
              radius={10}
              dark={dark}
              style={{ marginBottom: 16 }}
            />
          )}

          <SkeletonText
            lines={compact ? 2 : 3}
            widths={compact ? ['96%', '64%'] : ['100%', '98%', '68%']}
            height={10}
            gap={9}
            dark={dark}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * Right Sidebar Widget Item Skeleton
 * Mirrors the wireframe right-rail items:
 * - Rounded square thumbnail + 2 stacked text bars
 */
export function SidebarWidgetSkeleton({ rows = 3, dark = false, showHeader = false, style = {} }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading widget"
      className="ww-fade-in"
      style={{ display: 'flex', flexDirection: 'column', gap: 16, ...style }}
    >
      {showHeader && (
        <Skeleton width="48%" height={15} radius={6} dark={dark} style={{ marginBottom: 2 }} />
      )}
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SkeletonAvatar size={46} circle={false} radius={8} dark={dark} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton width={idx % 2 === 0 ? '88%' : '76%'} height={10} radius={999} dark={dark} />
            <Skeleton width={idx % 2 === 0 ? '62%' : '54%'} height={10} radius={999} dark={dark} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * KPI / Stat Cards Skeleton
 * Supports both light dashboard cards and dark `.stat-card` (`dark={true}`)
 */
export function StatCardSkeleton({
  count = 4,
  dark = false,
  useStatGridClass = false,
  minCardWidth = 155,
  style = {},
}) {
  if (useStatGridClass) {
    return (
      <div className="stat-grid ww-fade-in" role="status" aria-busy="true" aria-label="Loading metrics" style={style}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
            <Skeleton width="58%" height={10} radius={999} dark style={{ marginBottom: 14 }} />
            <Skeleton width="42%" height={32} radius={8} dark style={{ marginBottom: 8 }} />
            <Skeleton width="70%" height={9} radius={999} dark />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading metrics"
      className="ww-fade-in"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${minCardWidth}px, 1fr))`,
        gap: 14,
        ...style,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={dark ? 'ww-sk-surface--dark' : 'ww-sk-surface'}
          style={{
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Skeleton width="52%" height={11} radius={999} dark={dark} />
            <Skeleton width={28} height={28} radius={8} dark={dark} />
          </div>
          <Skeleton width="44%" height={28} radius={7} dark={dark} />
          <Skeleton width="68%" height={10} radius={999} dark={dark} />
        </div>
      ))}
    </div>
  )
}

/**
 * Table Rows Skeleton (for direct placement inside <tbody>)
 */
export function TableRowsSkeleton({ rows = 6, cols = 6 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rIdx) => (
        <tr key={rIdx} aria-hidden="true" style={{ borderBottom: '1px solid rgba(226,232,240,0.7)' }}>
          {Array.from({ length: cols }).map((__, cIdx) => (
            <td key={cIdx} style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
              {cIdx === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <SkeletonAvatar size={32} circle />
                  <div style={{ flex: 1, minWidth: 80 }}>
                    <Skeleton width="78%" height={11} radius={999} style={{ marginBottom: 6 }} />
                    <Skeleton width="52%" height={9} radius={999} />
                  </div>
                </div>
              ) : cIdx === cols - 1 ? (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Skeleton width={64} height={26} radius={7} />
                </div>
              ) : cIdx === cols - 2 ? (
                <SkeletonPill width={72} height={22} />
              ) : (
                <Skeleton
                  width={rIdx % 2 === 0 ? '75%' : '60%'}
                  height={11}
                  radius={999}
                />
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

/**
 * Standalone Card Table Skeleton (for CSS-grid tables or card-wrapped tables)
 */
export function TableSkeleton({ rows = 6, cols = 5, showToolbar = false, style = {} }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading table data"
      className="ww-sk-surface ww-fade-in"
      style={{ padding: 20, ...style }}
    >
      {showToolbar && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <Skeleton width={220} height={34} radius={8} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Skeleton width={90} height={34} radius={8} />
            <Skeleton width={90} height={34} radius={8} />
          </div>
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gap: 14,
          paddingBottom: 12,
          borderBottom: '1px solid #e2e8f0',
          marginBottom: 8,
        }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} width="65%" height={10} radius={999} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: 14,
            alignItems: 'center',
            padding: '13px 0',
            borderBottom: r < rows - 1 ? '1px solid #f1f5f9' : 'none',
          }}
        >
          {Array.from({ length: cols }).map((__, c) => (
            <div key={c}>
              {c === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Skeleton width={30} height={30} circle />
                  <Skeleton width="70%" height={11} radius={999} />
                </div>
              ) : c === cols - 1 ? (
                <SkeletonPill width={68} height={22} />
              ) : (
                <Skeleton width={r % 2 === 0 ? '78%' : '58%'} height={11} radius={999} />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Interactive Map Skeleton (Dark or Light)
 * Renders subtle cartographic grid lines, animated route polyline, floating chip skeletons, and radar pulse.
 */
export function MapSkeleton({
  height = '100%',
  dark = true,
  label = 'Loading map...',
  showControls = true,
  borderRadius = 0,
  style = {},
}) {
  const bg = dark ? '#0f172a' : '#eef2f6'
  const gridColor = dark ? 'rgba(148, 163, 184, 0.07)' : 'rgba(15, 23, 42, 0.05)'
  const routeStroke = dark ? 'rgba(20, 184, 166, 0.35)' : 'rgba(22, 163, 74, 0.3)'

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="ww-fade-in"
      style={{
        position: 'relative',
        width: '100%',
        height,
        minHeight: typeof height === 'number' ? height : 180,
        background: bg,
        borderRadius,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {/* Cartographic grid backdrop */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(to right, ${gridColor} 1px, transparent 1px),
            linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)
          `,
          backgroundSize: '44px 44px',
        }}
      />

      {/* Animated stylized route path */}
      <svg
        aria-hidden="true"
        viewBox="0 0 600 320"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.85 }}
      >
        <path
          d="M -20 250 Q 130 210, 210 155 T 430 120 T 620 65"
          fill="none"
          stroke={routeStroke}
          strokeWidth="3"
          strokeDasharray="10 14"
          style={{ animation: 'ww-map-dash 2.2s linear infinite' }}
        />
        <circle cx="210" cy="155" r="5" fill={routeStroke} />
        <circle cx="430" cy="120" r="5" fill={routeStroke} />
      </svg>

      {/* Top floating search / layer chip skeletons */}
      {showControls && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 14,
            left: 14,
            right: 14,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Skeleton width={160} height={32} radius={9} dark={dark} />
            <Skeleton width={68} height={28} radius={999} dark={dark} />
            <Skeleton width={68} height={28} radius={999} dark={dark} />
          </div>
          <Skeleton width={76} height={28} radius={8} dark={dark} />
        </div>
      )}

      {/* Center radar badge */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          padding: '14px 22px',
          borderRadius: 14,
          background: dark ? 'rgba(15, 23, 42, 0.78)' : 'rgba(255, 255, 255, 0.88)',
          border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.08)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <div style={{ position: 'relative', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: `2px solid ${dark ? '#14b8a6' : '#16a34a'}`,
              animation: 'ww-radar-ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite',
            }}
          />
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke={dark ? '#14b8a6' : '#16a34a'}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </div>
        {label && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.02em',
              color: dark ? '#cbd5e1' : '#475569',
            }}
          >
            {label}
          </span>
        )}
      </div>

      {/* Bottom status strip skeleton */}
      {showControls && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: 12,
            left: 14,
            display: 'flex',
            gap: 12,
            pointerEvents: 'none',
          }}
        >
          <Skeleton width={96} height={14} radius={999} dark={dark} />
          <Skeleton width={82} height={14} radius={999} dark={dark} />
        </div>
      )}
    </div>
  )
}

/**
 * Chart / Gauge Skeleton
 * Variants: 'bar' | 'line' | 'gauge'
 */
export function ChartSkeleton({
  height = 220,
  variant = 'bar',
  dark = false,
  showHeader = true,
  style = {},
}) {
  const barHeights = ['48%', '76%', '60%', '90%', '52%', '82%', '68%']

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading chart"
      className={`${dark ? 'ww-sk-surface--dark' : 'ww-sk-surface'} ww-fade-in`}
      style={{ padding: 20, ...style }}
    >
      {showHeader && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <Skeleton width={150} height={14} radius={6} dark={dark} style={{ marginBottom: 7 }} />
            <Skeleton width={96} height={10} radius={999} dark={dark} />
          </div>
          <SkeletonPill width={74} height={24} dark={dark} />
        </div>
      )}

      {variant === 'gauge' ? (
        <div style={{ height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <Skeleton width={132} height={132} circle dark={dark} />
          <Skeleton width={110} height={12} radius={999} dark={dark} />
        </div>
      ) : variant === 'line' ? (
        <div style={{ height, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingTop: 8 }}>
          <Skeleton width="100%" height={Math.max(80, height - 38)} radius={10} dark={dark} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} width={34} height={9} radius={999} dark={dark} />
            ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            height,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 12,
            paddingTop: 12,
            borderBottom: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid #eef2f6',
            paddingBottom: 10,
          }}
        >
          {barHeights.map((h, idx) => (
            <div key={idx} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
              <Skeleton width="100%" height={h} radius="6px 6px 2px 2px" dark={dark} />
              <Skeleton width="65%" height={8} radius={999} dark={dark} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * LiveTrackerCard Skeleton
 * Mirrors the exact dimensions & layout of `components/analytics/LiveTrackerCard.jsx`
 */
export function LiveTrackerSkeleton({ style = {} }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading live truck tracker"
      className="ww-sk-surface ww-fade-in"
      style={{
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        ...style,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Skeleton width={150} height={18} radius={6} style={{ marginBottom: 7 }} />
          <Skeleton width={115} height={12} radius={999} />
        </div>
        <SkeletonPill width={112} height={26} />
      </div>
      <div style={{ padding: 24, background: 'var(--bg, #f1f5f9)', borderRadius: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <SkeletonAvatar size={36} circle />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <Skeleton width="38%" height={13} radius={999} />
              <Skeleton width={70} height={20} radius={6} />
            </div>
            <Skeleton width="55%" height={10} radius={999} style={{ marginBottom: 10 }} />
            <Skeleton width="100%" height={6} radius={999} />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Monthly Calendar Skeleton (7-column grid)
 */
export function CalendarSkeleton({ style = {} }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading calendar"
      className="ww-sk-surface ww-fade-in"
      style={{ padding: 20, ...style }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Skeleton width={140} height={18} radius={6} />
        <div style={{ display: 'flex', gap: 8 }}>
          <Skeleton width={30} height={30} radius={8} />
          <Skeleton width={30} height={30} radius={8} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 10 }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={12} radius={4} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
        {Array.from({ length: 28 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={38} radius={8} />
        ))}
      </div>
    </div>
  )
}

/**
 * Detail Modal / Drawer Content Skeleton
 */
export function DetailModalSkeleton({ showBanner = true, style = {} }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading details"
      className="ww-fade-in"
      style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18, ...style }}
    >
      {showBanner && <Skeleton width="100%" height={180} radius={12} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <Skeleton width="55%" height={20} radius={6} />
        <div style={{ display: 'flex', gap: 8 }}>
          <SkeletonPill width={68} height={22} />
          <SkeletonPill width={68} height={22} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Skeleton width="100%" height={56} radius={10} />
        <Skeleton width="100%" height={56} radius={10} />
      </div>
      <SkeletonText lines={3} widths={['100%', '92%', '64%']} height={11} gap={10} />
    </div>
  )
}

/**
 * Mobile Route / Task Flow Skeleton (Driver & Watcher full-viewport modules)
 */
export function MobileFlowSkeleton({ dark = false, label = 'Preparing route workspace...' }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      style={{
        minHeight: '100vh',
        background: dark ? '#0f172a' : '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Top HUD bar */}
      <div style={{ padding: '16px', zIndex: 2 }}>
        <div
          className={dark ? 'ww-sk-surface--dark' : 'ww-sk-surface'}
          style={{
            padding: '12px 16px',
            borderRadius: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SkeletonAvatar size={34} circle dark={dark} />
            <div>
              <Skeleton width={120} height={13} radius={6} dark={dark} style={{ marginBottom: 6 }} />
              <Skeleton width={80} height={9} radius={999} dark={dark} />
            </div>
          </div>
          <SkeletonPill width={64} height={22} dark={dark} />
        </div>
      </div>

      {/* Center map / radar area */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <MapSkeleton height={300} dark={dark} label={label} showControls={false} borderRadius={18} />
      </div>

      {/* Bottom action sheet */}
      <div
        className={dark ? 'ww-sk-surface--dark' : 'ww-sk-surface'}
        style={{
          padding: '20px 18px 28px',
          borderRadius: '20px 20px 0 0',
          zIndex: 2,
        }}
      >
        <div style={{ width: 38, height: 4, borderRadius: 99, background: dark ? 'rgba(255,255,255,0.16)' : '#cbd5e1', margin: '0 auto 16px' }} />
        <Skeleton width="52%" height={16} radius={6} dark={dark} style={{ marginBottom: 10 }} />
        <SkeletonText lines={2} widths={['88%', '60%']} height={10} gap={8} dark={dark} style={{ marginBottom: 18 }} />
        <Skeleton width="100%" height={44} radius={12} dark={dark} />
      </div>
    </div>
  )
}

/**
 * Full Web App Wireframe Skeleton Shell
 * Directly mirrors the classic 3-column web-app skeleton screen:
 * - Top navigation bar with brand block & nav placeholders
 * - Left navigation rail with stacked pill bars
 * - Center main column with rich feed/dashboard cards (avatar + title + 3 pills + 3 lines)
 * - Right sidebar column with thumbnail + 2-line widget items
 */
export function AppShellSkeleton({ showTopBar = true }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading WasteWatch application"
      className="ww-fade-in"
      style={{
        minHeight: showTopBar ? '100vh' : 'calc(100vh - 60px)',
        background: '#f8fafc',
      }}
    >
      {showTopBar && (
        <div
          aria-hidden="true"
          style={{
            height: 60,
            background: '#eef2f6',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 28px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Skeleton width={38} height={26} radius={6} />
            <Skeleton width={110} height={14} radius={6} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Skeleton width={32} height={32} circle />
            <Skeleton width={88} height={30} radius={999} />
          </div>
        </div>
      )}

      <div className="ww-shell-sk-grid">
        {/* Left Navigation Column */}
        <div className="ww-shell-sk-left" aria-hidden="true" style={{ gap: 14, paddingTop: 4 }}>
          <Skeleton width={92} height={24} radius={6} style={{ marginBottom: 6 }} />
          {Array.from({ length: 6 }).map((_, idx) => (
            <Skeleton key={idx} width={idx % 2 === 0 ? '92%' : '82%'} height={11} radius={999} />
          ))}
        </div>

        {/* Center Main Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <StatCardSkeleton count={4} />
          <FeedCardSkeleton count={2} />
        </div>

        {/* Right Widget Column */}
        <div className="ww-shell-sk-right" aria-hidden="true" style={{ gap: 22, paddingTop: 4 }}>
          <SidebarWidgetSkeleton rows={3} showHeader />
          <div className="ww-sk-surface" style={{ padding: 16 }}>
            <Skeleton width="55%" height={13} radius={6} style={{ marginBottom: 12 }} />
            <Skeleton width="100%" height={120} radius={10} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default Skeleton

