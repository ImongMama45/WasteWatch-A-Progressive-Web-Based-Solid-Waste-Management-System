/**
 * BarangayScopeSelector.jsx
 * -------------------------
 * Accessible municipal scope dropdown for Lucena City public notices.
 * Options:
 * 1. All Lucena City (scope: 'all')
 * 2. City-Wide Only (scope: 'city_wide')
 * 3. 33 Lucena City Barangays (scope: '<id>') sorted alphabetically.
 *
 * Zero emojis. Material / Lucide SVG icons only.
 */

import { MapPin, ChevronDown } from 'lucide-react'

export default function BarangayScopeSelector({
  value = 'all',
  onChange,
  barangays = [],
  isLoading = false,
}) {
  // Sort barangays alphabetically by name for consistent option ordering
  const sortedBarangays = [...(barangays || [])].sort((a, b) => {
    const nameA = a?.name || ''
    const nameB = b?.name || ''
    return nameA.localeCompare(nameB)
  })

  const isCustomScope = value !== 'all'

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        minWidth: 200,
        width: '100%',
      }}
    >
      <label htmlFor="barangay-scope-select" style={{ display: 'none' }}>
        Filter notices by Lucena City barangay scope
      </label>

      {/* MapPin Icon */}
      <span
        style={{
          position: 'absolute',
          left: 14,
          color: isCustomScope ? '#16a34a' : '#64748b',
          display: 'flex',
          alignItems: 'center',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      >
        <MapPin size={16} strokeWidth={2.2} />
      </span>

      {/* Native Select with custom styling */}
      <select
        id="barangay-scope-select"
        aria-label="Filter notices by Lucena City barangay scope"
        value={value || 'all'}
        onChange={e => onChange?.(e.target.value)}
        disabled={isLoading && sortedBarangays.length === 0}
        style={{
          width: '100%',
          height: 44,
          paddingLeft: 38,
          paddingRight: 34,
          borderRadius: 12,
          border: isCustomScope ? '1.5px solid #16a34a' : '1px solid #cbd5e1',
          background: isCustomScope ? '#f0fdf4' : '#ffffff',
          color: isCustomScope ? '#15803d' : '#0f172a',
          fontSize: 13,
          fontWeight: isCustomScope ? 700 : 600,
          fontFamily: 'inherit',
          outline: 'none',
          appearance: 'none',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          transition: 'all .15s ease',
        }}
      >
        <option value="all">All Lucena City</option>
        <option value="city_wide">City-Wide Only</option>
        {sortedBarangays.length > 0 ? (
          <optgroup label="Lucena City Barangays">
            {sortedBarangays.map(b => (
              <option key={b.id} value={String(b.id)}>
                {b.name}
              </option>
            ))}
          </optgroup>
        ) : isLoading ? (
          <option disabled value="">
            Loading barangays...
          </option>
        ) : null}
      </select>

      {/* Dropdown Chevron */}
      <span
        style={{
          position: 'absolute',
          right: 12,
          color: isCustomScope ? '#16a34a' : '#64748b',
          display: 'flex',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        <ChevronDown size={15} strokeWidth={2.2} />
      </span>
    </div>
  )
}
