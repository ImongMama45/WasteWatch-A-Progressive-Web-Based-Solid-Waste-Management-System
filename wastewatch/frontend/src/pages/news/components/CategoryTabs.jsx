/**
 * CategoryTabs.jsx
 * -----------------
 * Horizontally scrollable accessible filter tabs with category icons.
 * Supports canonical internal identifiers and public display labels.
 * Zero emojis.
 */

import { CATEGORY_TABS, CATEGORY_CONFIG } from '../utils/newsConfig'
import { LayoutGrid } from 'lucide-react'

export default function CategoryTabs({ active = 'All', onChange, counts = {} }) {
  return (
    <div
      role="tablist"
      aria-label="Filter news by category"
      style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        paddingBottom: 6,
        scrollbarWidth: 'none',
        marginBottom: 20,
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {CATEGORY_TABS.map(tab => {
        const id = typeof tab === 'object' ? tab.id : tab
        const label = typeof tab === 'object' ? tab.label : tab
        const isActive = active === id || (id === 'All' && active === 'All Notices')
        const cfg = CATEGORY_CONFIG[id] || CATEGORY_CONFIG[label]
        const Icon = id === 'All' ? LayoutGrid : cfg?.Icon || LayoutGrid
        const count = counts[id] ?? counts[label]

        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(id)}
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: isActive ? 700 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all .15s ease',
              background: isActive ? '#16a34a' : '#ffffff',
              color: isActive ? '#ffffff' : '#475569',
              border: isActive ? '1px solid #16a34a' : '1px solid #cbd5e1',
            }}
          >
            <Icon size={12} strokeWidth={2.2} style={{ color: isActive ? '#ffffff' : '#64748b' }} />
            <span>{label}</span>
            {typeof count === 'number' && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: isActive ? 'rgba(255,255,255,0.25)' : '#f1f5f9',
                  color: isActive ? '#ffffff' : '#64748b',
                }}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
