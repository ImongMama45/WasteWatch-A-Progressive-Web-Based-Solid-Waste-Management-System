/**
 * RankingModal.jsx
 * -----------------
 * Bottom-sheet (mobile) / centered dialog (desktop).
 * Shows Cleanest Barangays based on live CENRO spotlights and evaluations.
 * Zero emojis. Material / Lucide icons only.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trophy, Award, TrendingUp, TrendingDown, Minus, X, BarChart2, ShieldCheck } from 'lucide-react'
import api from '../../api/client'

const CSS = `
@keyframes rm-up   { from { transform:translateY(100%); opacity:0 } to { transform:translateY(0); opacity:1 } }
@keyframes rm-fade { from { opacity:0 } to { opacity:1 } }
@keyframes rm-pop  { 0%{transform:scale(1)} 35%{transform:scale(1.03)} 100%{transform:scale(1)} }

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
    width: 480px; border-radius: 14px;
    animation: rm-fade .2s ease;
  }
}
.rm-handle { width: 36px; height: 4px; background: var(--border,#ccc); border-radius: 2px; margin: 12px auto 0; flex-shrink:0; }
@media (min-width:640px) { .rm-handle { display:none; } }
.rm-header {
  padding: 16px 20px 14px;
  border-bottom: 1px solid var(--border, #ccc);
  flex-shrink: 0;
}
.rm-body { overflow-y: auto; flex: 1; padding: 0 20px 20px; -webkit-overflow-scrolling: touch; }
.rm-body::-webkit-scrollbar { width: 0; }
.rm-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border, #eee);
}
.rm-row:last-child { border-bottom: none; }
.rm-congrats { animation: rm-pop .45s ease .1s both; }
`

let _rmInjected = false
function inject() {
  if (_rmInjected) return
  _rmInjected = true
  const el = document.createElement('style')
  el.textContent = CSS
  document.head.appendChild(el)
}

export default function RankingModal({ open, onClose, userBarangay }) {
  const navigate = useNavigate()
  const [spotlights, setSpotlights] = useState([])
  const [loading, setLoading] = useState(false)
  inject()

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      setLoading(true)
      api
        .get('/api/news/spotlights/')
        .then(res => {
          const list = Array.isArray(res.data) ? res.data : (res.data?.results || [])
          const sorted = [...list].sort(
            (a, b) => (typeof b.score === 'number' ? b.score : -1) - (typeof a.score === 'number' ? a.score : -1)
          )
          setSpotlights(sorted)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  if (!open) return null

  const userRank = userBarangay
    ? spotlights.find(
        b =>
          (b.barangay_name || (typeof b.barangay === 'object' ? b.barangay.name : b.barangay) || '')
            .toLowerCase() === userBarangay.toLowerCase()
      )
    : null

  return (
    <>
      <div className="rm-backdrop" onClick={onClose} />
      <div className="rm-sheet" role="dialog" aria-modal="true" aria-label="City Cleanliness Rankings">
        <div className="rm-handle" />

        {/* Header */}
        <div className="rm-header">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '.09em',
                  textTransform: 'uppercase',
                  color: 'var(--accent, #16a34a)',
                  marginBottom: 3,
                }}
              >
                <Trophy size={14} strokeWidth={2.2} />
                <span>Lucena City Cleanliness Standings</span>
              </div>
              <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text)', lineHeight: 1.25 }}>
                Cleanest Barangay Rankings
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Summary of solid waste segregation and collection compliance records
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                color: 'var(--text-muted)',
              }}
              aria-label="Close"
            >
              <X size={18} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="rm-body">
          {/* Congrats banner if user's barangay is in rankings */}
          {userRank && (
            <div
              className="rm-congrats"
              style={{
                background: 'rgba(22,163,74,.08)',
                border: '1px solid rgba(22,163,74,.3)',
                borderRadius: 10,
                padding: '12px 14px',
                marginTop: 14,
                marginBottom: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <Award size={24} strokeWidth={2.2} style={{ color: '#16a34a', flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#16a34a', marginBottom: 2 }}>
                  {userRank.barangay_name || userBarangay} Standings
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Your barangay holds a{' '}
                  <strong style={{ color: '#16a34a' }}>{userRank.score}%</strong> compliance rating in published evaluation records.
                </div>
              </div>
            </div>
          )}

          {/* Standings List */}
          <div style={{ marginTop: 12 }}>
            {spotlights.length > 0 ? (
              spotlights.map((b, i) => {
                const name = b.barangay_name || (typeof b.barangay === 'object' ? b.barangay.name : b.barangay) || 'Barangay'
                const isUser = userBarangay && name.toLowerCase() === userBarangay.toLowerCase()
                const isTrendUp = b.trend === 'up'
                const isTrendDown = b.trend === 'down'

                return (
                  <div
                    key={b.id || i}
                    className="rm-row"
                    style={{
                      background: isUser ? 'rgba(22,163,74,.06)' : 'transparent',
                      borderRadius: isUser ? 8 : 0,
                      padding: isUser ? '10px 8px' : '10px 0',
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        background: i === 0 ? '#16a34a' : '#f1f5f9',
                        color: i === 0 ? '#ffffff' : '#475569',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      #{i + 1}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 13,
                          color: isUser ? '#16a34a' : 'var(--text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        {name}
                        {isUser && (
                          <span
                            style={{
                              fontSize: 8,
                              fontWeight: 800,
                              letterSpacing: '.07em',
                              background: 'rgba(22,163,74,.15)',
                              color: '#16a34a',
                              padding: '1px 6px',
                              borderRadius: 10,
                            }}
                          >
                            YOU
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {b.achievement || 'Waste Segregation Compliance'}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 800, fontSize: 14, color: '#16a34a' }}>{b.score}%</div>
                        <div style={{ fontSize: 8.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>compliance</div>
                      </div>
                      {isTrendUp ? (
                        <TrendingUp size={14} strokeWidth={2.5} style={{ color: '#16a34a' }} aria-label="Improving trend" />
                      ) : isTrendDown ? (
                        <TrendingDown size={14} strokeWidth={2.5} style={{ color: '#dc2626' }} aria-label="Declining trend" />
                      ) : (
                        <Minus size={14} strokeWidth={2} style={{ color: 'var(--text-muted, #94a3b8)' }} aria-label="Stable or unrecorded trend" />
                      )}
                    </div>
                  </div>
                )
              })
            ) : (
              <div style={{ padding: '24px 10px', textAlign: 'center' }}>
                <ShieldCheck size={28} strokeWidth={1.8} style={{ color: '#16a34a', margin: '0 auto 8px', display: 'block' }} />
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                  Standings Under Evaluation
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 360, margin: '0 auto' }}>
                  Official citywide cleanest barangay standings will appear here once evaluation records are published.
                </div>
              </div>
            )}
          </div>

          {/* CTA */}
          <button
            onClick={() => {
              onClose()
              navigate('/analytics')
            }}
            className="btn btn-primary btn-full"
            style={{
              marginTop: 18,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <BarChart2 size={16} strokeWidth={2.2} />
            Open WasteWatch Analytics
          </button>
        </div>
      </div>
    </>
  )
}
