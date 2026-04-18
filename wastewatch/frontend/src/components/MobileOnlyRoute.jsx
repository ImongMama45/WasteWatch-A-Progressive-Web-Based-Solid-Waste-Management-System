// MobileOnlyRoute.jsx
// Wraps routes that require a mobile device (camera-dependent actions).
// On desktop (≥1024px), renders a restriction screen instead of the page.
// Drop into: src/components/MobileOnlyRoute.jsx

import { useNavigate } from 'react-router-dom'

function useIsDesktop() {
  // We use matchMedia so it's synchronous — no flash of content
  if (typeof window === 'undefined') return false
  return window.matchMedia('(min-width: 1024px)').matches
}

export default function MobileOnlyRoute({ children }) {
  const navigate  = useNavigate()
  const isDesktop = useIsDesktop()

  if (!isDesktop) return children

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
      background: 'var(--bg)',
      textAlign: 'center',
    }}>
      {/* Icon */}
      <div style={{
        width: 80, height: 80,
        borderRadius: '50%',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 36, marginBottom: 24,
      }}>
        📵
      </div>

      {/* Heading */}
      <h2 style={{
        fontFamily: 'var(--font-head)',
        fontSize: 22, fontWeight: 800,
        marginBottom: 12, color: 'var(--text)',
        letterSpacing: '.04em',
      }}>
        Desktop Not Supported
      </h2>

      {/* Body */}
      <p style={{
        fontSize: 14, color: 'var(--text-muted)',
        maxWidth: 380, lineHeight: 1.75, marginBottom: 10,
      }}>
        Submitting reports and confirming collections require your device's camera and GPS, which are only available on mobile.
      </p>
      <p style={{
        fontSize: 13, color: 'var(--text-muted)',
        maxWidth: 360, lineHeight: 1.7, marginBottom: 32,
        padding: '12px 16px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
      }}>
        💡 Desktop mode is for <strong style={{ color: 'var(--text)' }}>monitoring only</strong> — track live truck routes, view barangay zones, and stay updated on collection activity.
      </p>

      {/* CTA */}
      <button
        onClick={() => navigate('/dashboard')}
        style={{
          background: 'var(--accent)', color: '#0d1117',
          border: 'none', borderRadius: 10,
          padding: '12px 28px',
          fontFamily: 'var(--font-body)',
          fontWeight: 700, fontSize: 14,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        ← Back to Dashboard
      </button>
    </div>
  )
}