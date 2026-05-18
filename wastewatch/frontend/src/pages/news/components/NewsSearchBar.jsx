/**
 * NewsSearchBar.jsx
 * ------------------
 * Search input + filter trigger.
 * Icons: Search, SlidersHorizontal (Lucide React).
 */

import { Search, SlidersHorizontal } from 'lucide-react'

export default function NewsSearchBar({ value, onChange, onFilterClick, resultCount }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ position: 'relative', display: 'flex', gap: 8 }}>
        {/* Search input */}
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{
            position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
            pointerEvents: 'none',
          }}>
            <Search size={15} strokeWidth={2} />
          </span>
          <input
            type="text"
            className="form-input"
            placeholder="Search news, announcements..."
            value={value}
            onChange={e => onChange(e.target.value)}
            style={{ paddingLeft: 34, paddingRight: 12 }}
          />
        </div>

        {/* Filter button */}
        {onFilterClick && (
          <button
            onClick={onFilterClick}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 40, height: 40, borderRadius: 'var(--radius)',
              background: 'var(--surface)', border: '1px solid var(--border)',
              color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0,
              transition: 'border-color .15s, color .15s',
            }}
            title="Filter"
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
          >
            <SlidersHorizontal size={16} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Result count hint */}
      {value && resultCount !== undefined && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, paddingLeft: 2 }}>
          {resultCount} result{resultCount !== 1 ? 's' : ''} for &ldquo;{value}&rdquo;
        </div>
      )}
    </div>
  )
}
