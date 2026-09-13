/**
 * BarangayRankingCard.jsx
 * ------------------------
 * Individual ranking card. Material Symbols icons. Matches WasteWatch design tokens.
 */

import { TrendingUp, TrendingDown, Minus, Award } from 'lucide-react'

const TREND = {
  up:   { icon: TrendingUp,   color: 'var(--accent)'   },
  down: { icon: TrendingDown, color: 'var(--danger)'   },
  same: { icon: Minus, color: 'var(--text-muted)'},
}
const RANK_ICONS  = [Award, Award, Award]
const RANK_COLORS = ['#f59e0b', '#94a3b8', '#b45309']

export default function BarangayRankingCard({ brgy, rank, isUser = false, style = {} }) {
  const trend = TREND[brgy.trend] || TREND.same
  const scoreColor =
    brgy.score >= 90 ? 'var(--accent)' :
    brgy.score >= 80 ? 'var(--warning)' : 'var(--text-muted)'
  const ri = rank - 1

  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid ${isUser ? 'rgba(46,204,113,.35)' : 'var(--border)'}`,
      borderRadius: 'var(--radius)',
      padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: isUser ? 'inset 0 0 0 1px rgba(46,204,113,.15)' : 'none',
      ...style,
    }}>
      {/* Rank badge */}
      <div style={{
        width: 34, height: 34, borderRadius: 8, flexShrink: 0,
        background: 'var(--bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {ri < 3 ? (() => {
          const RankIcon = RANK_ICONS[ri];
          return <RankIcon size={20} color={RANK_COLORS[ri]} />
        })() : <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)' }}>#{rank}</span>}
      </div>

      {/* Name + bar */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{
            fontWeight: 600, fontSize: 13,
            color: isUser ? 'var(--accent)' : 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {brgy.name}
          </span>
          {isUser && (
            <span style={{
              fontSize: 8, fontWeight: 800, letterSpacing: '.07em',
              background: 'rgba(46,204,113,.1)', color: 'var(--accent)',
              padding: '1px 6px', borderRadius: 10,
            }}>YOU</span>
          )}
        </div>
        {/* Score bar */}
        <div style={{ height: 4, borderRadius: 20, background: 'var(--border)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 20,
            width: `${brgy.score}%`, background: scoreColor,
          }} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
          {brgy.population?.toLocaleString()} residents
        </div>
      </div>

      {/* Score + trend */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: scoreColor }}>{brgy.compliance}%</div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>compliance</div>
        {(() => {
          const TrendIcon = trend.icon;
          return <TrendIcon size={16} color={trend.color} />
        })()}
      </div>
    </div>
  )
}
