import React from 'react'

export default function StopCompletedOverlay({ task, onNext, totalStops, pendingCount, type }) {
  if (!task) return null;
  // Calculate completed count. Ensure it's at least 1 since they just completed a task.
  const completed = Math.max(1, totalStops - pendingCount);
  const progress = totalStops > 0 ? Math.round((completed / totalStops) * 100) : 0;
  
  return (
    <div style={{ 
      position: 'fixed', inset: 0, zIndex: 3000, 
      background: '#f8fafc', display: 'flex', flexDirection: 'column',
      animation: 'scoFadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1)'
    }}>
      <style>{`
        @keyframes scoFadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      
      {/* Header */}
      <div style={{ 
        padding: '60px 24px 40px', 
        background: 'linear-gradient(160deg, #0f172a 60%, #1e3a5f)', 
        color: '#fff', textAlign: 'center',
        borderBottomLeftRadius: 30, borderBottomRightRadius: 30,
        boxShadow: '0 10px 30px rgba(0,0,0,0.15)'
      }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
        <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 28, fontWeight: 900, margin: '0 0 10px', letterSpacing: '.02em' }}>
          Well done!
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 15, margin: 0, lineHeight: 1.5 }}>
          {type === 'pre' ? 'Inspection verified for' : 'Collection confirmed for'}<br/>
          <strong style={{ color: '#fff', fontSize: 17, display: 'inline-block', marginTop: 4 }}>{task.label || `Stop ${task.stop_order}`}</strong>
        </p>
      </div>

      <div style={{ padding: 24, flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Progress */}
        <div style={{ 
          background: '#fff', border: '1px solid #e2e8f0', 
          borderRadius: 16, padding: 20, marginTop: -20,
          boxShadow: '0 4px 20px rgba(0,0,0,0.06)' 
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: '.08em' }}>
              TODAY'S PROGRESS
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>
              {completed} / {totalStops} stops
            </div>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}>
            <div style={{ 
              width: `${progress}%`, height: '100%', 
              background: 'linear-gradient(90deg,#2ecc71,#16a34a)', 
              transition: 'width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)' 
            }} />
          </div>
        </div>

        <div style={{ marginTop: 'auto', paddingBottom: 20 }}>
          <button 
            onClick={onNext} 
            style={{ 
              width: '100%', padding: '18px', borderRadius: 30, 
              background: '#0f172a', color: '#fff', border: 'none', 
              fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900, 
              cursor: 'pointer', boxShadow: '0 6px 20px rgba(15,23,42,0.3)',
              letterSpacing: '.04em', transition: 'transform 0.1s'
            }}
            onPointerDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
            onPointerUp={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            Back to Map
          </button>
        </div>
      </div>
    </div>
  )
}
