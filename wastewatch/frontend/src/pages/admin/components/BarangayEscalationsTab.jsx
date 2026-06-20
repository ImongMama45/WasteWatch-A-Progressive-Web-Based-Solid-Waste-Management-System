import React from 'react'
import { useNavigate } from 'react-router-dom'

export default function BarangayEscalationsTab({ detail }) {
  const escalations = detail.escalations || []
  const open = escalations.filter(e => e.status !== 'resolved')
  const resolved = escalations.filter(e => e.status === 'resolved')
  const navigate = useNavigate()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', margin: 0 }}>
            OPEN ESCALATIONS
          </h3>
          <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>
            {open.length} open
          </span>
        </div>

        {open.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', background: '#F0FDF4', borderRadius: 12, border: '1px dashed #BBF7D0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>No open escalations</div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>This barangay has no unresolved escalations.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {open.map(e => <EscalationRow key={e.id} escalation={e} navigate={navigate} />)}
          </div>
        )}
      </section>

      {resolved.length > 0 && (
        <section>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#CBD5E1', letterSpacing: '.06em', marginBottom: 12 }}>
            RECENTLY RESOLVED
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resolved.slice(0, 5).map(e => <EscalationRow key={e.id} escalation={e} muted navigate={navigate} />)}
          </div>
        </section>
      )}

    </div>
  )
}

function EscalationRow({ escalation, muted = false, navigate }) {
  const severityMap = {
    critical: { bg: '#FEF2F2', color: '#DC2626' },
    high:     { bg: '#FFF7ED', color: '#EA580C' },
    medium:   { bg: '#FFFBEB', color: '#D97706' },
    low:      { bg: '#F0FDF4', color: '#16A34A' },
  }
  const s = severityMap[escalation.priority] || { bg: '#F1F5F9', color: '#475569' }
  const isResolved = escalation.status === 'resolved'

  return (
    <div
      onClick={() => navigate(`/admin/escalations/${escalation.id}`)}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '14px 16px', background: muted ? '#F8FAFC' : '#fff',
        border: '1px solid #E2E8F0', borderRadius: 10,
        cursor: 'pointer', opacity: muted ? 0.7 : 1,
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#F1F5F9'}
      onMouseLeave={e => e.currentTarget.style.background = muted ? '#F8FAFC' : '#fff'}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
        background: s.bg, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 18
      }}>
        {isResolved ? '✅' : '🚨'}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: '#0F172A',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>
          {escalation.title || escalation.notes || 'Untitled Escalation'}
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          Submitted by {escalation.raised_by || 'Unknown'}
          {escalation.created_at
            ? ` · ${new Date(escalation.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            : ''}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '.05em',
          padding: '3px 8px', borderRadius: 20,
          background: s.bg, color: s.color
        }}>
          {(escalation.priority || 'unknown').toUpperCase()}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '.04em',
          padding: '3px 8px', borderRadius: 20,
          background: isResolved ? '#F0FDF4' : '#FEF2F2',
          color: isResolved ? '#16A34A' : '#DC2626'
        }}>
          {isResolved ? 'RESOLVED' : 'OPEN'}
        </span>
      </div>

      <span style={{ color: '#CBD5E1', fontSize: 16, flexShrink: 0 }}>→</span>
    </div>
  )
}
