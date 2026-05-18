/**
 * CategoryTabs.jsx
 * -----------------
 * Horizontally scrollable filter tabs.
 */

import { CATEGORIES } from '../data/newsData'

export default function CategoryTabs({ active, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4,
      scrollbarWidth: 'none', marginBottom: 16,
    }}>
      {CATEGORIES.map(cat => {
        const isActive = active === cat
        return (
          <button
            key={cat}
            onClick={() => onChange(cat)}
            style={{
              flexShrink: 0, padding: '6px 14px',
              borderRadius: 20,
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'background .15s, color .15s, transform .1s',
              background: isActive ? 'var(--accent)' : 'var(--surface)',
              color: isActive ? '#0d1117' : 'var(--text-muted)',
              boxShadow: isActive ? '0 2px 8px rgba(46,204,113,.3)' : 'none',
              border: isActive ? '1.5px solid var(--accent)' : '1px solid var(--border)',
              transform: isActive ? 'translateY(-1px)' : 'none',
            }}
          >
            {cat}
          </button>
        )
      })}
    </div>
  )
}
