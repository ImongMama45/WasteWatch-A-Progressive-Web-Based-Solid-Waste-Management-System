/**
 * components/OfflineGamification.jsx
 * ------------------------------------
 * Barangay cleanliness ranking system — cached data.
 * Reads from ww_rankings localStorage cache.
 *
 * Shows:
 *   • Top-5 leaderboard (medal emojis)
 *   • Cleanliness score progress bars
 *   • Improvement delta (▲ green / ▼ red)
 *   • Full fallback UI when no data
 */

import { useState, useEffect } from 'react'
import { useOnline } from '../hooks/useOnline'
import api from '../api/client'

// ─── Cache helpers ────────────────────────────────────────────────────────────

const LS_KEY = 'ww_rankings'

function readCache()   { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') } catch { return null } }
function writeCache(d) { try { localStorage.setItem(LS_KEY, JSON.stringify(d)) } catch {} }

// ─── Fallback ─────────────────────────────────────────────────────────────────

const FALLBACK_RANKINGS = [
  { rank: 1, barangay: 'Ibabang Dupay',  score: 92, delta: +4,  improvement: '+4.5%', streak: 3  },
  { rank: 2, barangay: 'Gulang-Gulang',  score: 87, delta: +2,  improvement: '+2.3%', streak: 2  },
  { rank: 3, barangay: 'Isabang',        score: 83, delta: +1,  improvement: '+1.2%', streak: 1  },
  { rank: 4, barangay: 'Cotta',          score: 76, delta: -1,  improvement: '-1.3%', streak: 0  },
  { rank: 5, barangay: 'Dalahican',      score: 70, delta: +3,  improvement: '+4.1%', streak: 1  },
  { rank: 6, barangay: 'Ilayang Dupay',  score: 65, delta: -2,  improvement: '-3.0%', streak: 0  },
  { rank: 7, barangay: 'Ransohan',       score: 61, delta: +1,  improvement: '+1.6%', streak: 1  },
]

const MEDALS = ['🥇', '🥈', '🥉', '4', '5', '6', '7']

const SCORE_COLOR = (score) =>
  score >= 85 ? '#22c55e' :
  score >= 70 ? '#f59e0b' :
                '#ef4444'

// ─── Score bar ────────────────────────────────────────────────────────────────

function ScoreBar({ score, color }) {
  return (
    <div className="ogm-score-track">
      <div className="ogm-score-fill" style={{ width: `${score}%`, background: color }} />
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OfflineGamification() {
  const isOnline  = useOnline()
  const [rankings, setRankings] = useState(readCache() || FALLBACK_RANKINGS)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!isOnline) return
    api.get('/api/public/rankings/').then(res => {
      if (res?.data?.length) { writeCache(res.data); setRankings(res.data) }
    }).catch(() => {})
  }, [isOnline])

  const visible = expanded ? rankings : rankings.slice(0, 5)
  const top     = rankings[0]

  return (
    <div className="ogm-wrap">
      {/* Header */}
      <div className="ogm-header">
        <div className="ogm-header__left">
          <span className="ogm-icon">🏆</span>
          <div>
            <h3 className="ogm-title">Barangay Rankings</h3>
            <p className="ogm-sub">Cleanliness Leaderboard</p>
          </div>
        </div>
        {!isOnline && <span className="oas-badge oas-badge--cached">📦 Cached</span>}
      </div>

      {/* Champion banner */}
      {top && (
        <div className="ogm-champion">
          <div className="ogm-champion__medal">🥇</div>
          <div className="ogm-champion__info">
            <span className="ogm-champion__name">{top.barangay}</span>
            <span className="ogm-champion__sub">Top performer this month</span>
          </div>
          <div className="ogm-champion__score">
            <span className="ogm-champion__val">{top.score}</span>
            <span className="ogm-champion__label">pts</span>
          </div>
          {top.streak > 0 && (
            <div className="ogm-streak">🔥 {top.streak}-wk streak</div>
          )}
        </div>
      )}

      {/* Leaderboard */}
      <div className="ogm-list">
        {visible.map((r, i) => {
          const color  = SCORE_COLOR(r.score)
          const isUp   = r.delta > 0
          const medal  = MEDALS[r.rank - 1] || `${r.rank}`
          const isEmoji = r.rank <= 3
          return (
            <div key={r.barangay} className={`ogm-row${r.rank === 1 ? ' ogm-row--gold' : ''}`}>
              <span className={`ogm-rank${isEmoji ? ' ogm-rank--medal' : ''}`}>{medal}</span>
              <div className="ogm-row__info">
                <div className="ogm-row__top">
                  <span className="ogm-row__name">{r.barangay}</span>
                  <span className="ogm-row__delta" style={{ color: isUp ? '#22c55e' : '#ef4444' }}>
                    {isUp ? '▲' : '▼'} {Math.abs(r.delta)}
                  </span>
                </div>
                <ScoreBar score={r.score} color={color} />
              </div>
              <div className="ogm-row__right">
                <span className="ogm-row__score" style={{ color }}>{r.score}</span>
                <span className="ogm-row__pct" style={{ color: isUp ? '#22c55e' : '#ef4444' }}>
                  {r.improvement}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Show more */}
      {rankings.length > 5 && (
        <button className="ogm-more-btn" onClick={() => setExpanded(e => !e)}>
          {expanded ? '▲ Show Less' : `▼ Show All ${rankings.length} Barangays`}
        </button>
      )}

      {/* Info chip */}
      <div className="ogm-footer-chip">
        Scores based on reports, collection compliance & community feedback
      </div>
    </div>
  )
}
