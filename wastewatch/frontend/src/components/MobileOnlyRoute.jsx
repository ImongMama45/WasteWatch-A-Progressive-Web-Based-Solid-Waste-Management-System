// MobileOnlyRoute.jsx
// -------------------
// Wraps routes that require a mobile/tablet device (camera + GPS).
// On desktop, renders a restriction screen instead of the page.
//
// Detection goes beyond screen size — uses pointer type, hover
// capability, and touch support to reliably distinguish desktops
// from phones/tablets.

import { useNavigate } from 'react-router-dom'

/**
 * Detect whether the current device is a desktop/laptop.
 *
 * Combines multiple browser signals:
 *  1. pointer: fine   — primary input is a mouse/trackpad (not touch)
 *  2. hover: hover    — primary input can hover (mouse can, finger can't)
 *  3. maxTouchPoints  — desktops typically report 0
 *  4. screen width    — fallback: ≥1024 px
 *
 * Returns true when the majority of signals (≥3 of 4) point to desktop.
 * This correctly handles:
 *  - Large tablets  → wide screen but touch  → NOT desktop
 *  - Small laptops  → narrow but mouse+hover → desktop
 */
function useIsDesktop() {
  if (typeof window === 'undefined') return false

  const finePointer = window.matchMedia('(pointer: fine)').matches
  const canHover    = window.matchMedia('(hover: hover)').matches
  const noTouch     = navigator.maxTouchPoints === 0
  const wideScreen  = window.matchMedia('(min-width: 1024px)').matches

  // Count how many signals indicate desktop
  const score = [finePointer, canHover, noTouch, wideScreen].filter(Boolean).length

  // 3+ out of 4 signals agree → desktop
  return score >= 3
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