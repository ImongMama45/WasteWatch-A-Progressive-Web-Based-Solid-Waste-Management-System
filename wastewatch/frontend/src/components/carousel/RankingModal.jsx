/**
 * RankingModal.jsx
 * -----------------
 * Bottom-sheet (mobile) / centered dialog (desktop).
 * Shows Top 10 Cleanest Barangays.
 * Uses Material Symbols Outlined via .msi class.
 * Design matches .card / .card-dark surface language.
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

// ─── Mock data ────────────────────────────────────────────────────────────────
// REPLACE WITH: api.get('/api/analytics/barangay-rankings/')
export const TOP_BARANGAYS = [
  { rank: 1,  name: 'Gulang-Gulang',   score: 98, compliance: 98, population: 1023,  trend: 'up'   },
  { rank: 2,  name: 'Ibabang Dupay',   score: 95, compliance: 95, population: 1321,  trend: 'up'   },
  { rank: 3,  name: 'Mayao Crossing',  score: 92, compliance: 92, population: 2104,  trend: 'same' },
  { rank: 4,  name: 'Barangay 1',      score: 89, compliance: 89, population: 876,   trend: 'up'   },
  { rank: 5,  name: 'Isabang',         score: 87, compliance: 87, population: 3210,  trend: 'down' },
  { rank: 6,  name: 'Cotta',           score: 84, compliance: 84, population: 2875,  trend: 'up'   },
  { rank: 7,  name: 'Kanlurang Cotta', score: 81, compliance: 81, population: 1654,  trend: 'same' },
  { rank: 8,  name: 'Barangay 2',      score: 78, compliance: 78, population: 943,   trend: 'down' },
  { rank: 9,  name: 'Barangay 3',      score: 75, compliance: 75, population: 1187,  trend: 'up'   },
  { rank: 10, name: 'Barangay 4',      score: 72, compliance: 72, population: 2340,  trend: 'same' },
]

const TREND = {
  up:   { icon: 'trending_up',   color: 'var(--accent, #2ecc71)' },
  down: { icon: 'trending_down', color: 'var(--danger, #e74c3c)' },
  same: { icon: 'trending_flat', color: 'var(--text-muted, #7a8899)' },
}

const RANK_ICONS = ['looks_one', 'looks_two', 'looks_3']
const RANK_COLORS = ['#f59e0b', '#94a3b8', '#b45309']

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@keyframes rm-up   { from { transform:translateY(100%); opacity:0 } to { transform:translateY(0); opacity:1 } }
@keyframes rm-fade { from { opacity:0 } to { opacity:1 } }
@keyframes rm-pop  { 0%{transform:scale(1)} 35%{transform:scale(1.04)} 100%{transform:scale(1)} }

.rm-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.45);
  z-index: 8000;
  animation: rm-fade .2s ease;
  backdrop-filter: blur(2px);
}
.rm-sheet {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  max-height: 88vh;
  background: var(--surface, #fdfdfd);
  border-radius: 18px 18px 0 0;
  z-index: 8001;
  display: flex; flex-direction: column;
  animation: rm-up .3s cubic-bezier(.16,1,.3,1);
  box-shadow: 0 -6px 32px rgba(0,0,0,.14);
  border-top: 1px solid var(--border, #ccc);
  overflow: hidden;
}
@media (min-width: 640px) {
  .rm-sheet {
    bottom: auto; top: 50%; left: 50%;
    transform: translate(-50%,-50%) !important;
    width: 460px; border-radius: 14px;
    animation: rm-fade .2s ease;
  }
}
.rm-handle { width: 36px; height: 4px; background: var(--border,#ccc); border-radius: 2px; margin: 12px auto 0; flex-shrink:0; }
@media (min-width:640px) { .rm-handle { display:none; } }
.rm-header {
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--border, #ccc);
  flex-shrink: 0;
}
.rm-body { overflow-y: auto; flex: 1; padding: 0 18px 20px; -webkit-overflow-scrolling: touch; }
.rm-body::-webkit-scrollbar { width: 0; }
.rm-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border, #ccc);
}
.rm-row:last-child { border-bottom: none; }
.rm-congrats { animation: rm-pop .45s ease .1s both; }
`

let _rmInjected = false
function inject() {
  if (_rmInjected) return; _rmInjected = true
  const el = document.createElement('style'); el.textContent = CSS; document.head.appendChild(el)
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function RankingModal({ open, onClose, userBarangay }) {
  const navigate = useNavigate()
  inject()

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  const userRank = userBarangay
    ? TOP_BARANGAYS.find(b => b.name.toLowerCase() === userBarangay.toLowerCase())
    : null

  return (
    <>
      <div className="rm-backdrop" onClick={onClose} />
      <div className="rm-sheet" role="dialog" aria-modal="true" aria-label="Top 10 Cleanest Barangays">
        <div className="rm-handle" />

        {/* Header */}
        <div className="rm-header">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 10, fontWeight: 700, letterSpacing: '.09em',
                textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 3,
              }}>
                <span className="msi" style={{ fontSize: 15 }}>emoji_events</span>
                City Rankings
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', lineHeight: 1.25 }}>
                Top 10 Cleanest Barangays
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                Ranked by waste-to-population compliance · Lucena City
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 8, width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0, color: 'var(--text-muted)',
              }}
              aria-label="Close"
            >
              <span className="msi" style={{ fontSize: 18 }}>close</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="rm-body">
          {/* Congrats banner */}
          {userRank && (
            <div className="rm-congrats" style={{
              background: 'rgba(46,204,113,.07)',
              border: '1px solid rgba(46,204,113,.25)',
              borderRadius: 10, padding: '12px 14px',
              marginTop: 14, marginBottom: 4,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span className="msi" style={{ fontSize: 28, color: 'var(--accent)', flexShrink: 0 }}>
                celebration
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)', marginBottom: 2 }}>
                  {userRank.name} is #{userRank.rank} in the city!
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Your barangay has a{' '}
                  <strong style={{ color: 'var(--accent)' }}>{userRank.compliance}%</strong>{' '}
                  waste compliance rate. Keep it up!
                </div>
              </div>
            </div>
          )}

          {/* List */}
          <div style={{ marginTop: 12 }}>
            {TOP_BARANGAYS.map((b, i) => {
              const t = TREND[b.trend]
              const isUser = userBarangay && b.name.toLowerCase() === userBarangay.toLowerCase()
              const scoreColor = b.score >= 90 ? 'var(--accent)' : b.score >= 80 ? 'var(--warning)' : 'var(--text-muted)'

              return (
                <div key={b.rank} className="rm-row" style={{
                  background: isUser ? 'rgba(46,204,113,.05)' : 'transparent',
                  borderRadius: isUser ? 8 : 0,
                  padding: isUser ? '10px 8px' : '10px 0',
                  margin: isUser ? '2px 0' : 0,
                }}>
                  {/* Rank */}
                  <div style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    background: i < 3 ? 'rgba(0,0,0,.04)' : 'var(--bg)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {i < 3
                      ? <span className="msi" style={{ fontSize: 18, color: RANK_COLORS[i] }}>{RANK_ICONS[i]}</span>
                      : <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)' }}>#{b.rank}</span>
                    }
                  </div>

                  {/* Name + pop */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: isUser ? 700 : 500, fontSize: 13,
                      color: isUser ? 'var(--accent)' : 'var(--text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}>
                      {b.name}
                      {isUser && (
                        <span style={{
                          fontSize: 8, fontWeight: 800, letterSpacing: '.07em',
                          background: 'rgba(46,204,113,.12)', color: 'var(--accent)',
                          padding: '1px 6px', borderRadius: 10,
                        }}>YOU</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {b.population.toLocaleString()} residents
                    </div>
                  </div>

                  {/* Score + trend */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: scoreColor }}>{b.compliance}%</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>compliance</div>
                    </div>
                    <span className="msi" style={{ fontSize: 18, color: t.color }}>{t.icon}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* CTA */}
          <button
            onClick={() => { onClose(); navigate('/analytics') }}
            className="btn btn-primary btn-full"
            style={{ marginTop: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <span className="msi" style={{ fontSize: 18 }}>bar_chart</span>
            Open Full Analytics
          </button>
          <div style={{ height: 8 }} />
        </div>
      </div>
    </>
  )
}
