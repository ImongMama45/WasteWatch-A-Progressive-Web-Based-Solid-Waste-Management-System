import { TrendingUp, TrendingDown, Minus, Award } from 'lucide-react'

const TREND = {
  up:   { icon: TrendingUp,   color: '#15803d' },
  down: { icon: TrendingDown, color: '#dc2626' },
  same: { icon: Minus, color: '#65676b' },
}
const RANK_ICONS  = [Award, Award, Award]
const RANK_COLORS = ['#d97706', '#65676b', '#92400e']

export default function BarangayRankingCard({ brgy, rank, isUser = false, style = {} }) {
  const trend = TREND[brgy.trend] || TREND.same
  const scoreColor =
    brgy.score == null ? '#65676b' :
    brgy.score >= 90 ? '#15803d' :
    brgy.score >= 80 ? '#d97706' : '#65676b'
  const ri = rank - 1

  return (
    <div style={{
      background: '#ffffff',
      border: `1px solid ${isUser ? '#16a34a' : '#e4e6eb'}`,
      borderRadius: 6,
      padding: '10px 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
      ...style,
    }}>
      {/* Rank badge */}
      <div style={{
        width: 30, height: 30, borderRadius: 6, flexShrink: 0,
        background: '#f0f2f5',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {ri < 3 && typeof rank === 'number' ? (() => {
          const RankIcon = RANK_ICONS[ri];
          return <RankIcon size={16} color={RANK_COLORS[ri]} />
        })() : <span style={{ fontSize: 11, fontWeight: 700, color: '#65676b' }}>{typeof rank === 'number' ? `#${rank}` : rank}</span>}
      </div>

      {/* Name + bar */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{
            fontWeight: 600, fontSize: 13,
            color: isUser ? '#15803d' : '#050505',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {brgy.name}
          </span>
          {isUser && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
              background: '#e7f3ed', color: '#166534',
              padding: '1px 5px', borderRadius: 4,
            }}>YOU</span>
          )}
        </div>
        {/* Score bar */}
        <div style={{ height: 4, borderRadius: 4, background: '#f0f2f5', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 4,
            width: `${brgy.score ?? 0}%`, background: scoreColor,
          }} />
        </div>
        <div style={{ fontSize: 11, color: '#65676b', marginTop: 2 }}>
          {brgy.population?.toLocaleString()} residents
        </div>
      </div>

      {/* Score + trend */}
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: scoreColor }}>{brgy.compliance == null ? '—' : `${brgy.compliance}%`}</div>
        <div style={{ fontSize: 9, color: '#65676b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>compliance</div>
        {(() => {
          const TrendIcon = trend.icon;
          return <TrendIcon size={14} color={trend.color} />
        })()}
      </div>
    </div>
  )
}
