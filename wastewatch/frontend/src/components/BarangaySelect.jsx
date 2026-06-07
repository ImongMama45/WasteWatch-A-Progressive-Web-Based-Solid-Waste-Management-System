/**
 * components/BarangaySelect.jsx
 * -----------------------------
 * A simple dropdown component for selecting a barangay.
 * Uses native select for maximum compatibility across devices.
 */

import React from 'react'

export default function BarangaySelect({ barangays, value, onChange, label = 'Pumili ng barangay' }) {
  const isLoading = !barangays || barangays.length === 0;

  return (
    <div style={{ width: '100%', marginBottom: 12 }}>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="form-input"
        style={{
          width: '100%',
          background: 'var(--surface-2)',
          cursor: isLoading ? 'wait' : 'pointer',
          padding: '10px 12px',
          borderRadius: 8,
          border: '1.5px solid var(--border)',
          fontSize: 13,
          color: value ? 'var(--text)' : 'var(--text-muted)',
          appearance: 'none', // Remove default arrow in some browsers
          backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 12px center',
          backgroundSize: '14px',
          boxSizing: 'border-box',
        }}
        disabled={isLoading}
      >
        <option value="" disabled>{isLoading ? 'Loading barangays...' : label}</option>
        {!isLoading && barangays.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </div>
  )
}
