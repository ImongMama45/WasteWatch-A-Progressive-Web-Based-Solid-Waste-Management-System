/**
 * NewsSearchBar.jsx
 * ------------------
 * Accessible search input with clear action, keyboard support,
 * and live result counts. Zero emojis.
 */

import { Search, X } from 'lucide-react'

export default function NewsSearchBar({
  value,
  onChange,
  resultCount,
  activeCategory = 'All',
  containerStyle,
}) {
  return (
    <div style={{ marginBottom: 18, ...containerStyle }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {/* Search icon */}
        <span
          style={{
            position: 'absolute',
            left: 14,
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            pointerEvents: 'none',
          }}
        >
          <Search size={16} strokeWidth={2.2} />
        </span>

        {/* Input */}
        <input
          type="search"
          aria-label="Search city announcements and news"
          placeholder={`Search ${activeCategory === 'All' ? 'announcements, cleanup drives, advisories...' : `${activeCategory.toLowerCase()}...`}`}
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{
            width: '100%',
            height: 44,
            paddingLeft: 40,
            paddingRight: value ? 38 : 14,
            borderRadius: 12,
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            fontSize: 13,
            color: '#0f172a',
            fontFamily: 'inherit',
            outline: 'none',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            transition: 'border-color .15s ease, box-shadow .15s ease',
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = '#16a34a'
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(22,163,74,0.15)'
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = '#cbd5e1'
            e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)'
          }}
        />

        {/* Clear query button */}
        {value && (
          <button
            type="button"
            aria-label="Clear search query"
            onClick={() => onChange('')}
            style={{
              position: 'absolute',
              right: 12,
              background: '#f1f5f9',
              border: 'none',
              borderRadius: '50%',
              width: 22,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#64748b',
              padding: 0,
            }}
          >
            <X size={13} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {/* Result Count and Active Search Feedback */}
      {value && resultCount !== undefined && (
        <div
          role="status"
          aria-live="polite"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#475569',
            marginTop: 8,
            paddingLeft: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>
            Found {resultCount} {resultCount === 1 ? 'result' : 'results'} for &ldquo;{value}&rdquo;
          </span>
          <button
            type="button"
            onClick={() => onChange('')}
            style={{
              background: 'none',
              border: 'none',
              color: '#16a34a',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Reset Search
          </button>
        </div>
      )}
    </div>
  )
}
