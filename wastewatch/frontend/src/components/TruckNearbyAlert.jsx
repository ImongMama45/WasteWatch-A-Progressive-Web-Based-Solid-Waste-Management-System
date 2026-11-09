import React from 'react';

/**
 * Floating notification alert shown when a garbage truck is in proximity.
 * Uses role="alert" and aria-live="polite" for accessibility.
 */
export default function TruckNearbyAlert({ truck, onDismiss }) {
  if (!truck) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 70, // Leaves room for standard navbars
        right: 20,
        zIndex: 50, // Separate z-index scale vs standard toasts (9999)
        background: 'var(--accent, #2ecc71)',
        color: '#fff',
        padding: '12px 16px',
        borderRadius: '12px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        animation: 'fadeSlideIn 0.3s ease-out'
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: '15px', marginBottom: '2px' }}>
          Truck Nearby
        </div>
        <div style={{ fontSize: '12px', opacity: 0.9 }}>
          Approximately {truck.distance || '50m'}
        </div>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss alert"
        style={{
          background: 'rgba(255,255,255,0.2)',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          borderRadius: '50%',
          width: '24px',
          height: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          padding: 0,
        }}
      >
        <span style={{ fontSize: '12px', fontWeight: 'bold' }}>✕</span>
      </button>
    </div>
  );
}
