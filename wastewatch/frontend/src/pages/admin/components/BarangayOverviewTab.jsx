import React, { useEffect, useRef } from 'react'

export default function BarangayOverviewTab({ detail, barangayId }) {
  const mapContainerRef = useRef(null)

  useEffect(() => {
    if (!window.L || !mapContainerRef.current || !detail) return

    const L = window.L
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: false,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)

    // Boundary polygon — muted fill so tile layer shows through
    let geojson = detail.boundary_geojson
    if (typeof geojson === 'string') {
      try { geojson = JSON.parse(geojson) } catch (e) {}
    }

    if (geojson) {
      const normalized = geojson.type === 'FeatureCollection' || geojson.type === 'Feature'
        ? geojson
        : { type: 'Feature', geometry: geojson, properties: {} }
      const poly = L.geoJSON(normalized, {
        style: { color: '#2563EB', weight: 2, fillColor: '#2563EB', fillOpacity: 0.08 }
      }).addTo(map)
      map.fitBounds(poly.getBounds(), { padding: [24, 24] })
    } else {
      // Fallback: centroid marker if no polygon
      if (detail.latitude && detail.longitude) {
        map.setView([Number(detail.latitude), Number(detail.longitude)], 15)
        L.marker([Number(detail.latitude), Number(detail.longitude)], {
          icon: L.divIcon({ html: '<div style="font-size:20px">📍</div>', className: '', iconAnchor: [10, 20] })
        }).bindPopup('Boundary not yet mapped').addTo(map)
      } else {
        map.setView([13.93, 121.61], 13) // Default to Lucena
      }
    }

    // Hotspot pins — color by severity if available, else default red
    detail.hotspots?.forEach(h => {
      const color = h.severity === 'high' ? '#DC2626' : h.severity === 'medium' ? '#D97706' : '#F59E0B'
      L.circleMarker([Number(h.lat || h.latitude), Number(h.lng || h.longitude)], {
        radius: 8, fillColor: color, color: '#fff', weight: 2, fillOpacity: 0.9
      }).bindPopup(`<b>${h.name || 'Hotspot'}</b><br/>${h.description || ''}`)
        .addTo(map)
    })

    return () => { map.remove() }
  }, [barangayId, detail])

  const statCards = [
    { 
      label: 'Pending Concerns', 
      value: Array.isArray(detail.pending_concerns) 
        ? detail.pending_concerns.length 
        : (detail.pending_concern_count ?? 0), 
      warn: (Array.isArray(detail.pending_concerns) ? detail.pending_concerns.length : detail.pending_concern_count) > 5, 
      icon: '📋' 
    },
    { 
      label: 'Active Hotspots', 
      value: Array.isArray(detail.hotspots) 
        ? detail.hotspots.filter(h => h.is_active !== false).length 
        : (detail.active_hotspot_count ?? 0),
      warn: (Array.isArray(detail.hotspots) ? detail.hotspots.length : detail.active_hotspot_count) > 3, 
      icon: '🔥' 
    },
    { 
      label: 'Open Escalations', 
      value: Array.isArray(detail.escalations) 
        ? detail.escalations.filter(e => !e.resolved).length 
        : (detail.open_escalation_count ?? 0),
      warn: (Array.isArray(detail.escalations) ? detail.escalations.length : detail.open_escalation_count) > 0, 
      icon: '⚠️' 
    },
    { 
      label: 'Personnel', 
      value: (detail.officials?.length || 0) + (detail.watchers?.length || 0) + (detail.drivers?.length || 0), 
      warn: detail.has_unassigned_roles, 
      icon: '👥' 
    },
  ]

  return (
    <div>
      <div ref={mapContainerRef} style={{ height: 280, borderRadius: 12, border: '1px solid #E2E8F0', marginBottom: 20, zIndex: 1 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {statCards.map(stat => (
          <div key={stat.label} style={{
            background: '#fff', padding: 20, borderRadius: 12,
            border: `1px solid ${stat.warn ? '#FCA5A5' : '#E2E8F0'}`,
            display: 'flex', alignItems: 'center', gap: 16
          }}>
            <div style={{ fontSize: 24 }}>{stat.icon}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {stat.label}
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>
                {stat.value}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
