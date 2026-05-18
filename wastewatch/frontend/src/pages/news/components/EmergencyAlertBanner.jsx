/**
 * EmergencyAlertBanner.jsx
 * -------------------------
 * Pinned, dismissible emergency alert strip.
 * Pulse animation on icon. Danger-themed.
 */

import { useState } from 'react'
import { ShieldAlert, X } from 'lucide-react'
import { EMERGENCY_ALERTS } from '../data/newsData'

const CSS = `
@keyframes ea-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: .5; }
}
.ea-pulse-icon { animation: ea-pulse 2s ease-in-out infinite; }
@keyframes ea-slide-in {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.ea-root { animation: ea-slide-in .25s ease; }
`

let _injected = false
function inject() {
  if (_injected) return; _injected = true
  const el = document.createElement('style'); el.textContent = CSS; document.head.appendChild(el)
}

export default function EmergencyAlertBanner({ alerts = EMERGENCY_ALERTS }) {
  inject()
  const [dismissed, setDismissed] = useState([])
  const visible = alerts.filter(a => !dismissed.includes(a.id))

  if (!visible.length) return null

  return (
    <div className="ea-root" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {visible.map(alert => (
        <div key={alert.id} style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '12px 14px',
          background: 'rgba(231,76,60,.06)',
          border: '1px solid rgba(231,76,60,.3)',
          borderLeft: '4px solid var(--danger)',
          borderRadius: 'var(--radius)',
        }}>
          {/* Pulsing icon */}
          <div className="ea-pulse-icon" style={{
            flexShrink: 0, color: 'var(--danger)',
            display: 'flex', alignItems: 'center', marginTop: 1,
          }}>
            <ShieldAlert size={18} strokeWidth={2} />
          </div>

          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 10, fontWeight: 800, letterSpacing: '.08em',
              textTransform: 'uppercase', color: 'var(--danger)', marginBottom: 3,
            }}>
              Emergency Alert · {alert.date}
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 3, lineHeight: 1.35 }}>
              {alert.title}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              {alert.body}
            </div>
          </div>

          {/* Dismiss */}
          <button
            onClick={() => setDismissed(d => [...d, alert.id])}
            style={{
              flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 3, borderRadius: 6,
              display: 'flex', alignItems: 'center',
              transition: 'color .15s',
            }}
            title="Dismiss"
            onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            aria-label="Dismiss alert"
          >
            <X size={15} strokeWidth={2.5} />
          </button>
        </div>
      ))}
    </div>
  )
}
