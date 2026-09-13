import React from 'react';

export function Fireworks() {
  const particles = Array.from({ length: 28 }, (_, i) => {
    const angle = (i / 28) * 360
    const dist = 80 + Math.random() * 60
    const x = Math.cos((angle * Math.PI) / 180) * dist
    const y = Math.sin((angle * Math.PI) / 180) * dist
    const colors = ['#2ecc71', '#3b82f6', '#f59e0b', '#ec4899', '#22d3ee', '#a78bfa', '#fff']
    const color = colors[i % colors.length]
    const delay = Math.random() * 0.4
    const size = 6 + Math.random() * 8
    return { x, y, color, delay, size }
  })

  return (
    <div style={{ position: 'relative', width: 200, height: 200, margin: '0 auto' }}>
      {particles.map((p, i) => (
        <div key={i} style={{
          position: 'absolute', top: '50%', left: '50%',
          width: p.size, height: p.size,
          borderRadius: i % 3 === 0 ? '50%' : '2px',
          background: p.color,
          animation: `fwBurst 1.2s cubic-bezier(.22,.61,.36,1) ${p.delay}s both`,
          '--tx': `${p.x}px`, '--ty': `${p.y}px`,
        }} />
      ))}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fwCheck .5s cubic-bezier(.36,.07,.19,.97) .2s both',
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%', background: '#1e2a3a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 32px rgba(15,23,42,0.3)',
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="36" height="36">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ icon, label, value }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0', borderBottom: '1px solid #f1f5f9',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 14, color: '#64748b', fontWeight: 600 }}>{label}</span>
      </div>
      <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{value}</span>
    </div>
  )
}

export default function CelebrationScreen({ title, subtitle, stats, onDone, doneText = 'Back to Dashboard' }) {
  return (
    <>
      <style>{`
        @keyframes fwBurst {
          0%   { transform: translate(-50%,-50%) scale(1); opacity:1; }
          100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(0); opacity:0; }
        }
        @keyframes fwCheck {
          0%  { transform:scale(0); opacity:0; }
          60% { transform:scale(1.12); }
          80% { transform:scale(0.96); }
          100%{ transform:scale(1); opacity:1; }
        }
        @keyframes esFadeUp {
          from { opacity:0; transform:translateY(10px); }
          to   { opacity:1; transform:translateY(0); }
        }
        .es-fade1 { animation: esFadeUp .3s ease .1s both; }
        .es-fade2 { animation: esFadeUp .3s ease .4s both; }
        .es-fade3 { animation: esFadeUp .3s ease .6s both; }
      `}</style>

      <div style={{
        height: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column',
        background: '#f8fafc', fontFamily: 'var(--font-body)', overflowY: 'auto',
        marginTop: 60 // account for fixed navbar
      }}>
        <div style={{ padding: '32px 20px 0', textAlign: 'center' }}>
          <h1 className="es-fade1" style={{
            fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 900,
            color: '#0f172a', marginBottom: 6,
          }}>
            {title}
          </h1>
          <p className="es-fade1" style={{ color: '#64748b', fontSize: 14, marginBottom: 0 }}>
            {subtitle}
          </p>
        </div>

        <div style={{ padding: '24px 20px', textAlign: 'center' }}>
          <Fireworks />
        </div>

        <div className="es-fade2" style={{ padding: '0 20px', marginBottom: 24 }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '4px 16px',
            border: '1px solid #e2e8f0', boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          }}>
            {stats.map((s, i) => <SummaryRow key={i} {...s} />)}
          </div>
        </div>

        <div className="es-fade3" style={{ padding: '0 20px 32px', marginTop: 'auto' }}>
          <button
            onClick={onDone}
            style={{
              width: '100%', padding: '17px', borderRadius: 14,
              background: '#0f172a', color: '#fff', border: 'none',
              fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 900,
              cursor: 'pointer', marginBottom: 10,
              boxShadow: '0 6px 20px rgba(15,23,42,0.25)', letterSpacing: '.04em',
            }}
          >
            {doneText}
          </button>
        </div>

        <div style={{
          background: '#0f172a', padding: '16px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, letterSpacing: '.06em' }}>
            Track · Monitor · Report
          </span>
        </div>
      </div>
    </>
  )
}
