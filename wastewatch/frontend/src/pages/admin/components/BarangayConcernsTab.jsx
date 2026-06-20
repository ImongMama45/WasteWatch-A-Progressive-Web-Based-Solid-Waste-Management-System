import React from 'react'
import { useNavigate } from 'react-router-dom'

export default function BarangayConcernsTab({ detail }) {
  const concerns = detail.pending_concerns || []
  const hotspots = (detail.hotspots || []).filter(h => h.is_active !== false)
  const navigate = useNavigate()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', margin: 0 }}>
            PENDING CONCERNS
          </h3>
          <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>
            {concerns.length} report{concerns.length !== 1 ? 's' : ''}
          </span>
        </div>
        {concerns.length === 0
          ? <ConcernsEmptyState />
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {concerns.map(r => <ConcernRow key={r.id} report={r} navigate={navigate} />)}
            </div>
        }
      </section>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 800, color: '#94A3B8', letterSpacing: '.06em', margin: 0 }}>
            ACTIVE HOTSPOTS
          </h3>
          <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>
            {hotspots.length} hotspot{hotspots.length !== 1 ? 's' : ''}
          </span>
        </div>
        {hotspots.length === 0
          ? <HotspotsEmptyState />
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {hotspots.map(h => <HotspotRow key={h.id} hotspot={h} />)}
            </div>
        }
      </section>

    </div>
  )
}

function ConcernRow({ report, navigate }) {
  const severityColor = {
    high: { bg: '#FEF2F2', color: '#DC2626' },
    medium: { bg: '#FFFBEB', color: '#D97706' },
    low: { bg: '#F0FDF4', color: '#16A34A' },
  }[report.severity] || { bg: '#F1F5F9', color: '#475569' }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '14px 16px', background: '#fff',
      border: '1px solid #E2E8F0', borderRadius: 10,
      cursor: 'pointer', transition: 'background 0.15s',
    }}
    onClick={() => navigate(`/admin/reports/${report.id}`)}
    onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
        background: severityColor.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
      }}>
        {report.issue_type === 'garbage' ? '🗑️'
          : report.issue_type === 'flooding' ? '🌊'
          : '📋'}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', 
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {report.description || report.issue_type || 'No description'}
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          {report.address || 'No address'} · {report.user_name || 'Unknown reporter'}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '.05em',
          padding: '3px 8px', borderRadius: 20,
          background: severityColor.bg, color: severityColor.color
        }}>
          {(report.severity || 'unknown').toUpperCase()}
        </span>
        <span style={{ fontSize: 11, color: '#94A3B8' }}>
          {new Date(report.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      </div>

      <span style={{ color: '#CBD5E1', fontSize: 16, flexShrink: 0 }}>→</span>
    </div>
  )
}

function ConcernsEmptyState() {
  return (
    <div style={{ padding: '32px', textAlign: 'center', background: '#F8FAFC', borderRadius: 12, border: '1px dashed #E2E8F0' }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>No pending concerns</div>
      <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>This barangay has no unresolved reports.</div>
    </div>
  )
}

function HotspotRow({ hotspot }) {
  const severityMap = {
    high:   { bg: '#FEF2F2', color: '#DC2626', label: 'HIGH' },
    medium: { bg: '#FFFBEB', color: '#D97706', label: 'MEDIUM' },
    low:    { bg: '#FFF7ED', color: '#F59E0B', label: 'LOW' },
  }
  const s = severityMap[hotspot.severity] || { bg: '#F1F5F9', color: '#475569', label: 'UNKNOWN' }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '14px 16px', background: '#fff',
      border: `1px solid ${s.bg}`, borderRadius: 10,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
        background: s.bg, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 18
      }}>🔥</div>

      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
          {hotspot.name || hotspot.address || 'Unnamed Hotspot'}
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          {hotspot.report_count != null ? `${hotspot.report_count} linked reports` : ''}
          {hotspot.created_at
            ? ` · First reported ${new Date(hotspot.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            : ''}
        </div>
      </div>

      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: '.05em',
        padding: '3px 8px', borderRadius: 20,
        background: s.bg, color: s.color, flexShrink: 0
      }}>{s.label}</span>
    </div>
  )
}

function HotspotsEmptyState() {
  return (
    <div style={{ padding: '32px', textAlign: 'center', background: '#F8FAFC', borderRadius: 12, border: '1px dashed #E2E8F0' }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>🗺️</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A' }}>No active hotspots</div>
      <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>No recurring garbage issues recorded for this zone.</div>
    </div>
  )
}
